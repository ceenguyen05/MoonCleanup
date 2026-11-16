// Dust streaming to late joiners (M1-W4-T06): a client that joins after the first strokes rebuilds an exact copy of
// every server ledger inside its dust radius from DUST_SNAPSHOT + FRAME strokes + streamed DUST_LEDGER messages,
// applied in arrival order with the same integer ledger code (WDS 5.5). Also: `dust.plots` deltas, DUST_REQUEST
// answers, the snapshot interval bound, and the dust egress numbers for the report.
import { inflateRawSync } from "node:zlib";
import { STANDARD_GRID_PARAMS, PlotState, type ContractId, type PlayerId } from "@moon-cleanup/shared";
import {
  DUST_CHECK_ID,
  DUST_LEDGER_ID,
  DUST_REQUEST_ID,
  DUST_SNAPSHOT_ID,
  FRAME_OK,
  FrameReader,
  FrameView,
  SlotTable,
  SnapshotAssembler,
  createStrokeRecordOut,
  decodeDustCheck,
  decodeDustLedger,
  decodeSnapshotStream,
  encodeDustRequest,
  encodeInput,
  expandStrokeChain,
  type DecodedSnapshot,
  type Inflate,
  type MutableInput,
} from "@moon-cleanup/protocol";
import { loadGameData } from "@moon-cleanup/game-data";
import { createPlotGrid, type WorldDustLedger } from "@moon-cleanup/world";
import { createRoomDustLedger, type SimWorld } from "@moon-cleanup/sim";
import { describe, expect, it } from "vitest";
import { SNAPSHOT_EGRESS_BYTES_PER_S, SNAPSHOT_EGRESS_DEBT_FLOOR_BYTES, ShiftCore, type ShiftSink } from "./shift-core";
import { ShiftDust } from "./shift-dust";

const CONTRACT = "00000000-0000-4000-8000-0000000000d7" as ContractId;
const data = loadGameData();
const grid = createPlotGrid(STANDARD_GRID_PARAMS);
const world: SimWorld = { grid, ground: { heightAtXYZ: () => 0 } };
const SWEEP = 1 << 3;
const FRAME_ID = 0x20;

const inflate: Inflate = (bytes, max) => {
  try {
    return new Uint8Array(inflateRawSync(bytes, { maxOutputLength: max }));
  } catch {
    return null;
  }
};

function player(i: number) {
  return {
    playerId: `00000000-0000-4000-8000-0000000000${(0xb0 + i).toString(16)}` as PlayerId,
    displayName: `Bot${i}`,
    role: i === 0 ? ("holder" as const) : ("staff" as const),
  };
}

function inputBody(seq: number, buttons: number, yaw: number, moveY = 127): Uint8Array {
  const a: MutableInput = { seq, moveX: 0, moveY, yaw, pitch: 0, buttons, toolParam: 128 };
  const buf = new Uint8Array(32);
  const n = encodeInput(buf, a);
  return buf.slice(1, n);
}

/** The client side of the dust sync, in arrival order (what apps/client/src/net/remote-dust.ts does). */
class Mirror {
  readonly ledger: WorldDustLedger = createRoomDustLedger(grid, data, { tickHz: 20, initialLedgerSlots: 1024 });
  readonly reader = new FrameReader();
  readonly view = new FrameView();
  readonly table = new SlotTable();
  readonly assembler = new SnapshotAssembler();
  readonly rec = createStrokeRecordOut();
  readonly sink = { milligrams: 0, removedUnits: 0, grime01: 0, plotCount: 0, plotIds: new Int32Array(8) };
  ready = false;
  snapshot: DecodedSnapshot | null = null;
  snapshotVersion = -1;
  stats = { frames: 0, frameBytes: 0, snapshotBytes: 0, ledgerBytes: 0, ledgers: 0, strokes: 0, deltas: 0, checks: 0 };
  checks: unknown[] = [];

  constructor(readonly framesEvery: number) {}

