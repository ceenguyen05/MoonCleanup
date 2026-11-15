// M0 close-out (netcode review NB1, NB5): per-IP seat cap with `retry-after`, handshake/silence close (4107) through
// the real HelloRoom, the IdleWatch unit rules, and the ws backpressure sweep. Runs on the `ws` transport (no native
// addon needed); each server binds port 0.

import { ColyseusTestServer } from "@colyseus/testing";
import { CloseCode, MESSAGE_CATALOG, PROTOCOL_VERSION } from "@moon-cleanup/shared";
import { PING_BODY_BYTES, writePingBody } from "@moon-cleanup/protocol";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MAX_SEATS_PER_IP, type AdmissionLimits } from "./admission";
import { createGameServer, type GameServer } from "./game-server";
import { HELLO_JOIN_PATH, type HelloJoinResponse } from "./hello-join-route";
import type { NetLogger } from "./http-routes";
import { IdleWatch, type IdleLimits } from "./idle-watch";
import { terminateBackpressured } from "./ws-transport";

const ALLOWED = "http://localhost:5177";
const silent: NetLogger = { info() {}, warn() {}, error() {}, debug() {} };

let server: GameServer | undefined;

afterEach(async () => {
  await server?.gracefullyShutdown();
  server = undefined;
});

async function boot(admission: AdmissionLimits, helloIdle?: Partial<IdleLimits>): Promise<string> {
  server = await createGameServer({
    port: 0,
    routes: [],
    allowedOrigins: [ALLOWED],
    logger: silent,
    rates: { simTickHz: 20, snapshotHz: 10 },
    serverBuild: "test-build",
    transport: "ws",
    admission: { roomCreatesPerIpPerMin: 1000, ...admission },
    ...(helloIdle === undefined ? {} : { helloIdle }),
  });
  const port = await server.listen();
  return `http://127.0.0.1:${port}`;
}

function reserve(base: string, ip: string): Promise<Response> {
  return fetch(`${base}${HELLO_JOIN_PATH}`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: ALLOWED, "true-client-ip": ip },
    body: JSON.stringify({ protocolVersion: PROTOCOL_VERSION, clientBuild: "test" }),
  });
}

async function join(base: string, ip: string) {
  const res = await reserve(base, ip);
  expect(res.status).toBe(200);
  const { reservation } = (await res.json()) as HelloJoinResponse;
  const gs = server as GameServer;
  Reflect.set(gs.colyseus, "port", gs.port);
  const testServer = new ColyseusTestServer(gs.colyseus);
  testServer.sdk.http.options.headers = { Origin: ALLOWED };
  const room = await testServer.sdk.consumeSeatReservation(reservation);
  const closed = new Promise<number>((resolve) => room.onLeave((code: number) => resolve(code)));
  return { room, closed };
}

const pingBody = new Uint8Array(PING_BODY_BYTES);
function ping(room: { sendBytes(type: number, bytes: Uint8Array): void }): void {
  writePingBody(Date.now(), pingBody);
  room.sendBytes(MESSAGE_CATALOG.PING.id, pingBody);
}

describe("NB1 per-IP seat cap", () => {
  it("defaults to one full room of seats", () => {
    expect(MAX_SEATS_PER_IP).toBe(6);
  });

  it("refuses the seat over the cap with 429 RATE_LIMITED + retry-after, other IPs unaffected, freed on leave", async () => {
    const base = await boot({ maxRooms: 3, maxClients: 12, maxSeatsPerIp: 2 });
    const first = await join(base, "203.0.113.1");
    expect((await reserve(base, "203.0.113.1")).status).toBe(200);
    expect(server?.admission.seatsOf("203.0.113.1")).toBe(2);

    const refused = await reserve(base, "203.0.113.1");
    expect(refused.status).toBe(429);
    expect(refused.headers.get("retry-after")).toBe("15");
    expect(await refused.json()).toEqual({ error: "RATE_LIMITED", message: "seats per ip" });
    expect(server?.admission.refused.seats).toBe(1);
    expect((await reserve(base, "203.0.113.2")).status).toBe(200);

    // A joined seat that leaves frees its slot (the other reservation is still unconsumed and counts).
    await first.room.leave();
    await expect.poll(() => server?.admission.seatsOf("203.0.113.1"), { timeout: 3000 }).toBe(1);
    expect((await reserve(base, "203.0.113.1")).status).toBe(200);
  });

  it("does not limit a solo player (one seat, default cap)", async () => {
    const base = await boot({ maxRooms: 3, maxClients: 12 });
    const solo = await join(base, "198.51.100.7");
    expect(server?.admission.seatsOf("198.51.100.7")).toBe(1);
    await solo.room.leave();
  });
});

