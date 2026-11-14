// IcoPlotGrid: the production implementation of the shared `PlotGrid` contract (shared/world/plot-grid v1).
// WDS sections 2.3 to 2.7. Every per-call method is allocation-free except the documented first-touch caches of
// `center` / `centerDirection` / `frame` (bounded, direct-mapped, immutable objects).

import { CHUNK_EDGE_PLOTS, DIAMOND_COUNT, NO_NEIGHBOR, PLOT_NEIGHBOR_SLOTS } from "@moon-cleanup/shared";
import type {
  ChunkId,
  MoonPoint,
  MutableUnitDirection,
  PlotFrame,
  PlotGrid,
  PlotGridParams,
  PlotId,
  PlotIdView,
  PlotLocalMm,
  UnitDirection,
} from "@moon-cleanup/shared";
import { buildCentersAndLattice, buildFrames, buildNeighborSets, orderNeighbors, type PlotGridTables } from "./build";

/** Writable lattice address of a plot: diamond 0..9 and (i, j) in 0..m-1; poles report d = -1 (N) or -2 (S). */
export interface PlotLattice {
  d: number;
  i: number;
  j: number;
}

/**
 * Immutable vector returned by `center` / `centerDirection` / `frame`. A class (own hidden-class tree) on purpose:
 * freezing plain `{ x, y, z }` literals would make V8 generalise the double fields of every `{ x, y, z }` literal map
 * in the program to tagged, so each double store into callers' scratch direction objects would allocate.
 */
class FrozenVec3 {
  constructor(
    readonly x: number,
    readonly y: number,
    readonly z: number,
  ) {}
}

const CACHE_SIZE = 4096; // direct-mapped object caches (power of two)
const CACHE_MASK = CACHE_SIZE - 1;

/** Max greedy steps of the hinted fast path before it falls back to the full descent. */
const HINT_MAX_STEPS = 3;

export class IcoPlotGrid implements PlotGrid {
  readonly params: PlotGridParams;
  readonly count: number;
  /** Unit centres `[x, y, z]` per PlotId. Treat as read-only (shared by every room / system). */
  readonly centers: Float64Array;
  /** Local east axis per PlotId (`[x, y, z]`). Read-only. */
  readonly east: Float64Array;
  /** Local north axis per PlotId (`[x, y, z]`). Read-only. */
  readonly north: Float64Array;
  /** Ordered neighbour table, 6 slots per plot, NO_NEIGHBOR (-1) in slot 5 of a pentagon. Read-only. */
  readonly neighborTable: Int32Array;
  /** Canonical PlotId of every diamond lattice point (see PlotGridTables.lattice). Read-only. */
  readonly lattice: Int32Array;

  private readonly m: number;
  private readonly m2: number;
  private readonly logM: number;
  private readonly side: number;
  private readonly side2: number;
  private readonly chunksPerEdge: number;
  private readonly chunksPerDiamond: number;
  /** +1 or -1: sign that makes `orient * dot(p, a x b) >= 0` mean "p is left of a -> b in lattice coordinates". */
  private readonly orient: number;
  private readonly faceCentroid = new Float64Array(20 * 3);
  /** Per face 3 inward edge-plane normals (inside: dot >= 0 for all three). */
  private readonly faceEdge = new Float64Array(20 * 9);
  private readonly view6 = new Int32Array(6);
  /** Query point of plotAt (see the hot path note). */
  private readonly query = new Float64Array(3);
  private readonly view5 = new Int32Array(5);

  private readonly centerCacheIds = new Int32Array(CACHE_SIZE).fill(-1);
  private readonly centerCache: (MoonPoint | undefined)[] = new Array<MoonPoint | undefined>(CACHE_SIZE);
  private readonly dirCacheIds = new Int32Array(CACHE_SIZE).fill(-1);
  private readonly dirCache: (UnitDirection | undefined)[] = new Array<UnitDirection | undefined>(CACHE_SIZE);
  private readonly frameCacheIds = new Int32Array(CACHE_SIZE).fill(-1);
  private readonly frameCache: (PlotFrame | undefined)[] = new Array<PlotFrame | undefined>(CACHE_SIZE);