  receive(typeId: number, body: Uint8Array): void {
    const msg = new Uint8Array(body.byteLength + 1);
    msg[0] = typeId;
    msg.set(body, 1);
    if (typeId === FRAME_ID) this.frame(msg);
    else if (typeId === DUST_SNAPSHOT_ID) this.slice(msg);
    else if (typeId === DUST_LEDGER_ID) this.ledgerMessage(msg);
    else if (typeId === DUST_CHECK_ID) {
      this.stats.checks++;
      this.checks.push(decodeDustCheck(msg, grid.count));
    }
  }

  private frame(msg: Uint8Array): void {
    this.stats.frames++;
    this.stats.frameBytes += msg.byteLength;
    expect(this.reader.decode(msg, this.view, this.table, grid.count)).toBe(FRAME_OK);
    if (!this.ready) return; // strokes up to the snapshot tick are inside the snapshot
    const v = this.view;
    for (let i = 0; i < v.strokes.chainCount; i++) {
      expandStrokeChain(v.strokes, i, this.framesEvery, this.rec, (r) => {
        this.stats.strokes++;
        this.ledger.applyStroke(r as never, this.sink);
      });
    }
    for (let i = 0; i < v.dustPlots.count; i++) {
      this.stats.deltas++;
      const p = v.dustPlots.plotId[i]!;
      if (v.dustPlots.state[i] === PlotState.Polished && this.ledger.slotOf[p]! < 0) this.ledger.installPolished(p);
    }
    this.drain();
  }

  private slice(msg: Uint8Array): void {
    this.stats.snapshotBytes += msg.byteLength;
    if (this.assembler.add(msg) !== "complete") return;
    this.snapshotVersion = this.assembler.version;
    const s = decodeSnapshotStream(this.assembler.take()!, inflate, grid.count);
    expect(s).not.toBeNull();
    this.snapshot = s;
    const l = this.ledger;
    l.reset();
    for (let p = 0; p < grid.count; p++) {
      const st = (s!.plotStates[p >>> 2]! >>> ((p & 3) * 2)) & 3;
      if (st === PlotState.Polished) l.installPolished(p);
    }
    for (const e of s!.ledgers) this.install(e.plotId, e.texels, e.header.version, e.header.contributions);
    this.drain();
    this.ready = true;
  }

  private ledgerMessage(msg: Uint8Array): void {
    this.stats.ledgerBytes += msg.byteLength;
    this.stats.ledgers++;
    const d = decodeDustLedger(msg, inflate, grid.count);
    expect(d).not.toBeNull();
    this.install(d!.plotId, d!.texels, d!.header.version, d!.header.contributions);
    this.drain();
  }

  private install(
    plot: number,
    texels: Uint8Array,
    version: number,
    contributions: readonly { actorSlot: number; units: number }[],
  ): void {
    expect(this.ledger.installLedger(plot, texels, 0, version)).toBe(0);
    for (const c of contributions) this.ledger.addContribution(plot, c.actorSlot, c.units);
    this.ledger.refreshPlot(plot);
  }

  private drain(): void {
    this.ledger.clearOpenedQueue();
    this.ledger.clearPolishedQueue();
    this.ledger.clearDirtyPlots();
  }
}

function sinkFor(mirrors: (Mirror | undefined)[], bytesBySeat: number[]): ShiftSink {
  return {
    frame(seat, body) {
      bytesBySeat[seat] = (bytesBySeat[seat] ?? 0) + body.byteLength + 1;
      mirrors[seat]?.receive(FRAME_ID, body);
    },
    events() {},
    bytes(seat, typeId, body) {
      bytesBySeat[seat] = (bytesBySeat[seat] ?? 0) + body.byteLength + 1;
      mirrors[seat]?.receive(typeId, body);
    },
  };
}

function step(core: ShiftCore, sink: ShiftSink, seats: number, t: number): void {
  for (let s = 0; s < seats; s++) {
    // Seat 0 walks and sweeps in a slow circle; seat 1 sweeps on the spot, then follows.
    const yaw = (s * 20000 + t * 60) & 0xffff;
    core.receiveInput(s, inputBody(t + 1, SWEEP, yaw, s === 1 && t < 300 ? 0 : 127), t * 50);
  }
  core.step(sink);
}

