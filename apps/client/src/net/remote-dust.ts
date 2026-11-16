// Client dust mirror of an online room (M1-W4-T04, WDS section 5): keeps a local WorldDustLedger identical to the
// server's inside the dust radius, from the server's dust stream applied IN ARRIVAL ORDER (the server's ordering rule,
// apps/server/src/net/shift/shift-dust.ts):
//   DUST_SNAPSHOT (decoded by the protocol session)  -> installSnapshot: reset, Polished plots, ledgers within 60 m,
//                                                       L0 overlay (state / remaining byte) for plots without a ledger
//   FRAME dustStrokes                                -> the same integer `applyStroke` the server ran (WDS 5.5)
//   FRAME dustPlots (2 Hz, moon-wide)                -> L0 overlay; Polished latched into the ledger
//   DUST_LEDGER (streamed, or a DUST_REQUEST answer) -> installLedger (replaces the plot's ledger)
//   DUST_CHECK chunks (every 5 s)                    -> chunk hash compare; a mismatch queues a chunk DUST_REQUEST
//   DUST_CHECK detail (answer to that request)       -> hash compare; mismatching plots queue a DUST_REQUEST
// Strokes in frames that arrive before the snapshot are inside it, so they are skipped (`ready` false).
//
// SOLO FIRST: constructed only for an online room; solo never imports this file. `applyFrame` allocates nothing.
// The Opened / Polished queues are emptied after every change (the client pays no Stamp; `sim_events` carries the
// authoritative events). The dirty-plot list is left for the dust view to drain unless `clearDirty` is set.

import { DUST_REQUEST_MAX_PLOTS, PlotState, type DustCheckPayload, type PlotId } from "@moon-cleanup/shared";
import {
  DUST_CHECK_ID,
  DUST_LEDGER_ID,
  createStrokeRecordOut,
  decodeDustCheck,
  decodeDustLedger,
  encodeDustRequest,
  expandStrokeChain,
  type DecodedSnapshot,
  type DustPlotDeltaList,
  type FrameView,
  type Inflate,
  type StrokeChainBuffer,
  type StrokeRecordOut,
} from "@moon-cleanup/protocol";
import type { WorldDustLedger } from "@moon-cleanup/world";
import { inflateRaw } from "./inflate-raw";

// PlotState values hoisted out of the per-plot loops (a namespace property read per plot costs more than the loop body).
const ST_EMPTY = PlotState.Empty;
const ST_GRIMY = PlotState.Grimy;
const ST_OPENED = PlotState.Opened;
const ST_POLISHED = PlotState.Polished;
/** Bound of the chunk-check wants (a few chunks intersect a dust radius; the cap only stops a hostile stream). */
const WANTED_CHUNKS_MAX = 16;
/**
 * A wanted plot is requested at most this many times: the server may never answer (queue full, ledger freed without
 * Polishing), and an unanswered plot must not starve the chunk repair behind it. A later chunk check re-wants it.
 */
export const WANTED_PLOT_MAX_REQUESTS = 3;

export interface RemoteDustOptions {
  /** Ticks per frame (SIM_TICK_HZ / SNAPSHOT_HZ): stroke chain continuations advance by this. */
  readonly framesEvery: number;
  readonly inflate?: Inflate;
  /** Empty the ledger's dirty-plot list after every change (true when no dust view drains it). Default true. */
  readonly clearDirty?: boolean;
}

export interface RemoteDustStats {
  snapshots: number;
  strokes: number;
  strokesBeforeReady: number;
  ledgers: number;
  ledgersInvalid: number;
  ledgersRefused: number;
  deltas: number;
  checks: number;
  /** Plots a DUST_CHECK detail answer found missing or different. */
  checkMismatches: number;
  /** Chunks whose 5 s DUST_CHECK summary differed from the client's own chunk hash. */
  chunkMismatches: number;
}

