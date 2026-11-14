// Integration: LoadTestRoom on a real uWS socket (port 2567 + agent offset 3), driven by the Colyseus SDK that
// @colyseus/testing ships. Covers registration, REST join with bounded rates, 6-seat cap, 16-client join/leave churn,
// synthetic inputs at 20 Hz with acks, malformed input, per-type byte metrics and coalesced writes.
import "../testing/uws-esm-fix";

import { matchMaker } from "@colyseus/core";
import { ColyseusTestServer } from "@colyseus/testing";
import { HelloPayloadSchema, MAX_PLAYERS_PER_ROOM, MESSAGE_CATALOG, PROTOCOL_VERSION } from "@moon-cleanup/shared";
import {
  SPIKE_DUST_ID,
  SPIKE_FRAME_ID,
  createSpikeFrameHeader,
  createSpikeInput,
  readSpikeFrameHeader,
  writeSpikeInputBody,
} from "@moon-cleanup/protocol";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createGameServer, type GameServer } from "../game-server";
import type { NetLogger } from "../http-routes";
import { BYTES_TYPE, type LoadTestRoom, type SpikeRoomStats, type SpikeStatsSink } from "./load-test-room";
import { SPIKE_JOIN_PATH, type SpikeJoinResponse } from "./spike-join-route";

let PORT = 0;
let BASE = "";
const ALLOWED = "http://localhost:5177";
const silent: NetLogger = { info() {}, warn() {}, error() {}, debug() {} };

class FakeStats implements SpikeRoomStats {
  ticks = 0;
  clients = 0;
  readonly bytes = new Map<string, number>();
  setClients(count: number): void {
    this.clients = count;
  }
  recordTick(): void {
    this.ticks++;
  }
  recordBytesOut(type: string, bytes: number): void {
    this.bytes.set(type, (this.bytes.get(type) ?? 0) + bytes);
  }
  late = 0;
  recordLateInputs(count: number): void {
    this.late += count;
  }
}

const added = new Map<string, FakeStats>();
const removed: string[] = [];
const statsSink: SpikeStatsSink = {
  addRoom(roomId) {
    const s = new FakeStats();
    added.set(roomId, s);
    return s;
  },
  removeRoom(roomId) {
    removed.push(roomId);
  },
};

let server: GameServer;
let testServer: ColyseusTestServer;

