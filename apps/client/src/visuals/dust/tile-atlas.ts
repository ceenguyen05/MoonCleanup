// Dust tile atlas bookkeeping (M1-W3-T02): which plot owns which atlas slot, residency, eviction, the live stroke
// queue and the time-sliced tile rebuild. Pure CPU: it turns the work of one rendered frame into a `DustReplayBatch`
// that the GPU pass (replay-pass.ts) or the CPU reference (`CpuAtlas`) executes. No three.js, DOM or Node imports.
//
// Rebuild of one tile (W1-T06 contract items 4 and 7), a job of three stages that can spread over frames:
//   0. snapshot + fill: the stroke logs of the plot and its 6 neighbours are copied once (each stroke once), the
//      target slot is reset to full dust;
//   1. replay: the snapshot is emitted as stroke instances, a slice at a time, until the frame budget is used;
//   2. residual: the ledger's remaining dust per 0.8 m cell is read and the GPU subtracts what the logs do not explain.
// The log replay is rasterised by the GPU, so the main thread only writes instance records. Budget is in
// milliseconds per frame (`budgetMs`), not in tiles. A rebuild of a tile that is already on screen goes into a spare
// slot and the slot table switches when the job is done, so a resync never flashes back to dust.
//
// Contract with the host: a stroke is passed to `onStroke` after the ledger (and its stroke log) applied it and before
// the next `frame()`; `frame()` is followed by exactly one execution of the batch. Then a stroke reaches a tile exactly
// once: from the snapshot when it was logged before the snapshot was taken, live otherwise.
// Nothing here allocates per frame or per stroke (queues grow by doubling, rarely).

import { LEDGER_TEXEL_SIZE_MM, PLOT_NEIGHBOR_SLOTS, PlotState, STROKE_LOG_RING } from "@moon-cleanup/shared";
import { LoggedStroke, type IcoPlotGrid, type StrokeLogStore } from "@moon-cleanup/world";
import {
  BATCH_MAX_FILLS,
  BATCH_MAX_RESIDUALS,
  BATCH_MAX_STROKES,
  CELLS,
  FRAME_EDGE_MM,
  FRAME_HALF_MM,
  type AtlasLayout,
  type DustReplayBatch,
} from "./replay-batch";

/** What the atlas reads of the dust ledger (`WorldDustLedger` satisfies it). */
export interface DustLedgerView {
  readonly state: Uint8Array;
  readonly slotOf: Int32Array;
  readonly levelOf: Uint8Array;
  readonly texels: Uint8Array;
  readonly log: StrokeLogStore | null;
}

export interface DustTileAtlasOptions extends AtlasLayout {
  /** Plots with dust work closer than this to the camera get a tile. */
  readonly residencyM: number;
  /**
   * Main-thread budget of one `frame()` in milliseconds. Default 0.5: the replay budget is 1.0 ms per frame and the
   * render calls of `DustReplayPass.flush()` need the other half on the UHD 620 (W3-T02 report).
   */
  readonly budgetMs?: number;
  readonly now?: () => number;
}

/** Atlas presets (WDS 7.2): Low 2048 x 1024, Medium 2048 x 2048, High 4096 x 2048. */
export const DUST_TILE_PRESETS = {
  low: { slotPx: 64, cols: 32, rows: 16, residencyM: 80 },
  medium: { slotPx: 64, cols: 32, rows: 32, residencyM: 120 },
  high: { slotPx: 128, cols: 32, rows: 16, residencyM: 160 },
} as const;

const NB = PLOT_NEIGHBOR_SLOTS;
const TEXEL_MM = LEDGER_TEXEL_SIZE_MM;
const POLISHED = PlotState.Polished;
const EMPTY = PlotState.Empty;
/** ints per queued live stroke: anchor, sU, sV, eU, eV, widthCm, depth16 */
const SW = 7;
const SNAP_MAX = (NB + 1) * STROKE_LOG_RING;
const SEEN_SIZE = 4096;
/** Strokes emitted between two clock reads of the replay stage. */
const REPLAY_SLICE = 32;
/** Instances kept free for the live strokes of a frame (each stroke reaches at most 7 tiles plus one staging slot). */
const LIVE_RESERVE = 256;

