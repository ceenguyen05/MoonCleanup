// P2 prototype: one view of the dust state (the server's authoritative world, or one client's authoritative copy).
// Holds L0 (state + remaining fraction per plot) and the pooled 32 x 32 x 8-bit coarse ledgers, and implements the
// exact rasterisation of WDS section 4.5 (ADR-0026: absolute, coverage-weighted removal with a minimum per pass).
//
// Determinism: only + - * / sqrt, comparisons, Math.floor/round/min/max and integer ops (WDS section 1). The same
// stroke records give byte-identical ledgers in any order, on any engine.
// Hot path (applyStroke): no allocation. All scratch is preallocated typed arrays; arguments and results are small
// integers; results come back through `out*` fields. Pools grow by doubling (per touched plot, never per stroke).
// Environment-agnostic: no DOM, no Node, no three.js.

import { DUST_LEVEL_BY_CLASS, type PlotTables } from "./tables";

export const LEDGER_EDGE = 32;
export const LEDGER_BYTES = 1024;
export const TEXEL_MM = 800;
export const FRAME_HALF_MM = 12_800;
export const FRAME_EDGE_MM = 25_600;
export const TEXEL_AREA_MM2 = 640_000;
export const MIN_COVERAGE_MM2 = 10_000;
export const UNITS_PER_LEVEL = 16;
export const MAX_CONTRIB = 4;
/** mg per ledger unit: 0.062 kg per level per m^2 (0.310 / 5 = 0.496 / 8 = 0.806 / 13) x 0.64 m^2 / 16 units. */
export const MG_PER_UNIT = 2480;
/**
 * No owned texel reaches farther than this from its plot centre: the largest plot corner radius of GP(m,0) at the
 * contract sizes is <= 12.3 m (packages/world grid test) plus half a texel diagonal (0.57 m), rounded up.
 */
export const OWNED_REACH_MM = 13_000;

export const STATE_GRIMY = 0;
export const STATE_OPENED = 1;
export const STATE_POLISHED = 2;
export const STATE_EMPTY = 3;

const POLISHED_MARK = 0x504f4c49;
const FNV_BASIS = 0x811c9dc5;
const FNV_PRIME = 0x01000193;
const NO_ACTOR = 0xff;

/** mix(plotId, hash): FNV-1a 32 over (plotId u32 LE, hash u32 LE) (shared/world/dust.ts CHUNK_HASH_MIX). */
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
  return h >>> 0;
}

export class DustView {
  readonly t: PlotTables;
  /** 2-bit plot state per plot. */
  readonly state: Uint8Array;
  /** L0 remaining fraction 0 .. 255 (255 untouched, 0 Polished). */
  readonly frac: Uint8Array;
  /** Ledger slot per plot, -1 = none. */
  readonly slotOf: Int32Array;
  /** Interest membership (clients). null = every plot (server). Ops only touch member plots. */
  member: Uint8Array | null = null;

  // ---- ledger pool (structure of arrays, slot-indexed) ----
  cap = 0;
  texels = new Uint8Array(0);
  plotOfSlot = new Int32Array(0);
  remaining = new Uint32Array(0);
  initial = new Uint32Array(0);
  owned = new Uint16Array(0);
  version = new Uint32Array(0);
  private hashCache = new Uint32Array(0);
  private hashDirty = new Uint8Array(0);
  contribActor = new Uint8Array(0);
  contribUnits = new Uint32Array(0);
  /** Slots [0, slotHigh) have been handed out at least once. */
  slotHigh = 0;
  private freeList = new Int32Array(0);
  private freeTop = 0;
  ledgerCount = 0;

  // ---- results of the last applyStroke ----
  /** Plots whose frame the stroke's bounding box overlapped (member, not Polished/Empty). */
  outN = 0;
  readonly outPlots = new Int32Array(8);
  /** Units removed per outPlots entry. */
  readonly outRemoved = new Int32Array(8);
  /** Plot containing the stroke end point. */
  outHome = 0;

