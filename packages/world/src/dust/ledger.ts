// WorldDustLedger: the exact dust state of one room (M1-W3-T01; WDS sections 4.1 to 4.7, ADR-0026). It holds the
// per-plot state and L0 byte, the pooled 32 x 32 x 8-bit coarse ledgers, the stroke logs, and implements the integer
// rasterisation of WDS section 4.5 (absolute, coverage-weighted removal with a minimum per pass), the integer
// thresholds of section 4.2 and the Inspector's Stamp rule of section 4.7.
//
// It satisfies the sim's `DustLedgerPort` structurally (`isEmptyPlot`, `applyStroke(stroke, out)`), so a host passes
// it as `MoonRoomSim` option `ledger`. The same class is the server's authority, the Solo worker's authority and a
// client's authoritative copy.
//
// Determinism: only + - * / sqrt, comparisons, Math.floor / round and integer ops (WDS section 1). Every value that
// reaches a ledger byte is an integer held exactly in a double (below 2^53 for any segment up to 4 m and any width up
// to 10.23 m). The same stroke records give byte-identical ledgers in any order, on any engine.
// Hot path (`applyStroke`): no allocation. All scratch is preallocated typed arrays. Pools grow by doubling when a
// NEW plot is touched (never per stroke); `reserve` sizes them up front.
// Environment-agnostic: no DOM, no Node, no three.js, no Colyseus.

import {
  DustClass,
  FNV1A_32_OFFSET_BASIS,
  FNV1A_32_PRIME,
  LEDGER_BYTES,
  LEDGER_EDGE_TEXELS,
  LEDGER_FRAME_EDGE_MM,
  LEDGER_LATTICE_PITCH_DIVISOR,
  LEDGER_LATTICE_PITCH_MAX_MM,
  LEDGER_LATTICE_PITCH_MIN_MM,
  LEDGER_MAX_CONTRIBUTIONS,
  LEDGER_MAX_DUST_LEVEL,
  LEDGER_MIN_COVERAGE_MM2,
  LEDGER_MIN_REMOVAL_UNITS,
  LEDGER_TEXEL_AREA_MM2,
  LEDGER_TEXEL_SIZE_MM,
  LEDGER_UNITS_PER_LEVEL,
  NO_NEIGHBOR,
  OPENED_THRESHOLD_DIVISOR,
  PLOT_FRAME_HALF_MM,
  PLOT_NEIGHBOR_SLOTS,
  PlotState,
  POLISHED_THRESHOLD_DIVISOR,
  STROKE_ACTOR_SLOT_MAX,
  STROKE_DEPTH16_MAX,
  STROKE_NON_PLAYER_ACTOR_SLOT_MIN,
  STROKE_WIDTH_CM_MAX,
  type PlotAttributes,
  type PlotId,
  type StrokeRecord,
} from "@moon-cleanup/shared";
import type { IcoPlotGrid } from "../grid/plot-grid";
import { coverKey, coverTexelTarget, type DustCoverSpec } from "./initial-cover";
import { StrokeLogStore, STROKE_LOG_DEFAULT_MAX_BYTES } from "./stroke-log";

const EDGE = LEDGER_EDGE_TEXELS;
const BYTES = LEDGER_BYTES;
const TEXEL_MM = LEDGER_TEXEL_SIZE_MM;
const AREA = LEDGER_TEXEL_AREA_MM2;
const MIN_COVER = LEDGER_MIN_COVERAGE_MM2;
const MIN_REMOVAL = LEDGER_MIN_REMOVAL_UNITS;
const HALF_MM = PLOT_FRAME_HALF_MM;
const FRAME_MM = LEDGER_FRAME_EDGE_MM;
const NB = PLOT_NEIGHBOR_SLOTS;
const GRIMY = PlotState.Grimy;
const OPENED = PlotState.Opened;
const POLISHED = PlotState.Polished;
const EMPTY = PlotState.Empty;
const FNV_BASIS = FNV1A_32_OFFSET_BASIS | 0;
const FNV_PRIME = FNV1A_32_PRIME;

/** Bytes of one ownership mask (one bit per texel). */
const MASK_BYTES = BYTES / 8;
/** `reserve` also sizes the stroke log while at most this many rings would have to be copied (256 KB). */
const LOG_RESERVE_MAX_RINGS_IN_USE = 64;

/** Most plots one stroke can touch: the plot under its end point and that plot's 6 neighbours. */
export const STROKE_MAX_AFFECTED_PLOTS = NB + 1;

/**
 * Removal buckets per ledger: one per player slot (0 .. 15) plus one for "the shift" (every actor slot from 16 up:
 * vehicles' automatic intakes and robots, WDS section 4.4). Exact while the ledger lives; a save keeps the
 * LEDGER_MAX_CONTRIBUTIONS biggest.
 */
export const LEDGER_CONTRIBUTION_BUCKETS = STROKE_NON_PLAYER_ACTOR_SLOT_MIN + 1;

/** Actor slot under which the shift bucket is reported and saved (the first non-player slot, 16). */
export const LEDGER_SHIFT_ACTOR_SLOT = STROKE_NON_PLAYER_ACTOR_SLOT_MIN;

/** `creditedTo` of a Polished plot when no player removed at least half of it: the shift (WDS section 4.7 item 3). */
export const DUST_CREDIT_SHIFT = -1;

/**
 * No owned texel reaches farther than this from its plot centre: the largest plot corner radius of GP(m,0) at the
 * contract sizes is <= 12.3 m (grid test) plus half a texel diagonal (0.57 m), rounded up. Used only to skip lattice
 * work that cannot change a ledger; a unit test proves the skip changes no byte.
 */
export const LEDGER_OWNED_REACH_MM = 13_000;

/** Marker hashed for a Polished plot in `worldHash` (it has no ledger). "POLI". */
const POLISHED_MARK = 0x504f4c49;

/**
 * Units one stroke removes from a texel it covers by `coverageMm2` (WDS section 4.5 step 4): round(depth16 * C / A)
 * with halves rounding down, raised to the minimum removal once C >= A / 64. Independent of what the texel holds.
 */
export function ledgerRemovalUnits(depth16: number, coverageMm2: number): number {
  const c = coverageMm2 < AREA ? coverageMm2 : AREA;
  if (c <= 0) return 0;
  const r = Math.floor((depth16 * c + AREA / 2) / AREA);
  return r < MIN_REMOVAL && c >= MIN_COVER ? MIN_REMOVAL : r;
}

/** Opened once removed units >= this: ceil(initialUnits / 1000) (WDS section 4.2). */
export function openedThresholdUnits(initialUnits: number): number {
  return Math.ceil(initialUnits / OPENED_THRESHOLD_DIVISOR);
}

/** Polished once remaining units <= this: floor(initialUnits / 100) (WDS section 4.2, Inspector's Stamp). */
export function polishedThresholdUnits(initialUnits: number): number {
  return Math.floor(initialUnits / POLISHED_THRESHOLD_DIVISOR);
}

/** L0 byte: remaining dust as 0 .. 255 of the initial dust, rounded up (255 = untouched, 0 only when nothing is left). */
export function remainingFraction255(remainingUnits: number, initialUnits: number): number {
  if (initialUnits <= 0) return 0;
  return Math.floor((remainingUnits * 255 + initialUnits - 1) / initialUnits);
}

/**
 * Snapped lattice pitch per raw pitch (index = raw pitch in mm, 0 .. LEDGER_LATTICE_PITCH_MAX_MM): the largest
 * divisor of the texel edge (800 mm) that is not above the raw pitch. For the contract clamp 25 .. 100 mm the pitches
 * are 25, 32, 40, 50, 80 and 100 mm.
 *
 * Why (M1-W3-T01b lattice follow-up): the lattice is aligned to the plot frame, so a pitch that divides 800 mm puts
 * the same (800 / p)^2 points into every texel and a fully covered texel collects exactly A = 640,000 mm^2. A pitch
 * that does not divide it (56 mm at 0.45 m, 94 mm at 0.75 m) gave neighbouring texels 14 or 15 points a side: the
 * short ones collected 96 % of A and kept a residue that no full-coverage pass could remove. Snapping DOWN keeps at
 * least the width / 8 sampling of WDS section 4.5 step 3, so the coverage of a partly covered texel is never coarser
 * than the unsnapped rule gave.
 *
 * The table decides ledger bytes: changing it is a DUST_MODEL_VERSION change (introducing it is the 1 -> 2 change).
 */
const PITCH_SNAP = /* @__PURE__ */ buildPitchSnap();

