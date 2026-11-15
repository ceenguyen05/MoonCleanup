// Main-thread dust ledger view of the Solo LocalRoom (M1-W3-T02b). The sim worker owns the authoritative dust ledger;
// the client dust layer (visuals/dust tile atlas) needs a ledger on the main thread for its tile rebuilds (stroke logs,
// residual texels, plot states) and every stroke once, live. This view keeps that ledger:
//   - the worker's whole dust state (`SimDustState`, chunk payloads) is restored into a SPARE ledger in budgeted slices
//     (`pump()`, once per rendered frame); the spare becomes the front ledger in one step and the atlas rebuilds every
//     resident tile (`rebuildAll`), so a restore never shows half a moon;
//   - every FRAME of the host is decoded (packages/protocol FrameReader, the same decode path as a server room) and each
//     stroke is applied to the front ledger, then passed to the target (`onStroke`), followed by the ledger's
//     ledger-zero and Polished events (`onLedgerZero`, `onPolished`). Strokes that arrive during a restore wait and are
//     applied to the new ledger before it is published (they are then part of every tile rebuild).
// Ledger arithmetic is deterministic and the strokes are the worker's exact records, so the view equals the worker's
// ledger (tests compare `worldHash()`). Nothing is allocated per frame or per stroke in steady state (queues grow by
// doubling, rarely); the stroke work runs in the host's frame message handler, outside the render step, and never
// touches the input path.
// Imports packages only (module-boundaries section 3): the target is a structural interface the atlas satisfies.

import {
  FRAME_MAX_BYTES,
  STANDARD_GRID_PARAMS,
  type PlotId,
  type RoomHostFrame,
  type StrokeRecord,
  type Tick,
  type Unsubscribe,
} from "@moon-cleanup/shared";
import {
  FRAME_OK,
  FrameReader,
  FrameView,
  SlotTable,
  createStrokeRecordOut,
  expandStrokeChain,
  type StrokeRecordOut,
} from "@moon-cleanup/protocol";
import { createRoomDustLedger } from "@moon-cleanup/sim";
import { loadGameData } from "@moon-cleanup/game-data";
import {
  DustRestoreJob,
  createPlotGrid,
  type IcoPlotGrid,
  type StrokeLogStore,
  type WorldDustLedger,
} from "@moon-cleanup/world";
import type { SimDustState } from "./local-room-host";

/** What the dust layer reads of a ledger (`DustLedgerView` of visuals/dust; structural). */
export interface DustLedgerReadView {
  readonly state: Uint8Array;
  readonly slotOf: Int32Array;
  readonly levelOf: Uint8Array;
  readonly texels: Uint8Array;
  readonly log: StrokeLogStore | null;
}

/** Who consumes the strokes (`DustTileAtlas` satisfies it). */
export interface DustViewTarget {
  onStroke(anchor: number, sU: number, sV: number, eU: number, eV: number, widthCm: number, depth16: number): void;
  onLedgerZero(plot: number, texelIndex: number): void;
  onPolished(plot: number): void;
  rebuildAll(): void;
}

/** What the view needs of a host (`LocalRoomHostImpl` satisfies it). */
export interface DustViewSource {
  onFrame(listener: (frame: RoomHostFrame) => void): Unsubscribe;
  onDustState(listener: (state: SimDustState) => void): Unsubscribe;
  requestDustState(): void;
  frameBytes(frame: RoomHostFrame): Uint8Array;
}

export interface SoloDustViewOptions {
  /** Standard grid to share with the dust layer (default: built here). */
  readonly grid?: IcoPlotGrid;
  /** Main-thread milliseconds per `pump()` for a restore (default 1). */
  readonly restoreBudgetMs?: number;
  readonly now?: () => number;
}

export interface SoloDustViewStats {
  framesDecoded: number;
  decodeErrors: number;
  strokesApplied: number;
  strokesForwarded: number;
  /** Dust states received and restores published. */
  dustStates: number;
  restores: number;
  /** Duration, slice count and longest slice (ms) of the last restore. */
  restoreMs: number;
  restoreSlices: number;
  restoreSliceMaxMs: number;
  /** Strokes that arrived during a restore and were applied before publishing. */
  strokesQueued: number;
  /** Times the live feed overflowed (no rendered frame for a long time) and the target rebuilt instead. */
  liveOverflows: number;
  /** Ledger pool growths after the first publish (0 = no allocation on the stroke path). */
  ledgerPoolGrowths: number;
}

