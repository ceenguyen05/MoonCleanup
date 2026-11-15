// The brush. In P3 this is CLIENT code (plus the server's robot painter): the server never runs it for player paint,
// which is the "brush freedom" of the approach. It turns a tool-head segment into per-texel coverage (mm^2) of one
// 64 x 64 plot tile by lattice sampling, the same idea as WDS 4.5 at 0.4 m texels. Allocation-free.
import { FRAME_HALF_MM, TEXEL_AREA_MM2, TEXEL_MM, TILE_EDGE, TILE_TEXELS } from "./constants";

export const BRUSH_FLAT = 0;
/** Soft-edged brush: full weight in the core, linear falloff over the outer half of the squared radius. */
export const BRUSH_SOFT = 1;

export class Painter {
  /** Coverage in mm^2 per texel; only entries listed in `touched[0 .. count)` are non-zero. */
  readonly cov = new Int32Array(TILE_TEXELS);
  readonly touched = new Uint16Array(TILE_TEXELS);
  count = 0;

  /**
   * Flat-ended segment from (su, sv) to (eu, ev) of width `widthMm` in plot-local mm; a disc when start equals end.
   * Lattice pitch = clamp(width / 8, 25, 100) mm, aligned to the plot frame. Returns the number of texels touched.
   */
  raster(su: number, sv: number, eu: number, ev: number, widthMm: number, brush: number): number {
    const r = Math.ceil(widthMm / 2);
    const minU = Math.max(-FRAME_HALF_MM, Math.min(su, eu) - r);
    const maxU = Math.min(FRAME_HALF_MM - 1, Math.max(su, eu) + r);
    const minV = Math.max(-FRAME_HALF_MM, Math.min(sv, ev) - r);
    const maxV = Math.min(FRAME_HALF_MM - 1, Math.max(sv, ev) + r);
    if (minU > maxU || minV > maxV) return 0;
    let p = Math.round(widthMm / 8);
    if (p < 25) p = 25;
    else if (p > 100) p = 100;
    const p2 = p * p;
    const dx = eu - su;
    const dy = ev - sv;
    const len2 = dx * dx + dy * dy;
    const w2 = widthMm * widthMm; // (2r)^2
    const lim = len2 === 0 ? w2 : w2 * len2;
    const cov = this.cov;
    const touched = this.touched;
    let n = this.count;
    const x0 = Math.ceil(minU / p) * p;
    for (let y = Math.ceil(minV / p) * p; y <= maxV; y += p) {
      const rowBase = (((y + FRAME_HALF_MM) / TEXEL_MM) | 0) * TILE_EDGE;
      const py = y - sv;
      for (let x = x0; x <= maxU; x += p) {
        const px = x - su;
        let d4: number; // 4 * squared distance (times len2 for a segment)
        if (len2 === 0) {
          d4 = 4 * (px * px + py * py);
        } else {
          const dot = px * dx + py * dy;
          if (dot < 0 || dot >= len2) continue;
          const cr = px * dy - py * dx;
          d4 = 4 * cr * cr;
        }
        if (d4 > lim) continue;
        let dep = p2;
        if (brush === BRUSH_SOFT) {
          const t = 2 * (1 - d4 / lim);
          if (t < 1) dep = Math.round(p2 * t);
          if (dep === 0) continue;
        }
        const idx = rowBase + (((x + FRAME_HALF_MM) / TEXEL_MM) | 0);
        const c = cov[idx] ?? 0;
        if (c === 0) touched[n++] = idx;
        cov[idx] = c + dep;
      }
    }
    this.count = n;
    return n;
  }

  /** Zeroes the coverage of the touched texels. Call after consuming a raster. */
  clear(): void {
    const cov = this.cov;
    const touched = this.touched;
    for (let k = 0; k < this.count; k++) cov[touched[k] ?? 0] = 0;
    this.count = 0;
  }
}

/**
 * Fine units (1/16 shared level) removed from a texel covered by `coverageMm2` in one pass. State-independent, with a
 * minimum of one unit once coverage reaches 1/64 of the texel, so every texel a tool touches reaches zero.
 */
export function removalFine(coverageMm2: number, depthFine: number): number {
  const c = coverageMm2 > TEXEL_AREA_MM2 ? TEXEL_AREA_MM2 : coverageMm2;
  let r = Math.floor((depthFine * c + TEXEL_AREA_MM2 / 2) / TEXEL_AREA_MM2);
  if (r < 1 && c >= TEXEL_AREA_MM2 / 64) r = 1;
  return r;
}

/** Fine units a full-coverage pass removes: depth16 is 16 x Depth in dust levels; the tile holds 15 x 16 fine units. */
export function depthFineOf(depth16: number, dustLevel: number): number {
  return Math.floor((depth16 * 15) / dustLevel);
}