function buildPitchSnap(): Uint8Array {
  const table = new Uint8Array(LEDGER_LATTICE_PITCH_MAX_MM + 1);
  for (let raw = 1; raw <= LEDGER_LATTICE_PITCH_MAX_MM; raw++) {
    let p = raw;
    while (LEDGER_TEXEL_SIZE_MM % p !== 0) p--; // ends at 1 at the latest
    table[raw] = p;
  }
  return table;
}

/**
 * Lattice pitch in mm for a stroke width in cm (section 4.5 step 3): clamp(width / 8, 25, 100) rounded to whole mm,
 * then snapped down to a divisor of the 800 mm texel edge (see PITCH_SNAP).
 */
export function latticePitchMm(widthCm: number): number {
  const p = Math.floor((widthCm * 10 + LEDGER_LATTICE_PITCH_DIVISOR / 2) / LEDGER_LATTICE_PITCH_DIVISOR);
  return PITCH_SNAP[
    p < LEDGER_LATTICE_PITCH_MIN_MM
      ? LEDGER_LATTICE_PITCH_MIN_MM
      : p > LEDGER_LATTICE_PITCH_MAX_MM
        ? LEDGER_LATTICE_PITCH_MAX_MM
        : p
  ]!;
}

/** FNV-1a 32 of (plotId u32 LE, hash u32 LE) as a signed int32 (shared/world/dust CHUNK_HASH_MIX). */
export function mixPlotHash(plot: number, hash: number): number {
  let h = FNV_BASIS;
  h = Math.imul(h ^ (plot & 0xff), FNV_PRIME);
  h = Math.imul(h ^ ((plot >>> 8) & 0xff), FNV_PRIME);
  h = Math.imul(h ^ ((plot >>> 16) & 0xff), FNV_PRIME);
  h = Math.imul(h ^ (plot >>> 24), FNV_PRIME);
  h = Math.imul(h ^ (hash & 0xff), FNV_PRIME);
  h = Math.imul(h ^ ((hash >>> 8) & 0xff), FNV_PRIME);
  h = Math.imul(h ^ ((hash >>> 16) & 0xff), FNV_PRIME);
  h = Math.imul(h ^ (hash >>> 24), FNV_PRIME);
  // Signed int32 (same bits): an unsigned value above 2^31 is boxed when it crosses a call that is not inlined.
  return h;
}

/** FNV-1a 32 of `n` bytes of `bytes` from `offset`, unsigned (LEDGER_HASH_ALGORITHM). */
export function fnv1a32(bytes: Uint8Array, offset = 0, n: number = bytes.length - offset): number {
  let h = FNV_BASIS;
  for (let i = 0; i < n; i++) h = Math.imul(h ^ bytes[offset + i]!, FNV_PRIME);
  return h >>> 0;
}

/**
 * What `applyStroke` writes (the sim's `StrokeApplyResult` has exactly these fields). The ledger overwrites every
 * field.
 */
export interface StrokeApplySink {
  /** Mass removed by the stroke, integer milligrams. */
  milligrams: number;
  /** Ledger units removed. */
  removedUnits: number;
  /** Share of the swept area that still carried dust, 0 .. 1 (presentation only). */
  grime01: number;
  /** Number of valid entries in `plotIds`. */
  plotCount: number;
  /** Plots that gave dust, largest contributor first. */
  readonly plotIds: Int32Array;
}

export interface WorldDustLedgerOptions {
  readonly grid: IcoPlotGrid;
  /** Dust class and area per plot. Read once per plot (construction and ledger allocation), never per stroke. */
  readonly attributes: PlotAttributes;
  /** Dust level per DustClass code (game-data terrain table: Highland 5, Mare 8, Crater Floor 13). Empty is 0. */
  readonly dustLevelByClass: readonly number[];
  /** Optional per-plot level (landing aprons and the like); a negative result means "use the class level". */
  readonly dustLevelOf?: (plotId: PlotId) => number;
  /**
   * Plots that start with a partial cover (Landing Aprons; recipe and revision in ./initial-cover). A listed plot takes
   * the spec's level (Empty plots stay Empty; the first spec that lists a plot wins). Read once, at construction.
   */
  readonly initialCover?: readonly DustCoverSpec[];
  /** kg per m^2 per dust level (game-data world.dustKgPerM2PerLevel, 0.062). */
  readonly kgPerM2PerLevel: number;
  /** Keep stroke logs (default true). A host without tile consumers (balance-sim) may switch them off. */
  readonly strokeLog?: boolean;
  /** RAM cap of the stroke logs in bytes (default 16 MB, WDS section 4.3). */
  readonly strokeLogMaxBytes?: number;
  /** Ledger slots allocated up front (default 64; the pool doubles when it runs out). */
  readonly initialLedgerSlots?: number;
  /** Record every texel that reaches 0 (rendering clients: ledger-zero clear, WDS section 7.3). Default false. */
  readonly zeroEvents?: boolean;
}

export class WorldDustLedger {
  readonly grid: IcoPlotGrid;
  readonly plotCount: number;
  readonly chunkCount: number;
  /** 2-bit plot state per plot (PlotState). Read-only for callers. */
  readonly state: Uint8Array;
  /** L0 remaining fraction 0 .. 255 per plot (255 untouched, 0 Polished or Empty). Read-only for callers. */
  readonly frac: Uint8Array;
  /** Ledger slot per plot, -1 = none. Read-only for callers. */
  readonly slotOf: Int32Array;
  /** Dust level per plot (0 = Empty). */
  readonly levelOf: Uint8Array;
  /** Partial cover per plot: 0 = every owned texel starts dusty, k = cover entry k - 1. Read-only for callers. */
  readonly coverOf: Uint16Array;
  /** Dusty-texel masks of the cover entries (one bit per texel, as `ownedMask`), and their dusty texel counts. */
  private readonly coverMasks: Uint8Array;
  private readonly coverCounts: Uint16Array;
  /** Stroke logs, or null when switched off. */
  readonly log: StrokeLogStore | null;

  // ---- ledger pool (structure of arrays, slot-indexed). Read-only for callers; the arrays are replaced on growth. ----
  texels = new Uint8Array(0);
  /** Ownership mask: bit (ix & 7) of byte slot * 128 + (ix >> 3) is set when texel ix is owned by the plot. */
  ownedMask = new Uint8Array(0);
  plotOfSlot = new Int32Array(0);
  remaining = new Uint32Array(0);
  initial = new Uint32Array(0);
  owned = new Uint16Array(0);
  version = new Uint32Array(0);
  mgPerUnit = new Uint32Array(0);
  /** Units removed per bucket (LEDGER_CONTRIBUTION_BUCKETS per slot). */
  contrib = new Uint32Array(0);
  private hashCache = new Int32Array(0);
  private hashDirty = new Uint8Array(0);
  private freeList = new Int32Array(0);
  private freeTop = 0;
  private cap = 0;
  private initialSlotCount = 0;
  /** Slots [0, slotHigh) have been handed out at least once. */
  slotHigh = 0;
  /** Ledgers currently allocated (touched, not Polished). */
  ledgerCount = 0;
  /** Times the ledger pool grew (0 in steady state; the no-allocation tests watch it). */
  poolGrowths = 0;

  // ---- totals ----
  /** Polished plots. */
  polishedTotal = 0;
  /** Empty plots (count as Polished for the Shine Index). */
  readonly emptyTotal: number;
  /** Ledgers per chunk and Polished plots per chunk (a chunk with neither is pristine and is not stored). */
  readonly touchedInChunk: Uint16Array;
  readonly polishedInChunk: Uint16Array;

  // ---- results of the last applyOp ----
  /** Plots whose frame the stroke's bounding box overlapped (not Polished / Empty). */
  outN = 0;
  readonly outPlots = new Int32Array(STROKE_MAX_AFFECTED_PLOTS);
  /** Units and milligrams removed per outPlots entry. */
  readonly outRemoved = new Int32Array(STROKE_MAX_AFFECTED_PLOTS);
  readonly outMg = new Int32Array(STROKE_MAX_AFFECTED_PLOTS);
  /** Plot under the stroke's end point. */
  outHome = 0;

  // ---- queues the host drains (counted lists; the host calls the clear methods) ----
  private dirtyN = 0;
  private dirtyList = new Int32Array(256);
  private readonly dirtyFlag: Uint8Array;
  private polishedN = 0;
  /** Pairs (plot, creditedTo). */
  private polishedQueue = new Int32Array(128);
  private openedN = 0;
  private openedQueue = new Int32Array(64);
  private zeroN = 0;
  /** Pairs (plot, texel byte index). */
  private zeroList: Int32Array | null;
  private readonly chunkDirty: Uint8Array;
  private chunkDirtyN = 0;

  /** Bumped on every L0 change (snapshot cache key). */
  l0Version = 0;
  /** Skip lattice work for plots whose owned texels the stroke cannot reach (tests switch it off to prove it). */
  pruneFar = true;
  /** Counters (plain numbers, information only). */
  readonly counters = { opsApplied: 0, opsRejected: 0, latticePoints: 0, ledgersAllocated: 0 };