describe("ShiftCore dust streaming to a late joiner", () => {
  it("a late joiner's ledgers match the server exactly (snapshot + strokes + streamed ledgers), with dust.plots", () => {
    const core = new ShiftCore({ data, world, contractId: CONTRACT, shiftType: "private", simTickHz: 20 }, 0);
    const mirrors: (Mirror | undefined)[] = [];
    const bytes: number[] = [];
    const sink = sinkFor(mirrors, bytes);
    core.addSeat(player(0), 0);
    mirrors[0] = new Mirror(core.framesEvery);
    let t = 0;
    for (; t < 400; t++) step(core, sink, 1, t);
    expect(core.ledger.ledgerCount).toBeGreaterThan(2);
    // Seat 1 joins late: the moon is no longer pristine.
    core.addSeat(player(1), t * 50);
    const late = new Mirror(core.framesEvery);
    mirrors[1] = late;
    const bytesBefore = bytes[1] ?? 0;
    for (; t < 800; t++) step(core, sink, 2, t);
    expect(late.ready).toBe(true);
    expect(late.snapshot).not.toBeNull();
    expect(late.snapshot!.ledgers.length).toBeGreaterThan(0);
    // The snapshot's version is the server tick it reflects (a frame tick before the late join completed).
    expect(late.snapshotVersion).toBeGreaterThanOrEqual(400);
    expect(late.snapshotVersion).toBeLessThan(420);

    // Every server ledger inside the late joiner's dust radius exists on the client with the same 1,024 bytes.
    const l = core.ledger;
    const a = core.sim.avatar(1);
    const len = Math.hypot(a.px, a.py, a.pz);
    const cos = core.dust.cosOf(220);
    let compared = 0;
    for (let s = 0; s < l.slotHigh; s++) {
      const plot = l.plotOfSlot[s]!;
      if (plot < 0) continue;
      if (core.dust.plotDot(plot, a.px / len, a.py / len, a.pz / len) < cos) continue;
      expect(late.ledger.slotOf[plot]).toBeGreaterThanOrEqual(0);
      expect(late.ledger.ledgerHash(plot)).toBe(l.ledgerHash(plot));
      expect(late.ledger.state[plot]).toBe(l.state[plot]);
      compared++;
    }
    expect(compared).toBeGreaterThan(2);
    // The early joiner never needed a ledger message beyond its join snapshot (pristine moon) and stayed exact too.
    for (let s = 0; s < l.slotHigh; s++) {
      const plot = l.plotOfSlot[s]!;
      if (plot >= 0) expect(mirrors[0]!.ledger.ledgerHash(plot)).toBe(l.ledgerHash(plot));
    }
    expect(mirrors[0]!.ledger.worldHash()).toBe(l.worldHash());
    // Polished states agree everywhere (dust.plots for plots without a client ledger).
    for (let p = 0; p < grid.count; p++) {
      if (l.state[p] === PlotState.Polished) expect(late.ledger.state[p]).toBe(PlotState.Polished);
    }
    expect(late.stats.deltas).toBeGreaterThan(0);
    expect(core.counters.plotDeltasDropped).toBe(0);
    expect(core.counters.dustSnapshotsSent).toBe(2);
    expect(core.ledgerPoolGrowths).toBe(0);

    const seconds = (800 - 400) / 20;
    const snap = core.lastSnapshot!;
    console.info(
      `[dust late join] snapshot raw ${snap.rawBytes} B, deflated ${snap.deflatedBytes} B in ${snap.slices.length} slices, ` +
        `${snap.ledgers} ledgers, build ${snap.buildMs.toFixed(2)} ms; streamed ledgers ${late.stats.ledgers} (${late.stats.ledgerBytes} B); ` +
        `late joiner total ${(((bytes[1] ?? 0) - bytesBefore) / seconds).toFixed(0)} B/s over ${seconds} s ` +
        `(frames ${(late.stats.frameBytes / seconds).toFixed(0)} B/s, ${late.stats.strokes} strokes, ${late.stats.deltas} plot deltas); ` +
        `compared ${compared} ledgers, ${l.ledgerCount} server ledgers, polished ${l.polishedTotal}`,
    );
  });

  it("answers DUST_REQUEST: plots -> DUST_LEDGER, chunk -> DUST_CHECK detail; malformed is refused", () => {
    const core = new ShiftCore({ data, world, contractId: CONTRACT, shiftType: "private", simTickHz: 20 }, 0);
    const mirrors: (Mirror | undefined)[] = [];
    const sink = sinkFor(mirrors, []);
    core.addSeat(player(0), 0);
    const m = new Mirror(core.framesEvery);
    mirrors[0] = m;
    let t = 0;
    for (; t < 200; t++) step(core, sink, 1, t);
    let plot = -1;
    for (let s = 0; s < core.ledger.slotHigh && plot < 0; s++) plot = core.ledger.plotOfSlot[s]!;
    expect(plot).toBeGreaterThanOrEqual(0);
    const out = new Uint8Array(32);
    let n = encodeDustRequest({ kind: "plots", plotIds: [plot as never] }, out);
    const ledgersBefore = m.stats.ledgers;
    expect(core.receiveDustRequest(0, out.slice(1, n))).toBe(true);
    n = encodeDustRequest({ kind: "chunk", chunkId: grid.chunkOf(plot as never) }, out);
    expect(out[0]).toBe(DUST_REQUEST_ID);
    expect(core.receiveDustRequest(0, out.slice(1, n))).toBe(true);
    for (let k = 0; k < 2; k++, t++) step(core, sink, 1, t);
    expect(m.stats.ledgers).toBeGreaterThan(ledgersBefore);
    expect(m.ledger.ledgerHash(plot)).toBe(core.ledger.ledgerHash(plot));
    // (the 5 s chunk summaries of the 10 s run are also in `checks`; the detail answer is the only "detail" one)
    const details = m.checks.filter((c) => (c as { mode: string }).mode === "detail");
    expect(details).toHaveLength(1);
    const check = details[0] as { mode: string; plots: { plotId: number; hash: number }[] };
    expect(check.mode).toBe("detail");
    for (const e of check.plots) expect(e.hash).toBe(core.ledger.ledgerHash(e.plotId));
    expect(core.receiveDustRequest(0, new Uint8Array([7, 7, 7]))).toBe(false);
    expect(core.receiveDustRequest(0, new Uint8Array(64))).toBe(false);
    expect(core.counters.dustRequestsInvalid).toBe(1);
  });

  it("sends the 5 s DUST_CHECK chunk summary: every 5 s, one build per frame tick, equal to the client's chunk hashes", () => {
    const core = new ShiftCore({ data, world, contractId: CONTRACT, shiftType: "private", simTickHz: 20 }, 0);
    const mirrors: (Mirror | undefined)[] = [];
    const sink = sinkFor(mirrors, []);
    core.addSeat(player(0), 0);
    core.addSeat(player(1), 0);
    const m0 = new Mirror(core.framesEvery);
    const m1 = new Mirror(core.framesEvery);
    mirrors[0] = m0;
    mirrors[1] = m1;
    const ticksOf: number[][] = [[], []];
    const seen = [0, 0];
    const mark = (t: number): void => {
      [m0, m1].forEach((m, i) => {
        if (m.stats.checks > seen[i]!) ticksOf[i]!.push(t);
        seen[i] = m.stats.checks;
      });
    };
    let t = 0;
    for (; t < 300; t++) {
      step(core, sink, 2, t); // sweeping: ledgers appear
      mark(t);
    }
    expect(core.ledger.ledgerCount).toBeGreaterThan(2);
    for (; t < 460; t++) {
      core.step(sink); // quiet: no input, everything the clients should hold has been streamed
      mark(t);
    }
    expect(core.counters.dustSnapshotsSent).toBe(2);
    for (const m of [m0, m1]) {
      const chunk = m.checks.filter((c) => (c as { mode: string }).mode === "chunks");
      expect(chunk.length).toBe(m.checks.length);
      expect(m.checks.length).toBeGreaterThanOrEqual(3);
    }
    // Cadence: DUST_CHECK_INTERVAL_S (5 s = 100 ticks) per seat; two seats are never built on the same frame tick.
    for (const ticks of ticksOf) {
      for (let i = 1; i < ticks.length; i++) expect(ticks[i]! - ticks[i - 1]!).toBeGreaterThanOrEqual(100);
      for (let i = 1; i < ticks.length; i++) expect(ticks[i]! - ticks[i - 1]!).toBeLessThanOrEqual(104);
    }
    for (const t0 of ticksOf[0]!) expect(ticksOf[1]).not.toContain(t0);
    expect(core.dust.counters.chunkChecksSent).toBe(m0.checks.length + m1.checks.length);
    // Cost of one summary on a heavier ledger (1,500 Opened ledgers, all marked as sent: more than a 220 m radius holds).
    const big = createRoomDustLedger(grid, data, { tickHz: 20, initialLedgerSlots: 2048 });
    const template = new Uint8Array(1024);
    const src = core.ledger.plotOfSlot[0]!;
    core.ledger.copyTexels(src, template, 0);
    const allSent = new Uint8Array(grid.count);
    for (let p = 20000; p < 21500; p++) {
      if (big.isEmptyPlot(p as never) || big.installLedger(p, template, 0, 1) < 0) continue;
      big.refreshPlot(p);
      allSent[p] = 1;
    }
    const bigDust = new ShiftDust(big, 1737400);
    bigDust.chunkCheckBody(allSent); // warm
    const t1 = performance.now();
    let bytes = 0;
    for (let i = 0; i < 200; i++) bytes = bigDust.chunkCheckBody(allSent)?.byteLength ?? 0;
    console.info(
      `[dust check] ${big.ledgerCount} ledgers: ${((performance.now() - t1) / 200).toFixed(3)} ms per summary, ${bytes + 1} B`,
    );
    // The last summary equals what each client computes over its own ledgers (the sync is exact once streamed).
    for (const m of [m0, m1]) {
      const last = m.checks[m.checks.length - 1] as { mode: string; chunks: { chunkId: number; xorHash: number }[] };
      expect(last.chunks.length).toBeGreaterThan(0);
      for (const c of last.chunks) {
        expect(m.ledger.chunkHash(c.chunkId)).toBe(c.xorHash);
        expect(core.ledger.chunkHash(c.chunkId)).toBe(c.xorHash);
      }
      // ...and it is a drift detector: one flipped texel in a client ledger changes that chunk's hash.
      const c0 = last.chunks[0]!;
      let plot = -1;
      for (let s = 0; s < m.ledger.slotHigh && plot < 0; s++) {
        const p = m.ledger.plotOfSlot[s]!;
        if (p >= 0 && grid.chunkOf(p as never) === c0.chunkId && m.ledger.state[p] === PlotState.Opened) plot = p;
      }
      expect(plot).toBeGreaterThanOrEqual(0);
      const texels = new Uint8Array(1024);
      m.ledger.copyTexels(plot, texels, 0);
      const at = texels.findIndex((v) => v > 0);
      expect(at).toBeGreaterThanOrEqual(0);
      texels[at] = texels[at]! - 1;
      expect(m.ledger.installLedger(plot, texels, 0, 1)).toBeGreaterThanOrEqual(0);
      expect(m.ledger.chunkHash(c0.chunkId)).not.toBe(c0.xorHash);
    }
  });

  it("a resync re-sends the snapshot, but at most one per 2 s per seat", () => {
    const core = new ShiftCore({ data, world, contractId: CONTRACT, shiftType: "private", simTickHz: 20 }, 0);
    const mirrors: (Mirror | undefined)[] = [];
    core.addSeat(player(0), 0);
    mirrors[0] = new Mirror(core.framesEvery);
    const sink = sinkFor(mirrors, []);
    let t = 0;
    for (; t < 10; t++) step(core, sink, 1, t);
    expect(core.counters.dustSnapshotsSent).toBe(1);
    core.setHidden(0, false); // resync request
    core.setHidden(0, false);
    for (let k = 0; k < 10; k++, t++) step(core, sink, 1, t);
    expect(core.counters.dustSnapshotsSent).toBe(1); // inside 2 s of the join snapshot: waits
    for (let k = 0; k < 40; k++, t++) step(core, sink, 1, t);
    expect(core.counters.dustSnapshotsSent).toBe(2);
    // Hidden seats get no dust bytes; showing the tab again brings one snapshot.
    core.setHidden(0, true);
    for (let k = 0; k < 60; k++, t++) step(core, sink, 1, t);
    expect(core.counters.dustSnapshotsSent).toBe(2);
    core.setHidden(0, false);
    for (let k = 0; k < 4; k++, t++) step(core, sink, 1, t);
    expect(core.counters.dustSnapshotsSent).toBe(3);
  });
});