  /**
   * Builds the grid from raw tables. `orderedNeighbors` may be passed when it was produced by a previous build (for
   * example a hash-checked server binary); otherwise the neighbour table is built and ordered here.
   */
  constructor(tables: PlotGridTables, orderedNeighbors?: Int32Array) {
    const params = tables.params;
    this.params = params;
    this.count = params.plotCount;
    this.m = params.gridM;
    this.m2 = this.m * this.m;
    this.logM = Math.round(Math.log2(this.m));
    this.side = this.m + 1;
    this.side2 = this.side * this.side;
    this.chunksPerEdge = this.m / CHUNK_EDGE_PLOTS;
    this.chunksPerDiamond = this.chunksPerEdge * this.chunksPerEdge;
    this.centers = tables.centers;
    this.lattice = tables.lattice;
    const { east, north } = buildFrames(tables);
    this.east = east;
    this.north = north;
    if (orderedNeighbors) {
      if (orderedNeighbors.length !== this.count * PLOT_NEIGHBOR_SLOTS) throw new RangeError("neighbour table size");
      this.neighborTable = orderedNeighbors;
    } else {
      const nb = buildNeighborSets(tables);
      orderNeighbors(tables, nb, east, north);
      this.neighborTable = nb;
    }

    // Orientation: lattice triangle (0,0) -> (m,0) -> (0,m) of diamond 0 is counter-clockwise in lattice coordinates.
    const a = this.latticeId(0, 0, 0);
    const b = this.latticeId(0, this.m, 0);
    const c = this.latticeId(0, 0, this.m);
    this.orient = this.det(c, a, b) >= 0 ? 1 : -1;

    for (let f = 0; f < 20; f++) {
      const d = f >> 1;
      const upper = (f & 1) === 1;
      // Lattice-CCW corner order: lower (0,0),(m,0),(m,m); upper (0,0),(m,m),(0,m).
      const ids = upper
        ? [this.latticeId(d, 0, 0), this.latticeId(d, this.m, this.m), this.latticeId(d, 0, this.m)]
        : [this.latticeId(d, 0, 0), this.latticeId(d, this.m, 0), this.latticeId(d, this.m, this.m)];
      let sx = 0;
      let sy = 0;
      let sz = 0;
      for (const id of ids) {
        sx += this.cx(id);
        sy += this.cy(id);
        sz += this.cz(id);
      }
      const len = Math.sqrt(sx * sx + sy * sy + sz * sz);
      this.faceCentroid[f * 3] = sx / len;
      this.faceCentroid[f * 3 + 1] = sy / len;
      this.faceCentroid[f * 3 + 2] = sz / len;
      for (let k = 0; k < 3; k++) {
        const p = ids[k] ?? 0;
        const q = ids[(k + 1) % 3] ?? 0;
        // left of p -> q (lattice) <=> orient * dot(x, p x q) >= 0
        const px = this.cx(p);
        const py = this.cy(p);
        const pz = this.cz(p);
        const qx = this.cx(q);
        const qy = this.cy(q);
        const qz = this.cz(q);
        const o = f * 9 + k * 3;
        this.faceEdge[o] = this.orient * (py * qz - pz * qy);
        this.faceEdge[o + 1] = this.orient * (pz * qx - px * qz);
        this.faceEdge[o + 2] = this.orient * (px * qy - py * qx);
      }
    }
  }

  // ---- small accessors ------------------------------------------------------------------------------------------