  private readonly mgPerM2PerLevel: number;
  private readonly attributes: PlotAttributes;
  private readonly cov = new Int32Array(BYTES);
  /** f[0..2] start direction, f[3..5] end direction, f[6] grimy coverage mm^2, f[7] swept area mm^2. */
  private readonly f = new Float64Array(8);
  /** Ownership scratch: per candidate k (0 = the plot, 1 .. 6 = neighbours): A, B, C of dot = A + u B + v C. */
  private readonly own = new Float64Array(STROKE_MAX_AFFECTED_PLOTS * 3);
  private readonly ownId = new Int32Array(STROKE_MAX_AFFECTED_PLOTS);
  private ownN = 0;
  private ownPlot = -1;

  constructor(options: WorldDustLedgerOptions) {
    const grid = options.grid;
    this.grid = grid;
    this.plotCount = grid.count;
    this.chunkCount = grid.params.chunkCount;
    this.attributes = options.attributes;
    this.mgPerM2PerLevel = Math.round(options.kgPerM2PerLevel * 1e6);
    if (!(this.mgPerM2PerLevel > 0)) throw new RangeError("kgPerM2PerLevel must be positive");
    const n = grid.count;
    this.state = new Uint8Array(n);
    this.frac = new Uint8Array(n).fill(255);
    this.slotOf = new Int32Array(n).fill(-1);
    this.levelOf = new Uint8Array(n);
    this.dirtyFlag = new Uint8Array(n);
    this.chunkDirty = new Uint8Array(this.chunkCount);
    this.touchedInChunk = new Uint16Array(this.chunkCount);
    this.polishedInChunk = new Uint16Array(this.chunkCount);
    let empty = 0;
    for (let p = 0; p < n; p++) {
      const cls = options.attributes.classOf(p as PlotId);
      let level = cls === DustClass.Empty ? 0 : (options.dustLevelByClass[cls] ?? 0);
      if (level > 0 && options.dustLevelOf) {
        const custom = options.dustLevelOf(p as PlotId);
        if (custom >= 0) level = custom;
      }
      if (!(level >= 0 && level <= LEDGER_MAX_DUST_LEVEL && (level | 0) === level)) {
        throw new RangeError(`dust level ${level} of plot ${p} is not an integer in 0 .. ${LEDGER_MAX_DUST_LEVEL}`);
      }
      this.levelOf[p] = level;
      if (level === 0) {
        this.state[p] = EMPTY;
        this.frac[p] = 0;
        empty++;
      }
    }
    this.emptyTotal = empty;
    this.coverOf = new Uint16Array(n);
    const partial: number[] = [];
    const partialPermille: number[] = [];
    const listed = new Set<number>();
    for (const spec of options.initialCover ?? []) {
      const level = spec.level;
      const permille = spec.permille;
      if (!(level >= 1 && level <= LEDGER_MAX_DUST_LEVEL && (level | 0) === level)) {
        throw new RangeError(`cover level ${level} is not an integer in 1 .. ${LEDGER_MAX_DUST_LEVEL}`);
      }
      if (!(permille >= 1 && permille <= 1000 && (permille | 0) === permille)) {
        throw new RangeError(`cover share ${permille} is not an integer per mille in 1 .. 1000`);
      }
      for (const p of spec.plots) {
        if (!(p >= 0 && p < n && (p | 0) === p)) throw new RangeError(`cover plot ${p} is outside the grid`);
        if (listed.has(p) || this.levelOf[p] === 0) continue;
        listed.add(p);
        this.levelOf[p] = level;
        if (permille < 1000) {
          partial.push(p);
          partialPermille.push(permille);
        }
      }
    }
    if (partial.length > 0xffff) throw new RangeError("too many partial cover plots");
    this.coverMasks = new Uint8Array(partial.length * MASK_BYTES);
    this.coverCounts = new Uint16Array(partial.length);
    const keys = new Int32Array(BYTES);
    for (let k = 0; k < partial.length; k++) {
      const p = partial[k]!;
      this.prepOwnership(p);
      let owned = 0;
      for (let b = 0; b < EDGE; b++) for (let a = 0; a < EDGE; a++) if (this.ownedAt(a, b)) keys[owned++] = coverKey(p, a, b);
      const sorted = keys.subarray(0, owned).sort();
      const dusty = coverTexelTarget(owned, partialPermille[k]!);
      const base = k * MASK_BYTES;
      for (let j = owned - dusty; j < owned; j++) {
        const ix = sorted[j]! & (BYTES - 1);
        this.coverMasks[base + (ix >> 3)] = this.coverMasks[base + (ix >> 3)]! | (1 << (ix & 7));
      }
      this.coverCounts[k] = dusty;
      this.coverOf[p] = k + 1;
    }
    this.log =
      options.strokeLog === false
        ? null
        : new StrokeLogStore(n, options.strokeLogMaxBytes ?? STROKE_LOG_DEFAULT_MAX_BYTES);
    this.zeroList = options.zeroEvents ? new Int32Array(256) : null;
    this.initialSlotCount = Math.max(1, options.initialLedgerSlots ?? 64);
    this.reserve(this.initialSlotCount);
    this.poolGrowths = 0;
  }

  // ---- DustLedgerPort (packages/sim) ----------------------------------------------------------------------------

  /** True when the plot starts with dust on only part of its owned texels (a Landing Apron). */
  hasPartialCover(plot: number): boolean {
    return (this.coverOf[plot] ?? 0) !== 0;
  }

  /**
   * True when texel `ix` (b * 32 + a) of `plot` starts dusty if the plot owns it: always for a fully covered plot. Pure
   * lookup (no ownership test, no allocation); presentation uses it for plots that have no ledger yet.
   */
  isCoverTexel(plot: number, ix: number): boolean {
    const k = this.coverOf[plot] ?? 0;
    if (k === 0) return true;
    return ((this.coverMasks[(k - 1) * MASK_BYTES + (ix >> 3)]! >> (ix & 7)) & 1) === 1;
  }

  /** Texels a partial-cover plot starts with dust on, or -1 for a fully covered plot (every owned texel). */
  coverTexelCount(plot: number): number {
    const k = this.coverOf[plot] ?? 0;
    return k === 0 ? -1 : this.coverCounts[k - 1]!;
  }

  /** True when the plot has no dust (Empty / outpost pad, or an id outside the grid): the stroke is skipped. */
  isEmptyPlot(plotId: PlotId): boolean {
    const s = this.state[plotId];
    return s === undefined || s === EMPTY;
  }

  /** Applies one accepted stroke and writes what it removed into `out` (every field is overwritten). */
  applyStroke(stroke: StrokeRecord, out: StrokeApplySink): void {
    const total = this.applyOp(
      stroke.anchor,
      stroke.startUMm,
      stroke.startVMm,
      stroke.endUMm,
      stroke.endVMm,
      stroke.widthCm,
      stroke.depth16,
      stroke.toolCode,
      stroke.actorSlot,
    );
    // Order the affected plots by units removed, largest first (insertion sort over at most 7 entries; stable, so
    // ties keep the visit order: the plot under the end point, then its neighbours by slot).
    const n = this.outN;
    const plots = this.outPlots;
    const removed = this.outRemoved;
    const mgs = this.outMg;
    for (let i = 1; i < n; i++) {
      const p = plots[i]!;
      const r = removed[i]!;
      const m = mgs[i]!;
      let j = i - 1;
      while (j >= 0 && removed[j]! < r) {
        plots[j + 1] = plots[j]!;
        removed[j + 1] = removed[j]!;
        mgs[j + 1] = mgs[j]!;
        j--;
      }
      plots[j + 1] = p;
      removed[j + 1] = r;
      mgs[j + 1] = m;
    }
    let mg = 0;
    let count = 0;
    const ids = out.plotIds;
    const room = ids.length;
    for (let i = 0; i < n; i++) {
      if (removed[i]! <= 0) break;
      mg += mgs[i]!;
      if (count < room) ids[count++] = plots[i]!;
    }
    out.milligrams = mg;
    out.removedUnits = total;
    out.plotCount = count;
    const area = this.f[7]!;
    const share = area > 0 ? this.f[6]! / area : 0;
    out.grime01 = share > 1 ? 1 : share;
  }

  // ---- pool -----------------------------------------------------------------------------------------------------

