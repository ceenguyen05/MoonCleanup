// Integration: createGameServer on the `ws` FALLBACK transport (TRANSPORT=auto with a simulated uWebSockets.js load
// failure), on a real Node http socket, driven by the Colyseus SDK from @colyseus/testing. Proves the fallback keeps
// the uWS path's protections: origin refusal, body limit, safe percent-decoding, per-IP socket cap, AT_CAPACITY,
// CORS, 404 fallback (Colyseus' own router stripped) and a HelloRoom join.

import { createServer, request as httpRequest, type ClientRequest, type Server as HttpServer } from "node:http";
import { ColyseusTestServer } from "@colyseus/testing";
import { HelloPayloadSchema, MESSAGE_CATALOG, PROTOCOL_VERSION, type HttpRouteDef } from "@moon-cleanup/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Admission } from "./admission";
import { createOriginPolicy } from "./cors";
import { createGameServer, type GameServer } from "./game-server";
import { HELLO_JOIN_PATH, type HelloJoinResponse } from "./hello-join-route";
import { MAX_HTTP_BODY_BYTES, type NetLogger } from "./http-routes";
import { defaultTransportLoaders } from "./transport";
import { createWsTransport } from "./ws-transport";

const ALLOWED = "http://localhost:5177";
const DENIED = "https://evil.example";
const MAX_SOCKETS = 3;
const warnings: string[] = [];
const logger: NetLogger = {
  info() {},
  warn: (_obj, msg) => warnings.push(msg ?? ""),
  error() {},
  debug() {},
};

const routes: HttpRouteDef[] = [
  { method: "GET", path: "/healthz", handle: () => ({ status: 200, body: { ok: true } }) },
  {
    method: "POST",
    path: "/v1/echo/:id",
    handle: (req) => ({
      status: 200,
      body: { id: req.params.id, query: req.query, body: req.body, ip: req.remoteAddress },
    }),
  },
  { method: "POST", path: "/v1/echo/static", handle: () => ({ status: 200, body: { static: true } }) },
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
let PORT = 0;
let BASE = "";

beforeAll(async () => {
  server = await createGameServer({
    port: 0,
    routes,
    allowedOrigins: [ALLOWED],
    logger,
    rates: { simTickHz: 20, snapshotHz: 10 },
    serverBuild: "test-build",
    admission: { maxRooms: 1, maxClients: 2, maxSocketsPerIp: MAX_SOCKETS, roomCreatesPerIpPerMin: 100 },
    transport: "auto",
    transportLoaders: {
      uws: () => Promise.reject(new Error("Cannot find package 'uWebSockets.js' imported from /srv/dist/index.js")),
      ws: defaultTransportLoaders.ws,
    },
  });
  PORT = await server.listen();
  BASE = `http://127.0.0.1:${PORT}`;
  Reflect.set(server.colyseus, "port", PORT);
  testServer = new ColyseusTestServer(server.colyseus);
  testServer.sdk.http.options.headers = { Origin: ALLOWED };
});

afterAll(async () => {
  await server.gracefullyShutdown();
});

function reserve(ip: string): Promise<Response> {
  return fetch(`${BASE}${HELLO_JOIN_PATH}`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: ALLOWED, "true-client-ip": ip },
    body: JSON.stringify({ protocolVersion: PROTOCOL_VERSION, clientBuild: "test" }),
  });
}

/** Opens a raw upgrade; resolves the status and a closer that keeps the socket open until called. */
function upgrade(origin: string | undefined, ip: string): Promise<{ status: number; close: () => void }> {
  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = {
      connection: "Upgrade",
      upgrade: "websocket",
      "sec-websocket-key": "dGhlIHNhbXBsZSBub25jZQ==",
      "sec-websocket-version": "13",
      "true-client-ip": ip,
    };
    if (origin !== undefined) headers.origin = origin;
    const req: ClientRequest = httpRequest({ host: "127.0.0.1", port: PORT, path: "/", headers });
    req.on("upgrade", (res, socket) => resolve({ status: res.statusCode ?? 0, close: () => socket.destroy() }));
    req.on("response", (res) => {
      res.resume();
      resolve({ status: res.statusCode ?? 0, close: () => req.destroy() });
    });
    req.on("error", reject);
    req.end();
  });
}

