// Golden digests of the grid (WDS section 1 "Golden hash"; shared/world/plot-grid PlotGridGoldenHashes).
//
// Byte layouts (v1, fixed; changing one is a contracts change):
//   grid         for PlotId 0 .. count-1: three int32 little-endian (x, y, z) = Math.round(unit * radiusM * 1e6),
//                i.e. centres in micrometres on the reference sphere.
//   pointToPlot  for k = 0 .. 999: uint32 little-endian plotAt(point_k) without hint, points from `goldenPoints`.
//   neighbors    (packages/world-local, not a contract slot) the ordered Int32Array neighbour table, little-endian.
//
// Points: mulberry32 PRNG seeded with GOLDEN_POINT_SEED; each candidate takes three draws mapped to [-1, 1) by
// (u32 / 2^31) - 1, rejected unless 1e-6 < |v|^2 <= 1, then divided by its length (integer ops, + - * / sqrt only).

import type { PlotGrid, PlotId } from "@moon-cleanup/shared";
import { sha256Hex } from "../hash/sha256";
import type { IcoPlotGrid } from "./plot-grid";

/** Seed of the 1,000 golden point -> plot queries ("MOON"). */
export const GOLDEN_POINT_SEED = 0x4d4f4f4e;
/** Number of golden point -> plot queries. */
export const GOLDEN_POINT_COUNT = 1000;

/** Deterministic 32-bit PRNG (mulberry32). Returns a function producing uint32 values. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (t ^ (t >>> 14)) >>> 0;
  };
}

/** `count` seeded unit directions as a flat `[x, y, z, ...]` array (see the header for the exact procedure). */
export function goldenPoints(count: number = GOLDEN_POINT_COUNT, seed: number = GOLDEN_POINT_SEED): Float64Array {
  const rnd = mulberry32(seed);
  const out = new Float64Array(count * 3);
  let k = 0;
  while (k < count) {
    const x = rnd() / 2147483648 - 1;
    const y = rnd() / 2147483648 - 1;
    const z = rnd() / 2147483648 - 1;
    const r2 = x * x + y * y + z * z;
    if (r2 <= 1e-6 || r2 > 1) continue;
    const len = Math.sqrt(r2);
    out[k * 3] = x / len;
    out[k * 3 + 1] = y / len;
    out[k * 3 + 2] = z / len;
    k++;
  }
  return out;
}

/** The bytes hashed for the `grid` digest. */
export function gridGoldenBytes(grid: PlotGrid): Uint8Array {
  const bytes = new Uint8Array(grid.count * 12);
  const view = new DataView(bytes.buffer);
  const scale = grid.params.radiusM * 1_000_000;
  const dir = { x: 0, y: 0, z: 0 };
  for (let id = 0; id < grid.count; id++) {
    const c = centerOf(grid, id as PlotId, dir);
    const qx = Math.round(c.x * scale);
    const qy = Math.round(c.y * scale);
    const qz = Math.round(c.z * scale);
    if (Math.abs(qx) > 0x7fffffff || Math.abs(qy) > 0x7fffffff || Math.abs(qz) > 0x7fffffff) {
      throw new RangeError("radius too large for the int32 micrometre grid digest");
    }
    view.setInt32(id * 12, qx, true);
    view.setInt32(id * 12 + 4, qy, true);
    view.setInt32(id * 12 + 8, qz, true);
  }
  return bytes;
}

function centerOf(grid: PlotGrid, id: PlotId, out: { x: number; y: number; z: number }) {
  const ico = grid as Partial<IcoPlotGrid>;
  if (ico.centers) {
    out.x = ico.centers[id * 3] ?? 0;
    out.y = ico.centers[id * 3 + 1] ?? 0;
    out.z = ico.centers[id * 3 + 2] ?? 0;
    return out;
  }
  const d = grid.centerDirection(id);
  out.x = d.x;
  out.y = d.y;
  out.z = d.z;
  return out;
}

/** The 1,000 golden point -> plot answers (no hint). */
export function pointToPlotGoldenAnswers(grid: PlotGrid, points: Float64Array = goldenPoints()): Uint32Array {
  const n = points.length / 3;
  const out = new Uint32Array(n);
  const dir = { x: 0, y: 0, z: 0 };
  for (let k = 0; k < n; k++) {
    dir.x = points[k * 3] ?? 0;
    dir.y = points[k * 3 + 1] ?? 0;
    dir.z = points[k * 3 + 2] ?? 0;
    out[k] = grid.plotAt(dir);
  }
  return out;
}

function u32le(values: Uint32Array | Int32Array): Uint8Array {
  const bytes = new Uint8Array(values.length * 4);
  const view = new DataView(bytes.buffer);
  for (let k = 0; k < values.length; k++) view.setUint32(k * 4, (values[k] ?? 0) >>> 0, true);
  return bytes;
}

export interface GridGoldenDigests {
  /** `PlotGridGoldenHashes.grid`. */
  readonly grid: string;
  /** `PlotGridGoldenHashes.pointToPlot`. */
  readonly pointToPlot: string;
  /** packages/world-local digest of the ordered neighbour table (IndexedDB / server binary cache key). */
  readonly neighbors: string;
}

/** Computes all grid golden digests of an IcoPlotGrid. Allocates; tests, build steps and boot checks only. */
export function computeGridGoldenDigests(grid: IcoPlotGrid): GridGoldenDigests {
  return {
    grid: sha256Hex(gridGoldenBytes(grid)),
    pointToPlot: sha256Hex(u32le(pointToPlotGoldenAnswers(grid))),
    neighbors: sha256Hex(u32le(grid.neighborTable)),
  };
}