  /**
   * Makes room for `slots` ledgers without further growth. Hosts call it before play to keep the tick flat; the
   * restore job calls it once before it installs anything. The stroke log gets as many rings (up to its RAM cap) while
   * that is cheap, which is while it holds next to nothing: growing a log in use copies 4 KB per ring in one call
   * (12 MB after a 3,000-plot restore), so a used log is left to grow on demand as before.
   */
  reserve(slots: number): void {
    if (slots > this.cap) this.growPool(slots);
    if (this.log !== null && this.log.ringsTouched <= LOG_RESERVE_MAX_RINGS_IN_USE) this.log.reserve(slots);
  }

  /** Ledger slots the host asked for at construction: its play headroom (the restore job keeps that many free). */
  get initialSlots(): number {
    return this.initialSlotCount;
  }

  /** Ledger slots the pool holds without growing. */
  get slotCapacity(): number {
    return this.cap;
  }

  private growPool(cap: number): void {
    // Only slots [0, slotHigh) have ever been handed out; everything behind them is rewritten in full when a slot is
    // taken. Copying just that prefix makes growing an empty or nearly empty pool cost the allocation alone (the
    // restore job reserves once, before it installs; measured in docs/agent-reports/M1-restore-slices).
    const used = this.slotHigh;
    const texels = new Uint8Array(cap * BYTES);
    texels.set(this.texels.subarray(0, used * BYTES));
    this.texels = texels;
    const mask = new Uint8Array(cap * MASK_BYTES);
    mask.set(this.ownedMask.subarray(0, used * MASK_BYTES));
    this.ownedMask = mask;
    const plots = new Int32Array(cap).fill(-1);
    plots.set(this.plotOfSlot);
    this.plotOfSlot = plots;
    const remaining = new Uint32Array(cap);
    remaining.set(this.remaining);
    this.remaining = remaining;
    const initial = new Uint32Array(cap);
    initial.set(this.initial);
    this.initial = initial;
    const owned = new Uint16Array(cap);
    owned.set(this.owned);
    this.owned = owned;
    const version = new Uint32Array(cap);
    version.set(this.version);
    this.version = version;
    const mg = new Uint32Array(cap);
    mg.set(this.mgPerUnit);
    this.mgPerUnit = mg;
    const contrib = new Uint32Array(cap * LEDGER_CONTRIBUTION_BUCKETS);
    contrib.set(this.contrib.subarray(0, used * LEDGER_CONTRIBUTION_BUCKETS));
    this.contrib = contrib;
    const hc = new Int32Array(cap);
    hc.set(this.hashCache);
    this.hashCache = hc;
    const hd = new Uint8Array(cap);
    hd.set(this.hashDirty);
    this.hashDirty = hd;
    const free = new Int32Array(cap);
    free.set(this.freeList);
    this.freeList = free;
    this.cap = cap;
    this.poolGrowths++;
  }

  private takeSlot(plot: number): number {
    let slot: number;
    if (this.freeTop > 0) slot = this.freeList[--this.freeTop]!;
    else {
      if (this.slotHigh === this.cap) this.growPool(this.cap * 2);
      slot = this.slotHigh++;
    }
    this.plotOfSlot[slot] = plot;
    this.slotOf[plot] = slot;
    this.version[slot] = 0;
    this.hashDirty[slot] = 1;
    const c = slot * LEDGER_CONTRIBUTION_BUCKETS;
    for (let k = 0; k < LEDGER_CONTRIBUTION_BUCKETS; k++) this.contrib[c + k] = 0;
    this.ledgerCount++;
    this.counters.ledgersAllocated++;
    const chunk = this.grid.chunkOf(plot as PlotId);
    this.touchedInChunk[chunk] = this.touchedInChunk[chunk]! + 1;
    return slot;
  }

  private freeSlot(plot: number): void {
    const slot = this.slotOf[plot]!;
    if (slot < 0) return;
    this.slotOf[plot] = -1;
    this.plotOfSlot[slot] = -1;
    this.freeList[this.freeTop++] = slot;
    this.ledgerCount--;
    const chunk = this.grid.chunkOf(plot as PlotId);
    this.touchedInChunk[chunk] = this.touchedInChunk[chunk]! - 1;
  }

  // ---- ownership (WDS section 4.3) --------------------------------------------------------------------------------

  /** Prepares the nearest-centre test of `plot` against its neighbours for texel centres of its frame. */
  private prepOwnership(plot: number): void {
    if (this.ownPlot === plot) return;
    const g = this.grid;
    const c = g.centers;
    const ea = g.east;
    const no = g.north;
    const o = plot * 3;
    const nx = c[o]!;
    const ny = c[o + 1]!;
    const nz = c[o + 2]!;
    const ex = ea[o]!;
    const ey = ea[o + 1]!;
    const ez = ea[o + 2]!;
    const tx = no[o]!;
    const ty = no[o + 1]!;
    const tz = no[o + 2]!;
    const own = this.own;
    own[0] = nx * nx + ny * ny + nz * nz;
    own[1] = ex * nx + ey * ny + ez * nz;
    own[2] = tx * nx + ty * ny + tz * nz;
    this.ownId[0] = plot;
    let n = 1;
    const nb = plot * NB;
    const table = g.neighborTable;
    for (let k = 0; k < NB; k++) {
      const q = table[nb + k]!;
      if (q === NO_NEIGHBOR) continue;
      const qo = q * 3;
      const qx = c[qo]!;
      const qy = c[qo + 1]!;
      const qz = c[qo + 2]!;
      own[n * 3] = nx * qx + ny * qy + nz * qz;
      own[n * 3 + 1] = ex * qx + ey * qy + ez * qz;
      own[n * 3 + 2] = tx * qx + ty * qy + tz * qz;
      this.ownId[n] = q;
      n++;
    }
    this.ownN = n;
    this.ownPlot = plot;
  }

  /** After prepOwnership: is ledger texel (a, b) owned by the prepared plot? Ties go to the lower PlotId. */
  private ownedAt(a: number, b: number): boolean {
    const k = 1 / (1000 * this.grid.params.radiusM);
    const u = (a * TEXEL_MM + (TEXEL_MM / 2 - HALF_MM)) * k;
    const v = (b * TEXEL_MM + (TEXEL_MM / 2 - HALF_MM)) * k;
    const own = this.own;
    const d0 = own[0]! + u * own[1]! + v * own[2]!;
    const self = this.ownId[0]!;
    for (let i = 1; i < this.ownN; i++) {
      const d = own[i * 3]! + u * own[i * 3 + 1]! + v * own[i * 3 + 2]!;
      if (d > d0 || (d === d0 && this.ownId[i]! < self)) return false;
    }
    return true;
  }

  /** Writes the ownership mask of `slot` for `plot` and returns the number of owned texels. */
  private buildMask(plot: number, slot: number): number {
    const mask = this.ownedMask;
    const base = slot * MASK_BYTES;
    for (let i = 0; i < MASK_BYTES; i++) mask[base + i] = 0;
    return this.maskRows(plot, slot, 0, EDGE);
  }

  /** Sets the mask bits of texel rows [rowFrom, rowTo) of `slot` (bits must be clear) and returns the owned texels. */
  private maskRows(plot: number, slot: number, rowFrom: number, rowTo: number): number {
    this.prepOwnership(plot);
    const mask = this.ownedMask;
    const base = slot * MASK_BYTES;
    let owned = 0;
    for (let b = rowFrom; b < rowTo; b++) {
      for (let a = 0; a < EDGE; a++) {
        if (!this.ownedAt(a, b)) continue;
        const ix = b * EDGE + a;
        mask[base + (ix >> 3)] = mask[base + (ix >> 3)]! | (1 << (ix & 7));
        owned++;
      }
    }
    return owned;
  }

  /**
   * floor(plot mass in mg / fullUnits) (WDS section 4.1), where fullUnits = 16 x level x owned texels: the units of the
   * plot fully covered. A partial-cover plot keeps that areal density, so its dusty texels are worth what they would be
   * on a fully covered plot and its total mass is its cover share of the plot mass.
   */
  private mgPerUnitOf(plot: number, fullUnits: number): number {
    if (fullUnits <= 0) return 0;
    const massMg = this.mgPerM2PerLevel * this.levelOf[plot]! * this.attributes.areaM2(plot as PlotId);
    const v = Math.floor(massMg / fullUnits);
    return v >= 0 && v <= 0xffff_ffff ? v : 0;
  }