export class RemoteDust {
  readonly ledger: WorldDustLedger;
  /** True once a snapshot is installed; frames before it are skipped. */
  ready = false;
  /** Server tick of the installed snapshot (its `snapshotVersion` when known). */
  snapshotTick = -1;
  /** Authoritative L0 for plots WITHOUT a client ledger (snapshot + dust.plots): 2-bit state and remaining byte. */
  readonly l0State: Uint8Array;
  readonly l0Frac: Uint8Array;
  readonly stats: RemoteDustStats = {
    snapshots: 0,
    strokes: 0,
    strokesBeforeReady: 0,
    ledgers: 0,
    ledgersInvalid: 0,
    ledgersRefused: 0,
    deltas: 0,
    checks: 0,
    checkMismatches: 0,
    chunkMismatches: 0,
  };
  private readonly framesEvery: number;
  private readonly inflate: Inflate;
  private readonly clearDirty: boolean;
  private readonly rec: StrokeRecordOut = createStrokeRecordOut();
  private readonly sink = { milligrams: 0, removedUnits: 0, grime01: 0, plotCount: 0, plotIds: new Int32Array(8) };
  private readonly emit = (r: StrokeRecordOut): void => {
    this.stats.strokes++;
    this.ledger.applyStroke(r as never, this.sink);
  };
  /** Plots whose ledger hash disagreed with a DUST_CHECK (deduplicated, bounded). */
  private readonly wanted: number[] = [];
  /** Parallel to `wanted`: how many DUST_REQUESTs already named that plot without its ledger arriving (F4 expiry). */
  private readonly wantedTries: number[] = [];
  /** Chunks whose DUST_CHECK summary disagreed, waiting for a chunk DUST_REQUEST / its detail answer (bounded). */
  private readonly wantedChunks: number[] = [];
  /** Per chunk in `wantedChunks` or awaiting its detail answer: [server xor hash, client chunk hash] at mismatch. */
  private readonly pendingChunk = new Map<number, [number, number]>();
  /** Chunks whose detail check found nothing to fetch: the (server, client) hash pair that was judged harmless. */
  private readonly benign = new Map<number, [number, number]>();

  constructor(ledger: WorldDustLedger, options: RemoteDustOptions) {
    this.ledger = ledger;
    this.framesEvery = Math.max(1, options.framesEvery | 0);
    this.inflate = options.inflate ?? inflateRaw;
    this.clearDirty = options.clearDirty ?? true;
    this.l0State = new Uint8Array(ledger.plotCount);
    this.l0Frac = new Uint8Array(ledger.plotCount);
    this.resetOverlay();
  }

  /** Plot state as the client knows it (its ledger when it has one, else the overlay). */
  stateOf(plot: number): number {
    const l = this.ledger;
    return (l.slotOf[plot] ?? -1) >= 0 || l.state[plot]! >= ST_POLISHED ? l.state[plot]! : this.l0State[plot]!;
  }

  /** Remaining fraction byte (255 untouched, 0 Polished / Empty) as the client knows it. */
  fracOf(plot: number): number {
    const l = this.ledger;
    return (l.slotOf[plot] ?? -1) >= 0 || l.state[plot]! >= ST_POLISHED ? l.frac[plot]! : this.l0Frac[plot]!;
  }

  /** Replaces the client dust with a decoded DUST_SNAPSHOT. `tick` is its snapshotVersion (server tick), if known. */
  installSnapshot(s: DecodedSnapshot, tick = -1): boolean {
    const l = this.ledger;
    if (s.plotCount !== l.plotCount) return false;
    l.reset();
    this.resetOverlay();
    let opened = 0;
    for (let p = 0; p < s.plotCount; p++) {
      const st = (s.plotStates[p >>> 2]! >>> ((p & 3) * 2)) & 3;
      if (st === ST_POLISHED) l.installPolished(p);
      else if (st === ST_OPENED) {
        this.l0State[p] = ST_OPENED;
        this.l0Frac[p] = s.openedRemaining[opened++] ?? 255;
      }
    }
    for (const e of s.ledgers) this.install(e.plotId, e.texels, e.header.version, e.header.contributions);
    this.wanted.length = 0;
    this.wantedTries.length = 0;
    this.wantedChunks.length = 0;
    this.pendingChunk.clear();
    this.benign.clear();
    this.snapshotTick = tick;
    this.ready = true;
    this.stats.snapshots++;
    this.drain();
    return true;
  }