export class DustTileAtlas {
  readonly layout: AtlasLayout;
  readonly slots: number;
  /** Published slot per plot, -1 = no tile. Read-only for callers. */
  readonly slotOfPlot: Int32Array;
  /** Plot per slot (published or being rebuilt), -1 = free. */
  readonly plotOfSlot: Int32Array;
  /** Increments whenever `slotOfPlot` changes (consumers re-upload their slot table). */
  version = 0;
  tilesResident = 0;
  evictions = 0;
  rebuilds = 0;
  strokesReplayed = 0;
  tileStrokeDraws = 0;
  /** Live strokes that did not fit a batch; their tiles were queued for a rebuild instead. */
  liveOverflows = 0;
  /** Main-thread milliseconds of the last `frame()` that had rebuild work (0 otherwise), and the largest ever. */
  fCpuMs = 0;
  maxCpuMs = 0;
  /** Rebuild stages run by the last `frame()`. */
  fSteps = 0;

  private readonly budgetMs: number;
  private readonly now: () => number;
  private readonly cosRes: number;
  private readonly texelMm: number;
  private readonly cellPx: number;

  private readonly free: Int32Array;
  private freeTop = 0;
  private readonly quarantine: Int32Array;
  private quarantineN = 0;
  /** Frame number in which a rebuild stage last wrote instances for the slot. */
  private readonly busyStamp: Int32Array;
  /** Frame number in which the log snapshot of the slot's rebuild was taken. */
  private readonly snapStamp: Int32Array;
  private frameNo = 1;

  private pending = new Int32Array(256 * SW);
  private pendingN = 0;
  private zeros = new Int32Array(128);
  private zeroN = 0;

  private readonly queued: Uint8Array;
  private queue = new Int32Array(1024);
  private queueHead = 0;
  private queueN = 0;

  // the one rebuild job
  private jobPlot = -1;
  private jobSlot = -1;
  private jobStage = 0;
  private jobRestart = false;
  private readonly snap = new Int32Array(SNAP_MAX * SW);
  private snapN = 0;
  private snapI = 0;
  private readonly seenKeys = new Int32Array(SEEN_SIZE * 3);
  private readonly seenStamp = new Int32Array(SEEN_SIZE);
  private seenGen = 0;
  // stage cost estimates in ms (decaying maxima)
  private estStart = 0.15;
  private estResid = 0.25;

  private readonly visit: Int32Array;
  private visitGen = 0;
  private readonly bfs = new Int32Array(8192);
  // Scratch unit direction and plot-local millimetres. Typed arrays, and the projection is done here from the grid's
  // tables instead of the grid's object-out projection methods: those write doubles into object fields, which costs
  // one heap number per store (measured: about 58 KB per tile rebuild). Same arithmetic, same results.
  private readonly dir = new Float64Array(3);
  private readonly loc = new Int32Array(2);
  private readonly radiusM: number;
  private readonly rec = new LoggedStroke();
  /** Camera direction x, y, z and the start time of the running `frame()`: kept here so no call passes a double. */
  private readonly fv = new Float64Array(4);

  constructor(
    private readonly grid: IcoPlotGrid,
    private readonly ledger: DustLedgerView,
    options: DustTileAtlasOptions,
  ) {
    if (options.slotPx % CELLS !== 0) throw new RangeError(`dust tile edge ${options.slotPx}`);
    this.layout = { slotPx: options.slotPx, cols: options.cols, rows: options.rows };
    this.slots = options.cols * options.rows;
    this.budgetMs = options.budgetMs ?? 0.5;
    this.now = options.now ?? ((): number => performance.now());
    this.radiusM = grid.params.radiusM;
    const a = options.residencyM / grid.params.radiusM;
    this.cosRes = 1 - (a * a) / 2;
    this.texelMm = FRAME_EDGE_MM / options.slotPx;
    this.cellPx = options.slotPx / CELLS;
    this.slotOfPlot = new Int32Array(grid.count).fill(-1);
    this.plotOfSlot = new Int32Array(this.slots).fill(-1);
    this.free = new Int32Array(this.slots);
    for (let i = 0; i < this.slots; i++) this.free[i] = this.slots - 1 - i;
    this.freeTop = this.slots;
    this.quarantine = new Int32Array(this.slots);
    this.busyStamp = new Int32Array(this.slots);
    this.snapStamp = new Int32Array(this.slots);
    this.queued = new Uint8Array(grid.count);
    this.visit = new Int32Array(grid.count);
  }