/** Ledger slots reserved ahead of play (same headroom as the worker, SOLO_LEDGER_HEADROOM_SLOTS). */
const HEADROOM_SLOTS = 1024;
/** Ints per queued stroke: anchor, sU, sV, eU, eV, widthCm, depth16, toolCode, actorSlot, tick, inputSeq. */
const QW = 11;
/** Strokes forwarded between two `pump()` calls before the view stops feeding and asks for a rebuild instead. */
const LIVE_FORWARD_CAP = 2048;
/** Strokes queued during a restore before the restore is finished at once (a tab without rendered frames). */
const QUEUE_CAP = 65_536;

type MutableStroke = { -readonly [K in keyof StrokeRecord]: StrokeRecord[K] };

class Sink {
  milligrams = 0;
  removedUnits = 0;
  grime01 = 0;
  plotCount = 0;
  readonly plotIds = new Int32Array(8);
}

/** Stable read view whose arrays follow the current front ledger (the atlas holds this object for good). */
class FrontLedger implements DustLedgerReadView {
  constructor(private readonly owner: { front: WorldDustLedger }) {}
  get state(): Uint8Array {
    return this.owner.front.state;
  }
  get slotOf(): Int32Array {
    return this.owner.front.slotOf;
  }
  get levelOf(): Uint8Array {
    return this.owner.front.levelOf;
  }
  get texels(): Uint8Array {
    return this.owner.front.texels;
  }
  get log(): StrokeLogStore | null {
    return this.owner.front.log;
  }
}

export class SoloDustView {
  readonly grid: IcoPlotGrid;
  /** Read view for the dust layer: always the published ledger. */
  readonly ledger: DustLedgerReadView;
  readonly stats: SoloDustViewStats = {
    framesDecoded: 0,
    decodeErrors: 0,
    strokesApplied: 0,
    strokesForwarded: 0,
    dustStates: 0,
    restores: 0,
    restoreMs: 0,
    restoreSlices: 0,
    restoreSliceMaxMs: 0,
    strokesQueued: 0,
    liveOverflows: 0,
    ledgerPoolGrowths: 0,
  };
  /** Own avatar position (m) and sim tick of the newest decoded frame. */
  readonly selfPosition = new Float64Array(3);
  selfTick = -1;

  front: WorldDustLedger;
  private spare: WorldDustLedger | null = null;
  private job: DustRestoreJob | null = null;
  private restoreT0 = 0;
  /** False until the first dust state has been published (frames before it are covered by that state). */
  private synced = false;
  private awaiting = false;
  private growthsAtPublish = 0;

  private target: DustViewTarget | null = null;
  private source: DustViewSource | null = null;
  private offFrame: Unsubscribe | null = null;
  private offDust: Unsubscribe | null = null;
  private forwardedSincePump = 0;
  private needRebuild = false;

  private readonly reader = new FrameReader();
  private readonly frame = new FrameView();
  private readonly table = new SlotTable();
  private readonly scratch = new Uint8Array(FRAME_MAX_BYTES);
  /** Exact-length views of `scratch` (the decoder is strict about the length), built once per length. */
  private readonly views: (Uint8Array | undefined)[] = [];
  private readonly out: StrokeRecordOut = createStrokeRecordOut();
  private readonly rec: MutableStroke = {
    anchor: 0 as PlotId,
    startUMm: 0,
    startVMm: 0,
    endUMm: 0,
    endVMm: 0,
    widthCm: 0,
    depth16: 0,
    toolCode: 0,
    tick: 0 as Tick,
    actorSlot: 0,
    inputSeq: 0,
  };
  private readonly sink = new Sink();
  private queue = new Int32Array(256 * QW);
  private queueN = 0;
  private readonly budgetMs: number;
  private readonly now: () => number;
  private readonly emitFn = (r: StrokeRecordOut): void => this.onRecord(r);
  private readonly frameFn = (f: RoomHostFrame): void => this.onFrame(f);
  private readonly dustFn = (s: SimDustState): void => this.onDustState(s);

  constructor(options: SoloDustViewOptions = {}) {
    this.grid = options.grid ?? createPlotGrid(STANDARD_GRID_PARAMS);
    this.budgetMs = options.restoreBudgetMs ?? 1;
    this.now = options.now ?? ((): number => performance.now());
    this.front = this.createLedger();
    this.ledger = new FrontLedger(this);
  }

  /** True once the worker's dust state has been published; until then the view shows an untouched moon. */
  get isSynced(): boolean {
    return this.synced;
  }

  /** A restore is waiting for `pump()` slices. */
  get restoring(): boolean {
    return this.job !== null;
  }