  /** Applies a decoded FRAME's dust sections. Allocation-free. */
  applyFrame(view: FrameView): void {
    if (!this.ready) {
      this.stats.strokesBeforeReady += view.strokes.chainCount;
      return;
    }
    if (view.strokes.chainCount > 0) this.applyStrokes(view.strokes);
    if (view.dustPlots.count > 0) this.applyDeltas(view.dustPlots);
    this.drain();
  }

  applyStrokes(buf: StrokeChainBuffer): void {
    for (let i = 0; i < buf.chainCount; i++) expandStrokeChain(buf, i, this.framesEvery, this.rec, this.emit);
  }

  applyDeltas(list: DustPlotDeltaList): void {
    const l = this.ledger;
    for (let i = 0; i < list.count; i++) {
      this.stats.deltas++;
      const p = list.plotId[i]!;
      const st = list.state[i]!;
      if (st === ST_POLISHED) {
        if (l.state[p] !== ST_POLISHED) l.installPolished(p);
        // The server answers nothing for a requested plot that became Polished: stop re-requesting it.
        if (this.wanted.length > 0) this.removeWanted(p);
        continue;
      }
      if ((l.slotOf[p] ?? -1) >= 0) continue; // the client's ledger is authoritative for its own plot
      this.l0State[p] = st;
      this.l0Frac[p] = list.remainingFrac[i]!;
    }
  }

  /**
   * A dust bytes message the session did not consume (id byte first): DUST_LEDGER or DUST_CHECK. Returns false for
   * anything else or an invalid message (counted). Event-time; allocates.
   */
  applyBytes(message: Uint8Array): boolean {
    const id = message[0];
    if (id === DUST_LEDGER_ID) {
      const d = decodeDustLedger(message, this.inflate, this.ledger.plotCount);
      if (d === null) {
        this.stats.ledgersInvalid++;
        return false;
      }
      if (!this.ready) return true; // the snapshot that follows the resync carries it
      this.install(d.plotId, d.texels, d.header.version, d.header.contributions);
      this.removeWanted(d.plotId);
      this.drain();
      return true;
    }
    if (id === DUST_CHECK_ID) {
      const c = decodeDustCheck(message, this.ledger.plotCount);
      if (c === null) return false;
      this.check(c);
      return true;
    }
    return false;
  }

  /** Requests queued after a failed DUST_CHECK: plots (ledger wanted) plus chunks (detail check wanted). */
  get wantedCount(): number {
    return this.wanted.length + this.wantedChunks.length;
  }

  /**
   * Encodes the next DUST_REQUEST into `out` and returns its length, or 0 when nothing is wanted: <= 8 wanted plots
   * first (repair), else one wanted chunk (its detail check names the mismatching plots). The caller sends at most one
   * per 2 s (RATE_LIMITS.dustRequest); plots stay wanted until their ledger arrives, a chunk until its detail answer.
   */
  nextRequest(out: Uint8Array): number {
    // Expire plots that were already requested WANTED_PLOT_MAX_REQUESTS times (in place, no allocation).
    for (let i = this.wanted.length - 1; i >= 0; i--) {
      if (this.wantedTries[i]! >= WANTED_PLOT_MAX_REQUESTS) {
        this.wanted.splice(i, 1);
        this.wantedTries.splice(i, 1);
      }
    }
    if (this.wanted.length > 0) {
      const n = Math.min(this.wanted.length, DUST_REQUEST_MAX_PLOTS);
      for (let i = 0; i < n; i++) this.wantedTries[i]!++;
      const ids = this.wanted.slice(0, n) as PlotId[];
      return encodeDustRequest({ kind: "plots", plotIds: ids }, out);
    }
    if (this.wantedChunks.length > 0) return encodeDustRequest({ kind: "chunk", chunkId: this.wantedChunks[0]! }, out);
    return 0;
  }