beforeAll(async () => {
  server = await createGameServer({
    port: 0,
    // Many short-lived rooms from one test IP: generous ceilings (admission.test.ts covers the limits).
    admission: { maxRooms: 16, maxClients: 100, roomCreatesPerIpPerMin: 1000 },
    routes: [{ method: "GET", path: "/healthz", handle: () => ({ status: 200, body: { ok: true } }) }],
    allowedOrigins: [ALLOWED],
    logger: silent,
    rates: { simTickHz: 20, snapshotHz: 10 },
    serverBuild: "test-build",
    // Pinned: these suites test the uWS adapter (game-server-ws.test.ts covers the ws fallback).
    transport: "uws",
    helloRoom: false,
    loadTest: { enabled: true, stats: statsSink },
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

async function reserve(extra: Record<string, unknown>): Promise<Response> {
  return fetch(`${BASE}${SPIKE_JOIN_PATH}`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: ALLOWED, "true-client-ip": "203.0.113.78" },
    body: JSON.stringify({ protocolVersion: PROTOCOL_VERSION, clientBuild: "test", ...extra }),
  });
}

async function join(extra: Record<string, unknown> = { tickHz: 20, snapshotHz: 10 }) {
  const res = await reserve(extra);
  expect(res.status).toBe(200);
  const { reservation } = (await res.json()) as SpikeJoinResponse;
  const room = await testServer.sdk.consumeSeatReservation(reservation);
  const frames: Uint8Array[] = [];
  let dust = 0;
  let hello: unknown;
  room.onMessage(SPIKE_FRAME_ID, (b: Uint8Array) => frames.push(b));
  room.onMessage(SPIKE_DUST_ID, () => dust++);
  room.onMessage(MESSAGE_CATALOG.HELLO.id, (h: unknown) => (hello = h));
  room.onMessage("*", () => undefined);
  return { room, frames, dust: () => dust, hello: () => hello };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function localRoom(roomId: string): LoadTestRoom {
  return matchMaker.getLocalRoomById(roomId) as unknown as LoadTestRoom;
}

describe("LoadTestRoom join and bounds", () => {
  it("rejects out-of-range rates and bad join options with 400", async () => {
    expect((await reserve({ tickHz: 60, snapshotHz: 10 })).status).toBe(400);
    expect((await reserve({ tickHz: 20, snapshotHz: 30 })).status).toBe(400);
    // snapshotHz must divide tickHz (review N6; 30/15 is the high-rate profile).
    expect((await reserve({ tickHz: 30, snapshotHz: 20 })).status).toBe(400);
    expect((await reserve({ tickHz: 20, snapshotHz: 10, bodies: 1000 })).status).toBe(400);
    const res = await fetch(`${BASE}${SPIKE_JOIN_PATH}`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: ALLOWED, "true-client-ip": "203.0.113.78" },
      body: JSON.stringify({ tickHz: 20 }),
    });
    expect(res.status).toBe(400);
  });

  it("sends HELLO with the requested rates and Schema state with one avatar per seat", async () => {
    const c = await join({ tickHz: 30, snapshotHz: 15 });
    await sleep(300);
    expect(HelloPayloadSchema.parse(c.hello())).toMatchObject({ simTickHz: 30, snapshotHz: 15 });
    const state = c.room.state as {
      simTickHz: number;
      avatars: { length: number; at(i: number): { connected: boolean } };
    };
    expect(state.simTickHz).toBe(30);
    expect(state.avatars.length).toBe(MAX_PLAYERS_PER_ROOM);
    expect(state.avatars.at(0).connected).toBe(true);
    // ~15 frames/s for 300 ms.
    expect(c.frames.length).toBeGreaterThanOrEqual(3);
    await c.room.leave();
  });
});

describe("LoadTestRoom load", () => {
  it("caps a room at 6 seats; 16 clients join and leave with churn; the room disposes", async () => {
    const opts = { tickHz: 20, snapshotHz: 10, bodies: 33 };
    const live: Awaited<ReturnType<typeof join>>[] = [];
    let joins = 0;
    for (let i = 0; i < MAX_PLAYERS_PER_ROOM; i++) {
      live.push(await join(opts));
      joins++;
    }
    const roomId = live[0]?.room.roomId ?? "";
    expect(new Set(live.map((c) => c.room.roomId)).size).toBe(1);
    const room = localRoom(roomId);
    expect(room.engine.activeSeats).toBe(6);
    // The 7th lands in a second room (matchmaker), never a 7th seat.
    const seventh = await join(opts);
    joins++;
    expect(seventh.room.roomId).not.toBe(roomId);
    await seventh.room.leave();
    // Churn: leave two, join two, until 16 distinct clients have joined.
    while (joins < 16) {
      const gone = live.splice(0, 2);
      await Promise.all(gone.map((c) => c.room.leave()));
      for (let k = 0; k < 2 && joins < 16; k++) {
        live.push(await join(opts));
        joins++;
      }
      expect(room.engine.activeSeats).toBeLessThanOrEqual(6);
    }
    expect(room.engine.activeSeats).toBe(live.length);
    await Promise.all(live.map((c) => c.room.leave()));
    await sleep(100);
    expect(removed).toContain(roomId);
  });

  it("accepts synthetic inputs at 20 Hz, acks them in frames, counts bytes per type in one write per tick", async () => {
    const opts = { tickHz: 20, snapshotHz: 10, robots: 31 };
    const clients = [];
    for (let i = 0; i < MAX_PLAYERS_PER_ROOM; i++) clients.push(await join(opts));
    const roomId = clients[0]?.room.roomId ?? "";
    const room = localRoom(roomId);
    room.loopTimingsAndReset();
    await sleep(300);
    const patchBefore = added.get(roomId)?.bytes.get(BYTES_TYPE.patch) ?? 0;
    const out = new Uint8Array(32);
    const input = createSpikeInput();
    let seq = 0;
    for (let t = 0; t < 30; t++) {
      seq++;
      for (const c of clients) {
        input.seq = seq;
        input.moveY = 127;
        input.yaw = (t * 500) & 0xffff;
        input.buttons = 1 << 3;
        const n = writeSpikeInputBody([input], 1, out);
        c.room.sendBytes(MESSAGE_CATALOG.SPIKE_INPUT.id, out.slice(0, n));
      }
      await sleep(50);
    }
    await sleep(250);
    expect(room.engine.counters.inputsAccepted).toBeGreaterThanOrEqual(30 * 6 - 6);
    const header = createSpikeFrameHeader();
    const last = clients[0]?.frames.at(-1);
    expect(last !== undefined && readSpikeFrameHeader(last, header)).toBe(true);
    // Once inputs stop, the server substitutes and consumes the missing sequence numbers (netcode.md section 5.1),
    // so the ack runs ahead of the last sent seq by the substituted ticks.
    expect(header.ackInputSeq).toBeGreaterThanOrEqual(seq);
    expect(header.ackInputSeq - seq).toBeLessThanOrEqual(room.engine.counters.inputsSubstituted);
    expect(clients[0]?.dust()).toBeGreaterThan(5);

    // Malformed input: dropped and counted, never throws, client stays.
    const before = room.dropped;
    clients[0]?.room.sendBytes(MESSAGE_CATALOG.SPIKE_INPUT.id, new Uint8Array([9, 9]));
    await sleep(100);
    expect(room.dropped).toBe(before + 1);
    expect(room.engine.activeSeats).toBe(6);

    const stats = added.get(roomId);
    expect(stats?.bytes.get(BYTES_TYPE.frame)).toBeGreaterThan(0);
    expect(stats?.bytes.get(BYTES_TYPE.dust)).toBeGreaterThan(0);
    // Schema patches keep flowing during play (wallet/grams change), not only at join.
    expect(stats?.bytes.get(BYTES_TYPE.patch) ?? 0).toBeGreaterThan(patchBefore);
    expect(stats?.ticks).toBeGreaterThan(20);
    // Frame + dust + patch of one tick leave as one write per client: writes <= ticks x clients (+ joins/control).
    const timings = room.loopTimingsAndReset();
    expect(timings.socketWrites).toBeLessThanOrEqual(timings.ticks * 6 + 12);
    expect(timings.socketWrites).toBeGreaterThan(0);
    await Promise.all(clients.map((c) => c.room.leave()));
  });

  it("forwards late/duplicate input drops to the room stats (counter behind the rate-limited log)", async () => {
    const c = await join({ tickHz: 20, snapshotHz: 10 });
    const room = localRoom(c.room.roomId);
    const stats = added.get(c.room.roomId);
    const out = new Uint8Array(32);
    const input = createSpikeInput();
    input.seq = 5;
    const n = writeSpikeInputBody([input], 1, out);
    c.room.sendBytes(MESSAGE_CATALOG.SPIKE_INPUT.id, out.slice(0, n));
    await sleep(60);
    // The same sequence number again is a duplicate: dropped as late, not a violation.
    const droppedBefore = room.dropped;
    c.room.sendBytes(MESSAGE_CATALOG.SPIKE_INPUT.id, out.slice(0, n));
    await sleep(100);
    expect(room.engine.counters.inputsLate).toBeGreaterThanOrEqual(1);
    expect(stats?.late).toBe(room.engine.counters.inputsLate);
    expect(room.dropped).toBe(droppedBefore);
    await c.room.leave();
  });
});
