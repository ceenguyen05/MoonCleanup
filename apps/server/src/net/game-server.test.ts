// Integration: createGameServer on a real uWS socket (a free port, so live runs on 2571 never collide), driven by the Colyseus SDK that
// @colyseus/testing ships (its @colyseus/schema 5.0.47 decoder against the server's 5.0.48 encoder).
import "./testing/uws-esm-fix";

import { request as httpRequest } from "node:http";
import { matchMaker } from "@colyseus/core";
import { ColyseusTestServer } from "@colyseus/testing";
import {
  CloseCode,
  HelloPayloadSchema,
  MAX_PLAYERS_PER_ROOM,
  MESSAGE_CATALOG,
  PROTOCOL_VERSION,
  ProtocolMismatchInfoSchema,
  type HttpRouteDef,
} from "@moon-cleanup/shared";
import { PING_BODY_BYTES, readPongBody, rttFromPong, writePingBody, type PongTarget } from "@moon-cleanup/protocol";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createGameServer, type GameServer } from "./game-server";
import { HELLO_JOIN_PATH, type HelloJoinResponse } from "./hello-join-route";
import type { HelloRoom } from "./hello-room";
import { MAX_HTTP_BODY_BYTES, type NetLogger } from "./http-routes";

let PORT = 0;
let BASE = "";
const ALLOWED = "http://localhost:5177";
const DENIED = "https://evil.example";
const silent: NetLogger = { info() {}, warn() {}, error() {}, debug() {} };

const routes: HttpRouteDef[] = [
  {
    method: "GET",
    path: "/healthz",
    handle: () => ({ status: 200, body: { ok: true } }),
  },
  {
    method: "POST",
    path: "/v1/echo/:id",
    handle: (req) => ({
      status: 200,
      body: { id: req.params.id, query: req.query, body: req.body, ip: req.remoteAddress },
    }),
  },
  {
    method: "GET",
    path: "/v1/boom",
    handle: () => {
      throw new Error("secret stack detail");
    },
  },
];

let server: GameServer;
let testServer: ColyseusTestServer;

beforeAll(async () => {
  server = await createGameServer({
    port: 0,
    // Many short-lived rooms from one test IP: lift the per-IP room-creation rate (covered by admission.test.ts).
    admission: { maxRooms: 3, maxClients: 12, roomCreatesPerIpPerMin: 1000 },
    routes,
    allowedOrigins: [ALLOWED],
    logger: silent,
    rates: { simTickHz: 30, snapshotHz: 15 },
    serverBuild: "test-build",
    // Pinned: these suites test the uWS adapter (game-server-ws.test.ts covers the ws fallback).
    transport: "uws",
  });
  PORT = await server.listen();
  BASE = `http://127.0.0.1:${PORT}`;
  // The SDK reads the Colyseus server port (0 here): give it the bound one.
  Reflect.set(server.colyseus, "port", PORT);
  testServer = new ColyseusTestServer(server.colyseus);
  testServer.sdk.http.options.headers = { Origin: ALLOWED };
});

afterAll(async () => {
  await server.gracefullyShutdown();
});

async function reserve(body: unknown): Promise<Response> {
  return fetch(`${BASE}${HELLO_JOIN_PATH}`, {
    method: "POST",
    // A known edge IP: requests without it share the tighter `unknown` bucket (admission.test.ts covers that).
    headers: { "content-type": "application/json", origin: ALLOWED, "true-client-ip": "203.0.113.77" },
    body: JSON.stringify(body),
  });
}

async function joinHello(protocolVersion = PROTOCOL_VERSION) {
  const res = await reserve({ protocolVersion, clientBuild: "test" });
  expect(res.status).toBe(200);
  const { reservation } = (await res.json()) as HelloJoinResponse;
  return testServer.sdk.consumeSeatReservation(reservation);
}