  private check(c: DustCheckPayload): void {
    this.stats.checks++;
    const l = this.ledger;
    if (c.mode === "chunks") {
      // 5 s summary (WDS 5.1): the server hashes the Opened ledgers it sent this client per chunk; compare with the
      // client's own Opened ledgers of that chunk. Not ready (no snapshot yet): nothing to compare.
      if (!this.ready) return;
      for (const e of c.chunks) {
        const mine = l.chunkHash(e.chunkId);
        const theirs = e.xorHash >>> 0;
        if (mine === theirs) {
          this.benign.delete(e.chunkId);
          continue;
        }
        const known = this.benign.get(e.chunkId);
        if (known !== undefined && known[0] === theirs && known[1] === mine) continue; // detail found nothing to fetch
        this.stats.chunkMismatches++;
        this.pendingChunk.set(e.chunkId, [theirs, mine]);
        if (!this.wantedChunks.includes(e.chunkId) && this.wantedChunks.length < WANTED_CHUNKS_MAX) {
          this.wantedChunks.push(e.chunkId);
        }
      }
      return;
    }
    let fetch = 0;
    for (const e of c.plots) {
      if ((l.slotOf[e.plotId] ?? -1) >= 0 && l.ledgerHash(e.plotId) === e.hash >>> 0) continue;
      this.stats.checkMismatches++;
      fetch++;
      if (!this.wanted.includes(e.plotId) && this.wanted.length < 64) {
        this.wanted.push(e.plotId);
        this.wantedTries.push(0);
      }
    }
    // The detail answer closes the chunk's want. When it names nothing to fetch, the chunk summary differed only because
    // the client holds ledgers the server no longer counts (left behind beyond the stream hysteresis): remember that
    // pair so the same summary does not trigger a detail request every 5 s.
    const ci = this.wantedChunks.indexOf(c.chunkId);
    if (ci >= 0) this.wantedChunks.splice(ci, 1);
    const pair = this.pendingChunk.get(c.chunkId);
    this.pendingChunk.delete(c.chunkId);
    if (fetch === 0 && pair !== undefined && this.benign.size < WANTED_CHUNKS_MAX * 4) this.benign.set(c.chunkId, pair);
  }

  private removeWanted(plot: number): void {
    const i = this.wanted.indexOf(plot);
    if (i >= 0) {
      this.wanted.splice(i, 1);
      this.wantedTries.splice(i, 1);
    }
  }

  private install(
    plot: number,
    texels: Uint8Array,
    version: number,
    contributions: readonly { readonly actorSlot: number; readonly units: number }[],
  ): void {
    const l = this.ledger;
    if (l.state[plot] === ST_POLISHED) l.resetPlot(plot); // drift repair: the server still holds a ledger
    if (l.installLedger(plot, texels, 0, version) < 0) {
      this.stats.ledgersRefused++;
      return;
    }
    for (const c of contributions) l.addContribution(plot, c.actorSlot, c.units);
    l.refreshPlot(plot);
    this.stats.ledgers++;
  }

  private resetOverlay(): void {
    const l = this.ledger;
    for (let p = 0; p < l.plotCount; p++) {
      const empty = l.levelOf[p] === 0;
      this.l0State[p] = empty ? ST_EMPTY : ST_GRIMY;
      this.l0Frac[p] = empty ? 0 : 255;
    }
  }

  private drain(): void {
    const l = this.ledger;
    l.clearOpenedQueue();
    l.clearPolishedQueue();
    if (this.clearDirty) l.clearDirtyPlots();
  }
}