  // ---- host events ----------------------------------------------------------------------------------------------

  /** A stroke the ledger has applied (predicted, echoed or remote; any order). Endpoints in the frame of `anchor`. */
  onStroke(anchor: number, sU: number, sV: number, eU: number, eV: number, widthCm: number, depth16: number): void {
    if ((this.pendingN + 1) * SW > this.pending.length) {
      const g = new Int32Array(this.pending.length * 2);
      g.set(this.pending);
      this.pending = g;
    }
    const o = this.pendingN++ * SW;
    const p = this.pending;
    p[o] = anchor;
    p[o + 1] = sU;
    p[o + 2] = sV;
    p[o + 3] = eU;
    p[o + 4] = eV;
    p[o + 5] = widthCm;
    p[o + 6] = depth16;
  }

  /** The ledger of `plot` was replaced (join, restore, resync) or the plot became Polished: rebuild its tile. */
  onLedger(plot: number): void {
    if (plot === this.jobPlot) this.jobRestart = true;
    else if (this.slotOfPlot[plot]! >= 0) this.queueRebuild(plot);
  }

  /** `plot` became Polished: its own tile and the gutters of the neighbouring tiles are rebuilt. */
  onPolished(plot: number): void {
    this.onLedger(plot);
    const nb = this.grid.neighborTable;
    for (let k = 0; k < NB; k++) {
      const q = nb[plot * NB + k]!;
      if (q >= 0) this.onLedger(q);
    }
  }

  /** A 0.8 m ledger cell of `plot` reached zero (ledger-zero event): no residue may stay in any tile. */
  onLedgerZero(plot: number, texelIndex: number): void {
    if ((this.zeroN + 1) * 2 > this.zeros.length) {
      const g = new Int32Array(this.zeros.length * 2);
      g.set(this.zeros);
      this.zeros = g;
    }
    this.zeros[this.zeroN * 2] = plot;
    this.zeros[this.zeroN * 2 + 1] = texelIndex;
    this.zeroN++;
  }

  /** `plot` left the client's view of the world: its tile is released. */
  onDrop(plot: number): void {
    if (plot === this.jobPlot) this.cancelJob();
    const slot = this.slotOfPlot[plot]!;
    if (slot < 0) return;
    this.slotOfPlot[plot] = -1;
    this.plotOfSlot[slot] = -1;
    this.quarantine[this.quarantineN++] = slot;
    this.tilesResident--;
    this.version++;
  }

  /** The GPU atlas was lost (device loss, context restore): every resident tile is rebuilt from ledger and logs. */
  rebuildAll(): void {
    if (this.jobPlot >= 0) this.jobRestart = true;
    for (let s = 0; s < this.slots; s++) {
      const p = this.plotOfSlot[s]!;
      if (p >= 0 && p !== this.jobPlot && this.slotOfPlot[p] === s) this.queueRebuild(p);
    }
  }

  /** Rebuilds waiting, the running one included. */
  get rebuildBacklog(): number {
    return this.queueN + (this.jobPlot >= 0 ? 1 : 0);
  }

  /** Atlas texel origin of `slot`. */
  slotX(slot: number): number {
    return (slot % this.layout.cols) * this.layout.slotPx;
  }
  slotY(slot: number): number {
    return Math.floor(slot / this.layout.cols) * this.layout.slotPx;
  }

  // ---- frame ----------------------------------------------------------------------------------------------------

