// GP(m,0) table construction (WDS sections 2.2 to 2.5, 2.7). Runs once per process (or once at build time for the
// server binary); not a hot path. Determinism rule (WDS section 1): only + - * / sqrt, comparisons and integer ops.
//
// Construction: each diamond's (m+1) x (m+1) lattice is filled by recursive great-circle bisection,
// midpoint = normalise(a + b), level by level (step m, m/2, ..., 1). Every level-L+1 vertex is the midpoint of exactly
// one level-L edge, so this equals recursive subdivision of the 20 triangles; a + b is commutative, so the shared
// diamond edges come out bit-identical from both sides (checked below, the build throws otherwise).

import { DIAMOND_COUNT, NO_NEIGHBOR, PENTAGON_COUNT, PLOT_NEIGHBOR_SLOTS } from "@moon-cleanup/shared";
import type { PlotGridParams } from "@moon-cleanup/shared";
import { diamondCorners, ICO_NORTH, ICO_SOUTH } from "./icosahedron";

/** Raw tables of one grid: everything else (frames, chunk math) is derived from these at load. */
export interface PlotGridTables {
  readonly params: PlotGridParams;
  /** Unit plot centres, `[x, y, z]` per PlotId (length plotCount * 3). */
  readonly centers: Float64Array;
  /**
   * Canonical PlotId of every diamond lattice point, `d * (m+1)^2 + i * (m+1) + j` for 0 <= i, j <= m (the far edges
   * i = m and j = m resolved by the WDS section 2.3 edge remaps). Used by point -> plot and the orbit mesh.
   */
  readonly lattice: Int32Array;
}

/** True when `m` is a power of two (recursive bisection needs it). */
export function isPowerOfTwo(m: number): boolean {
  return Number.isInteger(m) && m > 0 && (m & (m - 1)) === 0;
}

/**
 * Canonical PlotId of lattice point (d, i, j), 0 <= i, j <= m, applying the WDS section 2.3 edge remaps until the
 * point is owned (0 <= i, j <= m - 1) or is a pole.
 */
export function canonicalPlotId(m: number, d: number, i: number, j: number): number {
  const m2 = m * m;
  for (let guard = 0; guard < 8; guard++) {
    if (d < 5) {
      if (i === m && j === 0) return 10 * m2; // north pole
      if (i === m) {
        const jj = j;
        d = (d + 1) % 5;
        i = m - jj;
        j = 0;
        continue;
      }
      if (j === m) {
        d = 5 + d;
        j = 0;
        continue;
      }
    } else {
      const k = d - 5;
      if (i === 0 && j === m) return 10 * m2 + 1; // south pole
      if (i === m) {
        d = (k + 1) % 5;
        i = 0;
        continue;
      }
      if (j === m) {
        const ii = i;
        d = 5 + ((k + 1) % 5);
        i = 0;
        j = m - ii;
        continue;
      }
    }
    return d * m2 + i * m + j;
  }
  throw new Error(`edge remap did not converge at (${d}, ${i}, ${j})`);
}

