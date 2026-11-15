// ShiftCore (transport-free) and its parts: section 5.1 input sequencing, join tickets, a 6-player authoritative room
// with FRAME decode checks, interest filtering, and the room tick-time measurement (netcode.md section 15 gate:
// tick p95 <= 3.5 ms with 6 bots).
import { STANDARD_GRID_PARAMS, MAX_PLAYERS_PER_ROOM, type ContractId, type PlayerId } from "@moon-cleanup/shared";
import { FRAME_OK, FrameReader, FrameView, SlotTable, encodeInput, type MutableInput } from "@moon-cleanup/protocol";
import { loadGameData } from "@moon-cleanup/game-data";
import { createPlotGrid } from "@moon-cleanup/world";
import { MoonRoomSim, type SimWorld } from "@moon-cleanup/sim";
import { describe, expect, it } from "vitest";
import { ConsumeKind, InputAccept, InputSequencer, SUBSTITUTE_MAX } from "./input-sequencer";
import { JoinTickets } from "./join-ticket";
import { InputVerdict, ShiftCore, type ShiftSink } from "./shift-core";
import { percentiles } from "./shift-room";
import { SHIFT_STATE_CLASS_FIELDS } from "./shift-state";
import { SHIFT_STATE_SCHEMA_FIELDS } from "@moon-cleanup/shared";

const CONTRACT = "00000000-0000-4000-8000-0000000000c7" as ContractId;
let world: SimWorld | undefined;
function flatWorld(): SimWorld {
  world ??= { grid: createPlotGrid(STANDARD_GRID_PARAMS), ground: { heightAtXYZ: () => 0 } };
  return world;
}
const data = loadGameData();

function makeCore(): ShiftCore {
  return new ShiftCore({ data, world: flatWorld(), contractId: CONTRACT, shiftType: "private", simTickHz: 20 }, 0);
}

function player(i: number) {
  return {
    playerId: `00000000-0000-4000-8000-0000000000${(0xa0 + i).toString(16)}` as PlayerId,
    displayName: `Bot${i}`,
    role: i === 0 ? ("holder" as const) : ("staff" as const),
  };
}

function input(seq: number, moveY = 0, buttons = 0, yaw = 0): MutableInput {
  return { seq, moveX: 0, moveY, yaw, pitch: 0, buttons, toolParam: 128 };
}

/** INPUT message body as Colyseus delivers it (type byte stripped). */
function inputBody(a: MutableInput, b?: MutableInput): Uint8Array {
  const buf = new Uint8Array(32);
  const n = encodeInput(buf, a, b);
  return buf.slice(1, n);
}

describe("InputSequencer (netcode.md section 5.1)", () => {
  it("consumes one seq per tick, drops late and duplicate inputs, never double-applies", () => {
    const q = new InputSequencer();
    expect(q.push(input(10))).toBe(InputAccept.Buffered);
    expect(q.push(input(11))).toBe(InputAccept.Buffered);
    expect(q.push(input(11))).toBe(InputAccept.Late);
    expect(q.depth).toBe(2);
    expect(q.consume()).toBe(ConsumeKind.Real);
    expect(q.current.seq).toBe(10);
    expect(q.push(input(10))).toBe(InputAccept.Late);
    expect(q.consume()).toBe(ConsumeKind.Real);
    expect(q.lastConsumedSeq).toBe(11);
    expect(q.depth).toBe(0);
  });

  it("substitutes up to 3 ticks consuming the seq, then neutral without consuming; late real input is dropped", () => {
    const q = new InputSequencer();
    q.push(input(1, 100, 1));
    q.consume();
    for (let k = 0; k < SUBSTITUTE_MAX; k++) {
      expect(q.consume()).toBe(ConsumeKind.Substituted);
      expect(q.current.moveY).toBe(100); // levels repeated verbatim
    }
    expect(q.lastConsumedSeq).toBe(1 + SUBSTITUTE_MAX);
    expect(q.push(input(2))).toBe(InputAccept.Late); // its seq was substituted
    expect(q.consume()).toBe(ConsumeKind.Neutral);
    expect(q.current.moveY).toBe(0);
    expect(q.lastConsumedSeq).toBe(1 + SUBSTITUTE_MAX);
    expect(q.push(input(5))).toBe(InputAccept.Buffered);
    expect(q.consume()).toBe(ConsumeKind.Real);
  });

  it("refuses inputs more than 16 ahead, wraps at 2^16, and resyncs a starved seat", () => {
    const q = new InputSequencer();
    q.push(input(0xfffe));
    q.consume();
    expect(q.push(input(0xffff))).toBe(InputAccept.Buffered);
    expect(q.push(input(0))).toBe(InputAccept.Buffered);
    expect(q.push(input(40))).toBe(InputAccept.TooFarAhead);
    q.consume();
    q.consume();
    expect(q.lastConsumedSeq).toBe(0);
    for (let k = 0; k < 5; k++) q.consume(); // starve
    expect(q.push(input(500))).toBe(InputAccept.Buffered);
    expect(q.consume()).toBe(ConsumeKind.Real);
    expect(q.lastConsumedSeq).toBe(500);
  });
});

