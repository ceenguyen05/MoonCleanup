// P2 prototype: flat per-plot tables the dust code reads with inline arithmetic (no method calls, no objects on the
// hot path). Built once from the packages/world grid (its Float64Array tables are used directly), or, for the harness
// dry-run stub grid, from `frame(id)` with no neighbours (anchor-only rasterisation, every texel owned).
// Environment-agnostic: no DOM, no Node, no three.js.

/** Structural subset of the packages/world IcoPlotGrid (and of the harness ContestGrid). */
export interface GridLike {
  readonly params: { readonly radiusM: number; readonly plotCount: number };
  frame(id: never): {
    readonly normal: { readonly x: number; readonly y: number; readonly z: number };
    readonly east: { readonly x: number; readonly y: number; readonly z: number };
    readonly north: { readonly x: number; readonly y: number; readonly z: number };
  };
  readonly centers?: Float64Array;
  readonly east?: Float64Array;
  readonly north?: Float64Array;
  readonly neighborTable?: Int32Array;
  chunkOf?(id: never): number;
}

export const DUST_CLASS_HIGHLAND = 0;
export const DUST_CLASS_MARE = 1;
export const DUST_CLASS_CRATER = 2;
export const DUST_CLASS_EMPTY = 3;

/** Dust level per class (WDS 4.1: 5 / 8 / 13); Empty has none. */
export const DUST_LEVEL_BY_CLASS = [5, 8, 13, 0] as const;

export interface PlotTables {
  readonly count: number;
  readonly radiusM: number;
  /** Unit centre, local east and local north per plot (3 doubles each). */
  readonly centers: Float64Array;
  readonly east: Float64Array;
  readonly north: Float64Array;
  /** 6 neighbour ids per plot, -1 = none. */
  readonly neighbors: Int32Array;
  readonly chunkOf: Uint16Array;
  readonly chunkCount: number;
  /** Plots of chunk c are chunkPlots[chunkStart[c] .. chunkStart[c + 1]) in PlotId order. */
  readonly chunkStart: Int32Array;
  readonly chunkPlots: Int32Array;
  /** Position of a plot inside its chunk's list. */
  readonly localOf: Uint16Array;
  readonly classOf: Uint8Array;
  /** True when the grid had a neighbour table (the real grid). */
  readonly hasNeighbors: boolean;
}

function fnv32(v: number): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < 4; i++) {
    h ^= (v >>> (8 * i)) & 0xff;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

/**
 * Synthetic class map [prototype assumption]: the per-plot class bake (WDS 3.2 step 8) does not exist yet, so the
 * class is a hash of (chunk id, seed) with the design shares 55 / 35 / 10 %. One class per 16 x 16 plot chunk.
 */
export function syntheticClass(chunk: number, seed: number): number {
  const pct = fnv32((chunk ^ Math.imul(seed, 0x9e3779b1)) >>> 0) % 100;
  return pct < 55 ? DUST_CLASS_HIGHLAND : pct < 90 ? DUST_CLASS_MARE : DUST_CLASS_CRATER;
}

export function buildTables(grid: GridLike, seed: number): PlotTables {
  const count = grid.params.plotCount;
  const radiusM = grid.params.radiusM;
  let centers = grid.centers;
  let east = grid.east;
  let north = grid.north;
  let neighbors = grid.neighborTable;
  const real =
    centers instanceof Float64Array &&
    east instanceof Float64Array &&
    north instanceof Float64Array &&
    neighbors instanceof Int32Array &&
    centers.length === count * 3 &&
    neighbors.length === count * 6;
  if (!real) {
    const c = new Float64Array(count * 3);
    const e = new Float64Array(count * 3);
    const n = new Float64Array(count * 3);
    for (let id = 0; id < count; id++) {
      const f = grid.frame(id as never);
      c[id * 3] = f.normal.x;
      c[id * 3 + 1] = f.normal.y;
      c[id * 3 + 2] = f.normal.z;
      e[id * 3] = f.east.x;
      e[id * 3 + 1] = f.east.y;
      e[id * 3 + 2] = f.east.z;
      n[id * 3] = f.north.x;
      n[id * 3 + 1] = f.north.y;
      n[id * 3 + 2] = f.north.z;
    }
    centers = c;
    east = e;
    north = n;
    neighbors = new Int32Array(count * 6).fill(-1);
  }
  const chunkOf = new Uint16Array(count);
  let chunkCount = 0;
  for (let id = 0; id < count; id++) {
    const ch = real && grid.chunkOf ? grid.chunkOf(id as never) : id >>> 8;
    chunkOf[id] = ch;
    if (ch + 1 > chunkCount) chunkCount = ch + 1;
  }
  const chunkStart = new Int32Array(chunkCount + 1);
  for (let id = 0; id < count; id++) chunkStart[(chunkOf[id] ?? 0) + 1]!++;
  for (let c = 0; c < chunkCount; c++) chunkStart[c + 1] = (chunkStart[c + 1] ?? 0) + (chunkStart[c] ?? 0);
  const fill = chunkStart.slice(0, chunkCount);
  const chunkPlots = new Int32Array(count);
  const localOf = new Uint16Array(count);
  const classOf = new Uint8Array(count);
  for (let id = 0; id < count; id++) {
    const ch = chunkOf[id] ?? 0;
    const at = fill[ch] ?? 0;
    chunkPlots[at] = id;
    localOf[id] = at - (chunkStart[ch] ?? 0);
    fill[ch] = at + 1;
    classOf[id] = syntheticClass(ch, seed);
  }
  return {
    count,
    radiusM,
    centers: centers as Float64Array,
    east: east as Float64Array,
    north: north as Float64Array,
    neighbors: neighbors as Int32Array,
    chunkOf,
    chunkCount,
    chunkStart,
    chunkPlots,
    localOf,
    classOf,
    hasNeighbors: real,
  };
}