  private cx(id: number): number {
    return this.centers[id * 3] ?? 0;
  }
  private cy(id: number): number {
    return this.centers[id * 3 + 1] ?? 0;
  }
  private cz(id: number): number {
    return this.centers[id * 3 + 2] ?? 0;
  }
  /** dot(centre(p), centre(a) x centre(b)). */
  private det(p: number, a: number, b: number): number {
    return this.tripleP(this.cx(p), this.cy(p), this.cz(p), a, b);
  }
  /** dot(x, centre(a) x centre(b)). */
  private tripleP(x: number, y: number, z: number, a: number, b: number): number {
    const c = this.centers;
    const ao = a * 3;
    const bo = b * 3;
    const ax = c[ao] ?? 0;
    const ay = c[ao + 1] ?? 0;
    const az = c[ao + 2] ?? 0;
    const bx = c[bo] ?? 0;
    const by = c[bo + 1] ?? 0;
    const bz = c[bo + 2] ?? 0;
    return x * (ay * bz - az * by) + y * (az * bx - ax * bz) + z * (ax * by - ay * bx);
  }
  private latticeId(d: number, i: number, j: number): number {
    return this.lattice[d * this.side2 + i * this.side + j] ?? -1;
  }

  private checkId(id: number): void {
    if (!(id >= 0 && id < this.count && (id | 0) === id)) throw new RangeError(`PlotId ${id} out of range`);
  }

  // ---- PlotGrid -------------------------------------------------------------------------------------------------

  plotAt(dir: UnitDirection, hint?: PlotId): PlotId {
    const q = this.query;
    q[0] = dir.x;
    q[1] = dir.y;
    q[2] = dir.z;
    if (hint !== undefined && hint >= 0 && hint < this.count && (hint | 0) === hint) {
      const r = this.walk(hint, HINT_MAX_STEPS);
      if (r >= 0) return r as PlotId;
    }
    return this.fullPath() as PlotId;
  }

  /** Full-path point -> plot for a unit vector given as numbers (WDS section 2.6 steps 2 to 4). */
  plotAtXYZ(x: number, y: number, z: number): PlotId {
    const q = this.query;
    q[0] = x;
    q[1] = y;
    q[2] = z;
    return this.fullPath() as PlotId;
  }

  // Hot path note: the query point travels through `this.query` (a Float64Array), never as double arguments, and the
  // helpers return only small integers. V8 boxes doubles passed to or returned from calls it does not inline, so this
  // keeps optimised code allocation-free; bench/world-bench.ts checks 0 bytes allocated per call.

