// Test fixture (not shipped): an authoritative MoonRoomSim + dust ledger in miniature, producing FRAME messages with
// strokes, deflated DUST_SNAPSHOTs and DUST_LEDGER messages the way the server does. Shared by dust-offload tests.
import { deflateRawSync } from "node:zlib";
import { LEDGER_BYTES, PlotState, STANDARD_GRID_PARAMS, type ContractId } from "@moon-cleanup/shared";
import {
  FrameWriter,
  StrokeChainBuffer,
  countOpened,
  createSelfState,
  encodeDustLedger,
  encodeSnapshotRaw,
  type LedgerRawInput,
} from "@moon-cleanup/protocol";
import { loadGameData } from "@moon-cleanup/game-data";
import { MoonRoomSim, createRoomDustLedger, type SimWorld } from "@moon-cleanup/sim";
import { createPlotGrid, type WorldDustLedger } from "@moon-cleanup/world";

export const data = loadGameData();
export const grid = createPlotGrid(STANDARD_GRID_PARAMS);
const world: SimWorld = { grid, ground: { heightAtXYZ: () => 0 } };
/** Ticks per frame (20 Hz sim, 10 Hz frames). */
export const F = 2;
const SWEEP = 1 << 3;
export const deflate = (raw: Uint8Array): Uint8Array => new Uint8Array(deflateRawSync(raw, { level: 6 }));
export const newClientLedger = (): WorldDustLedger =>
  createRoomDustLedger(grid, data, { tickHz: 20, initialLedgerSlots: 1024 });

export function ledgerInput(l: WorldDustLedger, plot: number): LedgerRawInput {
  const slot = l.slotOf[plot]!;
  const texels = new Uint8Array(LEDGER_BYTES);
  l.copyTexels(plot, texels, 0);
  const actors = new Uint8Array(4);
  const units = new Uint32Array(4);
  const n = l.topContributions(plot, actors, units);
  const contributions = [];
  for (let k = 0; k < n; k++) if (actors[k]! <= 15) contributions.push({ actorSlot: actors[k]!, units: units[k]! });
  return {
    header: {
      version: l.version[slot]!,
      remainingUnits: l.remaining[slot]!,
      initialUnits: l.initial[slot]!,
      ownedTexels: l.owned[slot]!,
      mgPerUnit: l.mgPerUnit[slot]!,
      hash: l.ledgerHash(plot),
      contributions,
    },
    texels,
  };
}

/** The server side in miniature: sim + ledger, stroke frames, snapshots. */
export class TestDustServer {
  readonly ledger = createRoomDustLedger(grid, data, { tickHz: 20, initialLedgerSlots: 1024 });
  readonly sim = new MoonRoomSim({
    data,
    world,
    ledger: this.ledger,
    contractId: "00000000-0000-4000-8000-0000000000f1" as ContractId,
    shiftType: "private",
    tickHz: 20,
    snapshotHz: 10,
  });
  private readonly strokes = new StrokeChainBuffer(64, 1);
  private readonly writer = new FrameWriter();
  private readonly cmd = { seq: 0, moveX: 0, moveY: 127, yaw: 0, pitch: 0, buttons: SWEEP, toolParam: 128 };

  constructor() {
    this.sim.addActor(0, { playerId: "p0" as never, displayName: "P0", role: "holder" });
    this.sim.onEvent(() => undefined);
  }

  /** One tick; returns a FRAME message on frame ticks (strokes since the previous frame), else null. */
  step(t: number): Uint8Array | null {
    this.cmd.seq = t + 1;
    this.cmd.yaw = (t * 70) & 0xffff;
    this.sim.applyInput(0, this.cmd);
    this.sim.step(this.sim.config.dt);
    for (let k = 0; k < this.sim.strokeCount; k++) {
      const r = this.sim.strokeAt(k);
      this.strokes.addChain(
        r.anchor,
        r.startUMm,
        r.startVMm,
        r.endUMm,
        r.endVMm,
        r.widthCm,
        r.depth16,
        r.toolCode,
        r.actorSlot,
        r.tick,
        r.inputSeq,
      );
    }
    const tick = this.sim.tick - 1;
    if (tick % F !== 0) return null;
    const w = this.writer;
    w.begin(tick, t + 1, 1, false);
    w.writeSelf(createSelfState());
    if (this.strokes.chainCount > 0 && w.writeStrokes(this.strokes, 0, tick) !== this.strokes.chainCount) {
      throw new Error("stroke section did not fit");
    }
    const n = w.finish();
    this.strokes.clear();
    return w.buffer.slice(0, n);
  }

  /** Server tick of the last completed step (the `snapshotVersion` of a snapshot built now). */
  get tick(): number {
    return this.sim.tick - 1;
  }

  /** A DUST_LEDGER message (id byte first) for the ledger of `plot` as it is now, or null when it has none. */
  ledgerMessage(plot: number): Uint8Array | null {
    if ((this.ledger.slotOf[plot] ?? -1) < 0) return null;
    const out = new Uint8Array(4096);
    const n = encodeDustLedger(plot, ledgerInput(this.ledger, plot), deflate, out);
    return n === 0 ? null : out.slice(0, n);
  }

  /** Plots that currently have a ledger. */
  ledgerPlots(): number[] {
    const l = this.ledger;
    const plots: number[] = [];
    for (let s = 0; s < l.slotHigh; s++) if (l.plotOfSlot[s]! >= 0) plots.push(l.plotOfSlot[s]!);
    return plots;
  }

  /** SNAPSHOT RAW of every plot state and every ledger (the server keeps only those within 60 m). */
  snapshot(): Uint8Array {
    const l = this.ledger;
    const n = l.plotCount;
    const states = new Uint8Array(Math.ceil(n / 4));
    for (let p = 0; p < n; p++) states[p >>> 2] = states[p >>> 2]! | ((l.state[p]! & 3) << ((p & 3) * 2));
    const opened = new Uint8Array(countOpened(states, n));
    let k = 0;
    for (let p = 0; p < n; p++) if (l.state[p] === PlotState.Opened) opened[k++] = l.frac[p]!;
    const ledgers = [];
    for (let s = 0; s < l.slotHigh; s++) {
      const plot = l.plotOfSlot[s]!;
      if (plot >= 0) ledgers.push({ plotId: plot, ledger: ledgerInput(l, plot) });
    }
    ledgers.sort((a, b) => a.plotId - b.plotId);
    return deflate(
      encodeSnapshotRaw({ plotCount: n, plotStates: states, openedRemaining: opened, ledgers, logs: [] })!,
    );
  }
}