  /**
   * One rendered frame with the camera above unit direction (x, y, z): residency, rebuild stages inside the budget,
   * this frame's strokes, ledger-zero clears. `batch` is reset and filled; the caller executes it once.
   */
  frame(x: number, y: number, z: number, batch: DustReplayBatch): void {
    // The clock is read only when there is rebuild work: a frame with nothing but live strokes reads no clock.
    let work = this.queueN > 0 || this.jobPlot >= 0;
    const fv = this.fv;
    fv[0] = x;
    fv[1] = y;
    fv[2] = z;
    if (work) fv[3] = this.now();
    batch.reset();
    this.frameNo++;
    for (let i = 0; i < this.quarantineN; i++) this.free[this.freeTop++] = this.quarantine[i]!;
    this.quarantineN = 0;

    this.residency();
    if (!work && this.queueN > 0) {
      work = true;
      fv[3] = this.now();
    }
    if (work) this.runRebuilds(batch);
    else this.fSteps = 0;
    this.liveStrokes(batch);
    this.zeroClears(batch);

    if (work) {
      const ms = this.now() - fv[3]!;
      this.fCpuMs = ms;
      if (ms > this.maxCpuMs) this.maxCpuMs = ms;
    } else this.fCpuMs = 0;
  }

  private queueRebuild(plot: number): void {
    if (this.queued[plot] === 1) return;
    this.queued[plot] = 1;
    if (this.queueN === this.queue.length) {
      const g = new Int32Array(this.queueN * 2);
      for (let i = 0; i < this.queueN; i++) g[i] = this.queue[(this.queueHead + i) % this.queue.length]!;
      this.queue = g;
      this.queueHead = 0;
    }
    this.queue[(this.queueHead + this.queueN++) % this.queue.length] = plot;
  }

  private wantsTile(plot: number): boolean {
    const led = this.ledger;
    if (led.slotOf[plot]! >= 0) return true;
    if (led.state[plot] !== POLISHED) return false;
    const nb = this.grid.neighborTable;
    for (let k = 0; k < NB; k++) {
      const q = nb[plot * NB + k]!;
      if (q >= 0 && led.slotOf[q]! >= 0) return true;
    }
    return false;
  }

  /** Breadth-first walk over the plots inside the residency radius, nearest first; plots with dust work get a tile. */
  private residency(): void {
    const x = this.fv[0]!;
    const y = this.fv[1]!;
    const z = this.fv[2]!;
    const grid = this.grid;
    const c = grid.centers;
    const nb = grid.neighborTable;
    const gen = ++this.visitGen;
    const visit = this.visit;
    const bfs = this.bfs;
    const start = grid.plotAtXYZ(x, y, z);
    let head = 0;
    let tail = 0;
    bfs[tail++] = start;
    visit[start] = gen;
    while (head < tail) {
      const p = bfs[head++]!;
      if (this.slotOfPlot[p]! < 0 && this.queued[p] === 0 && p !== this.jobPlot && this.wantsTile(p)) {
        this.queueRebuild(p);
      }
      for (let k = 0; k < NB; k++) {
        const q = nb[p * NB + k]!;
        if (q < 0 || visit[q] === gen) continue;
        visit[q] = gen;
        if (x * c[q * 3]! + y * c[q * 3 + 1]! + z * c[q * 3 + 2]! < this.cosRes) continue;
        if (tail < bfs.length) bfs[tail++] = q;
      }
    }
  }

  // ---- rebuild job ----------------------------------------------------------------------------------------------

  private cancelJob(): void {
    const p = this.jobPlot;
    if (p < 0) return;
    if (this.slotOfPlot[p] !== this.jobSlot) {
      this.plotOfSlot[this.jobSlot] = -1;
      this.quarantine[this.quarantineN++] = this.jobSlot;
    }
    this.jobPlot = -1;
    this.jobSlot = -1;
    this.jobRestart = false;
  }

  /** A slot for the tile of `plot`: a free one, else the farthest published tile when it is farther than `plot`. */
  private takeSlot(plot: number): number {
    const x = this.fv[0]!;
    const y = this.fv[1]!;
    const z = this.fv[2]!;
    if (this.freeTop > 0) return this.free[--this.freeTop]!;
    const c = this.grid.centers;
    let far = -1;
    let farDot = x * c[plot * 3]! + y * c[plot * 3 + 1]! + z * c[plot * 3 + 2]!;
    for (let s = 0; s < this.slots; s++) {
      const q = this.plotOfSlot[s]!;
      if (q < 0 || this.slotOfPlot[q] !== s || this.busyStamp[s] === this.frameNo) continue;
      const dq = x * c[q * 3]! + y * c[q * 3 + 1]! + z * c[q * 3 + 2]!;
      if (dq < farDot) {
        farDot = dq;
        far = s;
      }
    }
    if (far < 0) return -1;
    this.slotOfPlot[this.plotOfSlot[far]!] = -1;
    this.plotOfSlot[far] = -1;
    this.tilesResident--;
    this.evictions++;
    this.version++;
    return far;
  }