/** Builds centres and the lattice table of GP(m,0). Throws if the shared diamond edges disagree bit for bit. */
export function buildCentersAndLattice(params: PlotGridParams): PlotGridTables {
  const m = params.gridM;
  if (!isPowerOfTwo(m)) throw new RangeError(`gridM ${m} must be a power of two (recursive bisection)`);
  const side = m + 1;
  const side2 = side * side;
  const count = params.plotCount;
  const centers = new Float64Array(count * 3);
  const lattice = new Int32Array(DIAMOND_COUNT * side2);
  const pos = new Float64Array(DIAMOND_COUNT * side2 * 3);

  for (let d = 0; d < DIAMOND_COUNT; d++) {
    const base = d * side2;
    const corners = diamondCorners(d);
    const put = (i: number, j: number, v: readonly [number, number, number]): void => {
      const o = (base + i * side + j) * 3;
      pos[o] = v[0];
      pos[o + 1] = v[1];
      pos[o + 2] = v[2];
    };
    put(0, 0, corners[0]);
    put(m, 0, corners[1]);
    put(0, m, corners[2]);
    put(m, m, corners[3]);
    const mid = (ai: number, aj: number, bi: number, bj: number, oi: number, oj: number): void => {
      const a = (base + ai * side + aj) * 3;
      const b = (base + bi * side + bj) * 3;
      const o = (base + oi * side + oj) * 3;
      const x = (pos[a] ?? 0) + (pos[b] ?? 0);
      const y = (pos[a + 1] ?? 0) + (pos[b + 1] ?? 0);
      const z = (pos[a + 2] ?? 0) + (pos[b + 2] ?? 0);
      const len = Math.sqrt(x * x + y * y + z * z);
      pos[o] = x / len;
      pos[o + 1] = y / len;
      pos[o + 2] = z / len;
    };
    for (let s = m; s >= 2; s >>= 1) {
      const h = s >> 1;
      for (let i = 0; i <= m; i += s) {
        for (let j = 0; j <= m; j += s) {
          const iOk = i + s <= m;
          const jOk = j + s <= m;
          if (iOk) mid(i, j, i + s, j, i + h, j);
          if (jOk) mid(i, j, i, j + s, i, j + h);
          if (iOk && jOk) mid(i, j, i + s, j + s, i + h, j + h);
        }
      }
    }
    for (let i = 0; i <= m; i++) {
      for (let j = 0; j <= m; j++) {
        lattice[base + i * side + j] = canonicalPlotId(m, d, i, j);
      }
    }
    for (let i = 0; i < m; i++) {
      for (let j = 0; j < m; j++) {
        const o = (base + i * side + j) * 3;
        const id = d * m * m + i * m + j;
        centers[id * 3] = pos[o] ?? 0;
        centers[id * 3 + 1] = pos[o + 1] ?? 0;
        centers[id * 3 + 2] = pos[o + 2] ?? 0;
      }
    }
  }
  const nPole = params.northPolePlotId * 3;
  const sPole = params.southPolePlotId * 3;
  centers[nPole] = ICO_NORTH[0];
  centers[nPole + 1] = ICO_NORTH[1];
  centers[nPole + 2] = ICO_NORTH[2];
  centers[sPole] = ICO_SOUTH[0];
  centers[sPole + 1] = ICO_SOUTH[1];
  centers[sPole + 2] = ICO_SOUTH[2];

  // Seam check: every lattice point computed inside its diamond equals the canonical centre bit for bit.
  for (let d = 0; d < DIAMOND_COUNT; d++) {
    for (let i = 0; i <= m; i++) {
      for (let j = 0; j <= m; j++) {
        const li = d * side2 + i * side + j;
        const id = lattice[li] ?? -1;
        for (let c = 0; c < 3; c++) {
          if (pos[li * 3 + c] !== centers[id * 3 + c]) {
            throw new Error(`diamond seam mismatch at (${d}, ${i}, ${j}) -> plot ${id}`);
          }
        }
      }
    }
  }
  return { params, centers, lattice };
}

/**
 * Unordered neighbour sets from the level-n triangle list (WDS section 2.5: built from the edge set, not from diamond
 * rules), then verified: hexagons have 6, the 12 pentagons 5, symmetric. Slots are later ordered by `orderNeighbors`.
 */
export function buildNeighborSets(tables: PlotGridTables): Int32Array {
  const { params, lattice } = tables;
  const m = params.gridM;
  const side = m + 1;
  const side2 = side * side;
  const count = params.plotCount;
  const nb = new Int32Array(count * PLOT_NEIGHBOR_SLOTS).fill(NO_NEIGHBOR);
  const deg = new Uint8Array(count);
  const add = (a: number, b: number): void => {
    const o = a * PLOT_NEIGHBOR_SLOTS;
    const n = deg[a] ?? 0;
    for (let k = 0; k < n; k++) if (nb[o + k] === b) return;
    if (n >= PLOT_NEIGHBOR_SLOTS) throw new Error(`plot ${a} has more than 6 neighbours`);
    nb[o + n] = b;
    deg[a] = n + 1;
  };
  const edge = (a: number, b: number): void => {
    add(a, b);
    add(b, a);
  };
  for (let d = 0; d < DIAMOND_COUNT; d++) {
    const base = d * side2;
    for (let i = 0; i < m; i++) {
      for (let j = 0; j < m; j++) {
        const a = lattice[base + i * side + j] ?? -1;
        const b = lattice[base + (i + 1) * side + j] ?? -1;
        const c = lattice[base + (i + 1) * side + j + 1] ?? -1;
        const e = lattice[base + i * side + j + 1] ?? -1;
        // lower triangle (a, b, c), upper triangle (a, e, c); they share the diagonal a-c.
        edge(a, b);
        edge(b, c);
        edge(c, a);
        edge(a, e);
        edge(e, c);
      }
    }
  }
  let pentagons = 0;
  let entries = 0;
  for (let p = 0; p < count; p++) {
    const n = deg[p] ?? 0;
    entries += n;
    if (n === 5) pentagons++;
    else if (n !== 6) throw new Error(`plot ${p} has ${n} neighbours`);
    for (let k = 0; k < n; k++) {
      const q = nb[p * PLOT_NEIGHBOR_SLOTS + k] ?? -1;
      let back = false;
      for (let r = 0; r < (deg[q] ?? 0); r++) if (nb[q * PLOT_NEIGHBOR_SLOTS + r] === p) back = true;
      if (!back) throw new Error(`neighbour table not symmetric at ${p} -> ${q}`);
    }
  }
  if (pentagons !== PENTAGON_COUNT) throw new Error(`expected 12 pentagons, found ${pentagons}`);
  if (entries !== (count - PENTAGON_COUNT) * 6 + PENTAGON_COUNT * 5) throw new Error(`bad entry count ${entries}`);
  return nb;
}

