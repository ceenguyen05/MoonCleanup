// Security review fix batch: B1 (MAX_ROOMS / MAX_CLIENTS / per-IP room creation / per-IP sockets), N2 (unknown
// bucket), N3 (malformed percent-encoding on a real uWS server), N4/N5 (request spam and PING overflow are
// violations), N1 (socket mode). Each server binds port 0; servers run one after another (the Colyseus matchmaker
// is a process-wide singleton).
import "./testing/uws-esm-fix";

import { request as httpRequest, type ClientRequest } from "node:http";
import { matchMaker } from "@colyseus/core";
import { ColyseusTestServer } from "@colyseus/testing";
import { CloseCode, MESSAGE_CATALOG, PROTOCOL_VERSION, type HttpRouteDef } from "@moon-cleanup/shared";
import { PING_BODY_BYTES } from "@moon-cleanup/protocol";
import { afterEach, describe, expect, it } from "vitest";
import { IpRateLimiter, MAX_SOCKETS_PER_IP, type AdmissionLimits } from "./admission";
import { UNKNOWN_CLIENT_IP } from "./client-ip";
import { createGameServer, type GameServer } from "./game-server";
import { HELLO_JOIN_PATH, ROOM_JOINS_UNKNOWN_PER_MIN, type HelloJoinResponse } from "./hello-join-route";
import type { HelloRoom } from "./hello-room";
import type { NetLogger } from "./http-routes";

const ALLOWED = "http://localhost:5177";
const silent: NetLogger = { info() {}, warn() {}, error() {}, debug() {} };

const echo: HttpRouteDef = {
  method: "GET",
  path: "/v1/echo/:id",
  handle: (req) => ({ status: 200, body: { id: req.params.id, ip: req.remoteAddress } }),
};

let server: GameServer | undefined;

afterEach(async () => {
  await server?.gracefullyShutdown();
  server = undefined;
});

async function boot(admission: AdmissionLimits, clientIpHeader?: string | null): Promise<string> {
  server = await createGameServer({
    port: 0,
    routes: [echo],
    allowedOrigins: [ALLOWED],
    logger: silent,
    rates: { simTickHz: 20, snapshotHz: 10 },
    serverBuild: "test-build",
    // Pinned: these suites test the uWS adapter (game-server-ws.test.ts covers the ws fallback).
    transport: "uws",
    admission,
    ...(clientIpHeader === undefined ? {} : { clientIpHeader }),
  });
  const port = await server.listen();
  return `http://127.0.0.1:${port}`;
}

function reserve(base: string, ip?: string): Promise<Response> {
  const headers: Record<string, string> = { "content-type": "application/json", origin: ALLOWED };
  if (ip !== undefined) headers["true-client-ip"] = ip;
  return fetch(`${base}${HELLO_JOIN_PATH}`, {
    method: "POST",
    headers,
    body: JSON.stringify({ protocolVersion: PROTOCOL_VERSION, clientBuild: "test" }),
  });
}

async function reserveMany(base: string, n: number, ip: (i: number) => string): Promise<number[]> {
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push((await reserve(base, ip(i))).status);
  return out;
}

/** Opens a raw upgrade; resolves the status and keeps the socket open until `close()` is called. */
function upgrade(base: string, ip: string): Promise<{ status: number; close: () => void }> {
  const url = new URL(base);
  return new Promise((resolve, reject) => {
    const req: ClientRequest = httpRequest({
      host: url.hostname,
      port: Number(url.port),
      path: "/",
      headers: {
        connection: "Upgrade",
        upgrade: "websocket",
        "sec-websocket-key": "dGhlIHNhbXBsZSBub25jZQ==",
        "sec-websocket-version": "13",
        origin: ALLOWED,
        "true-client-ip": ip,
      },
    });
    req.on("upgrade", (res, socket) => resolve({ status: res.statusCode ?? 0, close: () => socket.destroy() }));
    req.on("response", (res) => {
      res.resume();
      resolve({ status: res.statusCode ?? 0, close: () => undefined });
    });
    req.on("error", reject);
    req.end();
  });
}

