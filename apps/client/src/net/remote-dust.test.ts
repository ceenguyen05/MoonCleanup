// RemoteDust against an authoritative MoonRoomSim: a client that joins after the first strokes installs a snapshot
// (protocol encoder + zlib, as the server builds it), then applies the FRAME strokes that follow through the real
// FrameWriter / FrameReader, and ends with the server's exact dust. Plus dust.plots, DUST_LEDGER, DUST_CHECK repair.
import { deflateRawSync } from "node:zlib";
import { LEDGER_BYTES, MESSAGE_CATALOG, PlotState, STANDARD_GRID_PARAMS, type ContractId } from "@moon-cleanup/shared";
import {
  FRAME_OK,
  FrameReader,
  FrameView,
  FrameWriter,
  SlotTable,
  StrokeChainBuffer,
  countOpened,
  createSelfState,
  decodeDustRequest,
  decodeSnapshotRaw,
  encodeDustCheck,
  encodeDustLedger,
  encodeSnapshotRaw,
  type LedgerRawInput,
} from "@moon-cleanup/protocol";
import { loadGameData } from "@moon-cleanup/game-data";
import { MoonRoomSim, createRoomDustLedger, type SimWorld } from "@moon-cleanup/sim";
import { createPlotGrid, type WorldDustLedger } from "@moon-cleanup/world";
import { describe, expect, it } from "vitest";
import { inflateRaw } from "./inflate-raw";
import { RemoteDust } from "./remote-dust";

const data = loadGameData();
const grid = createPlotGrid(STANDARD_GRID_PARAMS);
const world: SimWorld = { grid, ground: { heightAtXYZ: () => 0 } };
const F = 2; // 20 Hz sim, 10 Hz frames
const SWEEP = 1 << 3;
const deflate = (raw: Uint8Array): Uint8Array => new Uint8Array(deflateRawSync(raw, { level: 6 }));

