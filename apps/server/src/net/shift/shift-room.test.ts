// Integration: ShiftRoom through createGameServer on the `ws` transport, driven by the Colyseus SDK of
// @colyseus/testing. REST join (Bearer + membership + admission) -> server-side join ticket -> onAuth (no URL token);
// 6 players in one room per
// Contract, FRAMEs with acks, Schema roster, purchase/select_tool intents, 4101/4106/4100 close codes, seat hold.
import { ColyseusTestServer } from "@colyseus/testing";
import { matchMaker } from "@colyseus/core";
import {
  CloseCode,
  HelloPayloadSchema,
  MAX_PLAYERS_PER_ROOM,
  MESSAGE_CATALOG,
  PROTOCOL_VERSION,
  STANDARD_GRID_PARAMS,
} from "@moon-cleanup/shared";
import { inflateRawSync } from "node:zlib";
import {
  FRAME_OK,
  FrameReader,
  FrameView,
  SlotTable,
  SnapshotAssembler,
  decodeSnapshotStream,
  encodeInput,
  type Inflate,
} from "@moon-cleanup/protocol";
import { loadGameData } from "@moon-cleanup/game-data";
import { createPlotGrid } from "@moon-cleanup/world";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createGameServer, type GameServer } from "../game-server";
import type { NetLogger } from "../http-routes";
import { JoinTickets } from "./join-ticket";
import { MemoryShiftDustStore } from "./shift-persistence";
import { SHIFT_JOIN_PATH, type ShiftMember } from "./shift-join";
import { SHIFT_ROOM_NAME, type ShiftRoom } from "./shift-room";

const ALLOWED = "http://localhost:5178";
const silent: NetLogger = { info() {}, warn() {}, error() {}, debug() {} };
const CONTRACT_A = "00000000-0000-4000-8000-0000000000a1";
const CONTRACT_B = "00000000-0000-4000-8000-0000000000b2";
const CONTRACT_C = "00000000-0000-4000-8000-0000000000c3";
const CONTRACT_D = "00000000-0000-4000-8000-0000000000d4";
const CONTRACT_E = "00000000-0000-4000-8000-0000000000e5";
const dustStore = new MemoryShiftDustStore();
const inflate: Inflate = (bytes, max) => {
  try {
    return new Uint8Array(inflateRawSync(bytes, { maxOutputLength: max }));
  } catch {
    return null;
  }
};
const pid = (i: number) => `00000000-0000-4000-8000-0000000001${i.toString(16).padStart(2, "0")}`;

let server: GameServer;
let testServer: ColyseusTestServer;
let BASE = "";
const tickets = new JoinTickets();