  // ---- drains (the owner resets the counters) ----
  /** Plots whose L0 byte or state changed since the owner last drained. */
  dirtyN = 0;
  dirtyList = new Int32Array(256);
  private readonly dirtyFlag: Uint8Array;
  /** Plots that became Polished since the owner last drained (their ledger is already freed). */
  polishedN = 0;
  polishedList = new Int32Array(64);
  /** Every Polished plot of this view (for hashing and snapshots). */
  polishedAllN = 0;
  polishedAll = new Int32Array(64);

  /** Skip the lattice work for plots whose owned texels the stroke cannot reach (tests switch it off to prove it). */
  pruneFar: boolean;
  /**
   * Ledger-zero events (WDS 7.3): when set, every texel that reaches 0 is appended as (plot, byte index) pairs.
   * Only a rendering client sets it; the owner resets zeroN after draining.
   */
  zeroList: Int32Array | null = null;
  zeroN = 0;
  /** Bumped on every L0 change (snapshot cache key). */
  l0Version = 0;
  /** Counters (plain numbers; INFO only). */
  latticePoints = 0;

  private readonly cov = new Int32Array(LEDGER_BYTES);
  private readonly f = new Float64Array(8);
  /** Ownership scratch: per candidate k (0 = the plot, 1 .. 6 = neighbours): A, B, C of dot = A + u B + v C; id. */
  private readonly own = new Float64Array(7 * 3);
  private readonly ownId = new Int32Array(7);
  private ownN = 0;
  private ownPlot = -1;

  constructor(tables: PlotTables) {
    this.t = tables;
    this.state = new Uint8Array(tables.count);
    this.frac = new Uint8Array(tables.count).fill(255);
    this.slotOf = new Int32Array(tables.count).fill(-1);
    this.dirtyFlag = new Uint8Array(tables.count);
    this.pruneFar = tables.hasNeighbors;
    for (let p = 0; p < tables.count; p++) {
      if ((DUST_LEVEL_BY_CLASS[tables.classOf[p]!] ?? 0) === 0) {
        this.state[p] = STATE_EMPTY;
        this.frac[p] = 0;
      }
    }
    this.grow(64);
  }

  // ---- pool ---------------------------------------------------------------------------------------------------

  private grow(cap: number): void {
    const g8 = (old: Uint8Array, n: number): Uint8Array<ArrayBuffer> => {
      const a = new Uint8Array(n);
      a.set(old);
      return a;
    };
    const g32 = (old: Uint32Array, n: number): Uint32Array<ArrayBuffer> => {
      const a = new Uint32Array(n);
      a.set(old);
      return a;
    };
    this.texels = g8(this.texels, cap * LEDGER_BYTES);
    const plots = new Int32Array(cap).fill(-1);
    plots.set(this.plotOfSlot);
    this.plotOfSlot = plots;
    this.remaining = g32(this.remaining, cap);
    this.initial = g32(this.initial, cap);
    const owned = new Uint16Array(cap);
    owned.set(this.owned);
    this.owned = owned;
    this.version = g32(this.version, cap);
    this.hashCache = g32(this.hashCache, cap);
    this.hashDirty = g8(this.hashDirty, cap);
    this.contribActor = g8(this.contribActor, cap * MAX_CONTRIB);
    this.contribUnits = g32(this.contribUnits, cap * MAX_CONTRIB);
    const free = new Int32Array(cap);
    free.set(this.freeList);
    this.freeList = free;
    this.cap = cap;
  }

  private takeSlot(plot: number): number {
    let slot: number;
    if (this.freeTop > 0) slot = this.freeList[--this.freeTop]!;
    else {
      if (this.slotHigh === this.cap) this.grow(this.cap * 2);
      slot = this.slotHigh++;
    }
    this.plotOfSlot[slot] = plot;
    this.slotOf[plot] = slot;
    this.version[slot] = 0;
    this.hashDirty[slot] = 1;
    const c = slot * MAX_CONTRIB;
    for (let k = 0; k < MAX_CONTRIB; k++) {
      this.contribActor[c + k] = NO_ACTOR;
      this.contribUnits[c + k] = 0;
    }
    this.ledgerCount++;
    return slot;
  }