describe("JoinTickets", () => {
  it("accepts a ticket once, only for its claims, and not after expiry", () => {
    let now = 1_000;
    const tickets = new JoinTickets(() => now);
    const claims = { playerId: "p1", roomId: "r1", sessionId: "s1" };
    const t = tickets.issue(claims);
    expect(tickets.consume(t, { ...claims, sessionId: "s2" })).toBe(false);
    expect(tickets.consume(`${t}x`, claims)).toBe(false);
    expect(tickets.consume(undefined, claims)).toBe(false);
    expect(tickets.consume(t, claims)).toBe(true);
    expect(tickets.consume(t, claims)).toBe(false); // single use
    const late = tickets.issue(claims);
    now += 31_000;
    expect(tickets.consume(late, claims)).toBe(false);
    expect(new JoinTickets().consume(tickets.issue(claims), claims)).toBe(false); // other key
  });

  it("redeems a server-side grant once per sessionId, only for its claims and before expiry", () => {
    let now = 1_000;
    const tickets = new JoinTickets(() => now);
    const claims = { playerId: "p1", roomId: "r1", sessionId: "s9" };
    expect(tickets.grant(claims)).toMatch(/\./);
    expect(tickets.pendingGrants).toBe(1);
    expect(tickets.redeemSession({ ...claims, playerId: "p2" })).toBe(false); // wrong claims burn the grant
    expect(tickets.redeemSession(claims)).toBe(false);
    tickets.grant(claims);
    expect(tickets.redeemSession(claims)).toBe(true);
    expect(tickets.redeemSession(claims)).toBe(false); // single use
    tickets.grant(claims);
    now += 31_000;
    expect(tickets.redeemSession(claims)).toBe(false);
    expect(tickets.pendingGrants).toBe(0);
  });
});

describe("ShiftState Schema class", () => {
  it("matches the protocol/shift-state-schema v1 field table in order and type", () => {
    expect(SHIFT_STATE_CLASS_FIELDS.map(([n, t]) => [n, t])).toEqual(
      SHIFT_STATE_SCHEMA_FIELDS.map((f) => [f.name, f.type]),
    );
  });
});

interface Collected {
  frames: Uint8Array[][];
}

function collector(): ShiftSink & Collected {
  const frames: Uint8Array[][] = Array.from({ length: MAX_PLAYERS_PER_ROOM }, () => []);
  return {
    frames,
    frame(seat, body) {
      const msg = new Uint8Array(body.byteLength + 1);
      msg[0] = 0x20;
      msg.set(body, 1);
      frames[seat]!.push(msg);
    },
  };
}

