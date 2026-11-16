// ShiftDust: dust sync of the multiplayer room from the authoritative WorldDustLedger (WDS section 5, M1-W4-T06).
//
// What it produces (all through the bytes channel, codecs of @moon-cleanup/protocol):
//   - DUST_SNAPSHOT (join, resync, reconnect): plot states of the whole moon, the remaining byte of every Opened plot
//     and the ledgers within JOIN_SNAPSHOT_RADIUS_M of the player (WDS 5.4 blocking part). Deflated (raw deflate,
//     zlib level 6) and sliced to <= 4 KB. Stroke logs are not included yet (cosmetic: tiles rebuild from ledgers).
//   - DUST_LEDGER (streamed part and DUST_REQUEST answers): one plot's ledger, deflated.
//   - DUST_CHECK detail answers to a chunk DUST_REQUEST, and the 5 s DUST_CHECK chunks summary (`chunkCheckBody`).
//
// ORDERING RULE (why everything is built and sent synchronously right after the FRAMEs of a frame tick): when a
// snapshot or ledger leaves at frame tick T, every stroke up to T has already been sent in a FRAME (the core's stroke
// buffer is cleared after the frames), and every later stroke travels in a later FRAME. One WebSocket keeps that order,
// so a client that applies messages in arrival order never double-applies or misses a stroke. The snapshot's
// `snapshotVersion` carries T (information for clients and tests).
//
// Not on the per-tick hot path except `noteDirty` (allocation-free). Snapshot building allocates (join-time event).
//
// Moon-wide snapshot cache (M1-W3-T04, WDS 5.1 "cached"): the plot-state bits and the Opened remaining bytes are the
// same for every seat, so they are built once per dust generation and reused by every snapshot until the next L0
// change (`noteDirty`, called by ShiftCore when the tick's dirty-plot list is non-empty; a non-empty dirty list at
// build time also counts as a change). Never stale: a generation change always rebuilds. The cache is built lazily,
// so the persistence restore (which runs before the first seat joins and clears the dirty list) is always included.

import { constants as zlibConstants, deflateRawSync } from "node:zlib";
import { DUST_MESSAGE_SLICE_MAX_BYTES, LEDGER_BYTES, LEDGER_MAX_CONTRIBUTIONS, PlotState } from "@moon-cleanup/shared";
import {
  DUST_CHECK_ID,
  DUST_CHECK_MAX_CHUNKS,
  DUST_CHECK_MAX_DETAIL_PLOTS,
  DUST_LEDGER_ID,
  DUST_SNAPSHOT_MAX_LEDGERS,
  DUST_SNAPSHOT_MAX_SLICES,
  countOpened,
  encodeDustCheck,
  encodeDustLedger,
  encodeSnapshotRaw,
  snapshotSliceCount,
  writeSnapshotSlice,
  type Deflate,
  type LedgerRawInput,
} from "@moon-cleanup/protocol";
import { mixPlotHash, type WorldDustLedger } from "@moon-cleanup/world";

/** Ledgers within this distance travel in the blocking join snapshot (WDS 5.2). */
export const JOIN_SNAPSHOT_RADIUS_M = 60;
/** Streamed ledgers per client (WDS 5.4: <= 8 KB/s shared with structures; no structures in the MVP). */
export const DUST_STREAM_BYTES_PER_S = 8 * 1024;
/** Leave hysteresis of the streamed-ledger set (WDS 5.2). */
export const DUST_STREAM_HYSTERESIS_M = 20;
/** Highest contribution actor slot the wire carries (decoder cap; the shift bucket 16 is not sent). */
const WIRE_ACTOR_SLOT_MAX = 15;
/** zlib level of the snapshot (WDS 5.1). */
const DEFLATE_LEVEL = 6;
/**
 * Hoisted wire codes: reading `PlotState.Opened` per plot in a 163,842-plot loop cost 33-53 ms per snapshot under
 * the vitest ESM transform (live-binding namespace read), the same trap `countOpened` documents in packages/protocol.
 */