  private fullPath(): number {
    const q = this.query;
    const x = q[0]!;
    const y = q[1]!;
    const z = q[2]!;
    const c = this.centers;
    const lat = this.lattice;
    // Step 2: face by largest dot with the face centroids, confirmed by the 3 edge planes.
    const fc = this.faceCentroid;
    let face = 0;
    let best = -Infinity;
    for (let f = 0; f < 20; f++) {
      const o = f * 3;
      const dd = fc[o]! * x + fc[o + 1]! * y + fc[o + 2]! * z;
      if (dd > best) {
        best = dd;
        face = f;
      }
    }
    if (!this.inFace(face)) {
      for (let f = 0; f < 20; f++) {
        if (this.inFace(f)) {
          face = f;
          break;
        }
      }
    }
    // Step 3: descend log2(m) levels; midpoints are looked up through the lattice table. Side tests are triple
    // products p . (a x b); "left of a -> b in lattice coordinates" is orient * p . (a x b) >= 0. The upper triangle
    // tests the reversed edges, i.e. the negated products (exact in IEEE arithmetic), hence the sign `sg`.
    const d = face >> 1;
    let upper = (face & 1) === 1;
    const base = d * this.side2;
    const side = this.side;
    const orient = this.orient;
    let i = 0;
    let j = 0;
    for (let s = this.m; s > 1; s >>= 1) {
      const h = s >> 1;
      // lower: mAB=(i+h,j) mBC=(i+s,j+h) mAC=(i+h,j+h); upper: mAB=(i,j+h) mBC=(i+h,j+s) mAC=(i+h,j+h)
      const ab = upper ? lat[base + i * side + j + h]! : lat[base + (i + h) * side + j]!;
      const bc = upper ? lat[base + (i + h) * side + j + s]! : lat[base + (i + s) * side + j + h]!;
      const ac = lat[base + (i + h) * side + j + h]!;
      const abx = c[ab * 3]!;
      const aby = c[ab * 3 + 1]!;
      const abz = c[ab * 3 + 2]!;
      const bcx = c[bc * 3]!;
      const bcy = c[bc * 3 + 1]!;
      const bcz = c[bc * 3 + 2]!;
      const acx = c[ac * 3]!;
      const acy = c[ac * 3 + 1]!;
      const acz = c[ac * 3 + 2]!;
      const sg = upper ? -orient : orient;
      // t1 = p . (mAB x mAC): child A
      const t1 = x * (aby * acz - abz * acy) + y * (abz * acx - abx * acz) + z * (abx * acy - aby * acx);
      if (sg * t1 >= 0) {
        // child A keeps (i, j) and the orientation
      } else {
        // t2 = p . (mBC x mAB): child B
        const t2 = x * (bcy * abz - bcz * aby) + y * (bcz * abx - bcx * abz) + z * (bcx * aby - bcy * abx);
        if (sg * t2 >= 0) {
          if (upper) j += h;
          else i += h;
        } else {
          // t3 = p . (mAC x mBC): child C
          const t3 = x * (acy * bcz - acz * bcy) + y * (acz * bcx - acx * bcz) + z * (acx * bcy - acy * bcx);
          if (sg * t3 >= 0) {
            i += h;
            j += h;
          } else if (upper) {
            j += h;
            upper = false;
          } else {
            i += h;
            upper = true;
          }
        }
      }
    }
    // Step 4: nearest of the final triangle's 3 vertices (ties -> lower PlotId).
    const v0 = lat[base + i * side + j]!;
    const v1 = upper ? lat[base + i * side + j + 1]! : lat[base + (i + 1) * side + j]!;
    const v2 = lat[base + (i + 1) * side + j + 1]!;
    let bestId = v0;
    let bestDot = c[v0 * 3]! * x + c[v0 * 3 + 1]! * y + c[v0 * 3 + 2]! * z;
    const d1 = c[v1 * 3]! * x + c[v1 * 3 + 1]! * y + c[v1 * 3 + 2]! * z;
    if (d1 > bestDot || (d1 === bestDot && v1 < bestId)) {
      bestId = v1;
      bestDot = d1;
    }
    const d2 = c[v2 * 3]! * x + c[v2 * 3 + 1]! * y + c[v2 * 3 + 2]! * z;
    if (d2 > bestDot || (d2 === bestDot && v2 < bestId)) bestId = v2;
    // Safety net: the answer is a local maximum of dot over the neighbour graph (normally 0 steps). This makes the
    // full path and the hinted path agree exactly, including rounding cases on cell borders.
    const r = this.walk(bestId, 8);
    return r >= 0 ? r : bestId;
  }

  private inFace(f: number): boolean {
    const q = this.query;
    const x = q[0]!;
    const y = q[1]!;
    const z = q[2]!;
    const e = this.faceEdge;
    const o = f * 9;
    return (
      e[o]! * x + e[o + 1]! * y + e[o + 2]! * z >= 0 &&
      e[o + 3]! * x + e[o + 4]! * y + e[o + 5]! * z >= 0 &&
      e[o + 6]! * x + e[o + 7]! * y + e[o + 8]! * z >= 0
    );
  }