describe("ShiftDust hardening (server dust review follow-ups)", () => {
  function sweptCore(): { core: ShiftCore; sink: ShiftSink } {
    const core = new ShiftCore({ data, world, contractId: CONTRACT, shiftType: "private", simTickHz: 20 }, 0);
    const sink = sinkFor([], []);
    core.addSeat(player(0), 0);
    for (let t = 0; t < 200; t++) step(core, sink, 1, t);
    return { core, sink };
  }
  function detailPlots(body: Uint8Array | null): number {
    expect(body).not.toBeNull();
    const msg = new Uint8Array(body!.byteLength + 1);
    msg[0] = DUST_CHECK_ID;
    msg.set(body!, 1);
    const d = decodeDustCheck(msg, grid.count);
    expect(d?.mode).toBe("detail");
    return d?.mode === "detail" ? d.plots.length : -1;
  }

  it("N2: the detail answer lists only the ledgers marked sent for that seat (the set the chunk summary hashes)", () => {
    const { core } = sweptCore();
    const l = core.ledger;
    expect(l.ledgerCount).toBeGreaterThan(0);
    let plot = -1;
    for (let s = 0; s < l.slotHigh && plot < 0; s++) {
      const p = l.plotOfSlot[s]!;
      if (p >= 0 && (l.state[p]! & 3) === PlotState.Opened) plot = p;
    }
    expect(plot).toBeGreaterThanOrEqual(0);
    const chunk = grid.chunkOf(plot as never) as number;
    const all = detailPlots(core.dust.checkDetailBody(chunk));
    expect(all).toBeGreaterThan(0);
    const sent = new Uint8Array(grid.count);
    expect(detailPlots(core.dust.checkDetailBody(chunk, sent))).toBe(0); // client holds none of them
    sent[plot] = 2; // queued, not yet delivered: still not listed
    expect(detailPlots(core.dust.checkDetailBody(chunk, sent))).toBe(0);
    sent[plot] = 1;
    expect(detailPlots(core.dust.checkDetailBody(chunk, sent))).toBe(1);
  });

  it("F1: snapshot egress is charged per seat; a seat out of credit waits for the refill instead of rebuilding every 2 s", () => {
    const core = new ShiftCore({ data, world, contractId: CONTRACT, shiftType: "private", simTickHz: 20 }, 0);
    const sink = sinkFor([], []);
    core.addSeat(player(0), 0);
    const seat = (core as unknown as { seats: { snapshotCredit: number }[] }).seats[0]!;
    let t = 0;
    for (; t < 10; t++) step(core, sink, 1, t);
    expect(core.counters.dustSnapshotsSent).toBe(1);
    // Spent budget (a seat that resyncs with big snapshots): the 2 s interval alone no longer releases the next one.
    seat.snapshotCredit = -10 * SNAPSHOT_EGRESS_BYTES_PER_S;
    core.setHidden(0, false);
    for (let k = 0; k < 8 * 20; k++, t++) step(core, sink, 1, t); // 8 s later: past the 2 s interval, still in debt
    expect(core.counters.dustSnapshotsSent).toBe(1);
    // Repeated requests keep it pending, never multiply it; the refill (about 10 s of debt) releases exactly one.
    core.setHidden(0, false);
    for (let k = 0; k < 4 * 20; k++, t++) step(core, sink, 1, t);
    expect(core.counters.dustSnapshotsSent).toBe(2);
    // A seat with a normal (small) snapshot cost keeps the legit resume behaviour: the next resync a few seconds later.
    core.setHidden(0, false);
    for (let k = 0; k < 3 * 20; k++, t++) step(core, sink, 1, t);
    expect(core.counters.dustSnapshotsSent).toBe(3);
  });

  it("N1: an in-hold reconnect caps the egress debt, so its resync snapshot waits about 8 s, not ~40 s", () => {
    const core = new ShiftCore({ data, world, contractId: CONTRACT, shiftType: "private", simTickHz: 20 }, 0);
    const sink = sinkFor([], []);
    core.addSeat(player(0), 0);
    const seat = (core as unknown as { seats: { snapshotCredit: number }[] }).seats[0]!;
    let t = 0;
    for (; t < 10; t++) step(core, sink, 1, t);
    expect(core.counters.dustSnapshotsSent).toBe(1);
    // A heavy cleaner's first snapshot left a ~163 KB debt (review N1): ~40 s of refill without the cap.
    seat.snapshotCredit = -163 * 1024;
    core.holdSeat(0);
    core.resumeSeat(0, t * 50);
    expect(seat.snapshotCredit).toBe(SNAPSHOT_EGRESS_DEBT_FLOOR_BYTES);
    const waitS = -SNAPSHOT_EGRESS_DEBT_FLOOR_BYTES / SNAPSHOT_EGRESS_BYTES_PER_S; // 8 s
    for (let k = 0; k < (waitS - 1) * 20; k++, t++) step(core, sink, 1, t); // 7 s: still waiting for the refill
    expect(core.counters.dustSnapshotsSent).toBe(1);
    for (let k = 0; k < 2 * 20; k++, t++) step(core, sink, 1, t); // 9 s: refilled past zero, snapshot sent
    expect(core.counters.dustSnapshotsSent).toBe(2);
    // A debt already inside the cap is left alone (the floor only lifts, never grants credit).
    seat.snapshotCredit = -1000;
    core.holdSeat(0);
    core.resumeSeat(0, t * 50);
    expect(seat.snapshotCredit).toBe(-1000);
  });

  it("F2: a chunk DUST_REQUEST from a seat that has no snapshot yet is not answered", () => {
    const core = new ShiftCore({ data, world, contractId: CONTRACT, shiftType: "private", simTickHz: 20 }, 0);
    const m = new Mirror(core.framesEvery);
    const sink = sinkFor([m], []);
    core.addSeat(player(0), 0);
    let t = 0;
    for (; t < 400; t++) step(core, sink, 1, t);
    const l = core.ledger;
    const plot = l.plotOfSlot[0]!;
    const out = new Uint8Array(32);
    const n = encodeDustRequest({ kind: "chunk", chunkId: grid.chunkOf(plot as never) }, out);
    // A fresh seat that stays hidden never builds a snapshot, so `dustSent` is null.
    core.addSeat(player(1), t * 50);
    core.setHidden(1, true);
    const m1 = new Mirror(core.framesEvery);
    const sink1 = sinkFor([m, m1], []);
    expect(core.receiveDustRequest(1, out.slice(1, n))).toBe(true);
    for (let k = 0; k < 4; k++, t++) step(core, sink1, 2, t);
    expect(m1.stats.checks).toBe(0);
    // The seat with a snapshot still gets its answer.
    expect(core.receiveDustRequest(0, out.slice(1, n))).toBe(true);
    const before = m.stats.checks;
    for (let k = 0; k < 4; k++, t++) step(core, sink1, 2, t);
    expect(m.stats.checks).toBeGreaterThan(before);
  });

  it("N3: a ledger reset() after the moon-wide cache was built invalidates it (no stale plot states)", () => {
    const { core } = sweptCore();
    const before = core.dust.moonWide();
    expect(before.opened.length).toBeGreaterThan(0);
    core.ledger.clearDirtyPlots(); // nothing dirty: only l0Version tells the cache that the ledger changed
    core.ledger.reset();
    const builds = core.dust.counters.moonWideBuilds;
    const after = core.dust.moonWide();
    expect(core.dust.counters.moonWideBuilds).toBe(builds + 1);
    expect(after.opened.length).toBe(0);
    expect(after.states.every((b) => b === 0)).toBe(true);
  });
});