  /** Feeds `target` from now on (`null` stops). A new target rebuilds what it holds. */
  bind(target: DustViewTarget | null): void {
    this.target = target;
    this.forwardedSincePump = 0;
    target?.rebuildAll();
  }

  /** Follows `source` (one at a time) and asks it for the whole dust state; frames before that state are skipped. */
  attach(source: DustViewSource): void {
    this.detach();
    this.source = source;
    this.awaiting = true;
    this.offDust = source.onDustState(this.dustFn);
    this.offFrame = source.onFrame(this.frameFn);
    source.requestDustState();
  }

  /** Stops following the source; the ledger keeps its last state. */
  detach(): void {
    this.offFrame?.();
    this.offDust?.();
    this.offFrame = null;
    this.offDust = null;
    this.source = null;
    this.awaiting = false;
  }

  /**
   * Once per rendered frame, before the dust layer's `atlas.frame()`: runs restore slices inside the budget and
   * publishes a finished restore; asks the target for a rebuild after a live-feed overflow.
   */
  pump(): void {
    this.forwardedSincePump = 0;
    if (this.needRebuild) {
      this.needRebuild = false;
      this.target?.rebuildAll();
    }
    const job = this.job;
    if (job === null) return;
    const s0 = this.now();
    const done = job.run(this.budgetMs, this.now);
    const ms = this.now() - s0;
    this.stats.restoreSlices++;
    if (ms > this.stats.restoreSliceMaxMs) this.stats.restoreSliceMaxMs = ms;
    if (done) this.publish();
  }

  dispose(): void {
    this.detach();
    this.target = null;
    this.job = null;
  }

  // ---- internals -------------------------------------------------------------------------------------------------

  private createLedger(): WorldDustLedger {
    // Built exactly like the worker's ledger (same game data, grid and plot attributes), plus ledger-zero events.
    return createRoomDustLedger(this.grid, loadGameData(), {
      initialLedgerSlots: HEADROOM_SLOTS,
      zeroEvents: true,
    });
  }

  private onDustState(s: SimDustState): void {
    this.stats.dustStates++;
    this.awaiting = false;
    const back = this.spare ?? this.createLedger();
    this.spare = back;
    back.reset();
    const payloads: Uint8Array[] = [];
    for (const c of s.chunks) payloads.push(new Uint8Array(c));
    // A second state during a restore replaces the first: strokes queued so far belong to the older state.
    this.job = new DustRestoreJob(back, payloads, s.bakeCheck);
    this.queueN = 0;
    this.restoreT0 = this.now();
    this.stats.restoreSlices = 0;
    this.stats.restoreSliceMaxMs = 0;
    // A state without chunks (a fresh moon) is published at once.
    if (payloads.length === 0) this.publish();
  }

  private publish(): void {
    const back = this.spare;
    const job = this.job;
    if (back === null || job === null) return;
    if (!job.done) job.run();
    this.job = null;
    back.clearZeroEvents();
    back.clearPolishedQueue();
    back.clearOpenedQueue();
    back.clearDirtyPlots();
    back.reserve(back.ledgerCount + this.queueN + HEADROOM_SLOTS);
    const q = this.queue;
    for (let i = 0; i < this.queueN; i++) this.applyQueued(back, q, i * QW);
    this.queueN = 0;
    // Strokes applied before publishing are in every rebuild snapshot; their events are covered by the rebuild.
    back.clearZeroEvents();
    back.clearPolishedQueue();
    back.clearOpenedQueue();
    back.clearDirtyPlots();
    this.spare = this.front;
    this.front = back;
    this.synced = true;
    this.growthsAtPublish = back.poolGrowths;
    this.stats.restores++;
    this.stats.restoreMs = this.now() - this.restoreT0;
    this.target?.rebuildAll();
  }

  private applyQueued(ledger: WorldDustLedger, q: Int32Array, o: number): void {
    const r = this.rec;
    r.anchor = q[o]! as PlotId;
    r.startUMm = q[o + 1]!;
    r.startVMm = q[o + 2]!;
    r.endUMm = q[o + 3]!;
    r.endVMm = q[o + 4]!;
    r.widthCm = q[o + 5]!;
    r.depth16 = q[o + 6]!;
    r.toolCode = q[o + 7]!;
    r.actorSlot = q[o + 8]!;
    r.tick = q[o + 9]! as Tick;
    r.inputSeq = q[o + 10]!;
    ledger.applyStroke(r, this.sink);
    this.stats.strokesApplied++;
  }