function upgradeStatus(origin: string | undefined): Promise<number> {
  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = {
      connection: "Upgrade",
      upgrade: "websocket",
      "sec-websocket-key": "dGhlIHNhbXBsZSBub25jZQ==",
      "sec-websocket-version": "13",
    };
    if (origin !== undefined) headers.origin = origin;
    const req = httpRequest({ host: "127.0.0.1", port: PORT, path: "/", headers });
    req.on("upgrade", (res, socket) => {
      socket.destroy();
      resolve(res.statusCode ?? 0);
    });
    req.on("response", (res) => {
      res.resume();
      resolve(res.statusCode ?? 0);
    });
    req.on("error", reject);
    req.end();
  });
}

describe("HTTP routing on uWS", () => {
  it("serves HttpRouteDef routes with params, query, JSON body and the edge client IP", async () => {
    const res = await fetch(`${BASE}/v1/echo/abc%20d?x=1&x=2`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: ALLOWED,
        "true-client-ip": "203.0.113.5",
        "x-forwarded-for": "1.2.3.4",
      },
      body: JSON.stringify({ hello: "moon" }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe(ALLOWED);
    expect(res.headers.get("access-control-allow-credentials")).toBeNull();
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ id: "abc d", query: { x: "1" }, body: { hello: "moon" }, ip: "203.0.113.5" });
  });

  it("handles an empty POST body", async () => {
    const res = await fetch(`${BASE}/v1/echo/1`, { method: "POST", headers: { origin: ALLOWED } });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { body?: unknown }).body).toBeUndefined();
  });

  it("answers /healthz with Access-Control-Allow-Origin * for any origin", async () => {
    for (const origin of [ALLOWED, DENIED]) {
      const res = await fetch(`${BASE}/healthz`, { headers: { origin } });
      expect(res.status).toBe(200);
      expect(res.headers.get("access-control-allow-origin")).toBe("*");
    }
  });

  it("omits CORS headers for a denied origin", async () => {
    const res = await fetch(`${BASE}/v1/echo/1`, { method: "POST", headers: { origin: DENIED }, body: "{}" });
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("answers preflight for allowed origins only", async () => {
    const ok = await fetch(`${BASE}/v1/echo/1`, {
      method: "OPTIONS",
      headers: { origin: ALLOWED, "access-control-request-method": "POST" },
    });
    expect(ok.status).toBe(204);
    expect(ok.headers.get("access-control-allow-origin")).toBe(ALLOWED);
    expect(ok.headers.get("access-control-max-age")).toBe("600");
    expect(ok.headers.get("access-control-allow-credentials")).toBeNull();
    const denied = await fetch(`${BASE}/v1/echo/1`, {
      method: "OPTIONS",
      headers: { origin: DENIED, "access-control-request-method": "POST" },
    });
    expect(denied.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("rejects bodies over the 16 KB limit with 413 and malformed JSON with 400", async () => {
    const big = await fetch(`${BASE}/v1/echo/1`, {
      method: "POST",
      headers: { origin: ALLOWED, "content-type": "application/json" },
      body: JSON.stringify({ pad: "x".repeat(MAX_HTTP_BODY_BYTES) }),
    });
    expect(big.status).toBe(413);
    const bad = await fetch(`${BASE}/v1/echo/1`, { method: "POST", headers: { origin: ALLOWED }, body: "{nope" });
    expect(bad.status).toBe(400);
  });

  it("hides handler errors behind a 500 INTERNAL body", async () => {
    const res = await fetch(`${BASE}/v1/boom`, { headers: { origin: ALLOWED } });
    expect(res.status).toBe(500);
    const text = await res.text();
    expect(text).not.toContain("secret");
    expect(JSON.parse(text)).toEqual({ error: "INTERNAL" });
  });

  it("answers unknown paths (and Colyseus' /matchmake) with 404 instead of hanging", async () => {
    const unknown = await fetch(`${BASE}/nope`, { signal: AbortSignal.timeout(2000) });
    expect(unknown.status).toBe(404);
    const mm = await fetch(`${BASE}/matchmake/joinOrCreate/hello`, {
      method: "POST",
      headers: { origin: ALLOWED, "content-type": "application/json" },
      body: "{}",
      signal: AbortSignal.timeout(2000),
    });
    expect(mm.status).toBe(404);
  });
});

describe("WebSocket origin check", () => {
  it("upgrades an allowed origin and refuses others with 403 before the socket opens", async () => {
    expect(await upgradeStatus(ALLOWED)).toBe(101);
    expect(await upgradeStatus(DENIED)).toBe(403);
    expect(await upgradeStatus(undefined)).toBe(403);
  });
});

describe("REST-only join flow (ADR-0025)", () => {
  it("has public matchmake methods disabled", async () => {
    expect(matchMaker.controller.exposedMethods).toEqual([]);
    await expect(matchMaker.controller.invokeMethod("joinOrCreate", "hello", {})).rejects.toThrow(/invalid method/);
  });

  it("validates the join options", async () => {
    expect((await reserve({ protocolVersion: "x" })).status).toBe(400);
    expect((await reserve({ protocolVersion: 0, clientBuild: "bad build!" })).status).toBe(400);
  });

  it("reserves a seat that the SDK consumes; the seat is single-use", async () => {
    const res = await reserve({ protocolVersion: PROTOCOL_VERSION, clientBuild: "test" });
    const { reservation } = (await res.json()) as HelloJoinResponse;
    const room = await testServer.sdk.consumeSeatReservation(reservation);
    expect(room.roomId).toBe(reservation.roomId);
    await expect(testServer.sdk.consumeSeatReservation(reservation)).rejects.toBeTruthy();
    await room.leave();
  });

  it("reserveSeatFor on a full room fails (maxClients = MAX_PLAYERS_PER_ROOM = 6)", async () => {
    const cache = await matchMaker.createRoom("hello", {});
    for (let i = 0; i < MAX_PLAYERS_PER_ROOM; i++) await matchMaker.reserveSeatFor(cache, {});
    await expect(matchMaker.reserveSeatFor(cache, {})).rejects.toThrow(/full/);
    await matchMaker.getLocalRoomById(cache.roomId)?.disconnect();
  });
});

describe("HelloRoom", () => {
  it("sends HELLO, decodes Schema state across schema 5.0.47 (client) / 5.0.48 (server), and answers PING", async () => {
    const room = await joinHello();
    const hello = await new Promise<unknown>((resolve) => room.onMessage(MESSAGE_CATALOG.HELLO.id, resolve));
    expect(HelloPayloadSchema.parse(hello)).toEqual({
      serverProtocol: PROTOCOL_VERSION,
      serverBuild: "test-build",
      simTickHz: 30,
      snapshotHz: 15,
    });

    await room.waitForInitialState();
    const state = room.state as { protocolVersion: number; simTickHz: number; snapshotHz: number; players: number };
    expect(state.protocolVersion).toBe(PROTOCOL_VERSION);
    expect(state.simTickHz).toBe(30);
    expect(state.snapshotHz).toBe(15);
    expect(state.players).toBe(1);

    const pong: PongTarget = { clientTimeMs: -1, serverTick: -1 };
    const body = new Uint8Array(PING_BODY_BYTES);
    const sentAt = Math.floor(performance.now());
    writePingBody(sentAt, body);
    const reply = new Promise<Uint8Array>((resolve) => room.onMessage(MESSAGE_CATALOG.PONG.id, resolve));
    room.sendBytes(MESSAGE_CATALOG.PING.id, body);
    expect(readPongBody(await reply, pong)).toBe(true);
    expect(pong.clientTimeMs).toBe(sentAt);
    expect(pong.serverTick).toBeGreaterThan(0);
    const rtt = rttFromPong(Math.floor(performance.now()), pong.clientTimeMs);
    expect(rtt).toBeGreaterThanOrEqual(0);
    expect(rtt).toBeLessThan(1000);
    await room.leave();
  });

  it("closes a protocol mismatch with 4100 and a ProtocolMismatchInfo reason", async () => {
    const error = await joinHello(PROTOCOL_VERSION + 1).then(
      () => null,
      (e: unknown) => e as { code: number; message: string },
    );
    expect(error?.code).toBe(CloseCode.PROTOCOL_MISMATCH);
    expect(ProtocolMismatchInfoSchema.parse(JSON.parse(error?.message ?? ""))).toEqual({
      serverProtocol: PROTOCOL_VERSION,
      serverBuild: "test-build",
    });
  });

  it("drops and counts unknown, malformed and excess messages without disconnecting", async () => {
    const room = await joinHello();
    const serverRoom = matchMaker.getLocalRoomById(room.roomId) as HelloRoom;
    const before = serverRoom.dropped;
    room.sendBytes(0x55, new Uint8Array([1, 2, 3]));
    room.sendBytes(MESSAGE_CATALOG.PING.id, new Uint8Array(3));
    room.send("not_a_message", { x: 1 });
    for (let i = 0; i < 5; i++) room.sendBytes(MESSAGE_CATALOG.PING.id, new Uint8Array(PING_BODY_BYTES));
    await new Promise((r) => setTimeout(r, 200));
    expect(serverRoom.dropped - before).toBeGreaterThanOrEqual(3 + 3);
    expect(room.connection.isOpen).toBe(true);
    await room.leave();
  });

  it("closes with 4104 after more than 50 violations in 10 s", async () => {
    const room = await joinHello();
    const left = new Promise<number>((resolve) => room.onLeave(resolve));
    for (let i = 0; i < 60; i++) room.sendBytes(0x55, new Uint8Array([i]));
    expect(await left).toBe(CloseCode.RATE_LIMITED);
  });

  it("survives raw garbage frames from a joined client", async () => {
    const room = await joinHello();
    const conn = room.connection as unknown as { send(data: Uint8Array): void };
    for (let i = 0; i < 20; i++) {
      const junk = new Uint8Array(1 + (i % 7)).map(() => Math.floor(Math.random() * 256));
      conn.send(junk);
    }
    await new Promise((r) => setTimeout(r, 200));
    const res = await fetch(`${BASE}/healthz`);
    expect(res.status).toBe(200);
  });

  it("coalesces a frame send and broadcastPatch() into one corked write per client (autoBatchMessages)", async () => {
    const room = await joinHello();
    await room.waitForInitialState();
    const serverRoom = matchMaker.getLocalRoomById(room.roomId) as HelloRoom;
    expect(serverRoom.patchRate).toBeNull();
    const own = serverRoom.clients.find((c) => c.sessionId === room.sessionId);
    expect(own).toBeDefined();
    const ws = (own as unknown as { _ref: { ws: { cork(cb: () => void): void } } })._ref.ws;
    let corks = 0;
    const original = ws.cork.bind(ws);
    ws.cork = (cb: () => void) => {
      corks++;
      original(cb);
    };
    serverRoom.batchMessages(() => {
      own?.sendBytes(0x7f, new Uint8Array([1, 2, 3]));
      serverRoom.state.players = 5;
      serverRoom.broadcastPatch();
    });
    ws.cork = original;
    expect(corks).toBe(1);
    await room.leave();
  });
});

describe("NET_SPIKE off (default)", () => {
  it("does not register LoadTestRoom or its join route", async () => {
    const res = await fetch(`${BASE}/v0/spike/join`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: ALLOWED },
      body: JSON.stringify({ protocolVersion: PROTOCOL_VERSION, clientBuild: "test", tickHz: 20, snapshotHz: 10 }),
    });
    expect(res.status).toBe(404);
    await expect(matchMaker.createRoom("load_test", {})).rejects.toThrow();
  });
});