  /**
   * Allocates the ledger of an untouched plot: owned texels start at 16 x level (on a partial-cover plot only its dusty
   * texels), the rest hold 0.
   */
  private allocLedger(plot: number): number {
    const slot = this.takeSlot(plot);
    const owned = this.buildMask(plot, slot);
    const u0 = LEDGER_UNITS_PER_LEVEL * this.levelOf[plot]!;
    const base = slot * BYTES;
    const mbase = slot * MASK_BYTES;
    const tex = this.texels;
    const mask = this.ownedMask;
    const k = this.coverOf[plot]!;
    let dusty = owned;
    if (k === 0) {
      for (let ix = 0; ix < BYTES; ix++) tex[base + ix] = (mask[mbase + (ix >> 3)]! >> (ix & 7)) & 1 ? u0 : 0;
    } else {
      const cover = this.coverMasks;
      const cbase = (k - 1) * MASK_BYTES;
      dusty = 0;
      for (let ix = 0; ix < BYTES; ix++) {
        const on = (mask[mbase + (ix >> 3)]! & cover[cbase + (ix >> 3)]! & (1 << (ix & 7))) !== 0;
        tex[base + ix] = on ? u0 : 0;
        if (on) dusty++;
      }
    }
    this.owned[slot] = owned;
    this.initial[slot] = u0 * dusty;
    this.remaining[slot] = u0 * dusty;
    this.mgPerUnit[slot] = this.mgPerUnitOf(plot, u0 * owned);
    return slot;
  }

  // ---- queues and dirty marks ----------------------------------------------------------------------------------

  private markChunkDirty(plot: number): void {
    const chunk = this.grid.chunkOf(plot as PlotId);
    if (this.chunkDirty[chunk] === 0) {
      this.chunkDirty[chunk] = 1;
      this.chunkDirtyN++;
    }
  }

  private markDirty(plot: number): void {
    this.l0Version++;
    if (this.dirtyFlag[plot] === 1) return;
    this.dirtyFlag[plot] = 1;
    if (this.dirtyN === this.dirtyList.length) {
      const g = new Int32Array(this.dirtyList.length * 2);
      g.set(this.dirtyList);
      this.dirtyList = g;
    }
    this.dirtyList[this.dirtyN++] = plot;
  }

  /** Plots whose state or L0 byte changed since `clearDirtyPlots` (feeds `dust.plots`). */
  get dirtyPlotCount(): number {
    return this.dirtyN;
  }
  dirtyPlotAt(k: number): number {
    return this.dirtyList[k]!;
  }
  clearDirtyPlots(): void {
    for (let i = 0; i < this.dirtyN; i++) this.dirtyFlag[this.dirtyList[i]!] = 0;
    this.dirtyN = 0;
  }

  /** Plots that became Polished since `clearPolishedQueue` (their ledger and log are already freed). */
  get polishedQueueCount(): number {
    return this.polishedN;
  }
  polishedPlotAt(k: number): number {
    return this.polishedQueue[k * 2]!;
  }
  /** Player slot credited with the Inspector's Stamp of entry k, or DUST_CREDIT_SHIFT. */
  polishedCreditAt(k: number): number {
    return this.polishedQueue[k * 2 + 1]!;
  }
  clearPolishedQueue(): void {
    this.polishedN = 0;
  }

  /** Plots that became Opened since `clearOpenedQueue` (a plot that goes straight to Polished is not listed). */
  get openedQueueCount(): number {
    return this.openedN;
  }
  openedPlotAt(k: number): number {
    return this.openedQueue[k]!;
  }
  clearOpenedQueue(): void {
    this.openedN = 0;
  }

  /** Drops queued stamp / Opened entries beyond the given counts (a restore must not replay events). */
  truncateEventQueues(polishedCount: number, openedCount: number): void {
    if (polishedCount >= 0 && polishedCount < this.polishedN) this.polishedN = polishedCount;
    if (openedCount >= 0 && openedCount < this.openedN) this.openedN = openedCount;
  }

  /** Ledger-zero events since `clearZeroEvents` (only with option `zeroEvents`). */
  get zeroEventCount(): number {
    return this.zeroN;
  }
  zeroEventPlotAt(k: number): number {
    return this.zeroList![k * 2]!;
  }
  zeroEventTexelAt(k: number): number {
    return this.zeroList![k * 2 + 1]!;
  }
  clearZeroEvents(): void {
    this.zeroN = 0;
  }

  /** Chunks changed since they were last saved (checkpoint only when dirty). */
  get dirtyChunkCount(): number {
    return this.chunkDirtyN;
  }
  isChunkDirty(chunk: number): boolean {
    return this.chunkDirty[chunk] === 1;
  }
  clearChunkDirty(chunk: number): void {
    if (this.chunkDirty[chunk] === 1) {
      this.chunkDirty[chunk] = 0;
      this.chunkDirtyN--;
    }
  }
  /** Marks a chunk for the next save (restore uses it when it had to repair stored data). */
  setChunkDirty(chunk: number): void {
    if (chunk >= 0 && chunk < this.chunkCount && this.chunkDirty[chunk] === 0) {
      this.chunkDirty[chunk] = 1;
      this.chunkDirtyN++;
    }
  }
  /** True when the chunk has no ledger and no Polished plot: nothing to store (WDS section 6). */
  isChunkPristine(chunk: number): boolean {
    return this.touchedInChunk[chunk] === 0 && this.polishedInChunk[chunk] === 0;
  }

  /** Polished + Empty plots (the Shine Index numerator, WDS section 4.2). */
  get shinePlots(): number {
    return this.polishedTotal + this.emptyTotal;
  }

  private noteZero(plot: number, ix: number): void {
    let z = this.zeroList!;
    if ((this.zeroN + 1) * 2 > z.length) {
      const g = new Int32Array(z.length * 2);
      g.set(z);
      this.zeroList = z = g;
    }
    z[this.zeroN * 2] = plot;
    z[this.zeroN * 2 + 1] = ix;
    this.zeroN++;
  }

  // ---- thresholds and the Inspector's Stamp (WDS sections 4.2 and 4.7) -------------------------------------------

  /**
   * Player slot that removed at least half of the units removed from `slot`, else DUST_CREDIT_SHIFT. Ties (two
   * players at exactly half) go to the lower slot. Robots and vehicle intakes are the shift.
   */
  private stampCredit(slot: number): number {
    const c = slot * LEDGER_CONTRIBUTION_BUCKETS;
    const con = this.contrib;
    let best = -1;
    let bestUnits = 0;
    for (let k = 0; k < STROKE_NON_PLAYER_ACTOR_SLOT_MIN; k++) {
      const u = con[c + k]!;
      if (u > bestUnits) {
        bestUnits = u;
        best = k;
      }
    }
    const removed = this.initial[slot]! - this.remaining[slot]!;
    return best >= 0 && bestUnits * 2 >= removed ? best : DUST_CREDIT_SHIFT;
  }

  /** Sets a plot Polished: frees its ledger and log, queues the stamp. `credit` is the credited slot or the shift. */
  private polish(plot: number, credit: number): void {
    if (this.state[plot]! >= POLISHED) return;
    this.freeSlot(plot);
    if (this.log !== null) this.log.drop(plot);
    this.state[plot] = POLISHED;
    this.frac[plot] = 0;
    this.polishedTotal++;
    const chunk = this.grid.chunkOf(plot as PlotId);
    this.polishedInChunk[chunk] = this.polishedInChunk[chunk]! + 1;
    if ((this.polishedN + 1) * 2 > this.polishedQueue.length) {
      const g = new Int32Array(this.polishedQueue.length * 2);
      g.set(this.polishedQueue);
      this.polishedQueue = g;
    }
    this.polishedQueue[this.polishedN * 2] = plot;
    this.polishedQueue[this.polishedN * 2 + 1] = credit;
    this.polishedN++;
    this.markDirty(plot);
    this.markChunkDirty(plot);
  }

  /** Re-derives state and L0 byte of a plot from its ledger totals (integer thresholds of WDS section 4.2). */
  private refreshL0(plot: number, slot: number): void {
    const init = this.initial[slot]!;
    const rem = this.remaining[slot]!;
    if (rem <= Math.floor(init / POLISHED_THRESHOLD_DIVISOR)) {
      this.polish(plot, this.stampCredit(slot));
      return;
    }
    let changed = false;
    if (this.state[plot] === GRIMY && init - rem >= Math.ceil(init / OPENED_THRESHOLD_DIVISOR)) {
      this.state[plot] = OPENED;
      changed = true;
      if (this.openedN === this.openedQueue.length) {
        const g = new Int32Array(this.openedQueue.length * 2);
        g.set(this.openedQueue);
        this.openedQueue = g;
      }
      this.openedQueue[this.openedN++] = plot;
    }
    const nf = Math.floor((rem * 255 + init - 1) / init);
    if (nf !== this.frac[plot]) {
      this.frac[plot] = nf;
      changed = true;
    }
    if (changed) this.markDirty(plot);
  }

  // ---- hashes (WDS section 5.5) ---------------------------------------------------------------------------------