  private runRebuilds(batch: DustReplayBatch): void {
    const t0 = this.fv[3]!;
    const now = this.now;
    const budget = this.budgetMs;
    let steps = 0;
    for (;;) {
      if (this.jobPlot < 0) {
        if (this.queueN === 0) break;
        if (steps > 0 && now() - t0 + this.estStart > budget) break;
        const p = this.queue[this.queueHead]!;
        this.queueHead = (this.queueHead + 1) % this.queue.length;
        this.queueN--;
        this.queued[p] = 0;
        const published = this.slotOfPlot[p]!;
        if (published < 0 && !this.wantsTile(p)) continue;
        let slot = this.takeSlot(p);
        if (slot < 0) {
          if (published < 0) continue; // atlas full of nearer tiles
          slot = published; // no spare slot: rebuild in place
        }
        this.plotOfSlot[slot] = p;
        this.jobPlot = p;
        this.jobSlot = slot;
        this.jobStage = 0;
        this.jobRestart = false;
      }
      if (this.jobRestart) {
        this.jobRestart = false;
        this.jobStage = 0;
      }
      if (this.jobStage === 0) {
        if (batch.fillN === BATCH_MAX_FILLS) break;
        if (steps > 0 && now() - t0 + this.estStart > budget) break;
        const s0 = now();
        this.takeSnapshot(this.jobPlot);
        batch.pushFill(this.layout, this.jobSlot);
        this.busyStamp[this.jobSlot] = this.frameNo;
        this.snapStamp[this.jobSlot] = this.frameNo;
        this.jobStage = 1;
        steps++;
        const ms = now() - s0;
        this.estStart = ms > this.estStart ? ms : this.estStart * 0.98 + ms * 0.02;
      }
      if (this.jobStage === 1) {
        if (!this.replaySnapshot(steps, batch)) break;
        steps++;
        this.jobStage = 2;
      }
      if (batch.residN === BATCH_MAX_RESIDUALS) break;
      if (steps > 0 && now() - t0 + this.estResid > budget) break;
      const s0 = now();
      this.emitResidual(batch);
      steps++;
      const ms = now() - s0;
      this.estResid = ms > this.estResid ? ms : this.estResid * 0.98 + ms * 0.02;
      this.publishJob();
    }
    this.fSteps = steps;
  }

  private publishJob(): void {
    const p = this.jobPlot;
    const old = this.slotOfPlot[p]!;
    if (old !== this.jobSlot) {
      if (old >= 0) {
        this.plotOfSlot[old] = -1;
        this.quarantine[this.quarantineN++] = old;
      } else this.tilesResident++;
      this.slotOfPlot[p] = this.jobSlot;
      this.version++;
    }
    this.busyStamp[this.jobSlot] = this.frameNo;
    this.jobPlot = -1;
    this.jobSlot = -1;
    this.rebuilds++;
  }

  /** Copies the logs of `plot` and its neighbours into the job snapshot, each stroke once, in the tile's frame. */
  private takeSnapshot(plot: number): void {
    const log = this.ledger.log;
    this.snapN = 0;
    this.snapI = 0;
    if (log === null) return;
    this.seenGen++;
    const nb = this.grid.neighborTable;
    const rec = this.rec;
    const snap = this.snap;
    for (let ci = -1; ci < NB; ci++) {
      const q = ci < 0 ? plot : nb[plot * NB + ci]!;
      if (q < 0) continue;
      const n = log.count(q);
      for (let k = 0; k < n; k++) {
        log.read(q, k, rec);
        const w0 = rec.anchor | (rec.toolCode << 18) | (rec.actorSlot << 24);
        const w1 = (rec.startUMm & 0xffff) | (rec.startVMm << 16);
        const w2 = (rec.endUMm & 0xffff) | (rec.endVMm << 16);
        if (this.seenBefore(w0, w1, w2)) continue;
        const o = this.snapN++ * SW;
        let su = rec.startUMm;
        let sv = rec.startVMm;
        let eu = rec.endUMm;
        let ev = rec.endVMm;
        if (rec.anchor !== plot) {
          this.toFrame(rec.anchor, su, sv, plot);
          su = this.loc[0]!;
          sv = this.loc[1]!;
          this.toFrame(rec.anchor, eu, ev, plot);
          eu = this.loc[0]!;
          ev = this.loc[1]!;
        }
        snap[o] = rec.anchor;
        snap[o + 1] = su;
        snap[o + 2] = sv;
        snap[o + 3] = eu;
        snap[o + 4] = ev;
        snap[o + 5] = rec.widthCm;
        snap[o + 6] = rec.depth16;
      }
    }
  }