const ST_OPENED: number = PlotState.Opened;

/** Node zlib raw deflate (the client inflates raw deflate). */
export const nodeDeflateRaw: Deflate = (raw) =>
  deflateRawSync(raw, { level: DEFLATE_LEVEL, strategy: zlibConstants.Z_DEFAULT_STRATEGY });

/**
 * Per-seat state of the streamed-ledger interest pass (`ShiftDust.scanInterest`). The pass is skipped while it cannot
 * change anything: same ledger allocations, same radius, same marks, and the seat's unit direction moved by less than
 * `slack` (the smallest distance of any considered ledger's dot to its in/out threshold; a dot changes by at most the
 * chord the unit direction moved). So a skip is exact, never an approximation. Whoever changes the seat's `dustSent`
 * marks outside the scan (streaming a queued ledger, a full queue, a resync) calls `invalidate()`.
 */
export class DustInterestScan {
  valid = false;
  /** `ledger.counters.ledgersAllocated` at the last scan (a new ledger can enter the radius). */
  gen = -1;
  cosIn = 0;
  cosOut = 0;
  /** Squared slack of the last scan (Infinity: nothing to watch). */
  slackSq = 0;
  /** Unit direction of the last scan. */
  readonly u = new Float64Array(3);

  /** Sets the in/out distances (metres of surface) of the dust radius. */
  setRadius(dust: ShiftDust, inM: number, outM: number): void {
    this.cosIn = dust.cosOf(inM);
    this.cosOut = dust.cosOf(outM);
    this.valid = false;
  }

  invalidate(): void {
    this.valid = false;
  }
}

export interface DustSnapshotBuild {
  /** Slice message bodies WITHOUT the type byte (as `client.sendBytes(DUST_SNAPSHOT_ID, body)` wants them). */
  readonly slices: Uint8Array[];
  readonly rawBytes: number;
  readonly deflatedBytes: number;
  readonly ledgers: number;
  readonly buildMs: number;
}

export class ShiftDust {
  readonly ledger: WorldDustLedger;
  readonly plotCount: number;
  private readonly moonRadiusM: number;
  private readonly deflate: Deflate;
  private readonly dir = { x: 0, y: 0, z: 0 };
  private readonly actors = new Uint8Array(LEDGER_MAX_CONTRIBUTIONS);
  private readonly units = new Uint32Array(LEDGER_MAX_CONTRIBUTIONS);
  /** One DUST_LEDGER message (id byte first); deflate of 1,047 B of mostly-uniform data stays far below this. */
  private readonly ledgerOut = new Uint8Array(4 + 2048);
  private readonly checkOut = new Uint8Array(16 + DUST_CHECK_MAX_DETAIL_PLOTS * 11);
  /** Scratch of `chunkCheckBody` (per chunk: XOR accumulator and touched mark; the touched chunk ids). */
  private readonly chunkAcc: Int32Array;
  private readonly chunkMark: Uint8Array;
  private readonly chunkTouched: Uint16Array;
  private readonly sliceOut = new Uint8Array(DUST_MESSAGE_SLICE_MAX_BYTES);
  readonly counters = {
    snapshots: 0,
    snapshotFailures: 0,
    ledgersSent: 0,
    ledgerEncodeFailures: 0,
    checksSent: 0,
    chunkChecksSent: 0,
    moonWideBuilds: 0,
    moonWideCacheHits: 0,
  };
  /** Dust generation: bumped by `noteDirty` on every tick with an L0 change. */
  private generation = 0;
  private cacheGeneration = -1;
  private cacheL0Version = -1;
  private cacheStates: Uint8Array | null = null;
  private cacheOpened: Uint8Array | null = null;