/** POSTs `bytes` with chunked transfer encoding (no content-length), so only the streamed limit can catch it. */
function postChunked(path: string, bytes: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = httpRequest({
      host: "127.0.0.1",
      port: PORT,
      path,
      method: "POST",
      headers: { origin: ALLOWED, "content-type": "application/json", "transfer-encoding": "chunked" },
    });
    req.on("response", (res) => {
      res.resume();
      resolve(res.statusCode ?? 0);
    });
    // The server may close mid-upload after answering 413: a write error after the response is expected.
    req.on("error", (error) => (req.writableEnded ? undefined : reject(error)));
    const chunk = Buffer.alloc(1024, 0x61);
    for (let sent = 0; sent < bytes; sent += chunk.byteLength) req.write(chunk);
    req.end();
  });
}

describe("auto fallback", () => {
  it("serves on ws after a uWebSockets.js load failure, with one clear warning line", () => {
    expect(server.transport).toBe("ws");
    const fallback = warnings.filter((w) => w.startsWith("[net] transport="));
    expect(fallback).toEqual([
      "[net] transport=ws (uWebSockets.js unavailable: Cannot find package 'uWebSockets.js' imported from /srv/dist/index.js)",
    ]);
  });
});

describe("HTTP on the ws fallback", () => {
  it("serves params, query, JSON body and the trusted edge client IP", async () => {
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

  it("prefers a static route over a :param route (uWS precedence)", async () => {
    const res = await fetch(`${BASE}/v1/echo/static`, { method: "POST", headers: { origin: ALLOWED } });
    expect(await res.json()).toEqual({ static: true });
  });

  it("answers malformed percent-encoding with 400 instead of throwing", async () => {
    const res = await fetch(`${BASE}/v1/echo/%E0%A4%A`, { method: "POST", headers: { origin: ALLOWED }, body: "{}" });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "BAD_REQUEST", message: "malformed path" });
  });

  it("rejects bodies over 16 KB (declared and streamed) with 413, malformed JSON with 400", async () => {
    const big = await fetch(`${BASE}/v1/echo/1`, {
      method: "POST",
      headers: { origin: ALLOWED, "content-type": "application/json" },
      body: JSON.stringify({ pad: "x".repeat(MAX_HTTP_BODY_BYTES) }),
    });
    expect(big.status).toBe(413);
    expect(big.headers.get("connection")).toBe("close");
    expect(await postChunked("/v1/echo/1", MAX_HTTP_BODY_BYTES + 4096)).toBe(413);
    const bad = await fetch(`${BASE}/v1/echo/1`, { method: "POST", headers: { origin: ALLOWED }, body: "{nope" });
    expect(bad.status).toBe(400);
  });

  it("answers /healthz with Access-Control-Allow-Origin * and omits CORS for denied origins elsewhere", async () => {
    for (const origin of [ALLOWED, DENIED]) {
      const res = await fetch(`${BASE}/healthz`, { headers: { origin } });
      expect(res.status).toBe(200);
      expect(res.headers.get("access-control-allow-origin")).toBe("*");
    }
    const denied = await fetch(`${BASE}/v1/echo/1`, { method: "POST", headers: { origin: DENIED }, body: "{}" });
    expect(denied.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("answers preflight for allowed origins only", async () => {
    const ok = await fetch(`${BASE}/v1/echo/1`, {
      method: "OPTIONS",
      headers: { origin: ALLOWED, "access-control-request-method": "POST" },
    });
    expect(ok.status).toBe(204);
    expect(ok.headers.get("access-control-allow-origin")).toBe(ALLOWED);
    expect(ok.headers.get("access-control-max-age")).toBe("600");
    const denied = await fetch(`${BASE}/v1/echo/1`, {
      method: "OPTIONS",
      headers: { origin: DENIED, "access-control-request-method": "POST" },
    });
    expect(denied.status).toBe(204);
    expect(denied.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("hides handler errors behind 500 INTERNAL", async () => {
    const res = await fetch(`${BASE}/v1/boom`, { headers: { origin: ALLOWED } });
    expect(res.status).toBe(500);
    const text = await res.text();
    expect(text).not.toContain("secret");
  });

  it("answers unknown paths, Colyseus' /matchmake, / and /__healthcheck with 404 (Colyseus router stripped)", async () => {
    for (const path of ["/nope", "/", "/__healthcheck"]) {
      const res = await fetch(`${BASE}${path}`, { signal: AbortSignal.timeout(2000) });
      expect(res.status, path).toBe(404);
      expect(res.headers.get("access-control-allow-credentials")).toBeNull();
    }
    const mm = await fetch(`${BASE}/matchmake/joinOrCreate/hello`, {
      method: "POST",
      headers: { origin: ALLOWED, "content-type": "application/json" },
      body: "{}",
      signal: AbortSignal.timeout(2000),
    });
    expect(mm.status).toBe(404);
  });
});

describe("WebSocket upgrades on the ws fallback", () => {
  it("upgrades an allowed origin and refuses others with 403 before the socket opens", async () => {
    const ok = await upgrade(ALLOWED, "198.51.100.1");
    expect(ok.status).toBe(101);
    ok.close();
    expect((await upgrade(DENIED, "198.51.100.1")).status).toBe(403);
    expect((await upgrade(undefined, "198.51.100.1")).status).toBe(403);
  });

  it("caps concurrent sockets per IP (429) and releases the slot on close", async () => {
    const ip = "198.51.100.9";
    const open: Array<{ close: () => void }> = [];
    for (let i = 0; i < MAX_SOCKETS; i++) {
      const socket = await upgrade(ALLOWED, ip);
      expect(socket.status).toBe(101);
      open.push(socket);
    }
    expect(server.admission.socketsOf(ip)).toBe(MAX_SOCKETS);
    const refused = await upgrade(ALLOWED, ip);
    expect(refused.status).toBe(429);
    expect((await upgrade(ALLOWED, "198.51.100.10")).status).toBe(101);
    for (const socket of open) socket.close();
    await expect.poll(() => server.admission.socketsOf(ip), { timeout: 3000 }).toBe(0);
    const again = await upgrade(ALLOWED, ip);
    expect(again.status).toBe(101);
    again.close();
  });
});

describe("HelloRoom and admission on the ws fallback", () => {
  it("reserves a seat by REST, joins over ws and receives HELLO", async () => {
    const res = await reserve("203.0.113.7");
    expect(res.status).toBe(200);
    const { reservation } = (await res.json()) as HelloJoinResponse;
    const room = await testServer.sdk.consumeSeatReservation(reservation);
    const hello = await new Promise<unknown>((resolve) => room.onMessage(MESSAGE_CATALOG.HELLO.id, resolve));
    expect(HelloPayloadSchema.parse(hello)).toMatchObject({ serverProtocol: PROTOCOL_VERSION, simTickHz: 20 });
    await room.leave();
    await expect.poll(() => server.admission.socketsOf("unknown"), { timeout: 3000 }).toBe(0);
  });

  it("refuses with 503 AT_CAPACITY + retry-after once MAX_CLIENTS seats are taken", async () => {
    expect((await reserve("203.0.113.8")).status).toBe(200);
    expect((await reserve("203.0.113.8")).status).toBe(200);
    const refused = await reserve("203.0.113.8");
    expect(refused.status).toBe(503);
    expect(refused.headers.get("retry-after")).toBe("30");
    expect(await refused.json()).toEqual({ error: "AT_CAPACITY", message: "at_capacity:clients" });
  });
});

describe("ws adapter bind failure", () => {
  it("rejects listen when the port is taken (Colyseus' own listen would never settle)", async () => {
    const blocker: HttpServer = createServer();
    await new Promise<void>((resolve) => blocker.listen(0, resolve));
    const address = blocker.address();
    const port = typeof address === "object" && address !== null ? address.port : 0;
    const bound = createWsTransport({
      routes: [],
      policy: createOriginPolicy([ALLOWED]),
      clientIpHeader: "true-client-ip",
      logger,
      admission: new Admission({ maxRooms: 1, maxClients: 1 }, logger),
      beforeUpgrade: () => undefined,
    });
    try {
      await expect(bound.listen(() => new Promise<void>(() => bound.transport.listen(port)), port)).rejects.toThrow(
        /EADDRINUSE/,
      );
    } finally {
      bound.transport.shutdown();
      await new Promise((resolve) => blocker.close(resolve));
    }
  });
});