  /** FNV-1a 32 of the 1,024 texel bytes of `slot` (cached until the ledger changes), as a signed int32. */
  private slotHash(slot: number): number {
    if (this.hashDirty[slot] === 0) return this.hashCache[slot]!;
    const tex = this.texels;
    const base = slot * BYTES;
    let h = FNV_BASIS;
    for (let i = 0; i < BYTES; i++) h = Math.imul(h ^ tex[base + i]!, FNV_PRIME);
    this.hashCache[slot] = h;
    this.hashDirty[slot] = 0;
    return h;
  }

  /** Ledger drift hash of `plot` (unsigned), or 0 when the plot has no ledger. */
  ledgerHash(plot: number): number {
    const slot = this.slotOf[plot] ?? -1;
    return slot < 0 ? 0 : this.slotHash(slot) >>> 0;
  }

  /** Chunk drift hash (unsigned): XOR over the chunk's Opened plots of mix(plotId, ledger hash) (CHUNK_HASH_MIX). */
  chunkHash(chunk: number): number {
    const g = this.grid;
    const plots = chunk === g.params.poleChunkId ? 2 : 256;
    let acc = 0;
    for (let k = 0; k < plots; k++) {
      const plot = g.plotAtChunkLocal(chunk, k);
      if (this.state[plot] !== OPENED) continue;
      const slot = this.slotOf[plot]!;
      if (slot >= 0) acc ^= mixPlotHash(plot, this.slotHash(slot));
    }
    return acc >>> 0;
  }

  /** XOR of mix(plot, hash) over every ledger and mix(plot, marker) over every Polished plot (tests, golden vectors). */
  worldHash(): number {
    let acc = 0;
    for (let s = 0; s < this.slotHigh; s++) {
      const plot = this.plotOfSlot[s]!;
      if (plot >= 0) acc ^= mixPlotHash(plot, this.slotHash(s));
    }
    if (this.polishedTotal > 0) {
      const st = this.state;
      for (let p = 0; p < this.plotCount; p++) if (st[p] === POLISHED) acc ^= mixPlotHash(p, POLISHED_MARK);
    }
    return acc >>> 0;
  }

  // ---- reading a ledger -----------------------------------------------------------------------------------------

  /** Removed units of one bucket (player slot 0 .. 15, or LEDGER_SHIFT_ACTOR_SLOT) of `plot`; 0 without a ledger. */
  contributionOf(plot: number, actorSlot: number): number {
    const slot = this.slotOf[plot] ?? -1;
    if (slot < 0) return 0;
    const bucket = actorSlot < STROKE_NON_PLAYER_ACTOR_SLOT_MIN ? actorSlot : STROKE_NON_PLAYER_ACTOR_SLOT_MIN;
    return this.contrib[slot * LEDGER_CONTRIBUTION_BUCKETS + bucket] ?? 0;
  }

  /**
   * Writes the LEDGER_MAX_CONTRIBUTIONS biggest removers of `plot` into `actors` / `units` (largest first, ties to the
   * lower slot; the shift is reported as LEDGER_SHIFT_ACTOR_SLOT) and returns how many were written.
   */
  topContributions(plot: number, actors: Uint8Array, units: Uint32Array): number {
    const slot = this.slotOf[plot] ?? -1;
    if (slot < 0) return 0;
    const c = slot * LEDGER_CONTRIBUTION_BUCKETS;
    const con = this.contrib;
    let n = 0;
    for (let pick = 0; pick < LEDGER_MAX_CONTRIBUTIONS; pick++) {
      let best = -1;
      let bestUnits = 0;
      for (let k = 0; k < LEDGER_CONTRIBUTION_BUCKETS; k++) {
        const u = con[c + k]!;
        if (u <= bestUnits) continue;
        let taken = false;
        for (let j = 0; j < n; j++) if (actors[j] === k) taken = true;
        if (taken) continue;
        best = k;
        bestUnits = u;
      }
      if (best < 0) break;
      actors[n] = best;
      units[n] = bestUnits;
      n++;
    }
    return n;
  }

  // ---- installing state (save restore, server snapshots) ----------------------------------------------------------

  /**
   * Returns one plot to its starting state (Grimy and untouched, or Empty): frees its ledger and log. Marks nothing
   * dirty and queues nothing; a restore calls it before it installs stored data.
   */
  resetPlot(plot: number): void {
    if (!(plot >= 0 && plot < this.plotCount)) return;
    this.freeSlot(plot);
    if (this.log !== null) this.log.drop(plot);
    if (this.state[plot] === POLISHED) {
      this.polishedTotal--;
      const chunk = this.grid.chunkOf(plot as PlotId);
      this.polishedInChunk[chunk] = this.polishedInChunk[chunk]! - 1;
    }
    const empty = this.levelOf[plot] === 0;
    this.state[plot] = empty ? EMPTY : GRIMY;
    this.frac[plot] = empty ? 0 : 255;
  }

  /** Returns the whole ledger to its starting state and clears every queue and dirty mark. */
  reset(): void {
    for (let s = 0; s < this.slotHigh; s++) {
      const plot = this.plotOfSlot[s]!;
      if (plot >= 0) this.slotOf[plot] = -1;
      this.plotOfSlot[s] = -1;
    }
    this.slotHigh = 0;
    this.freeTop = 0;
    this.ledgerCount = 0;
    this.polishedTotal = 0;
    this.touchedInChunk.fill(0);
    this.polishedInChunk.fill(0);
    if (this.log !== null) this.log.clear();
    for (let p = 0; p < this.plotCount; p++) {
      const empty = this.levelOf[p] === 0;
      this.state[p] = empty ? EMPTY : GRIMY;
      this.frac[p] = empty ? 0 : 255;
    }
    this.dirtyFlag.fill(0);
    this.dirtyN = 0;
    this.polishedN = 0;
    this.openedN = 0;
    this.zeroN = 0;
    this.chunkDirty.fill(0);
    this.chunkDirtyN = 0;
    this.outN = 0;
    this.l0Version++;
  }

  /**
   * Marks a plot Polished from stored or received state (no ledger). Nothing is queued: the stamp was paid when the
   * plot was polished the first time. Returns false for Empty plots and ids outside the grid.
   */
  installPolished(plot: number): boolean {
    if (!(plot >= 0 && plot < this.plotCount) || this.state[plot] === EMPTY) return false;
    if (this.state[plot] === POLISHED) return true;
    const queued = this.polishedN;
    this.polish(plot, DUST_CREDIT_SHIFT);
    this.polishedN = queued;
    return true;
  }

  /**
   * Installs the 1,024 texel bytes of a ledger received from the authority or read from a save. The input is not
   * trusted: ownership, ownedTexels, initialUnits, remainingUnits, mgPerUnit and the hash are all recomputed here
   * (a non-owned texel is forced to 0, an owned texel is clamped to 16 x level). Returns the number of texels that
   * had to be repaired, or -1 when the plot cannot hold a ledger (Empty, Polished, outside the grid, short input).
   * Contributions start at 0 (`addContribution`); call `refreshPlot` when the plot is complete.
   */
  installLedger(plot: number, src: Uint8Array, srcOffset: number, version: number): number {
    if (!(plot >= 0 && plot < this.plotCount) || this.state[plot]! >= POLISHED) return -1;
    if (!(srcOffset >= 0 && srcOffset + BYTES <= src.length)) return -1;
    let slot = this.slotOf[plot]!;
    if (slot < 0) {
      slot = this.takeSlot(plot);
      this.owned[slot] = this.buildMask(plot, slot);
    } else {
      const c = slot * LEDGER_CONTRIBUTION_BUCKETS;
      for (let k = 0; k < LEDGER_CONTRIBUTION_BUCKETS; k++) this.contrib[c + k] = 0;
    }
    const u0 = LEDGER_UNITS_PER_LEVEL * this.levelOf[plot]!;
    const base = slot * BYTES;
    const mbase = slot * MASK_BYTES;
    const tex = this.texels;
    const mask = this.ownedMask;
    const k = this.coverOf[plot]!;
    const cover = this.coverMasks;
    const cbase = k === 0 ? 0 : (k - 1) * MASK_BYTES;
    let rem = 0;
    let repaired = 0;
    let dusty = 0;
    for (let ix = 0; ix < BYTES; ix++) {
      let u = src[srcOffset + ix]!;
      const bit = 1 << (ix & 7);
      // A texel that does not start dusty (not owned, or blank under a partial cover) can only hold 0.
      if ((mask[mbase + (ix >> 3)]! & bit) === 0 || (k !== 0 && (cover[cbase + (ix >> 3)]! & bit) === 0)) {
        if (u !== 0) repaired++;
        u = 0;
      } else {
        dusty++;
        if (u > u0) {
          u = u0;
          repaired++;
        }
      }
      tex[base + ix] = u;
      rem += u;
    }
    const initial = u0 * dusty;
    this.initial[slot] = initial;
    this.remaining[slot] = rem;
    this.version[slot] = version >>> 0;
    this.mgPerUnit[slot] = this.mgPerUnitOf(plot, u0 * this.owned[slot]!);
    this.hashDirty[slot] = 1;
    this.markChunkDirty(plot);
    return repaired;
  }