  /**
   * A stroke sits in the log of every plot it overlapped, so a snapshot meets it up to 7 times; it is drawn once.
   * Two different strokes with identical words (the same actor re-scrubbing the exact same segment with the same
   * tool) collapse into one; the residual step carries what that loses at 0.8 m.
   */
  private seenBefore(w0: number, w1: number, w2: number): boolean {
    const keys = this.seenKeys;
    const stamp = this.seenStamp;
    const gen = this.seenGen;
    let h = (Math.imul(w0, 0x9e3779b1) ^ Math.imul(w1, 0x85ebca6b) ^ Math.imul(w2, 0xc2b2ae35)) >>> 20;
    for (;;) {
      if (stamp[h] !== gen) {
        stamp[h] = gen;
        keys[h * 3] = w0;
        keys[h * 3 + 1] = w1;
        keys[h * 3 + 2] = w2;
        return false;
      }
      if (keys[h * 3] === w0 && keys[h * 3 + 1] === w1 && keys[h * 3 + 2] === w2) return true;
      h = (h + 1) & (SEEN_SIZE - 1);
    }
  }

  /** Emits snapshot strokes until done (true) or the budget / batch room is used (false). */
  private replaySnapshot(steps: number, batch: DustReplayBatch): boolean {
    const t0 = this.fv[3]!;
    const snap = this.snap;
    const slot = this.jobSlot;
    const level = this.ledger.levelOf[this.jobPlot]!;
    const room = BATCH_MAX_STROKES - LIVE_RESERVE;
    let since = 0;
    while (this.snapI < this.snapN) {
      if (batch.strokeN >= room) return false;
      if (since === REPLAY_SLICE) {
        since = 0;
        if (this.now() - t0 > this.budgetMs && (steps > 0 || batch.strokeN > 0)) return false;
      }
      const o = this.snapI++ * SW;
      if (
        batch.pushStroke(
          this.layout,
          slot,
          snap[o + 1]!,
          snap[o + 2]!,
          snap[o + 3]!,
          snap[o + 4]!,
          snap[o + 5]!,
          snap[o + 6]!,
          level,
        ) === 1
      ) {
        this.tileStrokeDraws++;
      }
      since++;
    }
    this.busyStamp[slot] = this.frameNo;
    return true;
  }

  /** Reads the ledger's remaining dust (1/255) for the 1,024 cells of the job's tile into the batch. */
  private emitResidual(batch: DustReplayBatch): void {
    const plot = this.jobPlot;
    const base = batch.pushResidual(this.layout, this.jobSlot);
    const cells = batch.ledgerCells;
    const led = this.ledger;
    const state = led.state;
    const slotOf = led.slotOf;
    const texels = led.texels;
    const levelOf = led.levelOf;
    for (let b = 0; b < CELLS; b++) {
      const v = b * TEXEL_MM + TEXEL_MM / 2 - FRAME_HALF_MM;
      for (let a = 0; a < CELLS; a++) {
        const u = a * TEXEL_MM + TEXEL_MM / 2 - FRAME_HALF_MM;
        const o = base + (b * CELLS + a) * 4;
        this.dirOf(plot, u, v);
        const owner = this.nearest(plot);
        const st = state[owner]!;
        let rl = 255;
        let valid = 255;
        if (st === POLISHED || st === EMPTY) rl = 0;
        else {
          const slot = slotOf[owner]!;
          if (slot >= 0) {
            let ou = u;
            let ov = v;
            if (owner !== plot) {
              this.localOf(owner);
              ou = this.loc[0]!;
              ov = this.loc[1]!;
            }
            const ca = Math.floor((ou + FRAME_HALF_MM) / TEXEL_MM);
            const cb = Math.floor((ov + FRAME_HALF_MM) / TEXEL_MM);
            if (ca < 0 || ca >= CELLS || cb < 0 || cb >= CELLS) valid = 0;
            else {
              const u0 = 16 * levelOf[owner]!;
              rl = u0 === 0 ? 0 : Math.round((texels[slot * CELLS * CELLS + cb * CELLS + ca]! * 255) / u0);
              if (rl > 255) rl = 255;
            }
          }
        }
        cells[o] = rl;
        cells[o + 1] = valid;
        cells[o + 2] = 0;
        cells[o + 3] = 255;
      }
    }
  }

