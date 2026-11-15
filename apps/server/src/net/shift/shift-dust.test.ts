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
import { ShiftCore, type ShiftSink } from "./shift-core";

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
    expect(m.checks).toHaveLength(1);
    const check = m.checks[0] as { mode: string; plots: { plotId: number; hash: number }[] };
    expect(check.mode).toBe("detail");
    for (const e of check.plots) expect(e.hash).toBe(core.ledger.ledgerHash(e.plotId));
    expect(core.receiveDustRequest(0, new Uint8Array([7, 7, 7]))).toBe(false);
    expect(core.receiveDustRequest(0, new Uint8Array(64))).toBe(false);
    expect(core.counters.dustRequestsInvalid).toBe(1);
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