function ledgerInput(l: WorldDustLedger, plot: number): LedgerRawInput {
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
class Server {
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
    if (this.strokes.chainCount > 0) expect(w.writeStrokes(this.strokes, 0, tick)).toBe(this.strokes.chainCount);
    const n = w.finish();
    this.strokes.clear();
    return w.buffer.slice(0, n);
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

describe("RemoteDust (client dust mirror)", () => {
  it("a late joiner ends with the server's exact dust: snapshot, then FRAME strokes in arrival order", () => {
    const server = new Server();
    const client = new RemoteDust(createRoomDustLedger(grid, data, { tickHz: 20, initialLedgerSlots: 1024 }), {
      framesEvery: F,
    });
    const reader = new FrameReader();
    const view = new FrameView();
    const table = new SlotTable();
    let t = 0;
    for (; t < 300; t++) {
      const f = server.step(t);
      // Frames before the snapshot: decoded, skipped (their strokes are inside the snapshot).
      if (f !== null) {
        expect(reader.decode(f, view, table, grid.count)).toBe(FRAME_OK);
        client.applyFrame(view);
      }
    }
    expect(server.ledger.ledgerCount).toBeGreaterThan(0);
    const snap = decodeSnapshotRaw(inflateRaw(server.snapshot(), 1 << 20)!, grid.count)!;
    expect(client.installSnapshot(snap, t)).toBe(true);
    expect(client.ledger.worldHash()).toBe(server.ledger.worldHash());
    for (; t < 700; t++) {
      const f = server.step(t);
      if (f === null) continue;
      expect(reader.decode(f, view, table, grid.count)).toBe(FRAME_OK);
      client.applyFrame(view);
    }
    expect(client.stats.strokesBeforeReady).toBeGreaterThan(0);
    expect(client.stats.strokes).toBeGreaterThan(0);
    expect(client.ledger.worldHash()).toBe(server.ledger.worldHash());
    for (let p = 0; p < grid.count; p++) {
      if (server.ledger.state[p] !== PlotState.Grimy) expect(client.stateOf(p)).toBe(server.ledger.state[p]);
    }
    expect(client.ledger.openedQueueCount + client.ledger.polishedQueueCount + client.ledger.dirtyPlotCount).toBe(0);
  });

  it("applyFrame allocates nothing per frame in steady state", () => {
    const server = new Server();
    const client = new RemoteDust(createRoomDustLedger(grid, data, { tickHz: 20, initialLedgerSlots: 1024 }), {
      framesEvery: F,
    });
    client.installSnapshot(decodeSnapshotRaw(inflateRaw(server.snapshot(), 1 << 20)!, grid.count)!);
    const reader = new FrameReader();
    const view = new FrameView();
    const table = new SlotTable();
    const frames: Uint8Array[] = [];
    for (let t = 0; t < 2000; t++) {
      const f = server.step(t);
      if (f !== null) frames.push(f);
    }
    for (let i = 0; i < 200; i++) {
      reader.decode(frames[i]!, view, table, grid.count);
      client.applyFrame(view);
    }
    globalThis.gc?.();
    const before = process.memoryUsage().heapUsed;
    for (let i = 200; i < frames.length; i++) {
      reader.decode(frames[i]!, view, table, grid.count);
      client.applyFrame(view);
    }
    const delta = process.memoryUsage().heapUsed - before;
    console.info(`[remote dust] ${frames.length - 200} frames, ${client.stats.strokes} strokes, heap delta ${delta} B`);
    expect(client.ledger.worldHash()).toBe(server.ledger.worldHash());
    // Ledger pool growth is preallocated (1,024 slots); allow GC noise but no per-frame garbage of note.
    expect(delta).toBeLessThan(512 * 1024);
  });

  it("dust.plots, DUST_LEDGER install and DUST_CHECK repair (mismatch -> DUST_REQUEST -> ledger)", () => {
    const server = new Server();
    for (let t = 0; t < 300; t++) server.step(t);
    const client = new RemoteDust(createRoomDustLedger(grid, data, { tickHz: 20, initialLedgerSlots: 1024 }), {
      framesEvery: F,
    });
    // A snapshot WITHOUT ledgers (as if all were outside 60 m): the client only knows states.
    const full = decodeSnapshotRaw(inflateRaw(server.snapshot(), 1 << 20)!, grid.count)!;
    client.installSnapshot({ ...full, ledgers: [] });
    let plot = -1;
    for (let s = 0; s < server.ledger.slotHigh && plot < 0; s++) plot = server.ledger.plotOfSlot[s]!;
    expect(client.ledger.slotOf[plot]).toBe(-1);
    // DUST_CHECK detail says the client is wrong about that plot -> it is requested.
    const out = new Uint8Array(4096);
    let n = encodeDustCheck(
      {
        mode: "detail",
        chunkId: grid.chunkOf(plot as never),
        plots: [{ plotId: plot as never, ledgerVersion: 1, hash: server.ledger.ledgerHash(plot) }],
      },
      out,
    );
    expect(client.applyBytes(out.slice(0, n))).toBe(true);
    expect(client.wantedCount).toBe(1);
    n = client.nextRequest(out);
    expect(decodeDustRequest(out.slice(0, n), grid.count)).toEqual({ kind: "plots", plotIds: [plot] });
    // The DUST_LEDGER answer installs the exact ledger and clears the want.
    n = encodeDustLedger(plot, ledgerInput(server.ledger, plot), deflate, out);
    expect(out[0]).toBe(MESSAGE_CATALOG.DUST_LEDGER.id);
    expect(client.applyBytes(out.slice(0, n))).toBe(true);
    expect(client.ledger.ledgerHash(plot)).toBe(server.ledger.ledgerHash(plot));
    expect(client.wantedCount).toBe(0);
    // A corrupt ledger message is refused and counted, never thrown.
    expect(client.applyBytes(new Uint8Array([MESSAGE_CATALOG.DUST_LEDGER.id as number, 1, 0, 0, 9, 9]))).toBe(false);
    expect(client.stats.ledgersInvalid).toBe(1);
    // dust.plots: a Polished delta latches; an Opened delta updates the overlay of a plot without a ledger.
    const view = new FrameView();
    view.dustPlots.count = 2;
    let free = 9000;
    while (client.ledger.isEmptyPlot(free as never) || client.ledger.slotOf[free]! >= 0) free++;
    view.dustPlots.plotId[0] = free;
    view.dustPlots.state[0] = PlotState.Opened;
    view.dustPlots.remainingFrac[0] = 200;
    view.dustPlots.plotId[1] = free + 1;
    view.dustPlots.state[1] = PlotState.Polished;
    view.dustPlots.remainingFrac[1] = 0;
    client.applyFrame(view);
    expect(client.stateOf(free)).toBe(PlotState.Opened);
    expect(client.fracOf(free)).toBe(200);
    expect(client.stateOf(free + 1)).toBe(PlotState.Polished);
  });
});