  /**
   * First step of installing a stored ledger in pieces (a restore that must stay inside a time budget; `installLedger`
   * alone does the same work in one call). Gives `plot` a ledger slot with an empty ownership mask and no dust.
   * Follow with `buildMaskRows` over every row exactly once, then `installLedger`. Returns false when the plot cannot
   * hold a ledger (Empty, Polished, outside the grid). Until `installLedger` ran the ledger holds no dust, so a stroke
   * that reaches it removes nothing; the plot must not be saved or refreshed in that state.
   */
  openLedger(plot: number): boolean {
    if (!(plot >= 0 && plot < this.plotCount) || this.state[plot]! >= POLISHED) return false;
    let slot = this.slotOf[plot]!;
    if (slot < 0) slot = this.takeSlot(plot);
    this.ownedMask.fill(0, slot * MASK_BYTES, (slot + 1) * MASK_BYTES);
    this.texels.fill(0, slot * BYTES, (slot + 1) * BYTES);
    this.owned[slot] = 0;
    this.initial[slot] = 0;
    this.remaining[slot] = 0;
    this.mgPerUnit[slot] = 0;
    this.hashDirty[slot] = 1;
    return true;
  }

  /**
   * Builds texel rows [rowFrom, rowTo) (0 .. 32) of the ownership mask of a ledger opened with `openLedger` and adds
   * their owned texels to the ledger's count. Every row must be built exactly once before `installLedger`.
   */
  buildMaskRows(plot: number, rowFrom: number, rowTo: number): void {
    const slot = this.slotOf[plot] ?? -1;
    if (slot < 0) return;
    const b0 = rowFrom > 0 ? rowFrom : 0;
    const b1 = rowTo < EDGE ? rowTo : EDGE;
    this.owned[slot] = this.owned[slot]! + this.maskRows(plot, slot, b0, b1);
  }

  /** Adds stored removal credit to a bucket of an installed ledger (clamped so the buckets never exceed the removed units). */
  addContribution(plot: number, actorSlot: number, units: number): void {
    const slot = this.slotOf[plot] ?? -1;
    if (slot < 0 || !(units > 0) || !(actorSlot >= 0 && actorSlot <= STROKE_ACTOR_SLOT_MAX)) return;
    const c = slot * LEDGER_CONTRIBUTION_BUCKETS;
    let sum = 0;
    for (let k = 0; k < LEDGER_CONTRIBUTION_BUCKETS; k++) sum += this.contrib[c + k]!;
    const room = this.initial[slot]! - this.remaining[slot]! - sum;
    const add = units < room ? units : room;
    if (add <= 0) return;
    const bucket = actorSlot < STROKE_NON_PLAYER_ACTOR_SLOT_MIN ? actorSlot : STROKE_NON_PLAYER_ACTOR_SLOT_MIN;
    this.contrib[c + bucket] = this.contrib[c + bucket]! + Math.floor(add);
  }

  /** Re-derives state and L0 byte of a plot after `installLedger` (recount of the thresholds, WDS section 4.2). */
  refreshPlot(plot: number): void {
    const slot = this.slotOf[plot] ?? -1;
    if (slot >= 0) this.refreshL0(plot, slot);
  }

  /** Copies the 1,024 texel bytes of `plot` into `out` at `offset`; false when the plot has no ledger. */
  copyTexels(plot: number, out: Uint8Array, offset: number): boolean {
    const slot = this.slotOf[plot] ?? -1;
    if (slot < 0) return false;
    const base = slot * BYTES;
    const tex = this.texels;
    for (let i = 0; i < BYTES; i++) out[offset + i] = tex[base + i]!;
    return true;
  }

  // ---- rasterisation (WDS section 4.5) ----------------------------------------------------------------------------