describe("ShiftCore: 6-player authoritative room", () => {
  it("seats 6 players, refuses a 7th, and streams decodable FRAMEs with acks, entities and stroke echoes", () => {
    const core = makeCore();
    for (let i = 0; i < MAX_PLAYERS_PER_ROOM; i++) expect(core.addSeat(player(i), 0)).toBe(i);
    expect(core.addSeat(player(9), 0)).toBe(-1);
    const sink = collector();
    let now = 0;
    for (let tick = 1; tick <= 60; tick++) {
      now += 50;
      for (let s = 0; s < MAX_PLAYERS_PER_ROOM; s++) {
        // walk forward and sweep (toolPrimary = bit 3)
        expect(core.receiveInput(s, inputBody(input(tick, 127, 1 << 3, s * 1000)), now)).toBe(InputVerdict.Ok);
      }
      core.step(sink);
    }
    expect(core.counters.frameEncodeFailures).toBe(0);
    const reader = new FrameReader();
    const view = new FrameView();
    for (let s = 0; s < MAX_PLAYERS_PER_ROOM; s++) {
      const frames = sink.frames[s]!;
      expect(frames.length).toBe(30); // 10 Hz for 3 s
      const table = new SlotTable();
      let entities = 0;
      let strokes = 0;
      for (const f of frames) {
        expect(f.byteLength).toBeLessThanOrEqual(1000);
        expect(reader.decode(f, view, table, flatWorld().grid.count)).toBe(FRAME_OK);
        entities += view.entityCount;
        strokes += view.strokes.chainCount;
      }
      // Last frame tick is tick 58 (frames on even ticks), which consumed seq 59.
      expect(view.ackInputSeq).toBe(59);
      expect(view.serverTick).toBe(58);
      expect(view.inputBufferDepth).toBe(0);
      expect(table.count).toBe(MAX_PLAYERS_PER_ROOM - 1); // every other avatar is within interest (spawn 2 m apart)
      expect(entities).toBeGreaterThan(0);
      expect(strokes).toBeGreaterThan(0); // own echoes + neighbours inside the dust radius
      expect(view.self.px !== 0 || view.self.py !== 0 || view.self.pz !== 0).toBe(true);
    }
    expect(core.counters.inputsLate).toBe(0);
  });

  it("drops malformed and over-rate inputs as counted verdicts, never throws", () => {
    const core = makeCore();
    core.addSeat(player(0), 0);
    expect(core.receiveInput(0, new Uint8Array(0), 0)).toBe(InputVerdict.Malformed);
    expect(core.receiveInput(0, new Uint8Array(15), 1)).toBe(InputVerdict.Malformed);
    const bad = inputBody(input(1));
    bad[0] = 3; // count 3
    expect(core.receiveInput(0, bad, 2)).toBe(InputVerdict.Malformed);
    expect(core.receiveInput(3, inputBody(input(1)), 3)).toBe(InputVerdict.NoSeat);
    let limited = 0;
    for (let i = 0; i < 100; i++)
      if (core.receiveInput(0, inputBody(input(i + 1)), 4) === InputVerdict.RateLimited) limited++;
    expect(limited).toBeGreaterThan(0); // burst 40 at 20 Hz
    for (let k = 0; k < 500; k++) {
      const junk = new Uint8Array(11);
      for (let b = 0; b < 11; b++) junk[b] = (k * 31 + b * 17) & 0xff;
      expect(() => core.receiveInput(0, junk, 10_000 + k * 100)).not.toThrow();
    }
  });

  it("streams far players out of entity interest (horizon rule) and holds/resumes a dropped seat", () => {
    const core = makeCore();
    core.addSeat(player(0), 0);
    core.addSeat(player(1), 0);
    const sink = collector();
    core.step(sink);
    expect(core.interestOf(0, 1)).toBe(true);
    // Walk player 1 away for 60 s at Lope (bit 2): it leaves the ~195 m horizon radius.
    for (let tick = 1; tick <= 1200; tick++) {
      core.receiveInput(1, inputBody(input(tick, 127, 1 << 2)), tick * 50);
      core.step(sink);
    }
    const a = core.sim.avatar(0);
    const b = core.sim.avatar(1);
    const d = Math.hypot(a.px - b.px, a.py - b.py, a.pz - b.pz);
    expect(d).toBeGreaterThan(240);
    expect(core.interestOf(0, 1)).toBe(false);
    core.holdSeat(1);
    expect(core.receiveInput(1, inputBody(input(1201)), 70_000)).toBe(InputVerdict.NoSeat);
    core.resumeSeat(1, 70_000);
    expect(core.receiveInput(1, inputBody(input(5)), 70_050)).toBe(InputVerdict.Ok);
  });

  it("answers a resync (visibility hidden:false, also while visible) with a keyframe decodable from an empty table", () => {
    const core = makeCore();
    core.addSeat(player(0), 0);
    core.addSeat(player(1), 0);
    const sink = collector();
    const reader = new FrameReader();
    const view = new FrameView();
    const grid = flatWorld().grid.count;
    const nextFrame = (): Uint8Array => {
      const n = sink.frames[0]!.length;
      for (let guard = 0; guard < 400 && sink.frames[0]!.length === n; guard++) core.step(sink);
      expect(sink.frames[0]!.length).toBe(n + 1);
      return sink.frames[0]![n]!;
    };
    // Join keyframe, then steady deltas against a continuous client table.
    const live = new SlotTable();
    expect(reader.decode(nextFrame(), view, live, grid)).toBe(FRAME_OK);
    expect(view.keyframe).toBe(true);
    for (let k = 0; k < 3; k++) {
      expect(reader.decode(nextFrame(), view, live, grid)).toBe(FRAME_OK);
      expect(view.keyframe).toBe(false);
    }
    const assertResyncKeyframe = (): void => {
      // The client resets its SlotTable on every keyframe: the frame must re-assign every slot in interest.
      const fresh = new SlotTable();
      expect(reader.decode(nextFrame(), view, fresh, grid)).toBe(FRAME_OK);
      expect(view.keyframe).toBe(true);
      expect(fresh.count).toBe(1);
      expect(view.entityCount).toBe(1);
      // Deltas continue against the rebuilt table.
      expect(reader.decode(nextFrame(), view, fresh, grid)).toBe(FRAME_OK);
      expect(view.keyframe).toBe(false);
    };
    // 1. Resync request while already visible (the old no-op).
    core.setHidden(0, false);
    assertResyncKeyframe();
    // 2. Hidden (1 Hz Self-only frames), then shown again.
    core.setHidden(0, true);
    const hiddenFrame = nextFrame();
    expect(reader.decode(hiddenFrame, view, new SlotTable(), grid)).toBe(FRAME_OK);
    expect(view.entityCount).toBe(0);
    core.setHidden(0, false);
    assertResyncKeyframe();
    // Seat 1 never asked: its frames stay deltas (one resync costs one seat one keyframe).
    const others = sink.frames[1]!;
    const t1 = new SlotTable();
    let keyframes = 0;
    for (const f of others) {
      expect(reader.decode(f, view, t1, grid)).toBe(FRAME_OK);
      if (view.keyframe) keyframes++;
    }
    expect(keyframes).toBe(1);
  });

  it("measures room tick time with 6 sweeping players (gate p95 <= 3.5 ms)", () => {
    const core = makeCore();
    for (let i = 0; i < MAX_PLAYERS_PER_ROOM; i++) core.addSeat(player(i), 0);
    const sink: ShiftSink = { frame() {}, events() {} };
    const bodies = Array.from({ length: 4096 }, (_, k) =>
      inputBody(input(k + 1, 127, k % 40 < 30 ? 1 << 3 : 1 << 0, (k * 97) & 0xffff)),
    );
    // Warm-up (JIT), then measure 1,200 ticks (60 s of game time).
    for (let t = 0; t < 400; t++) {
      for (let s = 0; s < MAX_PLAYERS_PER_ROOM; s++) core.receiveInput(s, bodies[t]!, t * 50);
      core.step(sink);
    }
    const N = 1200;
    const ring = new Float64Array(N);
    const heapBefore = process.memoryUsage().heapUsed;
    for (let t = 400; t < 400 + N; t++) {
      const start = performance.now();
      for (let s = 0; s < MAX_PLAYERS_PER_ROOM; s++) core.receiveInput(s, bodies[t]!, t * 50);
      core.step(sink);
      ring[t - 400] = performance.now() - start;
    }
    const heapDelta = process.memoryUsage().heapUsed - heapBefore;
    const p = percentiles(ring, N);
    // Recorded in the M1-W4-T02 report.
    console.info(
      `[shift tick] 6 players, ${N} ticks: p50 ${p.p50.toFixed(3)} ms, p95 ${p.p95.toFixed(3)} ms, max ${p.max.toFixed(3)} ms, heap delta ${(heapDelta / 1024).toFixed(0)} KiB, frames ${core.counters.framesSent}`,
    );
    // Attribution baseline: the bare sim with one event listener and the same inputs (no netcode).
    const bare = new MoonRoomSim({ data, world: flatWorld(), contractId: CONTRACT, shiftType: "private" });
    for (let i = 0; i < MAX_PLAYERS_PER_ROOM; i++) bare.addActor(i, player(i));
    bare.onEvent(() => undefined);
    const cmd = { seq: 0, moveX: 0, moveY: 0, yaw: 0, pitch: 0, buttons: 0, toolParam: 128 };
    const step = (t: number): void => {
      const k = t % 4096;
      cmd.seq = (k + 1) & 0xffff;
      cmd.moveY = 127;
      cmd.buttons = k % 40 < 30 ? 1 << 3 : 1 << 0;
      cmd.yaw = (k * 97) & 0xffff;
      for (let s = 0; s < MAX_PLAYERS_PER_ROOM; s++) bare.applyInput(s, cmd);
      bare.step(bare.config.dt);
    };
    for (let t = 0; t < 400; t++) step(t);
    const bareBefore = process.memoryUsage().heapUsed;
    for (let t = 400; t < 400 + N; t++) step(t);
    const bareDelta = process.memoryUsage().heapUsed - bareBefore;
    console.info(
      `[shift tick] bare MoonRoomSim heap delta over the same ${N} ticks: ${(bareDelta / 1024).toFixed(0)} KiB`,
    );
    expect(p.p95).toBeLessThanOrEqual(3.5);
    expect(core.counters.frameEncodeFailures).toBe(0);
  });
});