/**
 * Tangent frames (WDS section 2.7): n = centre, e = normalise(Y x n) = normalise((nz, 0, -nx)), t = n x e.
 * Poles: N e = +X, t = -Z; S e = +X, t = +Z. Returns [east, north] as plotCount * 3 arrays.
 */
export function buildFrames(tables: PlotGridTables): { east: Float64Array; north: Float64Array } {
  const { params, centers } = tables;
  const count = params.plotCount;
  const east = new Float64Array(count * 3);
  const north = new Float64Array(count * 3);
  for (let p = 0; p < count; p++) {
    const o = p * 3;
    const nx = centers[o] ?? 0;
    const ny = centers[o + 1] ?? 0;
    const nz = centers[o + 2] ?? 0;
    let ex: number;
    let ez: number;
    if (p === params.northPolePlotId || p === params.southPolePlotId) {
      ex = 1;
      ez = 0;
    } else {
      const len = Math.sqrt(nz * nz + nx * nx);
      ex = nz / len;
      ez = -nx / len;
    }
    east[o] = ex;
    east[o + 1] = 0;
    east[o + 2] = ez;
    // t = n x e with ey = 0
    north[o] = ny * ez;
    north[o + 1] = nz * ex - nx * ez;
    north[o + 2] = -ny * ex;
  }
  return { east, north };
}

/** Monotone stand-in for atan2(dv, du) mapped to [0, 4) (no trigonometry, WDS section 1). */
function pseudoAngle(du: number, dv: number): number {
  const s = Math.abs(du) + Math.abs(dv);
  if (s === 0) return 0;
  if (dv >= 0) return du >= 0 ? dv / s : 1 - du / s;
  return du < 0 ? 2 - dv / s : 3 + du / s;
}

/**
 * Orders every plot's neighbour slots in place (WDS section 2.5): counter-clockwise around the outward normal (from e
 * toward t, since e x t = n), starting with the neighbour whose direction is closest to the local east axis.
 * Ties go to the lower PlotId. Pentagons keep NO_NEIGHBOR in slot 5.
 */
export function orderNeighbors(tables: PlotGridTables, nb: Int32Array, east: Float64Array, north: Float64Array): void {
  const { centers, params } = tables;
  const ids = new Int32Array(6);
  const keys = new Float64Array(6);
  const cosines = new Float64Array(6);
  const angles = new Float64Array(6);
  for (let p = 0; p < params.plotCount; p++) {
    const o = p * 3;
    const cx = centers[o] ?? 0;
    const cy = centers[o + 1] ?? 0;
    const cz = centers[o + 2] ?? 0;
    const ex = east[o] ?? 0;
    const ey = east[o + 1] ?? 0;
    const ez = east[o + 2] ?? 0;
    const tx = north[o] ?? 0;
    const ty = north[o + 1] ?? 0;
    const tz = north[o + 2] ?? 0;
    let n = 0;
    for (let k = 0; k < PLOT_NEIGHBOR_SLOTS; k++) {
      const q = nb[p * PLOT_NEIGHBOR_SLOTS + k] ?? NO_NEIGHBOR;
      if (q === NO_NEIGHBOR) continue;
      const dx = (centers[q * 3] ?? 0) - cx;
      const dy = (centers[q * 3 + 1] ?? 0) - cy;
      const dz = (centers[q * 3 + 2] ?? 0) - cz;
      const du = dx * ex + dy * ey + dz * ez;
      const dv = dx * tx + dy * ty + dz * tz;
      ids[n] = q;
      cosines[n] = du / Math.sqrt(du * du + dv * dv);
      angles[n] = pseudoAngle(du, dv);
      n++;
    }
    let start = 0;
    for (let k = 1; k < n; k++) {
      const ck = cosines[k] ?? 0;
      const cs = cosines[start] ?? 0;
      if (ck > cs || (ck === cs && (ids[k] ?? 0) < (ids[start] ?? 0))) start = k;
    }
    const a0 = angles[start] ?? 0;
    for (let k = 0; k < n; k++) {
      let rel = (angles[k] ?? 0) - a0;
      if (rel < 0) rel += 4;
      keys[k] = rel;
    }
    // insertion sort by (key, id)
    for (let k = 1; k < n; k++) {
      const key = keys[k] ?? 0;
      const id = ids[k] ?? 0;
      let r = k - 1;
      while (r >= 0 && ((keys[r] ?? 0) > key || ((keys[r] ?? 0) === key && (ids[r] ?? 0) > id))) {
        keys[r + 1] = keys[r] ?? 0;
        ids[r + 1] = ids[r] ?? 0;
        r--;
      }
      keys[r + 1] = key;
      ids[r + 1] = id;
    }
    for (let k = 0; k < PLOT_NEIGHBOR_SLOTS; k++) {
      nb[p * PLOT_NEIGHBOR_SLOTS + k] = k < n ? (ids[k] ?? NO_NEIGHBOR) : NO_NEIGHBOR;
    }
  }
}