describe("NB1 handshake and silence close (4107)", () => {
  it("closes a seat that never sends an app message, keeps one that pings, then closes it once it falls silent", async () => {
    const base = await boot({ maxRooms: 3, maxClients: 12 }, { handshakeMs: 400, silenceMs: 900 });
    const silent1 = await join(base, "203.0.113.10");
    const talker = await join(base, "203.0.113.11");
    ping(talker.room);

    const timer = setInterval(() => ping(talker.room), 150);
    try {
      expect(await silent1.closed).toBe(CloseCode.IDLE_TIMEOUT);
      // The talker outlived the silent seat's handshake limit because it kept pinging.
      expect(talker.room.connection.isOpen).toBe(true);
    } finally {
      clearInterval(timer);
    }
    // Now it is silent: closed after silenceMs (+ up to a 1 s sweep).
    expect(await talker.closed).toBe(CloseCode.IDLE_TIMEOUT);
    await expect.poll(() => server?.admission.seatsOf("203.0.113.10"), { timeout: 3000 }).toBe(0);
  }, 15_000);
});

describe("IdleWatch", () => {
  function fake(sessionId: string) {
    return { sessionId, leave: vi.fn() };
  }

  it("enforces the handshake limit before the first message and the silence limit after", () => {
    const watch = new IdleWatch({ handshakeMs: 100, silenceMs: 1000 });
    const a = fake("a");
    const b = fake("b");
    watch.add(a, 0);
    watch.add(b, 0);
    watch.touch("b", 50);
    expect(watch.sweep(99)).toBe(0);
    expect(watch.sweep(100)).toBe(1);
    expect(a.leave).toHaveBeenCalledWith(CloseCode.IDLE_TIMEOUT);
    expect(b.leave).not.toHaveBeenCalled();
    expect(watch.sweep(1049)).toBe(0);
    expect(watch.sweep(1050)).toBe(1);
    expect(b.leave).toHaveBeenCalledTimes(1);
    expect(watch.size).toBe(0);
    expect(watch.closed).toBe(2);
  });

  it("forgets removed clients and survives a client that throws on leave", () => {
    const watch = new IdleWatch({ handshakeMs: 10 });
    const gone = fake("gone");
    const boom = {
      sessionId: "boom",
      leave: vi.fn(() => {
        throw new Error("closed");
      }),
    };
    watch.add(gone, 0);
    watch.add(boom, 0);
    watch.remove("gone");
    expect(() => watch.sweep(50)).not.toThrow();
    expect(gone.leave).not.toHaveBeenCalled();
    expect(boom.leave).toHaveBeenCalledTimes(1);
  });
});

describe("ws backpressure sweep (security review B1c / NB5)", () => {
  it("terminates only the sockets whose send buffer is over the limit", () => {
    const over = { bufferedAmount: 129, terminate: vi.fn() };
    const at = { bufferedAmount: 128, terminate: vi.fn() };
    const idle = { bufferedAmount: 0, terminate: vi.fn() };
    expect(terminateBackpressured(new Set([over, at, idle]), 128)).toBe(1);
    expect(over.terminate).toHaveBeenCalledTimes(1);
    expect(at.terminate).not.toHaveBeenCalled();
    expect(idle.terminate).not.toHaveBeenCalled();
  });

  it("the running transport sweeps wss.clients once a second", async () => {
    await boot({ maxRooms: 1, maxClients: 2 });
    const wss = Reflect.get(Reflect.get(server?.colyseus as object, "transport") as object, "wss") as {
      clients: Set<unknown>;
    };
    const stuck = { bufferedAmount: 10 * 1024 * 1024, terminate: vi.fn(() => wss.clients.delete(stuck)) };
    const healthy = { bufferedAmount: 1024, terminate: vi.fn() };
    wss.clients.add(stuck);
    wss.clients.add(healthy);
    try {
      await expect.poll(() => stuck.terminate.mock.calls.length, { timeout: 3000, interval: 100 }).toBe(1);
      expect(healthy.terminate).not.toHaveBeenCalled();
    } finally {
      wss.clients.delete(stuck);
      wss.clients.delete(healthy);
    }
  }, 10_000);
});