  private onFrame(f: RoomHostFrame): void {
    const source = this.source;
    if (source === null) return;
    const len = f.byteLength;
    if (len <= 0 || len > FRAME_MAX_BYTES) {
      f.release();
      return;
    }
    const src = source.frameBytes(f);
    const scratch = this.scratch;
    for (let i = 0; i < len; i++) scratch[i] = src[i]!;
    // Read inside the listener, then released (room-host contract; the host defers it until every listener ran).
    f.release();
    let view = this.views[len];
    if (view === undefined) {
      view = scratch.subarray(0, len);
      this.views[len] = view;
    }
    const fv = this.frame;
    const rc = this.reader.decode(view, fv, this.table, this.grid.count);
    if (rc !== FRAME_OK) {
      // Its strokes are lost to the view: start over from the worker's whole state.
      this.stats.decodeErrors++;
      this.table.reset();
      if (!this.awaiting) {
        this.awaiting = true;
        source.requestDustState();
      }
      return;
    }
    this.stats.framesDecoded++;
    this.selfPosition[0] = fv.self.px;
    this.selfPosition[1] = fv.self.py;
    this.selfPosition[2] = fv.self.pz;
    this.selfTick = fv.serverTick;
    // Frames before the requested state are part of it.
    if (this.awaiting || fv.strokes.chainCount === 0) return;
    const chains = fv.strokes;
    for (let c = 0; c < chains.chainCount; c++) expandStrokeChain(chains, c, 1, this.out, this.emitFn);
    if (this.job === null) this.forwardEvents();
  }

  private onRecord(r: StrokeRecordOut): void {
    if (this.job !== null) {
      this.enqueue(r);
      return;
    }
    if (!this.synced) return;
    const rec = this.rec;
    rec.anchor = r.anchor as PlotId;
    rec.startUMm = r.startUMm;
    rec.startVMm = r.startVMm;
    rec.endUMm = r.endUMm;
    rec.endVMm = r.endVMm;
    rec.widthCm = r.widthCm;
    rec.depth16 = r.depth16;
    rec.toolCode = r.toolCode;
    rec.actorSlot = r.actorSlot;
    rec.tick = r.tick as Tick;
    rec.inputSeq = r.inputSeq;
    const ledger = this.front;
    ledger.applyStroke(rec, this.sink);
    this.stats.strokesApplied++;
    this.stats.ledgerPoolGrowths = ledger.poolGrowths - this.growthsAtPublish;
    const target = this.target;
    if (target === null || this.needRebuild) return;
    if (this.forwardedSincePump >= LIVE_FORWARD_CAP) {
      // No rendered frame for a long time (hidden tab): stop queueing live strokes, rebuild on the next frame.
      this.needRebuild = true;
      this.stats.liveOverflows++;
      return;
    }
    this.forwardedSincePump++;
    this.stats.strokesForwarded++;
    target.onStroke(r.anchor, r.startUMm, r.startVMm, r.endUMm, r.endVMm, r.widthCm, r.depth16);
  }

  private enqueue(r: StrokeRecordOut): void {
    if ((this.queueN + 1) * QW > this.queue.length) {
      const g = new Int32Array(this.queue.length * 2);
      g.set(this.queue);
      this.queue = g;
    }
    const q = this.queue;
    const o = this.queueN++ * QW;
    q[o] = r.anchor;
    q[o + 1] = r.startUMm;
    q[o + 2] = r.startVMm;
    q[o + 3] = r.endUMm;
    q[o + 4] = r.endVMm;
    q[o + 5] = r.widthCm;
    q[o + 6] = r.depth16;
    q[o + 7] = r.toolCode;
    q[o + 8] = r.actorSlot;
    q[o + 9] = r.tick | 0;
    q[o + 10] = r.inputSeq;
    this.stats.strokesQueued++;
    if (this.queueN >= QUEUE_CAP) this.publish();
  }

  /** The front ledger's ledger-zero and Polished events go to the target; the other queues are emptied. */
  private forwardEvents(): void {
    const led = this.front;
    const target = this.needRebuild ? null : this.target;
    const nz = led.zeroEventCount;
    if (target !== null)
      for (let k = 0; k < nz; k++) target.onLedgerZero(led.zeroEventPlotAt(k), led.zeroEventTexelAt(k));
    led.clearZeroEvents();
    const np = led.polishedQueueCount;
    if (target !== null) for (let k = 0; k < np; k++) target.onPolished(led.polishedPlotAt(k));
    led.clearPolishedQueue();
    led.clearOpenedQueue();
    led.clearDirtyPlots();
  }
}