  constructor(ledger: WorldDustLedger, moonRadiusM: number, deflate: Deflate = nodeDeflateRaw) {
    this.ledger = ledger;
    this.plotCount = ledger.plotCount;
    this.moonRadiusM = moonRadiusM;
    this.deflate = deflate;
    this.chunkAcc = new Int32Array(ledger.chunkCount);
    this.chunkMark = new Uint8Array(ledger.chunkCount);
    this.chunkTouched = new Uint16Array(ledger.chunkCount);
  }

  /** Marks the moon-wide snapshot part stale (call once per tick that changed any plot's L0; allocation-free). */
  noteDirty(): void {
    this.generation++;
  }

  /**
   * Plot-state bits (2 per plot) and the remaining byte of every Opened plot in PlotId order, cached per dust
   * generation. The returned arrays are shared: callers must not modify them (encodeSnapshotRaw copies them).
   */
  moonWide(): { readonly states: Uint8Array; readonly opened: Uint8Array } {
    const l = this.ledger;
    if (l.dirtyPlotCount > 0) this.generation++;
    if (
      this.cacheGeneration === this.generation &&
      this.cacheL0Version === l.l0Version && // also moves on ledger reset(), which marks nothing dirty
      this.cacheStates !== null &&
      this.cacheOpened !== null
    ) {
      this.counters.moonWideCacheHits++;
      return { states: this.cacheStates, opened: this.cacheOpened };
    }
    const n = l.plotCount;
    const st = l.state;
    const frac = l.frac;
    const states = this.cacheStates ?? new Uint8Array(Math.ceil(n / 4));
    states.fill(0);
    let openedCount = 0;
    for (let p = 0; p < n; p++) {
      const s = st[p]! & 3;
      if (s === 0) continue;
      states[p >>> 2] = states[p >>> 2]! | (s << ((p & 3) * 2));
      if (s === ST_OPENED) openedCount++;
    }
    const opened = this.cacheOpened?.length === openedCount ? this.cacheOpened : new Uint8Array(openedCount);
    let k = 0;
    for (let p = 0; p < n && k < openedCount; p++) if ((st[p]! & 3) === ST_OPENED) opened[k++] = frac[p]!;
    this.cacheStates = states;
    this.cacheOpened = opened;
    this.cacheGeneration = this.generation;
    this.cacheL0Version = l.l0Version;
    this.counters.moonWideBuilds++;
    return { states, opened };
  }

  /** Cosine of the angle a surface distance `m` spans (for the centre-direction dot test). */
  cosOf(m: number): number {
    const a = m / this.moonRadiusM;
    return a >= Math.PI ? -1 : Math.cos(a);
  }

  /** Dot of the plot centre direction with the unit direction (ux, uy, uz). */
  plotDot(plot: number, ux: number, uy: number, uz: number): number {
    const d = this.ledger.grid.centerDirectionInto(plot as never, this.dir as never) as {
      x: number;
      y: number;
      z: number;
    };
    return d.x * ux + d.y * uy + d.z * uz;
  }

  /** Slot-indexed centre-direction cache of `scanInterest` (valid while `dirPlot[slot]` equals the slot's plot). */
  private dirPlot = new Int32Array(0);
  private dirVec = new Float64Array(0);
  /** Plots the last `scanInterest` wants queued (first `scanInterest()` return value entries). */
  hitPlots = new Int32Array(0);
  private readonly scanU = new Float64Array(3);