describe("B1 join admission", () => {
  it("refuses with 503 at_capacity:rooms once MAX_ROOMS rooms are full (4th room at MAX_ROOMS=3)", async () => {
    const base = await boot({ maxRooms: 3, maxClients: 100 });
    const statuses = await reserveMany(base, 18, (i) => `203.0.113.${Math.floor(i / 6) + 1}`);
    expect(statuses.every((s) => s === 200)).toBe(true);
    expect(matchMaker.stats.local.roomCount).toBe(3);
    const refused = await reserve(base, "203.0.113.50");
    expect(refused.status).toBe(503);
    expect(refused.headers.get("retry-after")).toBe("30");
    expect(await refused.json()).toEqual({ error: "AT_CAPACITY", message: "at_capacity:rooms" });
    expect(matchMaker.stats.local.roomCount).toBe(3);
    expect(server?.admission.refused.rooms).toBe(1);
  });

  it("refuses with 503 at_capacity:clients at MAX_CLIENTS (reservations count)", async () => {
    const base = await boot({ maxRooms: 3, maxClients: 8 });
    const statuses = await reserveMany(base, 8, (i) => `198.51.100.${i + 1}`);
    expect(statuses.every((s) => s === 200)).toBe(true);
    const refused = await reserve(base, "198.51.100.99");
    expect(refused.status).toBe(503);
    expect(await refused.json()).toEqual({ error: "AT_CAPACITY", message: "at_capacity:clients" });
  });

  it("holds the room ceiling under concurrent joins", async () => {
    const base = await boot({ maxRooms: 1, maxClients: 100 });
    const statuses = await Promise.all(Array.from({ length: 12 }, (_, i) => reserve(base, `192.0.2.${i + 1}`)));
    const codes = statuses.map((r) => r.status);
    expect(codes.filter((s) => s === 200)).toHaveLength(6);
    expect(codes.filter((s) => s === 503)).toHaveLength(6);
    expect(matchMaker.stats.local.roomCount).toBe(1);
  });

  it("rate-limits room creation per IP (429) without blocking joins into a room with free seats", async () => {
    const base = await boot({ maxRooms: 3, maxClients: 100, roomCreatesPerIpPerMin: 1 });
    expect(await reserveMany(base, 6, () => "203.0.113.7")).toEqual([200, 200, 200, 200, 200, 200]);
    const second = await reserve(base, "203.0.113.7");
    expect(second.status).toBe(429);
    expect(await second.json()).toEqual({ error: "RATE_LIMITED", message: "room creation" });
    expect((await reserve(base, "203.0.113.8")).status).toBe(200);
    // The new room has free seats now: the first IP may join it.
    expect((await reserve(base, "203.0.113.7")).status).toBe(200);
  });
});

describe("B1 per-IP WebSocket cap at upgrade", () => {
  it(`accepts ${MAX_SOCKETS_PER_IP} sockets per IP, refuses the next with 429 and frees slots on close`, async () => {
    const base = await boot({ maxRooms: 3, maxClients: 12 });
    const open = [];
    for (let i = 0; i < MAX_SOCKETS_PER_IP; i++) open.push(await upgrade(base, "203.0.113.9"));
    expect(open.map((o) => o.status)).toEqual(Array.from({ length: MAX_SOCKETS_PER_IP }, () => 101));
    const ninth = await upgrade(base, "203.0.113.9");
    expect(ninth.status).toBe(429);
    const other = await upgrade(base, "203.0.113.10");
    expect(other.status).toBe(101);
    for (const o of [...open, other]) o.close();
    await expect.poll(() => server?.admission.socketsOf("203.0.113.9"), { timeout: 3000 }).toBe(0);
    const again = await upgrade(base, "203.0.113.9");
    expect(again.status).toBe(101);
    again.close();
  });
});

describe("N2 unknown bucket", () => {
  it("gives requests without the edge header a tighter join limit", async () => {
    const base = await boot({ maxRooms: 3, maxClients: 100 });
    const statuses: number[] = [];
    for (let i = 0; i <= ROOM_JOINS_UNKNOWN_PER_MIN; i++) statuses.push((await reserve(base)).status);
    expect(statuses.slice(0, ROOM_JOINS_UNKNOWN_PER_MIN).every((s) => s === 200)).toBe(true);
    expect(statuses[ROOM_JOINS_UNKNOWN_PER_MIN]).toBe(429);
    // A request with the header is unaffected.
    expect((await reserve(base, "203.0.113.20")).status).toBe(200);
  });

  it("IpRateLimiter logs the unknown bucket at most once a minute", async () => {
    const warnings: object[] = [];
    let now = 0;
    const logger: NetLogger = { ...silent, warn: (obj) => void warnings.push(obj) };
    const limiter = new IpRateLimiter("t", 5, 2, 60, logger, () => now);
    expect(await limiter.consume(UNKNOWN_CLIENT_IP)).toBe(true);
    expect(await limiter.consume(UNKNOWN_CLIENT_IP)).toBe(true);
    expect(await limiter.consume(UNKNOWN_CLIENT_IP)).toBe(false);
    expect(warnings).toHaveLength(1);
    now = 61_000;
    await limiter.consume(UNKNOWN_CLIENT_IP);
    expect(warnings).toHaveLength(2);
    for (let i = 0; i < 5; i++) expect(await limiter.consume("203.0.113.1")).toBe(true);
    expect(await limiter.consume("203.0.113.1")).toBe(false);
  });
});

