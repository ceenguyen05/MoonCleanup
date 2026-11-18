// ShiftRoom co-op (M1-W8-T01): join-in-progress, Holder kick, session-scoped ban, reconnect within the seat hold.
import { ColyseusTestServer } from "@colyseus/testing";
import { matchMaker } from "@colyseus/core";
import {
  CloseCode,
  MAX_PLAYERS_PER_ROOM,
  MESSAGE_CATALOG,
  PROTOCOL_VERSION,
  STANDARD_GRID_PARAMS,
} from "@moon-cleanup/shared";
import { loadGameData } from "@moon-cleanup/game-data";
import { createPlotGrid } from "@moon-cleanup/world";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createGameServer, type GameServer } from "../game-server";
import type { NetLogger } from "../http-routes";
import { JoinTickets } from "./join-ticket";
import { SHIFT_JOIN_PATH, type ShiftMember } from "./shift-join";
import type { ShiftRoom } from "./shift-room";

const ALLOWED = "http://localhost:5178";
const silent: NetLogger = { info() {}, warn() {}, error() {}, debug() {} };
const CONTRACT = "00000000-0000-4000-8000-0000000000c1";
const pid = (i: number) => `00000000-0000-4000-8000-0000000003${i.toString(16).padStart(2, "0")}`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let server: GameServer;
let testServer: ColyseusTestServer;
let BASE = "";
const tickets = new JoinTickets();