  /**
   * Streamed-ledger interest pass of one seat (WDS 5.2): writes the plots to queue (mark 0, dot >= cosIn) to `hitPlots`
   * and returns their count, and clears the mark (`sent[plot] = 0`) of every streamed ledger (mark 1) beyond cosOut.
   * Marks 2 (queued) are left alone. Returns 0 without scanning when `st` proves the result would be empty. Zero
   * allocation in steady state: typed-array scratch only, cached centre directions, no calls in the loop.
   * The caller enqueues the hits and calls `st.invalidate()` when it could not queue all of them.
   */
  scanInterest(
    st: DustInterestScan,
    a: { readonly px: number; readonly py: number; readonly pz: number },
    sent: Uint8Array,
  ): number {
    const l = this.ledger;
    const gen = l.counters.ledgersAllocated;
    const u = this.scanU;
    const len = Math.sqrt(a.px * a.px + a.py * a.py + a.pz * a.pz) || 1;
    const ux = a.px / len;
    const uy = a.py / len;
    const uz = a.pz / len;
    const su = st.u;
    if (st.valid && st.gen === gen) {
      const dx = ux - su[0]!;
      const dy = uy - su[1]!;
      const dz = uz - su[2]!;
      if (dx * dx + dy * dy + dz * dz < st.slackSq) return 0;
    }
    u[0] = ux;
    u[1] = uy;
    u[2] = uz;
    const slots = l.slotHigh;
    const cap = l.plotOfSlot.length;
    if (this.dirPlot.length < cap) {
      this.dirPlot = new Int32Array(cap).fill(-1);
      this.dirVec = new Float64Array(cap * 3);
      this.hitPlots = new Int32Array(cap);
    }
    const dirPlot = this.dirPlot;
    const dirVec = this.dirVec;
    const hits = this.hitPlots;
    const plotOfSlot = l.plotOfSlot;
    const cosIn = st.cosIn;
    const cosOut = st.cosOut;
    let n = 0;
    let gap = Infinity;
    for (let s = 0; s < slots; s++) {
      const plot = plotOfSlot[s]!;
      if (plot < 0) continue;
      const mark = sent[plot]!;
      if (mark === 2) continue;
      if (dirPlot[s] !== plot) {
        const d = this.ledger.grid.centerDirectionInto(plot as never, this.dir as never) as {
          x: number;
          y: number;
          z: number;
        };
        dirVec[3 * s] = d.x;
        dirVec[3 * s + 1] = d.y;
        dirVec[3 * s + 2] = d.z;
        dirPlot[s] = plot;
      }
      const dot = dirVec[3 * s]! * ux + dirVec[3 * s + 1]! * uy + dirVec[3 * s + 2]! * uz;
      if (mark === 0) {
        if (dot >= cosIn)
          hits[n++] = plot; // becomes 2: the streamed copy's later 1 is watched by the caller
        else if (cosIn - dot < gap) gap = cosIn - dot;
      } else if (dot < cosOut) {
        sent[plot] = 0;
        if (cosIn - dot < gap) gap = cosIn - dot; // now a mark 0 outside the in-limit
      } else if (dot - cosOut < gap) gap = dot - cosOut;
    }
    st.u.set(u);
    st.gen = gen;
    // A 1e-12 safety margin keeps float rounding of the dot products out of the exactness argument.
    const slack = gap - 1e-12;
    st.slackSq = slack > 0 ? slack * slack : 0;
    st.valid = true;
    return n;
  }