describe("N1 socket mode (CLIENT_IP_HEADER blank, local only)", () => {
  it("keys REST by the TCP peer and ignores forged headers", async () => {
    const base = await boot({ maxRooms: 3, maxClients: 12 }, null);
    const res = await fetch(`${base}/v1/echo/1`, {
      headers: { origin: ALLOWED, "true-client-ip": "1.2.3.4", "x-forwarded-for": "5.6.7.8" },
    });
    const body = (await res.json()) as { ip: string };
    expect(body.ip).not.toBe("1.2.3.4");
    expect(body.ip).not.toBe("5.6.7.8");
    expect(body.ip).not.toBe(UNKNOWN_CLIENT_IP);
  });
});

describe("N3 malformed percent-encoding on a real uWS server", () => {
  it("answers 400 for a bad :param escape and keeps serving", async () => {
    const base = await boot({ maxRooms: 3, maxClients: 12 });
    for (const bad of ["%E0%A4%A", "%", "%zz", "%C0%80"]) {
      const res = await fetch(`${base}/v1/echo/${bad}`, { headers: { origin: ALLOWED } });
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "BAD_REQUEST", message: "malformed path" });
    }
    const ok = await fetch(`${base}/v1/echo/a%20b`, { headers: { origin: ALLOWED } });
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as { id: string }).id).toBe("a b");
  });
});

describe("N4/N5 violations", () => {
  async function joinHello(base: string, testServer: ColyseusTestServer) {
    const res = await reserve(base, "203.0.113.30");
    const { reservation } = (await res.json()) as HelloJoinResponse;
    return testServer.sdk.consumeSeatReservation(reservation);
  }

  it("closes request spam of unknown types with 4104", async () => {
    const base = await boot({ maxRooms: 3, maxClients: 12 });
    // The SDK reads the Colyseus server port, which is 0 here: give it the bound one.
    Reflect.set((server as GameServer).colyseus, "port", (server as GameServer).port);
    const testServer = new ColyseusTestServer((server as GameServer).colyseus);
    testServer.sdk.http.options.headers = { Origin: ALLOWED };
    const room = await joinHello(base, testServer);
    const left = new Promise<number>((resolve) => room.onLeave(resolve));
    const requester = room as unknown as { request(type: string, body?: unknown): Promise<unknown> };
    for (let i = 0; i < 60; i++) requester.request(`nope_${i}`, {}).catch(() => undefined);
    expect(await left).toBe(CloseCode.RATE_LIMITED);
  });

  it("counts PING overflow as violations and closes sustained PING spam with 4104", async () => {
    const base = await boot({ maxRooms: 3, maxClients: 12 });
    // The SDK reads the Colyseus server port, which is 0 here: give it the bound one.
    Reflect.set((server as GameServer).colyseus, "port", (server as GameServer).port);
    const testServer = new ColyseusTestServer((server as GameServer).colyseus);
    testServer.sdk.http.options.headers = { Origin: ALLOWED };
    const room = await joinHello(base, testServer);
    const serverRoom = matchMaker.getLocalRoomById(room.roomId) as HelloRoom;
    const left = new Promise<number>((resolve) => room.onLeave(resolve));
    const body = new Uint8Array(PING_BODY_BYTES);
    // 60 PINGs in < 1 s: 2 answered, the rest dropped as violations (> 50 in 10 s closes). Stays under the
    // Colyseus per-second backstop (simTickHz * 4 = 80).
    for (let i = 0; i < 60; i++) room.sendBytes(MESSAGE_CATALOG.PING.id, body);
    expect(await left).toBe(CloseCode.RATE_LIMITED);
    expect(serverRoom.dropped).toBeGreaterThan(50);
  });
});