  /** Frees the ledger of `plot` (Polished, or dropped from a client's interest set). */
  freeLedger(plot: number): void {
    const slot = this.slotOf[plot]!;
    if (slot < 0) return;
    this.slotOf[plot] = -1;
    this.plotOfSlot[slot] = -1;
    this.freeList[this.freeTop++] = slot;
    this.ledgerCount--;
  }

  // ---- ownership (WDS 4.3) ------------------------------------------------------------------------------------

  /** Prepares the nearest-centre test of `plot` against its neighbours for texel centres of its frame. */
  private prepOwnership(plot: number): void {
    if (this.ownPlot === plot) return;
    const t = this.t;
    const c = t.centers;
    const o = plot * 3;
    const nx = c[o]!;
    const ny = c[o + 1]!;
    const nz = c[o + 2]!;
    const ex = t.east[o]!;
    const ey = t.east[o + 1]!;
    const ez = t.east[o + 2]!;
    const tx = t.north[o]!;
    const ty = t.north[o + 1]!;
    const tz = t.north[o + 2]!;
    const own = this.own;
    own[0] = nx * nx + ny * ny + nz * nz;
    own[1] = ex * nx + ey * ny + ez * nz;
    own[2] = tx * nx + ty * ny + tz * nz;
    this.ownId[0] = plot;
    let n = 1;
    const nb = plot * 6;
    for (let k = 0; k < 6; k++) {
      const q = t.neighbors[nb + k]!;
      if (q < 0) continue;
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
    const k = 1 / (1000 * this.t.radiusM);
    const u = (a * TEXEL_MM + (TEXEL_MM / 2 - FRAME_HALF_MM)) * k;
    const v = (b * TEXEL_MM + (TEXEL_MM / 2 - FRAME_HALF_MM)) * k;
    const own = this.own;
    const d0 = own[0]! + u * own[1]! + v * own[2]!;
    const self = this.ownId[0]!;
    for (let i = 1; i < this.ownN; i++) {
      const d = own[i * 3]! + u * own[i * 3 + 1]! + v * own[i * 3 + 2]!;
      if (d > d0 || (d === d0 && this.ownId[i]! < self)) return false;
    }
    return true;
  }

  /** Allocates the ledger of an untouched plot: owned texels start at 16 x level, the rest hold 0. */
  private allocLedger(plot: number): number {
    const slot = this.takeSlot(plot);
    this.prepOwnership(plot);
    const u0 = UNITS_PER_LEVEL * (DUST_LEVEL_BY_CLASS[this.t.classOf[plot]!] ?? 0);
    const base = slot * LEDGER_BYTES;
    const tex = this.texels;
    let owned = 0;
    for (let b = 0; b < LEDGER_EDGE; b++) {
      for (let a = 0; a < LEDGER_EDGE; a++) {
        if (this.ownedAt(a, b)) {
          tex[base + b * LEDGER_EDGE + a] = u0;
          owned++;
        } else tex[base + b * LEDGER_EDGE + a] = 0;
      }
    }
    this.owned[slot] = owned;
    this.initial[slot] = u0 * owned;
    this.remaining[slot] = u0 * owned;
    return slot;
  }

  /** Installs a ledger received from the server or loaded from a save. `texels` is copied. */
  installLedger(
    plot: number,
    texels: Uint8Array,
    texOffset: number,
    version: number,
    initial: number,
    owned: number,
  ): number {
    let slot = this.slotOf[plot]!;
    if (slot < 0) slot = this.takeSlot(plot);
    const base = slot * LEDGER_BYTES;
    let rem = 0;
    for (let i = 0; i < LEDGER_BYTES; i++) {
      const u = texels[texOffset + i]!;
      this.texels[base + i] = u;
      rem += u;
    }
    this.owned[slot] = owned;
    this.initial[slot] = initial;
    this.remaining[slot] = rem;
    this.version[slot] = version;
    this.hashDirty[slot] = 1;
    this.refreshL0(plot, slot);
    return slot;
  }

  // ---- L0 -----------------------------------------------------------------------------------------------------

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

  /** Clears the dirty list (the owner has consumed it). */
  drainDirty(): void {
    for (let i = 0; i < this.dirtyN; i++) this.dirtyFlag[this.dirtyList[i]!] = 0;
    this.dirtyN = 0;
  }

  /** Marks a plot Polished (ledger freed). Also used by L0 deltas and snapshots. */
  setPolished(plot: number): void {
    if (this.state[plot] === STATE_POLISHED) return;
    this.freeLedger(plot);
    this.state[plot] = STATE_POLISHED;
    this.frac[plot] = 0;
    if (this.polishedAllN === this.polishedAll.length) {
      const g = new Int32Array(this.polishedAll.length * 2);
      g.set(this.polishedAll);
      this.polishedAll = g;
    }
    this.polishedAll[this.polishedAllN++] = plot;
    if (this.polishedN === this.polishedList.length) {
      const g = new Int32Array(this.polishedList.length * 2);
      g.set(this.polishedList);
      this.polishedList = g;
    }
    this.polishedList[this.polishedN++] = plot;
    this.markDirty(plot);
  }

  /** Re-derives state and L0 byte from the ledger totals (integer thresholds of WDS 4.2). */
  private refreshL0(plot: number, slot: number): void {
    const init = this.initial[slot]!;
    const rem = this.remaining[slot]!;
    if (rem <= Math.floor(init / 100)) {
      this.setPolished(plot);
      return;
    }
    let changed = false;
    if (this.state[plot] === STATE_GRIMY && init - rem >= Math.ceil(init / 1000)) {
      this.state[plot] = STATE_OPENED;
      changed = true;
    }
    const nf = Math.floor((rem * 255 + init - 1) / init);
    if (nf !== this.frac[plot]) {
      this.frac[plot] = nf;
      changed = true;
    }
    if (changed) this.markDirty(plot);
  }

  // ---- hashes -------------------------------------------------------------------------------------------------

  /** FNV-1a 32 of the 1,024 texel bytes of `slot` (cached until the ledger changes). */
  ledgerHash(slot: number): number {
    if (this.hashDirty[slot] === 0) return this.hashCache[slot]!;
    const tex = this.texels;
    const base = slot * LEDGER_BYTES;
    let h = FNV_BASIS;
    for (let i = 0; i < LEDGER_BYTES; i++) h = Math.imul(h ^ tex[base + i]!, FNV_PRIME);
    h >>>= 0;
    this.hashCache[slot] = h;
    this.hashDirty[slot] = 0;
    return h;
  }

  /** Hash contribution of one plot: its ledger, or the Polished marker, or 0. */
  plotHash(plot: number): number {
    const slot = this.slotOf[plot]!;
    if (slot >= 0) return mixPlotHash(plot, this.ledgerHash(slot));
    return this.state[plot] === STATE_POLISHED ? mixPlotHash(plot, POLISHED_MARK) : 0;
  }

  /** XOR of plotHash over every ledger and Polished plot, restricted to `where` (a membership array) when given. */
  hashWhere(where: Uint8Array | null): number {
    let acc = 0;
    for (let s = 0; s < this.slotHigh; s++) {
      const plot = this.plotOfSlot[s]!;
      if (plot < 0 || (where !== null && where[plot] === 0)) continue;
      acc ^= mixPlotHash(plot, this.ledgerHash(s));
    }
    for (let i = 0; i < this.polishedAllN; i++) {
      const plot = this.polishedAll[i]!;
      if (where !== null && where[plot] === 0) continue;
      acc ^= mixPlotHash(plot, POLISHED_MARK);
    }
    return acc >>> 0;
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

  /** Unit direction of the end point of the last applyStroke, into out[0 .. 2]. */
  copyEndDir(out: Float64Array): void {
    out[0] = this.f[3]!;
    out[1] = this.f[4]!;
    out[2] = this.f[5]!;
  }

  // ---- contributions ------------------------------------------------------------------------------------------

  private credit(slot: number, actor: number, units: number): void {
    const c = slot * MAX_CONTRIB;
    const act = this.contribActor;
    const un = this.contribUnits;
    let min = 0;
    for (let k = 0; k < MAX_CONTRIB; k++) {
      const a = act[c + k]!;
      if (a === actor) {
        un[c + k] = un[c + k]! + units;
        return;
      }
      if (a === NO_ACTOR) {
        act[c + k] = actor;
        un[c + k] = units;
        return;
      }
      if (un[c + k]! < un[c + min]!) min = k;
    }
    // Table full: keep the biggest removers (the smallest entry is replaced only by a bigger single contribution).
    if (units > un[c + min]!) {
      act[c + min] = actor;
      un[c + min] = units;
    }
  }

  // ---- rasterisation (WDS 4.5) --------------------------------------------------------------------------------

  /**
   * Applies one stroke record to every affected member plot. The record is a flat-ended segment (or a disc when
   * start == end) in the frame of `anchor`, endpoints in integer mm. Returns the total units removed; per-plot
   * results are in outN / outPlots / outRemoved, the plot under the end point in outHome.
   */
  applyStroke(
    anchor: number,
    sU: number,
    sV: number,
    eU: number,
    eV: number,
    widthCm: number,
    depth16: number,
    actor: number,
  ): number {
    const t = this.t;
    const c = t.centers;
    const ea = t.east;
    const no = t.north;
    const R = t.radiusM;
    const kIn = 1 / 1000 / R;
    const f = this.f;
    this.outN = 0;

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

    // 2. Home plot = nearest centre to the end point: greedy walk over neighbours (ties to the lower id).
    const nbr = t.neighbors;
    let home = anchor;
    let best = ex * c[o]! + ey * c[o + 1]! + ez * c[o + 2]!;
    for (let step = 0; step < 64; step++) {
      let next = home;
      const nb = home * 6;
      for (let k = 0; k < 6; k++) {
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

    // 3. Lattice pitch and half width (integer mm).
    const wMm = widthCm * 10;
    const hw = widthCm * 5;
    let p = (wMm + 4) >> 3;
    if (p < 25) p = 25;
    else if (p > 100) p = 100;
    const half = p >> 1;
    const p2 = p * p;
    const nLat = Math.floor((FRAME_EDGE_MM - 1 - half) / p) + 1;
    const member = this.member;
    const prune = this.pruneFar;
    const cov = this.cov;
    const tex = this.texels;
    const kOut = R * 1000;
    let total = 0;

    for (let ci = -1; ci < 6; ci++) {
      const q = ci < 0 ? home : nbr[home * 6 + ci]!;
      if (q < 0) continue;
      if (member !== null && member[q] === 0) continue;
      if (this.state[q]! >= STATE_POLISHED) continue;

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
      if (maxU < -FRAME_HALF_MM || minU >= FRAME_HALF_MM || maxV < -FRAME_HALF_MM || minV >= FRAME_HALF_MM) continue;
      const n = this.outN++;
      this.outPlots[n] = q;
      this.outRemoved[n] = 0;

      // Owned texels lie within OWNED_REACH_MM of the plot centre: a stroke farther away than that cannot change
      // this ledger (it may still reach the tile gutter, so the plot stays in outPlots).
      const dx = eu - su;
      const dy = ev - sv;
      const len2 = dx * dx + dy * dy;
      if (prune) {
        let tt = len2 === 0 ? 0 : -(su * dx + sv * dy) / len2;
        if (tt < 0) tt = 0;
        else if (tt > 1) tt = 1;
        const cx = su + tt * dx;
        const cy = sv + tt * dy;
        const reach = OWNED_REACH_MM + hw;
        if (cx * cx + cy * cy > reach * reach) continue;
      }

      // 6. Lattice sampling: point i is at i * p + half - 12,800 mm (frame-aligned), each worth p^2 mm^2.
      let i0 = Math.ceil((minU + FRAME_HALF_MM - half) / p);
      let i1 = Math.floor((maxU + FRAME_HALF_MM - half) / p);
      let j0 = Math.ceil((minV + FRAME_HALF_MM - half) / p);
      let j1 = Math.floor((maxV + FRAME_HALF_MM - half) / p);
      if (i0 < 0) i0 = 0;
      if (j0 < 0) j0 = 0;
      if (i1 > nLat - 1) i1 = nLat - 1;
      if (j1 > nLat - 1) j1 = nLat - 1;
      if (i0 > i1 || j0 > j1) continue;
      const hw2 = hw * hw;
      const lim = hw2 * len2;
      const pdx = p * dx;
      const pdy = p * dy;
      const u0 = i0 * p + half; // offset from the frame corner (0 .. 25,599)
      const wx0 = u0 - FRAME_HALF_MM - su;
      let inside = 0;
      for (let j = j0; j <= j1; j++) {
        const vOff = j * p + half;
        const wy = vOff - FRAME_HALF_MM - sv;
        const row = ((vOff / TEXEL_MM) | 0) * LEDGER_EDGE;
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
      this.latticePoints += (i1 - i0 + 1) * (j1 - j0 + 1);
      const a0 = (u0 / TEXEL_MM) | 0;
      const a1 = ((i1 * p + half) / TEXEL_MM) | 0;
      const b0 = ((j0 * p + half) / TEXEL_MM) | 0;
      const b1 = ((j1 * p + half) / TEXEL_MM) | 0;
      if (inside === 0) continue;

      // 7. Untouched plot: allocate its ledger only if an owned texel would lose dust.
      let slot = this.slotOf[q]!;
      if (slot < 0) {
        this.prepOwnership(q);
        let need = false;
        for (let b = b0; b <= b1 && !need; b++) {
          for (let a = a0; a <= a1; a++) {
            const cv = cov[b * LEDGER_EDGE + a]!;
            if (cv === 0) continue;
            const cc = cv < TEXEL_AREA_MM2 ? cv : TEXEL_AREA_MM2;
            if ((cc >= MIN_COVERAGE_MM2 || depth16 * cc + TEXEL_AREA_MM2 / 2 >= TEXEL_AREA_MM2) && this.ownedAt(a, b)) {
              need = true;
              break;
            }
          }
        }
        if (!need) {
          for (let b = b0; b <= b1; b++) for (let a = a0; a <= a1; a++) cov[b * LEDGER_EDGE + a] = 0;
          continue;
        }
        slot = this.allocLedger(q);
      }

      // 8. State-independent removal per texel; non-owned texels hold 0, so they lose nothing.
      const base = slot * LEDGER_BYTES;
      let removed = 0;
      for (let b = b0; b <= b1; b++) {
        for (let a = a0; a <= a1; a++) {
          const ix = b * LEDGER_EDGE + a;
          const cv = cov[ix]!;
          if (cv === 0) continue;
          cov[ix] = 0;
          const cc = cv < TEXEL_AREA_MM2 ? cv : TEXEL_AREA_MM2;
          let r = ((depth16 * cc + TEXEL_AREA_MM2 / 2) / TEXEL_AREA_MM2) | 0;
          if (r === 0 && cc >= MIN_COVERAGE_MM2) r = 1;
          const u = tex[base + ix]!;
          const nu = u > r ? u - r : 0;
          tex[base + ix] = nu;
          removed += u - nu;
          if (nu === 0 && u > 0 && this.zeroList !== null) this.noteZero(q, ix);
        }
      }
      if (removed > 0) {
        this.remaining[slot] = this.remaining[slot]! - removed;
        this.version[slot] = this.version[slot]! + 1;
        this.hashDirty[slot] = 1;
        this.credit(slot, actor, removed);
        this.outRemoved[n] = removed;
        total += removed;
        this.refreshL0(q, slot);
      }
    }
    return total;
  }
}