  /**
   * Applies one stroke to every affected plot: the plot under its end point and that plot's neighbours whose 25.6 m
   * frame overlaps the stroke's bounding box. The record is a flat-ended segment, or a disc of diameter `widthCm` when
   * start equals end, in the frame of `anchor`, endpoints in integer mm. Returns the total units removed; per-plot
   * results are in outN / outPlots / outRemoved / outMg, the plot under the end point in outHome. A record outside the
   * wire ranges is counted (`counters.opsRejected`) and changes nothing.
   */
  applyOp(
    anchor: number,
    sU: number,
    sV: number,
    eU: number,
    eV: number,
    widthCm: number,
    depth16: number,
    toolCode: number,
    actor: number,
  ): number {
    this.outN = 0;
    const f = this.f;
    f[6] = 0;
    f[7] = 0;
    if (
      !(anchor >= 0 && anchor < this.plotCount) ||
      (anchor | 0) !== anchor ||
      !(widthCm >= 1 && widthCm <= STROKE_WIDTH_CM_MAX) ||
      !(depth16 >= 0 && depth16 <= STROKE_DEPTH16_MAX) ||
      !(actor >= 0 && actor <= STROKE_ACTOR_SLOT_MAX) ||
      (sU | 0) !== sU ||
      (sV | 0) !== sV ||
      (eU | 0) !== eU ||
      (eV | 0) !== eV ||
      (widthCm | 0) !== widthCm ||
      (depth16 | 0) !== depth16 ||
      sU < -32_768 ||
      sU > 32_767 ||
      sV < -32_768 ||
      sV > 32_767 ||
      eU < -32_768 ||
      eU > 32_767 ||
      eV < -32_768 ||
      eV > 32_767
    ) {
      this.counters.opsRejected++;
      this.outHome = -1;
      return 0;
    }
    this.counters.opsApplied++;
    const g = this.grid;
    const c = g.centers;
    const ea = g.east;
    const no = g.north;
    const R = g.params.radiusM;
    const kIn = 1 / 1000 / R;

    // 1. Unit directions of both endpoints (inverse gnomonic projection in the anchor frame).
    let o = anchor * 3;
    {
      const a = sU * kIn;
      const b = sV * kIn;
      const x = c[o]! + a * ea[o]! + b * no[o]!;
      const y = c[o + 1]! + a * ea[o + 1]! + b * no[o + 1]!;
      const z = c[o + 2]! + a * ea[o + 2]! + b * no[o + 2]!;
      const l = Math.sqrt(x * x + y * y + z * z);
      f[0] = x / l;
      f[1] = y / l;
      f[2] = z / l;
    }
    {
      const a = eU * kIn;
      const b = eV * kIn;
      const x = c[o]! + a * ea[o]! + b * no[o]!;
      const y = c[o + 1]! + a * ea[o + 1]! + b * no[o + 1]!;
      const z = c[o + 2]! + a * ea[o + 2]! + b * no[o + 2]!;
      const l = Math.sqrt(x * x + y * y + z * z);
      f[3] = x / l;
      f[4] = y / l;
      f[5] = z / l;
    }
    const sx = f[0]!;
    const sy = f[1]!;
    const sz = f[2]!;
    const ex = f[3]!;
    const ey = f[4]!;
    const ez = f[5]!;

    // 2. Home plot = nearest centre to the end point: greedy walk over neighbours (ties to the lower id). Normally the
    //    anchor itself; a chain continuation may keep an older anchor (shared/world/stroke), so it is derived here.
    const nbr = g.neighborTable;
    let home = anchor;
    let best = ex * c[o]! + ey * c[o + 1]! + ez * c[o + 2]!;
    for (let step = 0; step < 64; step++) {
      let next = home;
      const nb = home * NB;
      for (let k = 0; k < NB; k++) {
        const q = nbr[nb + k]!;
        if (q < 0) continue;
        const qo = q * 3;
        const d = ex * c[qo]! + ey * c[qo + 1]! + ez * c[qo + 2]!;
        if (d > best || (d === best && q < next)) {
          best = d;
          next = q;
        }
      }
      if (next === home) break;
      home = next;
    }
    this.outHome = home;

    // 3. Lattice pitch (snapped to a divisor of the texel edge, see PITCH_SNAP) and half width (integer mm).
    const wMm = widthCm * 10;
    const hw = widthCm * 5;
    let p = (wMm + 4) >> 3;
    if (p < LEDGER_LATTICE_PITCH_MIN_MM) p = LEDGER_LATTICE_PITCH_MIN_MM;
    else if (p > LEDGER_LATTICE_PITCH_MAX_MM) p = LEDGER_LATTICE_PITCH_MAX_MM;
    p = PITCH_SNAP[p]!;
    const half = p >> 1;
    const p2 = p * p;
    const nLat = Math.floor((FRAME_MM - 1 - half) / p) + 1;
    const prune = this.pruneFar;
    const cov = this.cov;
    const kOut = R * 1000;
    const log = this.log;
    const zero = this.zeroList !== null;
    let total = 0;
    let grimy = 0;
    {
      // Swept area in the anchor frame (presentation share only): length x width, or the disc.
      const adx = eU - sU;
      const ady = eV - sV;
      const al2 = adx * adx + ady * ady;
      f[7] = al2 === 0 ? 0.7853981633974483 * wMm * wMm : Math.sqrt(al2) * wMm;
    }

    for (let ci = -1; ci < NB; ci++) {
      const q = ci < 0 ? home : nbr[home * NB + ci]!;
      if (q < 0) continue;
      if (this.state[q]! >= POLISHED) continue;

      // 4. Endpoints in the frame of q, rounded to mm (gnomonic projection, as PlotGrid.toPlotLocal).
      o = q * 3;
      const nx = c[o]!;
      const ny = c[o + 1]!;
      const nz = c[o + 2]!;
      const qex = ea[o]!;
      const qey = ea[o + 1]!;
      const qez = ea[o + 2]!;
      const qtx = no[o]!;
      const qty = no[o + 1]!;
      const qtz = no[o + 2]!;
      let dn = sx * nx + sy * ny + sz * nz;
      let gx = sx / dn - nx;
      let gy = sy / dn - ny;
      let gz = sz / dn - nz;
      const su = Math.round(kOut * (gx * qex + gy * qey + gz * qez));
      const sv = Math.round(kOut * (gx * qtx + gy * qty + gz * qtz));
      dn = ex * nx + ey * ny + ez * nz;
      gx = ex / dn - nx;
      gy = ey / dn - ny;
      gz = ez / dn - nz;
      const eu = Math.round(kOut * (gx * qex + gy * qey + gz * qez));
      const ev = Math.round(kOut * (gx * qtx + gy * qty + gz * qtz));

      // 5. Bounding box against the 25.6 m frame.
      const minU = (su < eu ? su : eu) - hw;
      const maxU = (su > eu ? su : eu) + hw;
      const minV = (sv < ev ? sv : ev) - hw;
      const maxV = (sv > ev ? sv : ev) + hw;
      if (maxU < -HALF_MM || minU >= HALF_MM || maxV < -HALF_MM || minV >= HALF_MM) continue;
      const n = this.outN++;
      this.outPlots[n] = q;
      this.outRemoved[n] = 0;
      this.outMg[n] = 0;

      // Owned texels lie within LEDGER_OWNED_REACH_MM of the plot centre: a stroke farther away than that cannot
      // change this ledger (it may still reach the tile gutter, so the plot stays in outPlots and in the log).
      const dx = eu - su;
      const dy = ev - sv;
      const len2 = dx * dx + dy * dy;
      let reachable = true;
      if (prune) {
        let tt = len2 === 0 ? 0 : -(su * dx + sv * dy) / len2;
        if (tt < 0) tt = 0;
        else if (tt > 1) tt = 1;
        const cx = su + tt * dx;
        const cy = sv + tt * dy;
        const reach = LEDGER_OWNED_REACH_MM + hw;
        if (cx * cx + cy * cy > reach * reach) reachable = false;
      }

      let slot = this.slotOf[q]!;
      if (reachable) {
        // 6. Lattice sampling: point i is at i * p + half - 12,800 mm (frame-aligned), each worth p^2 mm^2.
        let i0 = Math.ceil((minU + HALF_MM - half) / p);
        let i1 = Math.floor((maxU + HALF_MM - half) / p);
        let j0 = Math.ceil((minV + HALF_MM - half) / p);
        let j1 = Math.floor((maxV + HALF_MM - half) / p);
        if (i0 < 0) i0 = 0;
        if (j0 < 0) j0 = 0;
        if (i1 > nLat - 1) i1 = nLat - 1;
        if (j1 > nLat - 1) j1 = nLat - 1;
        if (i0 <= i1 && j0 <= j1) {
          const hw2 = hw * hw;
          const lim = hw2 * len2;
          const pdx = p * dx;
          const pdy = p * dy;
          const u0 = i0 * p + half; // offset from the frame corner (0 .. 25,599)
          const wx0 = u0 - HALF_MM - su;
          let inside = 0;
          for (let j = j0; j <= j1; j++) {
            const vOff = j * p + half;
            const wy = vOff - HALF_MM - sv;
            const row = ((vOff / TEXEL_MM) | 0) * EDGE;
            let uOff = u0;
            if (len2 === 0) {
              const wy2 = wy * wy;
              let wx = wx0;
              for (let i = i0; i <= i1; i++) {
                if (wx * wx + wy2 <= hw2) {
                  const ix = row + ((uOff / TEXEL_MM) | 0);
                  cov[ix] = cov[ix]! + p2;
                  inside++;
                }
                wx += p;
                uOff += p;
              }
            } else {
              let cross = wx0 * dy - wy * dx;
              let along = wx0 * dx + wy * dy;
              for (let i = i0; i <= i1; i++) {
                if (along >= 0 && along < len2 && cross * cross <= lim) {
                  const ix = row + ((uOff / TEXEL_MM) | 0);
                  cov[ix] = cov[ix]! + p2;
                  inside++;
                }
                cross += pdy;
                along += pdx;
                uOff += p;
              }
            }
          }
          this.counters.latticePoints += (i1 - i0 + 1) * (j1 - j0 + 1);
          if (inside > 0) {
            const a0 = (u0 / TEXEL_MM) | 0;
            const a1 = ((i1 * p + half) / TEXEL_MM) | 0;
            const b0 = ((j0 * p + half) / TEXEL_MM) | 0;
            const b1 = ((j1 * p + half) / TEXEL_MM) | 0;

            // 7. Untouched plot: allocate its ledger only if an owned texel would lose dust.
            if (slot < 0) {
              this.prepOwnership(q);
              const kc = this.coverOf[q]!;
              let need = false;
              for (let b = b0; b <= b1 && !need; b++) {
                for (let a = a0; a <= a1; a++) {
                  const cv = cov[b * EDGE + a]!;
                  if (cv === 0) continue;
                  const cc = cv < AREA ? cv : AREA;
                  if (
                    (cc >= MIN_COVER || depth16 * cc + AREA / 2 >= AREA) &&
                    (kc === 0 || this.isCoverTexel(q, b * EDGE + a)) &&
                    this.ownedAt(a, b)
                  ) {
                    need = true;
                    break;
                  }
                }
              }
              if (need) slot = this.allocLedger(q);
              else for (let b = b0; b <= b1; b++) for (let a = a0; a <= a1; a++) cov[b * EDGE + a] = 0;
            }

            if (slot >= 0) {
              // 8. State-independent removal per texel; non-owned texels hold 0, so they lose nothing.
              const tex = this.texels;
              const base = slot * BYTES;
              let removed = 0;
              for (let b = b0; b <= b1; b++) {
                for (let a = a0; a <= a1; a++) {
                  const ix = b * EDGE + a;
                  const cv = cov[ix]!;
                  if (cv === 0) continue;
                  cov[ix] = 0;
                  const u = tex[base + ix]!;
                  if (u === 0) continue;
                  const cc = cv < AREA ? cv : AREA;
                  grimy += cc;
                  let r = ((depth16 * cc + AREA / 2) / AREA) | 0;
                  if (r < MIN_REMOVAL && cc >= MIN_COVER) r = MIN_REMOVAL;
                  const nu = u > r ? u - r : 0;
                  tex[base + ix] = nu;
                  removed += u - nu;
                  if (nu === 0 && zero) this.noteZero(q, ix);
                }
              }
              if (removed > 0) {
                this.remaining[slot] = this.remaining[slot]! - removed;
                this.version[slot] = this.version[slot]! + 1;
                this.hashDirty[slot] = 1;
                const bucket = actor < STROKE_NON_PLAYER_ACTOR_SLOT_MIN ? actor : STROKE_NON_PLAYER_ACTOR_SLOT_MIN;
                const ci2 = slot * LEDGER_CONTRIBUTION_BUCKETS + bucket;
                this.contrib[ci2] = this.contrib[ci2]! + removed;
                this.outRemoved[n] = removed;
                this.outMg[n] = removed * this.mgPerUnit[slot]!;
                total += removed;
                this.markChunkDirty(q);
                this.refreshL0(q, slot);
              }
            }
          }
        }
      }

      // 9. Stroke log: every overlapped plot that still has a ledger keeps the record (tile rebuilds, WDS 7.4).
      if (log !== null && this.slotOf[q]! >= 0) {
        log.push(q, anchor, sU, sV, eU, eV, widthCm, depth16, toolCode, actor);
        this.markChunkDirty(q);
      }
    }
    f[6] = grimy;
    return total;
  }
}