  /** LEDGER RAW input of `plot` (a fresh object; event-time). Null when the plot has no ledger. */
  ledgerInput(plot: number): LedgerRawInput | null {
    const l = this.ledger;
    const slot = l.slotOf[plot] ?? -1;
    if (slot < 0) return null;
    const n = l.topContributions(plot, this.actors, this.units);
    const contributions: { actorSlot: number; units: number }[] = [];
    for (let k = 0; k < n; k++) {
      const a = this.actors[k]!;
      if (a <= WIRE_ACTOR_SLOT_MAX) contributions.push({ actorSlot: a, units: this.units[k]! });
    }
    const texels = new Uint8Array(LEDGER_BYTES);
    l.copyTexels(plot, texels, 0);
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

  /**
   * SNAPSHOT RAW around the moon-centred position (px, py, pz): all plot states, Opened remaining bytes, ledgers within
   * `radiusM` (at most DUST_SNAPSHOT_MAX_LEDGERS, nearest kept). `sent` (optional, one byte per plot) is set to 1 for
   * every included ledger. Null when the encoder refuses the input.
   */
  buildSnapshotRaw(px: number, py: number, pz: number, radiusM: number, sent: Uint8Array | null): Uint8Array | null {
    const l = this.ledger;
    const n = l.plotCount;
    const { states, opened } = this.moonWide();
    const len = Math.sqrt(px * px + py * py + pz * pz) || 1;
    const ux = px / len;
    const uy = py / len;
    const uz = pz / len;
    const cosR = this.cosOf(radiusM);
    const near: { plot: number; dot: number }[] = [];
    for (let s = 0; s < l.slotHigh; s++) {
      const plot = l.plotOfSlot[s]!;
      if (plot < 0) continue;
      const dot = this.plotDot(plot, ux, uy, uz);
      if (dot >= cosR) near.push({ plot, dot });
    }
    near.sort((a, b) => b.dot - a.dot || a.plot - b.plot);
    if (near.length > DUST_SNAPSHOT_MAX_LEDGERS) near.length = DUST_SNAPSHOT_MAX_LEDGERS;
    near.sort((a, b) => a.plot - b.plot);
    const ledgers: { plotId: number; ledger: LedgerRawInput }[] = [];
    for (const e of near) {
      const input = this.ledgerInput(e.plot);
      if (input === null) continue;
      ledgers.push({ plotId: e.plot, ledger: input });
      if (sent !== null) sent[e.plot] = 1;
    }
    return encodeSnapshotRaw({ plotCount: n, plotStates: states, openedRemaining: opened, ledgers, logs: [] });
  }

  /** Builds, deflates and slices a snapshot. `version` is the server tick it reflects. Null on failure (counted). */
  buildSnapshot(
    px: number,
    py: number,
    pz: number,
    version: number,
    sent: Uint8Array | null,
    radiusM: number = JOIN_SNAPSHOT_RADIUS_M,
  ): DustSnapshotBuild | null {
    const start = performance.now();
    const raw = this.buildSnapshotRaw(px, py, pz, radiusM, sent);
    if (raw === null) {
      this.counters.snapshotFailures++;
      return null;
    }
    const deflated = this.deflate(raw);
    const count = snapshotSliceCount(deflated.length);
    if (count > DUST_SNAPSHOT_MAX_SLICES) {
      this.counters.snapshotFailures++;
      return null;
    }
    const slices: Uint8Array[] = [];
    for (let i = 0; i < count; i++) {
      const w = writeSnapshotSlice(deflated, i, version >>> 0, this.sliceOut);
      if (w === 0) {
        this.counters.snapshotFailures++;
        return null;
      }
      slices.push(this.sliceOut.slice(1, w));
    }
    this.counters.snapshots++;
    return {
      slices,
      rawBytes: raw.length,
      deflatedBytes: deflated.length,
      ledgers: countLedgers(raw, this.plotCount),
      buildMs: performance.now() - start,
    };
  }

  /**
   * DUST_LEDGER body of `plot` WITHOUT the type byte (a view into a reused buffer: send or copy at once), or null when
   * the plot has no ledger.
   */
  ledgerBody(plot: number): Uint8Array | null {
    const input = this.ledgerInput(plot);
    if (input === null) return null;
    const n = encodeDustLedger(plot, input, this.deflate, this.ledgerOut);
    if (n === 0 || this.ledgerOut[0] !== DUST_LEDGER_ID) {
      this.counters.ledgerEncodeFailures++;
      return null;
    }
    this.counters.ledgersSent++;
    return this.ledgerOut.subarray(1, n);
  }

  /**
   * DUST_CHECK chunks body (no type byte, WDS 5.1 "every 5 s"): per chunk that holds at least one Opened ledger the
   * seat's client has (`sent[plot] === 1`), the chunk id and the XOR of mix(plotId, ledger hash) over those ledgers,
   * ascending chunk id, at most DUST_CHECK_MAX_CHUNKS. Restricting to the ledgers the client was sent keeps the hash
   * comparable with the client's own (it only holds what it was sent); a ledger still queued or in a paced snapshot is
   * not `sent === 1`. One pass over the ledger slots, no per-plot allocation; the result is a view into a reused buffer
   * (send or copy at once). Null when nothing qualifies.
   */
  chunkCheckBody(sent: Uint8Array): Uint8Array | null {
    const l = this.ledger;
    const g = l.grid;
    const acc = this.chunkAcc;
    const touched = this.chunkTouched;
    let n = 0;
    for (let s = 0; s < l.slotHigh; s++) {
      const plot = l.plotOfSlot[s]!;
      if (plot < 0 || sent[plot] !== 1 || (l.state[plot]! & 3) !== ST_OPENED) continue;
      const chunk = g.chunkOf(plot as never) as number;
      if (this.chunkMark[chunk] === 0) {
        this.chunkMark[chunk] = 1;
        acc[chunk] = 0;
        touched[n++] = chunk;
      }
      acc[chunk] = acc[chunk]! ^ mixPlotHash(plot, l.ledgerHash(plot));
    }
    if (n === 0) return null;
    const ids = touched.subarray(0, n);
    ids.sort();
    const count = Math.min(n, DUST_CHECK_MAX_CHUNKS);
    const chunks: { chunkId: number; xorHash: number }[] = [];
    for (let i = 0; i < n; i++) {
      const chunk = ids[i]!;
      if (i < count) chunks.push({ chunkId: chunk, xorHash: acc[chunk]! >>> 0 });
      this.chunkMark[chunk] = 0;
    }
    const len = encodeDustCheck({ mode: "chunks", chunks }, this.checkOut);
    if (len === 0 || this.checkOut[0] !== DUST_CHECK_ID) return null;
    this.counters.chunkChecksSent++;
    return this.checkOut.subarray(1, len);
  }

  /**
   * DUST_CHECK detail body (no type byte) of one chunk: (plotId, version, hash) per Opened plot with a ledger. With
   * `sent` (the asking seat's marks) only `sent[plot] === 1` plots are listed, the same set the chunk summary hashed, so
   * a plot the client never held (out of its stream interest) is not reported as a mismatch to fetch.
   */
  checkDetailBody(chunkId: number, sent: Uint8Array | null = null): Uint8Array | null {
    const l = this.ledger;
    const g = l.grid;
    if (!(chunkId >= 0 && chunkId < l.chunkCount)) return null;
    const plots = chunkId === g.params.poleChunkId ? 2 : 256;
    const list: { plotId: never; ledgerVersion: number; hash: number }[] = [];
    for (let k = 0; k < plots && list.length < DUST_CHECK_MAX_DETAIL_PLOTS; k++) {
      const plot = g.plotAtChunkLocal(chunkId as never, k) as number;
      const slot = l.slotOf[plot] ?? -1;
      if ((l.state[plot]! & 3) !== ST_OPENED || slot < 0) continue;
      if (sent !== null && sent[plot] !== 1) continue;
      list.push({ plotId: plot as never, ledgerVersion: l.version[slot]!, hash: l.ledgerHash(plot) });
    }
    const n = encodeDustCheck({ mode: "detail", chunkId, plots: list }, this.checkOut);
    if (n === 0 || this.checkOut[0] !== DUST_CHECK_ID) return null;
    this.counters.checksSent++;
    return this.checkOut.subarray(1, n);
  }
}

/** Reads the ledger count of a SNAPSHOT RAW (statistics only). */
function countLedgers(raw: Uint8Array, plotCount: number): number {
  const stateBytes = Math.ceil(plotCount / 4);
  const opened = countOpened(raw.subarray(4, 4 + stateBytes), plotCount);
  const at = 4 + stateBytes + opened;
  return (raw[at] ?? 0) | ((raw[at + 1] ?? 0) << 8);
}