beforeAll(async () => {
  const grid = createPlotGrid(STANDARD_GRID_PARAMS);
  server = await createGameServer({
    port: 0,
    admission: { maxRooms: 4, maxClients: 24, maxSeatsPerIp: 24, roomCreatesPerIpPerMin: 100 },
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
      // Test tokens: "tok-<playerId>".
      verifyToken: (t) => Promise.resolve(t.startsWith("tok-") ? { playerId: t.slice(4) } : null),
      membership: (playerId, contractId): Promise<ShiftMember | null> =>
        Promise.resolve(
          playerId === pid(99)
            ? null
            : {
                role: playerId === pid(0) ? "holder" : "staff",
                displayName: `P${playerId.slice(-2)}`,
                shiftType: contractId === CONTRACT_B ? "private" : "private",
              },
        ),
      tickets,
      seatHoldS: 2,
      dustStore,
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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function rest(
  contractId: string,
  token: string | null,
  body: unknown = { protocolVersion: PROTOCOL_VERSION, clientBuild: "t" },
) {
  return fetch(`${BASE}${SHIFT_JOIN_PATH.replace(":id", contractId)}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: ALLOWED,
      "true-client-ip": "203.0.113.90",
      ...(token === null ? {} : { authorization: `Bearer ${token}` }),
    },
    body: JSON.stringify(body),
  });
}

interface Joined {
  room: Awaited<ReturnType<ColyseusTestServer["sdk"]["consumeSeatReservation"]>>;
  frames: Uint8Array[];
  /** DUST_SNAPSHOT / DUST_LEDGER messages, id byte first. */
  dust: Uint8Array[];
  hello: () => unknown;
  closed: () => number | undefined;
  messages: Map<string, unknown[]>;
}

async function join(i: number, contractId = CONTRACT_A, urlToken?: string): Promise<Joined> {
  const res = await rest(contractId, `tok-${pid(i)}`);
  expect(res.status).toBe(200);
  const body = (await res.json()) as { reservation: never };
  expect(body).not.toHaveProperty("joinTicket");
  // No auth token: the ticket is redeemed server-side. `urlToken` puts junk in `_authToken` to prove it is ignored.
  if (urlToken !== undefined) testServer.sdk.http.authToken = urlToken;
  const room = await testServer.sdk.consumeSeatReservation(body.reservation);
  testServer.sdk.http.authToken = undefined as never;
  const frames: Uint8Array[] = [];
  const messages = new Map<string, unknown[]>();
  let hello: unknown;
  let closed: number | undefined;
  room.onMessage(MESSAGE_CATALOG.FRAME.id, (b: Uint8Array) => {
    const m = new Uint8Array(b.byteLength + 1);
    m[0] = MESSAGE_CATALOG.FRAME.id as number;
    m.set(b, 1);
    frames.push(m);
  });
  const dust: Uint8Array[] = [];
  for (const id of [MESSAGE_CATALOG.DUST_SNAPSHOT.id, MESSAGE_CATALOG.DUST_LEDGER.id] as number[]) {
    room.onMessage(id, (b: Uint8Array) => {
      const m = new Uint8Array(b.byteLength + 1);
      m[0] = id;
      m.set(b, 1);
      dust.push(m);
    });
  }
  room.onMessage(MESSAGE_CATALOG.HELLO.id, (h: unknown) => (hello = h));
  room.onMessage("*", (type: string | number, m: unknown) => {
    const list = messages.get(String(type)) ?? [];
    list.push(m);
    messages.set(String(type), list);
  });
  room.onLeave((code: number) => (closed = code));
  return { room, frames, dust, hello: () => hello, closed: () => closed, messages };
}

function sendInput(r: Joined, seq: number, buttons = 0): void {
  const buf = new Uint8Array(32);
  const n = encodeInput(buf, { seq, moveX: 0, moveY: 127, yaw: 0, pitch: 0, buttons, toolParam: 128 });
  r.room.sendBytes(MESSAGE_CATALOG.INPUT.id as number, buf.slice(1, n));
}

function localRoom(roomId: string): ShiftRoom {
  return matchMaker.getLocalRoomById(roomId) as unknown as ShiftRoom;
}

describe("ShiftRoom REST join + onAuth", () => {
  it("refuses a missing/invalid Bearer (401), a non-member (403) and bad join options (400)", async () => {
    expect((await rest(CONTRACT_A, null)).status).toBe(401);
    expect((await rest(CONTRACT_A, "garbage")).status).toBe(401);
    expect((await rest(CONTRACT_A, `tok-${pid(99)}`)).status).toBe(403);
    expect((await rest("not-a-uuid", `tok-${pid(1)}`)).status).toBe(404);
    expect((await rest(CONTRACT_A, `tok-${pid(1)}`, { protocolVersion: "x" })).status).toBe(400);
  });

  it("redeems the ticket server-side: no URL token needed, a URL token is ignored, a seat without a grant is refused", async () => {
    const viaUrl = await join(50, CONTRACT_B, "forged.ticket");
    expect(viaUrl.room.roomId).toBeTruthy();
    expect(tickets.pendingGrants).toBe(0);
    await viaUrl.room.leave();
    // A seat reserved WITHOUT the REST route's grant (e.g. a leaked reservation path) is refused at onAuth.
    const seat = await server.admission.reserve(
      SHIFT_ROOM_NAME,
      {
        protocolVersion: PROTOCOL_VERSION,
        clientBuild: "t",
        contractId: CONTRACT_B,
        shiftType: "private",
        playerId: pid(51),
        displayName: "P51",
        role: "staff",
      },
      "203.0.113.91",
    );
    expect(seat.ok).toBe(true);
    if (seat.ok) await expect(testServer.sdk.consumeSeatReservation(seat.seat as never)).rejects.toBeTruthy();
  });
});

describe("ShiftRoom with 6 players", () => {
  it("puts 6 players of one Contract in one room, streams FRAMEs with acks, roster in Schema, intents work", async () => {
    const clients: Joined[] = [];
    for (let i = 0; i < MAX_PLAYERS_PER_ROOM; i++) clients.push(await join(i));
    const roomId = clients[0]!.room.roomId;
    expect(new Set(clients.map((c) => c.room.roomId)).size).toBe(1);
    const room = localRoom(roomId);
    expect(room.core.activeSeats).toBe(6);
    for (let seq = 1; seq <= 30; seq++) {
      for (const c of clients) sendInput(c, seq, 1 << 3);
      await sleep(50);
    }
    await sleep(300);
    const reader = new FrameReader();
    const view = new FrameView();
    for (const c of clients) {
      expect(HelloPayloadSchema.parse(c.hello())).toMatchObject({ simTickHz: 20, snapshotHz: 10 });
      expect(c.frames.length).toBeGreaterThanOrEqual(20);
      const table = new SlotTable();
      for (const f of c.frames) expect(reader.decode(f, view, table, room.core.sim.world.grid.count)).toBe(FRAME_OK);
      // 30 real inputs, then 3 substituted seqs once input stops (netcode.md section 5.1), then neutral.
      // (timing under load may leave fewer substitutions in the last frame; never more, never a lost real input).
      expect(view.ackInputSeq).toBeGreaterThanOrEqual(30);
      expect(view.ackInputSeq).toBeLessThanOrEqual(30 + 3);
      expect(table.count).toBe(5);
      const state = c.room.state as { players: { size: number }; contractId: string; walletLumens: number };
      expect(state.players.size).toBe(6);
      expect(state.contractId).toBe(CONTRACT_A);
    }
    // The room's real dust ledger (same as the Solo host): sweeping opens plots, and `plot.opened` reaches every client
    // in a `sim_events` batch (rare, one broadcast).
    expect(room.core.sim.counters.plotsOpened).toBeGreaterThan(0);
    expect(room.core.ledgerPoolGrowths).toBe(0);
    for (const c of clients) {
      const batches = (c.messages.get(MESSAGE_CATALOG.SIM_EVENTS.id) ?? []) as { events: { name: string }[] }[];
      const names = batches.flatMap((b) => b.events.map((e) => e.name));
      expect(names).toContain("plot.opened");
    }
    // Control intents: purchase of an unknown item answers purchase_result ok:false; bad payload -> error INVALID.
    clients[1]!.room.send(MESSAGE_CATALOG.PURCHASE.id, {
      requestId: "00000000-0000-4000-8000-00000000f001",
      itemId: "tool.does_not_exist",
    });
    clients[1]!.room.send(MESSAGE_CATALOG.SELECT_TOOL.id, { slot: 99 });
    // Staff may not change the shift type; Holder may.
    clients[2]!.room.send(MESSAGE_CATALOG.SET_SHIFT_TYPE.id, { shiftType: "private" });
    await sleep(300);
    const results = clients[1]!.messages.get(MESSAGE_CATALOG.PURCHASE_RESULT.id) ?? [];
    expect(results[0]).toMatchObject({ ok: false });
    expect(clients[1]!.messages.get(MESSAGE_CATALOG.ERROR.id)?.[0]).toMatchObject({ code: "INVALID" });
    expect(clients[2]!.messages.get(MESSAGE_CATALOG.ERROR.id)?.[0]).toMatchObject({ code: "FORBIDDEN" });
    const t = room.tickStats();
    console.info(
      `[shift room] 6 clients over ws, ${t.n} ticks: p50 ${t.p50.toFixed(3)} ms, p95 ${t.p95.toFixed(3)} ms, max ${t.max.toFixed(3)} ms, overruns ${room.overruns}`,
    );
    // ~50 cold ticks (JIT warm-up, parallel suites): logged, not the gate. The p95 <= 3.5 ms gate is the warmed
    // 1,200-tick ShiftCore benchmark in shift-core.test.ts; this only guards against a grossly slow live loop.
    expect(t.p50).toBeLessThanOrEqual(3.5);

    // Duplicate session: the same player joining again closes the older connection with 4106.
    const again = await join(3);
    await sleep(200);
    expect(clients[3]!.closed()).toBe(CloseCode.DUPLICATE_SESSION);
    expect(room.core.activeSeats).toBe(6);
    expect(again.room.roomId).toBe(roomId);
    clients[3] = again;
    // A 7th distinct member reaches the same room and is closed with 4105 ROOM_FULL.
    await expect(join(6)).rejects.toMatchObject({ code: CloseCode.ROOM_FULL });
    await Promise.all(clients.map((c) => c.room.leave()));
    await sleep(200);
  });

  it("sends a keyframe FRAME on a resync request (visibility hidden:false while visible), decodable from empty", async () => {
    const a = await join(20, CONTRACT_C);
    const b = await join(21, CONTRACT_C);
    const room = localRoom(a.room.roomId);
    const grid = room.core.sim.world.grid.count;
    const reader = new FrameReader();
    const view = new FrameView();
    await expect.poll(() => a.frames.length, { timeout: 3000 }).toBeGreaterThanOrEqual(5);
    const before = a.frames.length;
    a.room.send(MESSAGE_CATALOG.VISIBILITY.id, { hidden: false });
    await expect.poll(() => a.frames.length, { timeout: 3000 }).toBeGreaterThanOrEqual(before + 3);
    // The first keyframe after the request is the resync answer; the client decodes it from an EMPTY table.
    let resync = -1;
    for (let i = before; i < a.frames.length && resync < 0; i++) {
      if (reader.decode(a.frames[i]!, view, new SlotTable(), grid) === FRAME_OK && view.keyframe) resync = i;
    }
    expect(resync).toBeGreaterThanOrEqual(before);
    const table = new SlotTable();
    expect(reader.decode(a.frames[resync]!, view, table, grid)).toBe(FRAME_OK);
    expect(table.count).toBe(1);
    for (let i = resync + 1; i < a.frames.length; i++) {
      expect(reader.decode(a.frames[i]!, view, table, grid)).toBe(FRAME_OK);
      expect(view.keyframe).toBe(false);
    }
    // Not counted as a violation, no error answer; a second request inside 1 s is dropped by the visibility bucket.
    expect(a.messages.get(MESSAGE_CATALOG.ERROR.id)).toBeUndefined();
    const dropped = room.dropped;
    a.room.send(MESSAGE_CATALOG.VISIBILITY.id, { hidden: false });
    await expect.poll(() => room.dropped, { timeout: 2000 }).toBe(dropped + 1);
    await Promise.all([a.room.leave(), b.room.leave()]);
    await sleep(100);
  });

  it("closes a protocol mismatch with 4100 and a different Contract gets its own room", async () => {
    const res = await rest(CONTRACT_B, `tok-${pid(7)}`, { protocolVersion: PROTOCOL_VERSION + 1, clientBuild: "t" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { reservation: { roomId: string } };
    // The room closes during onJoin, so the SDK rejects the join with the 4100 mismatch info.
    await expect(testServer.sdk.consumeSeatReservation(body.reservation as never)).rejects.toMatchObject({
      code: CloseCode.PROTOCOL_MISMATCH,
    });
  });

  it("closes a seat that never speaks with 4107 is covered by IdleWatch; malformed input spam closes with 4104", async () => {
    const c = await join(8, CONTRACT_B);
    for (let k = 0; k < 60; k++) c.room.sendBytes(MESSAGE_CATALOG.INPUT.id as number, new Uint8Array([1, 2, 3]));
    await sleep(400);
    expect(c.closed()).toBe(CloseCode.RATE_LIMITED);
  });
});

/** Assembles the DUST_SNAPSHOT slices a client received; the decoded snapshot or null. */
function snapshotOf(j: Joined, plotCount: number) {
  const asm = new SnapshotAssembler();
  let done: Uint8Array | null = null;
  for (const m of j.dust) {
    if (m[0] === (MESSAGE_CATALOG.DUST_SNAPSHOT.id as number) && asm.add(m) === "complete") done = asm.take();
  }
  return done === null ? null : decodeSnapshotStream(done, inflate, plotCount);
}

function simEvents(j: Joined): { name: string; payload: Record<string, unknown> }[] {
  const batches = (j.messages.get(MESSAGE_CATALOG.SIM_EVENTS.id) ?? []) as {
    events: { name: string; payload: Record<string, unknown> }[];
  }[];
  return batches.flatMap((b) => b.events);
}

describe("ShiftRoom dust over the wire (M1-W4-T06)", () => {
  it("plot.polished travels server -> client in sim_events, with its dust.plots delta and the Stamp in Schema", async () => {
    const a = await join(30, CONTRACT_E);
    const room = localRoom(a.room.roomId);
    const ledger = room.core.ledger;
    const seat = room.seatOf(a.room.sessionId);
    expect(seat).toBeGreaterThanOrEqual(0);
    // A far, untouched, non-Empty plot made Polished-ready: no dust left, all removal credited to this seat. The ledger
    // queues it as Polished on refresh; the sim drains the queue on the next applied stroke (Stamp + event).
    let plot = 5000;
    while (ledger.isEmptyPlot(plot as never) || ledger.slotOf[plot]! >= 0) plot++;
    expect(ledger.installLedger(plot, new Uint8Array(1024), 0, 1)).toBe(0);
    ledger.addContribution(plot, seat, ledger.initial[ledger.slotOf[plot]!]!);
    ledger.refreshPlot(plot);
    expect(ledger.polishedQueueCount).toBe(1);
    const walletBefore = room.core.sim.wallet;
    for (let seq = 1; seq <= 40; seq++) {
      sendInput(a, seq, 1 << 3);
      await sleep(50);
    }
    await expect.poll(() => simEvents(a).some((e) => e.name === "plot.polished"), { timeout: 4000 }).toBe(true);
    const polished = simEvents(a).find((e) => e.name === "plot.polished")!;
    expect(polished.payload).toMatchObject({ plotId: plot, credit: "player", creditedSlot: seat, polishedCount: 1 });
    expect(polished.payload["stampLm"]).toBeGreaterThan(0);
    expect(room.core.sim.wallet).toBeGreaterThan(walletBefore);
    // The moon-wide L0 delta of that plot (state 2 = Polished) reached the client in a FRAME.
    await sleep(600);
    const reader = new FrameReader();
    const view = new FrameView();
    const table = new SlotTable();
    let delta = -1;
    for (const f of a.frames) {
      expect(reader.decode(f, view, table, ledger.plotCount)).toBe(FRAME_OK);
      for (let i = 0; i < view.dustPlots.count; i++) {
        if (view.dustPlots.plotId[i] === plot) delta = view.dustPlots.state[i]!;
      }
    }
    expect(delta).toBe(2);
    // Schema mirrors (frame-tick patches): Shine counts the new Polished plot, the wallet holds the Stamp.
    const state = () => a.room.state as { shinePolished: number; walletLumens: number };
    await expect.poll(() => state().shinePolished, { timeout: 2000 }).toBe(ledger.shinePlots);
    await expect.poll(() => state().walletLumens, { timeout: 2000 }).toBe(room.core.sim.wallet);
    await a.room.leave();
    await sleep(100);
  });

  it("a late joiner receives a DUST_SNAPSHOT with the room ledgers; the dust survives a room restart", async () => {
    const a = await join(40, CONTRACT_D);
    const roomId = a.room.roomId;
    const room = localRoom(roomId);
    for (let seq = 1; seq <= 60; seq++) {
      sendInput(a, seq, 1 << 3);
      await sleep(50);
    }
    await expect.poll(() => room.core.ledger.ledgerCount, { timeout: 3000 }).toBeGreaterThan(0);
    const plots = room.core.ledger.plotCount;
    // The first joiner's snapshot arrived too (pristine moon at its join).
    expect(snapshotOf(a, plots)).not.toBeNull();
    const late = await join(41, CONTRACT_D);
    expect(late.room.roomId).toBe(roomId);
    await expect.poll(() => snapshotOf(late, plots) !== null, { timeout: 3000 }).toBe(true);
    const snap = snapshotOf(late, plots)!;
    expect(snap.ledgers.length).toBeGreaterThan(0);
    for (const e of snap.ledgers) expect(e.header.hash).toBe(room.core.ledger.ledgerHash(e.plotId));

    // Everyone leaves: the room disposes and writes its dirty chunks; the next join restores them.
    const hash = room.core.ledger.worldHash();
    const ledgers = room.core.ledger.ledgerCount;
    const savesBefore = dustStore.saves;
    await Promise.all([a.room.leave(), late.room.leave()]);
    await expect.poll(() => matchMaker.getLocalRoomById(roomId) === undefined, { timeout: 5000 }).toBe(true);
    await expect.poll(() => dustStore.saves, { timeout: 3000 }).toBeGreaterThan(savesBefore);
    expect(dustStore.storedBytes(CONTRACT_D)).toBeGreaterThan(0);
    const again = await join(42, CONTRACT_D);
    expect(again.room.roomId).not.toBe(roomId);
    const restored = localRoom(again.room.roomId);
    expect(restored.persistence?.lastRestore?.ok).toBe(true);
    expect(restored.core.ledger.ledgerCount).toBe(ledgers);
    expect(restored.core.ledger.worldHash()).toBe(hash);
    // The restore paid no Stamp and replayed no event.
    expect(restored.core.sim.counters.plotsOpened).toBe(0);
    expect(restored.core.sim.counters.plotsPolished).toBe(0);
    await again.room.leave();
    await sleep(100);
  });
});
