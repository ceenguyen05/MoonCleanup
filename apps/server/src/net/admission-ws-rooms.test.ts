// Live (real Node http socket, no mocks of the admission path): the AT_CAPACITY refusal for ROOMS on the `ws`
// FALLBACK transport. The uWS twin is admission.test.ts ("refuses with 503 at_capacity:rooms once MAX_ROOMS rooms are
// full"); game-server-ws.test.ts covers `at_capacity:clients` on this transport. Here MAX_ROOMS=2 with a generous
// MAX_CLIENTS, so the only thing that can refuse the 13th seat is the room ceiling (two full rooms of 6).
//
// Asserts the exact refusal contract (contract api/rest AT_CAPACITY): status 503, JSON body
// `{ error: "AT_CAPACITY", message: "at_capacity:rooms" }`, a `retry-after` header, no new room, refusal counter.

import { matchMaker } from "@colyseus/core";
import { PROTOCOL_VERSION } from "@moon-cleanup/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AT_CAPACITY_RETRY_AFTER_S } from "./admission";
import { createGameServer, type GameServer } from "./game-server";
import { HELLO_JOIN_PATH } from "./hello-join-route";
import type { NetLogger } from "./http-routes";
import { defaultTransportLoaders } from "./transport";

const ALLOWED = "http://localhost:5177";
const silent: NetLogger = { info() {}, warn() {}, error() {}, debug() {} };

let server: GameServer;
let base = "";

beforeAll(async () => {
  server = await createGameServer({
    port: 0,
    routes: [],
    allowedOrigins: [ALLOWED],
    logger: silent,
    rates: { simTickHz: 20, snapshotHz: 10 },
    serverBuild: "test-build",
    // Generous per-IP room-create and client ceilings: only MAX_ROOMS may refuse.
    admission: { maxRooms: 2, maxClients: 100, roomCreatesPerIpPerMin: 1000 },
    transport: "auto",
    transportLoaders: {
      uws: () => Promise.reject(new Error("uWebSockets.js simulated unavailable")),
      ws: defaultTransportLoaders.ws,
    },
  });
  const port = await server.listen();
  base = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await server.gracefullyShutdown();
});

function reserve(ip: string): Promise<Response> {
  return fetch(`${base}${HELLO_JOIN_PATH}`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: ALLOWED, "true-client-ip": ip },
    body: JSON.stringify({ protocolVersion: PROTOCOL_VERSION, clientBuild: "test" }),
  });
}

describe("AT_CAPACITY (rooms) on the ws fallback transport", () => {
  it("serves on the ws transport", () => {
    expect(server.transport).toBe("ws");
  });

  it("fills MAX_ROOMS=2 rooms (12 seats), then refuses the next join with 503 at_capacity:rooms", async () => {
    // Fill both rooms: 12 reservations from distinct IPs (the per-IP socket cap is not involved: no sockets are opened).
    for (let i = 0; i < 12; i++) {
      const res = await reserve(`203.0.113.${i + 1}`);
      expect(res.status).toBe(200);
    }
    expect(matchMaker.stats.local.roomCount).toBe(2);

    const refused = await reserve("203.0.113.200");
    expect(refused.status).toBe(503);
    expect(refused.headers.get("retry-after")).toBe(String(AT_CAPACITY_RETRY_AFTER_S));
    expect(refused.headers.get("content-type")).toContain("application/json");
    expect(await refused.json()).toEqual({ error: "AT_CAPACITY", message: "at_capacity:rooms" });

    // The refusal created nothing and was counted.
    expect(matchMaker.stats.local.roomCount).toBe(2);
    expect(server.admission.refused.rooms).toBe(1);
    expect(server.admission.refused.clients).toBe(0);
  });
});