beforeAll(async () => {
  const grid = createPlotGrid(STANDARD_GRID_PARAMS);
  server = await createGameServer({
    port: 0,
    admission: { maxRooms: 2, maxClients: 16, maxSeatsPerIp: 16, roomCreatesPerIpPerMin: 100 },
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
      membership: (playerId): Promise<ShiftMember | null> =>
        Promise.resolve({
          role: playerId === pid(0) ? "holder" : "staff",
          displayName: `P${playerId.slice(-2)}`,
          shiftType: "private",
        }),
      tickets,
      seatHoldS: 3,
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

async function reserve(i: number) {
  const res = await fetch(`${BASE}${SHIFT_JOIN_PATH.replace(":id", CONTRACT)}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: ALLOWED,
      "true-client-ip": "203.0.113.96",
      authorization: `Bearer tok-${pid(i)}`,
    },
    body: JSON.stringify({ protocolVersion: PROTOCOL_VERSION, clientBuild: "t" }),
  });
  expect(res.status).toBe(200);
  return ((await res.json()) as { reservation: never }).reservation;
}

async function join(i: number) {
  const room = await testServer.sdk.consumeSeatReservation(await reserve(i));
  let closed: number | undefined;
  const messages = new Map<string, unknown[]>();
  room.onMessage("*", (type: string | number, m: unknown) => {
    const list = messages.get(String(type)) ?? [];
    list.push(m);
    messages.set(String(type), list);
  });
  room.onLeave((code: number) => (closed = code));
  return { room, closed: () => closed, messages };
}

const localRoom = (id: string) => matchMaker.getLocalRoomById(id) as unknown as ShiftRoom;

describe("ShiftRoom co-op", () => {
  it("join-in-progress, Holder kick and session ban, held-seat kick, and seat cap", async () => {
    const holder = await join(0);
    const room = localRoom(holder.room.roomId);
    const a = await join(1);
    for (let k = 0; k < 20; k++) await sleep(50); // the shift is running
    const late = await join(2); // join in progress
    expect(late.room.roomId).toBe(holder.room.roomId);
    expect(room.core.activeSeats).toBe(3);

    // Staff cannot kick; nobody can kick the Holder or self.
    a.room.send(MESSAGE_CATALOG.KICK.id, { playerId: pid(2), reasonCode: "other" });
    holder.room.send(MESSAGE_CATALOG.KICK.id, { playerId: pid(0), reasonCode: "other" });
    await sleep(300);
    expect(a.messages.get(MESSAGE_CATALOG.ERROR.id)?.[0]).toMatchObject({ code: "FORBIDDEN" });
    expect(holder.messages.get(MESSAGE_CATALOG.ERROR.id)?.[0]).toMatchObject({ code: "FORBIDDEN" });
    a.room.send(MESSAGE_CATALOG.KICK.id, { playerId: pid(0), reasonCode: "other" });
    await sleep(200);
    expect(room.core.activeSeats).toBe(3);

    // Holder kicks (no ban): 4102 + notice, seat freed, the player may rejoin.
    holder.room.send(MESSAGE_CATALOG.KICK.id, { playerId: pid(2), reasonCode: "griefing" });
    await expect.poll(() => late.closed(), { timeout: 3000 }).toBe(CloseCode.KICKED);
    expect(late.messages.get(MESSAGE_CATALOG.KICK_NOTICE.id)?.[0]).toMatchObject({
      by: "holder",
      reasonCode: "griefing",
    });
    await expect.poll(() => room.core.activeSeats, { timeout: 3000 }).toBe(2);
    const back = await join(2);
    expect(room.core.activeSeats).toBe(3);

    // Ban: closed 4103 and the same player cannot join again this session.
    holder.room.send(MESSAGE_CATALOG.KICK.id, { playerId: pid(2), reasonCode: "harassment", ban: true });
    await expect.poll(() => back.closed(), { timeout: 3000 }).toBe(CloseCode.BANNED);
    await expect(join(2)).rejects.toMatchObject({ code: CloseCode.BANNED });
    await expect.poll(() => room.core.activeSeats, { timeout: 3000 }).toBe(2);

    // Seat cap: fill to 6, the 7th distinct player is refused.
    const rest: Awaited<ReturnType<typeof join>>[] = [];
    for (let i = 3; i < 3 + (MAX_PLAYERS_PER_ROOM - 2); i++) rest.push(await join(i));
    expect(room.core.activeSeats).toBe(MAX_PLAYERS_PER_ROOM);
    await expect(join(20)).rejects.toMatchObject({ code: CloseCode.ROOM_FULL });

    // Held-seat kick: a dropped player's seat is freed by a kick and the late reconnect is refused.
    const victim = rest[0]!;
    victim.room.reconnection.enabled = false;
    (victim.room.connection as unknown as { transport: { ws: { close(c: number): void } } }).transport.ws.close(4010);
    await expect.poll(() => room.core.isHeld(room.seatOf(victim.room.sessionId)), { timeout: 3000 }).toBe(true);
    holder.room.send(MESSAGE_CATALOG.KICK.id, { playerId: pid(3), reasonCode: "other" });
    await expect.poll(() => room.core.activeSeats, { timeout: 3000 }).toBe(MAX_PLAYERS_PER_ROOM - 1);

    await Promise.all([holder, a, ...rest.slice(1)].map((c) => c.room.leave()));
    await sleep(100);
  });

  it("reconnects within the seat hold and keeps the seat (no new seat)", async () => {
    const a = await join(0);
    const b = await join(1);
    const room = localRoom(a.room.roomId);
    const seat = room.seatOf(b.room.sessionId);
    expect(seat).toBeGreaterThanOrEqual(0);
    (b.room as unknown as { reconnection: { minUptime: number } }).reconnection.minUptime = 0;
    (b.room.connection as unknown as { transport: { ws: { close(c: number): void } } }).transport.ws.close(4010);
    await expect.poll(() => room.core.isHeld(seat), { timeout: 3000 }).toBe(true);
    await expect.poll(() => room.core.isHeld(seat), { timeout: 6000 }).toBe(false);
    expect(room.seatOf(b.room.sessionId)).toBe(seat);
    expect(room.core.activeSeats).toBe(2);
    await Promise.all([a.room.leave(), b.room.leave()]);
    await sleep(100);
  });
});