  /**
   * Greedy ascent of dot(p, centre) over the neighbour graph from `start` (Delaunay greedy walk: a local maximum is the
   * nearest plot). Returns the local maximum, or -1 if it was not reached within `maxSteps` moves.
   */
  private walk(start: number, maxSteps: number): number {
    const q = this.query;
    const x = q[0]!;
    const y = q[1]!;
    const z = q[2]!;
    const nb = this.neighborTable;
    const c = this.centers;
    let cur = start;
    let curDot = c[cur * 3]! * x + c[cur * 3 + 1]! * y + c[cur * 3 + 2]! * z;
    for (let step = 0; step <= maxSteps; step++) {
      let bestId = cur;
      let bestDot = curDot;
      const o = cur * PLOT_NEIGHBOR_SLOTS;
      for (let k = 0; k < PLOT_NEIGHBOR_SLOTS; k++) {
        const q = nb[o + k]!;
        if (q === NO_NEIGHBOR) continue;
        const dq = c[q * 3]! * x + c[q * 3 + 1]! * y + c[q * 3 + 2]! * z;
        if (dq > bestDot || (dq === bestDot && q < bestId)) {
          bestId = q;
          bestDot = dq;
        }
      }
      if (bestId === cur) return cur;
      cur = bestId;
      curDot = bestDot;
    }
    return -1;
  }

  neighbors(id: PlotId): PlotIdView {
    this.checkId(id);
    const o = id * PLOT_NEIGHBOR_SLOTS;
    const nb = this.neighborTable;
    if ((nb[o + 5] ?? NO_NEIGHBOR) === NO_NEIGHBOR) {
      const v = this.view5;
      for (let k = 0; k < 5; k++) v[k] = nb[o + k] ?? NO_NEIGHBOR;
      return v as unknown as PlotIdView;
    }
    const v = this.view6;
    for (let k = 0; k < 6; k++) v[k] = nb[o + k] ?? NO_NEIGHBOR;
    return v as unknown as PlotIdView;
  }

  neighborCount(id: PlotId): 5 | 6 {
    this.checkId(id);
    return (this.neighborTable[id * PLOT_NEIGHBOR_SLOTS + 5] ?? NO_NEIGHBOR) === NO_NEIGHBOR ? 5 : 6;
  }

  center(id: PlotId): MoonPoint {
    this.checkId(id);
    const slot = id & CACHE_MASK;
    if (this.centerCacheIds[slot] === id) {
      const hit = this.centerCache[slot];
      if (hit) return hit;
    }
    const r = this.params.radiusM;
    const p: MoonPoint = Object.freeze(new FrozenVec3(r * this.cx(id), r * this.cy(id), r * this.cz(id)));
    this.centerCacheIds[slot] = id;
    this.centerCache[slot] = p;
    return p;
  }

  centerDirection(id: PlotId): UnitDirection {
    this.checkId(id);
    const slot = id & CACHE_MASK;
    if (this.dirCacheIds[slot] === id) {
      const hit = this.dirCache[slot];
      if (hit) return hit;
    }
    const p: UnitDirection = Object.freeze(new FrozenVec3(this.cx(id), this.cy(id), this.cz(id)));
    this.dirCacheIds[slot] = id;
    this.dirCache[slot] = p;
    return p;
  }

  /** Allocation-free variant of `centerDirection`. */
  centerDirectionInto(id: PlotId, out: MutableUnitDirection): MutableUnitDirection {
    this.checkId(id);
    out.x = this.cx(id);
    out.y = this.cy(id);
    out.z = this.cz(id);
    return out;
  }

  chunkOf(id: PlotId): ChunkId {
    this.checkId(id);
    if (id >= 10 * this.m2) return this.params.poleChunkId;
    const d = Math.floor(id / this.m2);
    const rem = id - d * this.m2;
    const i = rem >> this.logM;
    const j = rem & (this.m - 1);
    return d * this.chunksPerDiamond + (i >> 4) * this.chunksPerEdge + (j >> 4);
  }

