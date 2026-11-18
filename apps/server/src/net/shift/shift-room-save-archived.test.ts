// ShiftRoom HELLO `saveArchived`: only the first joiner of a room whose save was archived is told (one-shot).
import { ColyseusTestServer } from "@colyseus/testing";
import { HelloPayloadSchema, MESSAGE_CATALOG, PROTOCOL_VERSION, STANDARD_GRID_PARAMS } from "@moon-cleanup/shared";
import { loadGameData } from "@moon-cleanup/game-data";
import { createPlotGrid } from "@moon-cleanup/world";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createGameServer, type GameServer } from "../game-server";
import type { NetLogger } from "../http-routes";
import { JoinTickets } from "./join-ticket";
import { MemoryShiftDustStore } from "./shift-persistence";
import { SHIFT_JOIN_PATH, type ShiftMember } from "./shift-join";

const ALLOWED = "http://localhost:5178";
const silent: NetLogger = { info() {}, warn() {}, error() {}, debug() {} };
const CONTRACT = "00000000-0000-4000-8000-0000000000f6";
const pid = (i: number) => `00000000-0000-4000-8000-0000000002${i.toString(16).padStart(2, "0")}`;

/** Memory store that reports one archive (as the durable store does after a bake-hash mismatch), once. */
class ArchivingStore extends MemoryShiftDustStore {
  private pending = true;
  takeArchived(): Promise<boolean> {
    const was = this.pending;
    this.pending = false;
    return Promise.resolve(was);
  }
}

let server: GameServer;
let testServer: ColyseusTestServer;
let BASE = "";
const tickets = new JoinTickets();

beforeAll(async () => {
  const grid = createPlotGrid(STANDARD_GRID_PARAMS);
  server = await createGameServer({
    port: 0,
    admission: { maxRooms: 2, maxClients: 8, maxSeatsPerIp: 8, roomCreatesPerIpPerMin: 100 },
    routes: [],
    allowedOrigins: [ALLOWED],
    logger: silent,
    rates: { simTickHz: 20, snapshotHz: 10 },
    serverBuild: "test-build",
    transport: "ws",
    helloRoom: false,
    shift: {
      data: loadGameData(),
      world: { grid, ground: { heightAtXYZ: () => 0 } },
      verifyToken: (t) => Promise.resolve(t.startsWith("tok-") ? { playerId: t.slice(4) } : null),
      membership: (): Promise<ShiftMember | null> =>
        Promise.resolve({ role: "staff", displayName: "P", shiftType: "private" }),
      tickets,
      seatHoldS: 2,
      dustStore: new ArchivingStore(),
    },
  });
  const port = await server.listen();
  BASE = `http://127.0.0.1:${port}`;
  Reflect.set(server.colyseus, "port", port);
  testServer = new ColyseusTestServer(server.colyseus);
  testServer.sdk.http.options.headers = { Origin: ALLOWED };
});

afterAll(async () => {
  await server.gracefullyShutdown();
});

async function joinHello(i: number): Promise<unknown> {
  const res = await fetch(`${BASE}${SHIFT_JOIN_PATH.replace(":id", CONTRACT)}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: ALLOWED,
      "true-client-ip": "203.0.113.95",
      authorization: `Bearer tok-${pid(i)}`,
    },
    body: JSON.stringify({ protocolVersion: PROTOCOL_VERSION, clientBuild: "t" }),
  });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { reservation: never };
  const room = await testServer.sdk.consumeSeatReservation(body.reservation);
  let hello: unknown;
  room.onMessage(MESSAGE_CATALOG.HELLO.id, (h: unknown) => (hello = h));
  for (let t = 0; t < 100 && hello === undefined; t++) await new Promise((r) => setTimeout(r, 20));
  return hello;
}

describe("ShiftRoom HELLO saveArchived", () => {
  it("tells the first joiner once; a later joiner gets a plain HELLO", async () => {
    const first = HelloPayloadSchema.parse(await joinHello(1));
    expect(first.saveArchived).toBe(true);
    const second = HelloPayloadSchema.parse(await joinHello(2));
    expect(second.saveArchived).toBeUndefined();
  });
});