  // ---- live strokes and clears ----------------------------------------------------------------------------------

  /** Unit direction of integer mm (u, v) in the frame of `plot`, into `this.dir` (the grid's inverse projection). */
  private dirOf(plot: number, uMm: number, vMm: number): void {
    const o = plot * 3;
    const c = this.grid.centers;
    const e = this.grid.east;
    const t = this.grid.north;
    const a = uMm / 1000 / this.radiusM;
    const b = vMm / 1000 / this.radiusM;
    const x = c[o]! + a * e[o]! + b * t[o]!;
    const y = c[o + 1]! + a * e[o + 1]! + b * t[o + 1]!;
    const z = c[o + 2]! + a * e[o + 2]! + b * t[o + 2]!;
    const len = Math.sqrt(x * x + y * y + z * z);
    const d = this.dir;
    d[0] = x / len;
    d[1] = y / len;
    d[2] = z / len;
  }

  /** Rounded mm of `this.dir` in the frame of `plot`, into `this.loc` (the grid's gnomonic projection). */
  private localOf(plot: number): void {
    const o = plot * 3;
    const c = this.grid.centers;
    const e = this.grid.east;
    const t = this.grid.north;
    const d = this.dir;
    const nx = c[o]!;
    const ny = c[o + 1]!;
    const nz = c[o + 2]!;
    const dn = d[0]! * nx + d[1]! * ny + d[2]! * nz;
    const qx = d[0]! / dn - nx;
    const qy = d[1]! / dn - ny;
    const qz = d[2]! / dn - nz;
    const r = this.radiusM;
    const u = r * (qx * e[o]! + qy * e[o + 1]! + qz * e[o + 2]!);
    const v = r * (qx * t[o]! + qy * t[o + 1]! + qz * t[o + 2]!);
    this.loc[0] = Math.round(u * 1000);
    this.loc[1] = Math.round(v * 1000);
  }

  private toFrame(from: number, u: number, v: number, to: number): void {
    this.dirOf(from, u, v);
    this.localOf(to);
  }

  /** Plot whose centre is nearest to `this.dir`, walking from `start` (ties to the lower id). */
  private nearest(start: number): number {
    const x = this.dir[0]!;
    const y = this.dir[1]!;
    const z = this.dir[2]!;
    const c = this.grid.centers;
    const nb = this.grid.neighborTable;
    let home = start;
    let best = x * c[home * 3]! + y * c[home * 3 + 1]! + z * c[home * 3 + 2]!;
    for (let step = 0; step < 64; step++) {
      let next = home;
      for (let k = 0; k < NB; k++) {
        const q = nb[home * NB + k]!;
        if (q < 0) continue;
        const dq = x * c[q * 3]! + y * c[q * 3 + 1]! + z * c[q * 3 + 2]!;
        if (dq > best || (dq === best && q < next)) {
          best = dq;
          next = q;
        }
      }
      if (next === home) break;
      home = next;
    }
    return home;
  }