  localIndexOf(id: PlotId): number {
    this.checkId(id);
    if (id === this.params.northPolePlotId) return 0;
    if (id === this.params.southPolePlotId) return 1;
    const rem = id % this.m2;
    const i = rem >> this.logM;
    const j = rem & (this.m - 1);
    return (i & 15) * CHUNK_EDGE_PLOTS + (j & 15);
  }

  plotAtChunkLocal(chunkId: ChunkId, localIndex: number): PlotId {
    if (!(chunkId >= 0 && chunkId <= this.params.poleChunkId && (chunkId | 0) === chunkId)) {
      throw new RangeError(`chunk ${chunkId} out of range`);
    }
    if (chunkId === this.params.poleChunkId) {
      if (localIndex === 0) return this.params.northPolePlotId as PlotId;
      if (localIndex === 1) return this.params.southPolePlotId as PlotId;
      throw new RangeError(`pole chunk local index ${localIndex} (0 = north, 1 = south)`);
    }
    if (!(localIndex >= 0 && localIndex < 256 && (localIndex | 0) === localIndex)) {
      throw new RangeError(`local index ${localIndex} out of range`);
    }
    const d = Math.floor(chunkId / this.chunksPerDiamond);
    const r = chunkId - d * this.chunksPerDiamond;
    const ci = Math.floor(r / this.chunksPerEdge);
    const cj = r - ci * this.chunksPerEdge;
    const i = ci * CHUNK_EDGE_PLOTS + (localIndex >> 4);
    const j = cj * CHUNK_EDGE_PLOTS + (localIndex & 15);
    return (d * this.m2 + i * this.m + j) as PlotId;
  }

  isPentagon(id: PlotId): boolean {
    this.checkId(id);
    return id >= 10 * this.m2 || id % this.m2 === 0;
  }

  frame(id: PlotId): PlotFrame {
    this.checkId(id);
    const slot = id & CACHE_MASK;
    if (this.frameCacheIds[slot] === id) {
      const hit = this.frameCache[slot];
      if (hit) return hit;
    }
    const o = id * 3;
    const f: PlotFrame = Object.freeze({
      normal: this.centerDirection(id),
      east: Object.freeze(new FrozenVec3(this.east[o]!, this.east[o + 1]!, this.east[o + 2]!)),
      north: Object.freeze(new FrozenVec3(this.north[o]!, this.north[o + 1]!, this.north[o + 2]!)),
    });
    this.frameCacheIds[slot] = id;
    this.frameCache[slot] = f;
    return f;
  }

  /**
   * Gnomonic projection (WDS section 2.7): q = p / dot(p, n) - n; u = R dot(q, e), v = R dot(q, t); written as
   * Math.round(millimetres) (never -0). `dir` must be in the hemisphere of the plot (dot(p, n) > 0).
   */
  toPlotLocal(id: PlotId, dir: UnitDirection, out: PlotLocalMm): PlotLocalMm {
    this.checkId(id);
    const o = id * 3;
    const c = this.centers;
    const nx = c[o] ?? 0;
    const ny = c[o + 1] ?? 0;
    const nz = c[o + 2] ?? 0;
    const px = dir.x;
    const py = dir.y;
    const pz = dir.z;
    const dn = px * nx + py * ny + pz * nz;
    const qx = px / dn - nx;
    const qy = py / dn - ny;
    const qz = pz / dn - nz;
    const e = this.east;
    const t = this.north;
    const r = this.params.radiusM;
    const u = r * (qx * (e[o] ?? 0) + qy * (e[o + 1] ?? 0) + qz * (e[o + 2] ?? 0));
    const v = r * (qx * (t[o] ?? 0) + qy * (t[o + 1] ?? 0) + qz * (t[o + 2] ?? 0));
    // `+ 0` turns Math.round's -0 into +0 so equal answers are also equal bytes (Object.is, hashing).
    out.u = Math.round(u * 1000) + 0;
    out.v = Math.round(v * 1000) + 0;
    return out;
  }

