// Per-plot attributes the dust ledger needs (WDS sections 4.1 and 4.3): dust class and area. The class bake
// (WDS section 3.2 step 8) is owned by tools/terrain-bake; until it ships a host passes a class table of its own
// (for example every plot Highland). Areas are computed here from the grid.
//
// Determinism: plot areas feed mgPerUnit and therefore Dust Cell grams, so they use only + - * / sqrt (no atan):
// the cell is the fan of flat triangles (centre, Voronoi vertex k, Voronoi vertex k + 1). The flat fan differs from
// the spherical area by about (cell radius / R)^2 = 3e-5, far below one ledger unit.

import { DustClass, NO_NEIGHBOR, PLOT_NEIGHBOR_SLOTS, type PlotAttributes, type PlotId } from "@moon-cleanup/shared";
import type { IcoPlotGrid } from "../grid/plot-grid";

/** Area of every plot in square metres (Float32Array, WDS section 4.3). About 60 ms for GP(128,0); call once. */
export function computePlotAreasM2(grid: IcoPlotGrid): Float32Array {
  const count = grid.count;
  const c = grid.centers;
  const nb = grid.neighborTable;
  const r2 = grid.params.radiusM * grid.params.radiusM;
  const out = new Float32Array(count);
  // Voronoi vertices of one cell (unit directions), at most 6.
  const vx = new Float64Array(PLOT_NEIGHBOR_SLOTS);
  const vy = new Float64Array(PLOT_NEIGHBOR_SLOTS);
  const vz = new Float64Array(PLOT_NEIGHBOR_SLOTS);
  for (let p = 0; p < count; p++) {
    const o = p * 3;
    const px = c[o]!;
    const py = c[o + 1]!;
    const pz = c[o + 2]!;
    const base = p * PLOT_NEIGHBOR_SLOTS;
    const n = nb[base + 5] === NO_NEIGHBOR ? 5 : 6;
    for (let k = 0; k < n; k++) {
      const a = nb[base + k]! * 3;
      const b = nb[base + ((k + 1) % n)]! * 3;
      const ax = c[a]! - px;
      const ay = c[a + 1]! - py;
      const az = c[a + 2]! - pz;
      const bx = c[b]! - px;
      const by = c[b + 1]! - py;
      const bz = c[b + 2]! - pz;
      // Circumcentre direction of the triangle (p, a, b): normal of its plane, pointing outward.
      let wx = ay * bz - az * by;
      let wy = az * bx - ax * bz;
      let wz = ax * by - ay * bx;
      let len = Math.sqrt(wx * wx + wy * wy + wz * wz);
      if (wx * px + wy * py + wz * pz < 0) len = -len;
      wx /= len;
      wy /= len;
      wz /= len;
      // Scale onto the tangent plane at p (gnomonic), so the fan is flat.
      const d = wx * px + wy * py + wz * pz;
      vx[k] = wx / d - px;
      vy[k] = wy / d - py;
      vz[k] = wz / d - pz;
    }
    let area = 0;
    for (let k = 0; k < n; k++) {
      const j = (k + 1) % n;
      const cx = vy[k]! * vz[j]! - vz[k]! * vy[j]!;
      const cy = vz[k]! * vx[j]! - vx[k]! * vz[j]!;
      const cz = vx[k]! * vy[j]! - vy[k]! * vx[j]!;
      area += 0.5 * Math.sqrt(cx * cx + cy * cy + cz * cz);
    }
    out[p] = area * r2;
  }
  return out;
}

/** `PlotAttributes` over two flat tables (class code per plot, area per plot). */
export class PlotAttributeTables implements PlotAttributes {
  constructor(
    /** DustClass code per PlotId. */
    readonly classes: Uint8Array,
    /** Area in square metres per PlotId. */
    readonly areas: Float32Array,
  ) {
    if (classes.length !== areas.length) throw new RangeError("plot attribute tables differ in length");
  }

  classOf(id: PlotId): DustClass {
    return (this.classes[id] ?? DustClass.Empty) as DustClass;
  }

  areaM2(id: PlotId): number {
    return this.areas[id] ?? 0;
  }
}

/**
 * Attributes with one class for every plot (default Highland) and real areas. A stand-in until the per-plot class
 * bake exists; `emptyPlots` marks outpost pads (class Empty).
 */
export function createUniformPlotAttributes(
  grid: IcoPlotGrid,
  dustClass: DustClass = DustClass.Highland,
  emptyPlots?: Iterable<number>,
): PlotAttributeTables {
  const classes = new Uint8Array(grid.count).fill(dustClass);
  if (emptyPlots) for (const p of emptyPlots) if (p >= 0 && p < grid.count) classes[p] = DustClass.Empty;
  return new PlotAttributeTables(classes, computePlotAreasM2(grid));
}