  private liveStrokes(batch: DustReplayBatch): void {
    const pend = this.pending;
    const nb = this.grid.neighborTable;
    const levelOf = this.ledger.levelOf;
    for (let i = 0; i < this.pendingN; i++) {
      const o = i * SW;
      const anchor = pend[o]!;
      const sU = pend[o + 1]!;
      const sV = pend[o + 2]!;
      const eU = pend[o + 3]!;
      const eV = pend[o + 4]!;
      this.dirOf(anchor, eU, eV);
      const home = this.nearest(anchor);
      for (let ci = -1; ci < NB; ci++) {
        const q = ci < 0 ? home : nb[home * NB + ci]!;
        if (q < 0) continue;
        const published = this.slotOfPlot[q]!;
        // The staging slot of a running rebuild also takes the stroke once its snapshot exists.
        const staging = q === this.jobPlot && this.jobStage >= 1 && this.jobSlot !== published ? this.jobSlot : -1;
        if (published < 0 && staging < 0) continue;
        let su = sU;
        let sv = sV;
        let eu = eU;
        let ev = eV;
        if (anchor !== q) {
          this.toFrame(anchor, sU, sV, q);
          su = this.loc[0]!;
          sv = this.loc[1]!;
          this.toFrame(anchor, eU, eV, q);
          eu = this.loc[0]!;
          ev = this.loc[1]!;
        }
        const level = levelOf[q]!;
        // A slot whose snapshot was taken this frame already holds this stroke (it was logged before the frame).
        if (published >= 0 && this.snapStamp[published] !== this.frameNo) {
          const r = batch.pushStroke(this.layout, published, su, sv, eu, ev, pend[o + 5]!, pend[o + 6]!, level);
          if (r === 1) this.tileStrokeDraws++;
          else if (r < 0) {
            this.liveOverflows++;
            this.onLedger(q);
          }
        }
        if (staging >= 0 && this.snapStamp[staging] !== this.frameNo) {
          const r = batch.pushStroke(this.layout, staging, su, sv, eu, ev, pend[o + 5]!, pend[o + 6]!, level);
          if (r === 1) this.tileStrokeDraws++;
          else if (r < 0) {
            this.liveOverflows++;
            this.jobRestart = true;
          }
        }
      }
    }
    this.strokesReplayed += this.pendingN;
    this.pendingN = 0;
  }

  private zeroClears(batch: DustReplayBatch): void {
    const px = this.layout.slotPx;
    const cell = this.cellPx;
    const nb = this.grid.neighborTable;
    for (let i = 0; i < this.zeroN; i++) {
      const plot = this.zeros[i * 2]!;
      const ix = this.zeros[i * 2 + 1]!;
      const cu = ((ix & (CELLS - 1)) + 0.5) * TEXEL_MM - FRAME_HALF_MM;
      const cv = (Math.floor(ix / CELLS) + 0.5) * TEXEL_MM - FRAME_HALF_MM;
      for (let ci = -1; ci < NB; ci++) {
        const q = ci < 0 ? plot : nb[plot * NB + ci]!;
        if (q < 0) continue;
        const published = this.slotOfPlot[q]!;
        const staging = q === this.jobPlot && this.jobStage >= 1 && this.jobSlot !== published ? this.jobSlot : -1;
        if (published < 0 && staging < 0) continue;
        let u = cu;
        let w = cv;
        if (q !== plot) {
          this.toFrame(plot, cu, cv, q);
          u = this.loc[0]!;
          w = this.loc[1]!;
        }
        // Neighbouring frames are almost parallel, so the cell is cleared as an axis-aligned block around its centre.
        const x0 = Math.round((u + FRAME_HALF_MM) / this.texelMm - cell / 2);
        const y0 = Math.round((w + FRAME_HALF_MM) / this.texelMm - cell / 2);
        if (x0 + cell <= 0 || y0 + cell <= 0 || x0 >= px || y0 >= px) continue;
        const cx0 = x0 < 0 ? 0 : x0;
        const cy0 = y0 < 0 ? 0 : y0;
        const cx1 = x0 + cell > px ? px - 1 : x0 + cell - 1;
        const cy1 = y0 + cell > px ? px - 1 : y0 + cell - 1;
        let ok = true;
        if (published >= 0) ok = batch.pushClear(this.layout, published, cx0, cy0, cx1, cy1);
        if (staging >= 0) ok = batch.pushClear(this.layout, staging, cx0, cy0, cx1, cy1) && ok;
        if (!ok) this.onLedger(q);
      }
    }
    this.zeroN = 0;
  }
}