  /** Inverse projection: p = normalise(n + (u/R) e + (v/R) t), u and v in millimetres. */
  fromPlotLocal(id: PlotId, uMm: number, vMm: number, out: MutableUnitDirection): MutableUnitDirection {
    this.checkId(id);
    const o = id * 3;
    const c = this.centers;
    const e = this.east;
    const t = this.north;
    const r = this.params.radiusM;
    const a = uMm / 1000 / r;
    const b = vMm / 1000 / r;
    const x = (c[o] ?? 0) + a * (e[o] ?? 0) + b * (t[o] ?? 0);
    const y = (c[o + 1] ?? 0) + a * (e[o + 1] ?? 0) + b * (t[o + 1] ?? 0);
    const z = (c[o + 2] ?? 0) + a * (e[o + 2] ?? 0) + b * (t[o + 2] ?? 0);
    const len = Math.sqrt(x * x + y * y + z * z);
    out.x = x / len;
    out.y = y / len;
    out.z = z / len;
    return out;
  }

  // ---- extras (not in the contract) -----------------------------------------------------------------------------

  /** Writes the lattice address of `id` into `out` (poles: d = -1 north, -2 south, i = j = 0). */
  latticeOf(id: PlotId, out: PlotLattice): PlotLattice {
    this.checkId(id);
    if (id >= 10 * this.m2) {
      out.d = id === this.params.northPolePlotId ? -1 : -2;
      out.i = 0;
      out.j = 0;
      return out;
    }
    const d = Math.floor(id / this.m2);
    const rem = id - d * this.m2;
    out.d = d;
    out.i = rem >> this.logM;
    out.j = rem & (this.m - 1);
    return out;
  }

  /** Canonical PlotId of diamond lattice point (d, i, j) with 0 <= i, j <= m (far edges remapped, WDS 2.3). */
  plotAtLattice(d: number, i: number, j: number): PlotId {
    if (!(d >= 0 && d < DIAMOND_COUNT && i >= 0 && i <= this.m && j >= 0 && j <= this.m)) {
      throw new RangeError(`lattice point (${d}, ${i}, ${j}) out of range`);
    }
    return this.latticeId(d, i, j) as PlotId;
  }

  /**
   * Triangle index list of the level-n icosphere whose vertices are the plot centres (20 m^2 triangles, counter-
   * clockwise seen from outside). For the orbit / Survey Globe mesh (WDS section 7.8). Allocates; call once.
   */
  buildTriangleIndices(): Uint32Array {
    const m = this.m;
    const out = new Uint32Array(20 * m * m * 3);
    let w = 0;
    // Lattice-CCW is clockwise seen from outside when orient < 0; flip the winding in that case.
    const flip = this.orient < 0;
    for (let d = 0; d < DIAMOND_COUNT; d++) {
      for (let i = 0; i < m; i++) {
        for (let j = 0; j < m; j++) {
          const a = this.latticeId(d, i, j);
          const b = this.latticeId(d, i + 1, j);
          const c = this.latticeId(d, i + 1, j + 1);
          const e = this.latticeId(d, i, j + 1);
          // lower (a, b, c) and upper (a, c, e) are both lattice-CCW
          if (flip) {
            out[w++] = a;
            out[w++] = c;
            out[w++] = b;
            out[w++] = a;
            out[w++] = e;
            out[w++] = c;
          } else {
            out[w++] = a;
            out[w++] = b;
            out[w++] = c;
            out[w++] = a;
            out[w++] = c;
            out[w++] = e;
          }
        }
      }
    }
    return out;
  }
}

/** Builds the full grid (centres, lattice, ordered neighbours, frames) for `params`. About 0.1 to 0.3 s for m = 128. */
export function createPlotGrid(params: PlotGridParams): IcoPlotGrid {
  return new IcoPlotGrid(buildCentersAndLattice(params));
}
