// Per-plot static geometry: tangent frame, texel ownership mask and the plots that share the 25.6 m frame.
// Built on first touch from the ContestGrid subset of the shared PlotGrid contract (no neighbour table needed), then
// immutable. One cache may be shared by every room and, in the harness, by the in-process clients.
import type { PlotGrid, PlotId } from "../../../../../packages/shared/src/index";
import { FRAME_HALF_MM, TEXEL_MM, TILE_EDGE, TILE_TEXELS } from "./constants";

export type P3Grid = Pick<PlotGrid, "params" | "plotAt" | "centerDirection" | "frame" | "toPlotLocal">;

export class Vec3 {
  x = 0;
  y = 0;
  z = 0;
}

export class LocalMm {
  u = 0;
  v = 0;
}

export class PlotGeom {
  /** n, e, t (3 doubles each): centre direction, local east, local north. */
  readonly f = new Float64Array(9);
  /** Bit i set when texel i (index = b * 64 + a) is owned by this plot (its centre is nearest to this plot). */
  readonly owned = new Uint32Array(TILE_TEXELS / 32);
  ownedCount = 0;
  /** Plots that own at least one texel of this plot's frame (its 5 or 6 neighbours), in discovery order. */
  readonly neighbors = new Int32Array(8);
  neighborCount = 0;

  constructor(readonly plot: number) {}
}

/** Unit direction of plot-local (uMm, vMm) in the frame of `g`. */
export function localToDir(g: PlotGeom, uMm: number, vMm: number, radiusM: number, out: Vec3): Vec3 {
  const f = g.f;
  const a = uMm / 1000 / radiusM;
  const b = vMm / 1000 / radiusM;
  const x = (f[0] ?? 0) + a * (f[3] ?? 0) + b * (f[6] ?? 0);
  const y = (f[1] ?? 0) + a * (f[4] ?? 0) + b * (f[7] ?? 0);
  const z = (f[2] ?? 0) + a * (f[5] ?? 0) + b * (f[8] ?? 0);
  const len = Math.sqrt(x * x + y * y + z * z);
  out.x = x / len;
  out.y = y / len;
  out.z = z / len;
  return out;
}

/** Gnomonic projection of `dir` into the frame of `g`, rounded to millimetres (same rule as PlotGrid.toPlotLocal). */
export function dirToLocal(g: PlotGeom, dir: Vec3, radiusM: number, out: LocalMm): LocalMm {
  const f = g.f;
  const nx = f[0] ?? 0;
  const ny = f[1] ?? 0;
  const nz = f[2] ?? 0;
  const dn = dir.x * nx + dir.y * ny + dir.z * nz;
  const qx = dir.x / dn - nx;
  const qy = dir.y / dn - ny;
  const qz = dir.z / dn - nz;
  out.u = Math.round(radiusM * 1000 * (qx * (f[3] ?? 0) + qy * (f[4] ?? 0) + qz * (f[5] ?? 0))) + 0;
  out.v = Math.round(radiusM * 1000 * (qx * (f[6] ?? 0) + qy * (f[7] ?? 0) + qz * (f[8] ?? 0))) + 0;
  return out;
}

export class GeomCache {
  private readonly map = new Map<number, PlotGeom>();
  private readonly scratch = new Vec3();
  private readonly centers = new Float64Array(8 * 3);
  readonly radiusM: number;
  readonly plotCount: number;
  /** Wall-clock free counter of builds (each is 4,096 point-to-plot queries). */
  builds = 0;

  constructor(readonly grid: P3Grid) {
    this.radiusM = grid.params.radiusM;
    this.plotCount = grid.params.plotCount;
  }

  get(plot: number): PlotGeom {
    const hit = this.map.get(plot);
    if (hit) return hit;
    const g = this.build(plot);
    this.map.set(plot, g);
    return g;
  }

  private build(plot: number): PlotGeom {
    const g = new PlotGeom(plot);
    const fr = this.grid.frame(plot as PlotId);
    const f = g.f;
    f[0] = fr.normal.x;
    f[1] = fr.normal.y;
    f[2] = fr.normal.z;
    f[3] = fr.east.x;
    f[4] = fr.east.y;
    f[5] = fr.east.z;
    f[6] = fr.north.x;
    f[7] = fr.north.y;
    f[8] = fr.north.z;
    // 1. The plots that share this frame: point-to-plot on the 252 border texels (the cell of every neighbour reaches
    //    the border of the square). 2. Ownership of all 4,096 texels by the nearest centre among the plot and those
    //    neighbours (WDS 4.3), ties to the lower PlotId as PlotGrid.plotAt.
    const d = this.scratch;
    let hint = plot as PlotId;
    const last = TILE_EDGE - 1;
    for (let b = 0; b < TILE_EDGE; b++) {
      const v = -FRAME_HALF_MM + b * TEXEL_MM + TEXEL_MM / 2;
      const stepA = b === 0 || b === last ? 1 : last;
      for (let a = 0; a < TILE_EDGE; a += stepA) {
        const u = -FRAME_HALF_MM + a * TEXEL_MM + TEXEL_MM / 2;
        localToDir(g, u, v, this.radiusM, d);
        const owner = this.grid.plotAt(d, hint);
        hint = owner;
        if (owner === plot) continue;
        let seen = false;
        for (let k = 0; k < g.neighborCount; k++) if (g.neighbors[k] === owner) seen = true;
        if (!seen && g.neighborCount < g.neighbors.length) g.neighbors[g.neighborCount++] = owner;
      }
    }
    const nc = this.centers;
    for (let k = 0; k < g.neighborCount; k++) {
      const c = this.grid.centerDirection((g.neighbors[k] ?? 0) as PlotId);
      nc[k * 3] = c.x;
      nc[k * 3 + 1] = c.y;
      nc[k * 3 + 2] = c.z;
    }
    for (let b = 0; b < TILE_EDGE; b++) {
      const v = -FRAME_HALF_MM + b * TEXEL_MM + TEXEL_MM / 2;
      for (let a = 0; a < TILE_EDGE; a++) {
        const u = -FRAME_HALF_MM + a * TEXEL_MM + TEXEL_MM / 2;
        localToDir(g, u, v, this.radiusM, d);
        const own = d.x * (f[0] ?? 0) + d.y * (f[1] ?? 0) + d.z * (f[2] ?? 0);
        let mine = true;
        for (let k = 0; k < g.neighborCount; k++) {
          const dn = d.x * (nc[k * 3] ?? 0) + d.y * (nc[k * 3 + 1] ?? 0) + d.z * (nc[k * 3 + 2] ?? 0);
          if (dn > own || (dn === own && (g.neighbors[k] ?? 0) < plot)) {
            mine = false;
            break;
          }
        }
        if (mine) {
          const i = b * TILE_EDGE + a;
          g.owned[i >>> 5] = (g.owned[i >>> 5] ?? 0) | (1 << (i & 31));
          g.ownedCount++;
        }
      }
    }
    this.builds++;
    return g;
  }
}

/** cos of the angle subtended by `metres` on a sphere of radius `radiusM` (polynomial; no trig on the sim path). */
export function cosOfArc(metres: number, radiusM: number): number {
  const t = metres / radiusM;
  const t2 = t * t;
  return 1 - t2 / 2 + (t2 * t2) / 24 - (t2 * t2 * t2) / 720;
}
