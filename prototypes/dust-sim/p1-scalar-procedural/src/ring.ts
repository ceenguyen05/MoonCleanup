// P1 client visuals, part 1 (CPU reference): the detail ring, a toroidal mask of what was swept near the Custodian.
// It is local, never synced and lost when it scrolls away. Environment-agnostic, no imports at run time.
import type { PlotFrame, StrokeRecord } from "@moon-cleanup/shared";

/** Ring presets of WDS 7.5 (size in texels, texel in millimetres). */
export const RING_PRESETS = {
  low: { size: 1024, texelMm: 40 },
  medium: { size: 1024, texelMm: 35 },
  high: { size: 2048, texelMm: 25 },
} as const;

/** Re-anchor distance of the ring's tangent plane (WDS 7.5), millimetres. */
const REANCHOR_MM = 100_000;

/**
 * Toroidal u8 mask in a tangent plane at the ring anchor. A texel holds the visually removed share of the dust layer,
 * 0 (untouched) .. 255 (swept clean). Strokes add with saturation, so the order of strokes does not matter.
 */
export class DetailRing {
  readonly size: number;
  readonly texelMm: number;
  readonly texels: Uint8Array;
  /** Texels written by strokes since the last takeDirtyTexels() (GPU upload estimate). */
  private dirtyTexels = 0;
  private readonly radiusMm: number;
  /** Anchor frame: normal, east, north (3 doubles each). */
  private readonly f = new Float64Array(9);
  /** Scratch: projected point x, y (mm in the anchor plane). */
  private readonly p = new Float64Array(2);
  private anchored = false;
  /** Window origin in global texel coordinates (toroidal index = global mod size). */
  private gx0 = 0;
  private gy0 = 0;
  /** Global texel coordinates of the anchor plane origin. */
  private shiftX = 0;
  private shiftY = 0;

  get isAnchored(): boolean {
    return this.anchored;
  }

  constructor(size: number, texelMm: number, radiusM: number) {
    this.size = size;
    this.texelMm = texelMm;
    this.radiusMm = radiusM * 1000;
    this.texels = new Uint8Array(size * size);
  }

  private setAnchor(x: number, y: number, z: number): void {
    const f = this.f;
    // east = normalise(Y x n), north = n x east (WDS 2.7); near a pole east falls back to +X.
    let ex = z;
    let ez = -x;
    const l = Math.sqrt(ex * ex + ez * ez);
    if (l < 1e-9) {
      ex = 1;
      ez = 0;
    } else {
      ex /= l;
      ez /= l;
    }
    f[0] = x;
    f[1] = y;
    f[2] = z;
    f[3] = ex;
    f[4] = 0;
    f[5] = ez;
    f[6] = y * ez;
    f[7] = z * ex - x * ez;
    f[8] = -y * ex;
  }

  /** Gnomonic projection of a (not necessarily unit) direction into the anchor plane, millimetres, into `p`. */
  private project(x: number, y: number, z: number): void {
    const f = this.f;
    const k = this.radiusMm / (x * (f[0] ?? 0) + y * (f[1] ?? 0) + z * (f[2] ?? 1));
    this.p[0] = (x * (f[3] ?? 0) + y * (f[4] ?? 0) + z * (f[5] ?? 0)) * k;
    this.p[1] = (x * (f[6] ?? 0) + y * (f[7] ?? 0) + z * (f[8] ?? 0)) * k;
  }

  /** Centres the window on the unit direction of the Custodian. Texels that scroll out are cleared (trails are lost). */
  centerOn(x: number, y: number, z: number): void {
    const size = this.size;
    if (!this.anchored) {
      this.setAnchor(x, y, z);
      this.anchored = true;
      this.gx0 = -(size >> 1);
      this.gy0 = -(size >> 1);
      return;
    }
    this.project(x, y, z);
    let cx = Math.floor((this.p[0] ?? 0) / this.texelMm);
    let cy = Math.floor((this.p[1] ?? 0) / this.texelMm);
    const far = (this.p[0] ?? 0) * (this.p[0] ?? 0) + (this.p[1] ?? 0) * (this.p[1] ?? 0) > REANCHOR_MM * REANCHOR_MM;
    const nx = cx + this.shiftX - (size >> 1);
    const ny = cy + this.shiftY - (size >> 1);
    this.scroll(nx, ny);
    if (far) {
      // Translation-only re-anchor: the texel under the Custodian keeps its content, the plane basis moves there.
      this.shiftX += cx;
      this.shiftY += cy;
      this.setAnchor(x, y, z);
      cx = 0;
      cy = 0;
    }
  }

  private scroll(nx: number, ny: number): void {
    const size = this.size;
    const dx = nx - this.gx0;
    const dy = ny - this.gy0;
    if (dx === 0 && dy === 0) return;
    const t = this.texels;
    if (dx >= size || dx <= -size || dy >= size || dy <= -size) {
      t.fill(0);
    } else {
      // Rows that leave the window are reused for the newly exposed strip: clear them.
      const rowFrom = dy > 0 ? this.gy0 : ny;
      const rows = dy > 0 ? dy : -dy;
      for (let r = 0; r < rows; r++) {
        const row = (((rowFrom + r) % size) + size) % size;
        t.fill(0, row * size, row * size + size);
      }
      const colFrom = dx > 0 ? this.gx0 : nx;
      const cols = dx > 0 ? dx : -dx;
      for (let c = 0; c < cols; c++) {
        const col = (((colFrom + c) % size) + size) % size;
        for (let i = col; i < t.length; i += size) t[i] = 0;
      }
    }
    this.gx0 = nx;
    this.gy0 = ny;
  }

  /**
   * Draws one stroke (round-capped capsule, 1-texel anti-aliased edge). `frame` is the anchor plot's tangent frame,
   * `strength` the share of the layer one full-coverage pass removes (min(1, depth16 / u0), WDS 7.3). Returns the
   * number of texels written.
   */
  drawStroke(frame: PlotFrame, s: StrokeRecord, strength: number): number {
    if (!this.anchored || strength <= 0) return 0;
    const n = frame.normal;
    const e = frame.east;
    const t = frame.north;
    const inv = 1 / this.radiusMm;
    const su = s.startUMm * inv;
    const sv = s.startVMm * inv;
    this.project(n.x + su * e.x + sv * t.x, n.y + su * e.y + sv * t.y, n.z + su * e.z + sv * t.z);
    const texel = this.texelMm;
    const ax = (this.p[0] ?? 0) / texel + this.shiftX;
    const ay = (this.p[1] ?? 0) / texel + this.shiftY;
    const eu = s.endUMm * inv;
    const ev = s.endVMm * inv;
    this.project(n.x + eu * e.x + ev * t.x, n.y + eu * e.y + ev * t.y, n.z + eu * e.z + ev * t.z);
    const bx = (this.p[0] ?? 0) / texel + this.shiftX;
    const by = (this.p[1] ?? 0) / texel + this.shiftY;
    const half = (s.widthCm * 5) / texel;
    const size = this.size;
    const reach = half + 1;
    let x0 = Math.floor((ax < bx ? ax : bx) - reach);
    let x1 = Math.ceil((ax > bx ? ax : bx) + reach);
    let y0 = Math.floor((ay < by ? ay : by) - reach);
    let y1 = Math.ceil((ay > by ? ay : by) + reach);
    if (x0 < this.gx0) x0 = this.gx0;
    if (y0 < this.gy0) y0 = this.gy0;
    if (x1 > this.gx0 + size - 1) x1 = this.gx0 + size - 1;
    if (y1 > this.gy0 + size - 1) y1 = this.gy0 + size - 1;
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const tex = this.texels;
    const gain = 255 * (strength > 1 ? 1 : strength);
    let written = 0;
    for (let gy = y0; gy <= y1; gy++) {
      const row = ((gy % size) + size) % size;
      const py = gy + 0.5 - ay;
      for (let gx = x0; gx <= x1; gx++) {
        const px = gx + 0.5 - ax;
        let h = len2 > 0 ? (px * dx + py * dy) / len2 : 0;
        h = h < 0 ? 0 : h > 1 ? 1 : h;
        const qx = px - h * dx;
        const qy = py - h * dy;
        const d2 = qx * qx + qy * qy;
        if (d2 >= reach * reach) continue;
        let cov = half - Math.sqrt(d2) + 0.5;
        if (cov <= 0) continue;
        if (cov > 1) cov = 1;
        const i = row * size + (((gx % size) + size) % size);
        const v = (tex[i] ?? 0) + Math.round(gain * cov);
        tex[i] = v > 255 ? 255 : v;
        written++;
      }
    }
    this.dirtyTexels += written;
    return written;
  }

  /** Swept share 0..1 at a direction (nearest texel); 0 outside the window. */
  sweptAt(x: number, y: number, z: number): number {
    if (!this.anchored) return 0;
    this.project(x, y, z);
    const gx = Math.floor((this.p[0] ?? 0) / this.texelMm) + this.shiftX;
    const gy = Math.floor((this.p[1] ?? 0) / this.texelMm) + this.shiftY;
    const size = this.size;
    if (gx < this.gx0 || gy < this.gy0 || gx >= this.gx0 + size || gy >= this.gy0 + size) return 0;
    return (this.texels[(((gy % size) + size) % size) * size + (((gx % size) + size) % size)] ?? 0) / 255;
  }

  /** Swept share 0..1 at a direction, bilinear between texel centres (what a filtered GPU sample returns). */
  sweptBilinearAt(x: number, y: number, z: number): number {
    if (!this.anchored) return 0;
    this.project(x, y, z);
    const fx = (this.p[0] ?? 0) / this.texelMm + this.shiftX - 0.5;
    const fy = (this.p[1] ?? 0) / this.texelMm + this.shiftY - 0.5;
    const ix = Math.floor(fx);
    const iy = Math.floor(fy);
    const size = this.size;
    if (ix < this.gx0 || iy < this.gy0 || ix + 1 >= this.gx0 + size || iy + 1 >= this.gy0 + size) return 0;
    const tx = fx - ix;
    const ty = fy - iy;
    const c0 = ((ix % size) + size) % size;
    const c1 = (((ix + 1) % size) + size) % size;
    const r0 = (((iy % size) + size) % size) * size;
    const r1 = ((((iy + 1) % size) + size) % size) * size;
    const t = this.texels;
    const top = (t[r0 + c0] ?? 0) * (1 - tx) + (t[r0 + c1] ?? 0) * tx;
    const bottom = (t[r1 + c0] ?? 0) * (1 - tx) + (t[r1 + c1] ?? 0) * tx;
    return (top * (1 - ty) + bottom * ty) / 255;
  }

  /** Clears all content and forgets the anchor (used between capture sessions). */
  reset(): void {
    this.texels.fill(0);
    this.anchored = false;
    this.shiftX = 0;
    this.shiftY = 0;
    this.dirtyTexels = 0;
  }

  /** Continuous global texel coordinates of a direction, written to out[at] and out[at + 1]. Needs an anchor. */
  texelCoords(x: number, y: number, z: number, out: Float64Array, at: number): void {
    this.project(x, y, z);
    out[at] = (this.p[0] ?? 0) / this.texelMm + this.shiftX;
    out[at + 1] = (this.p[1] ?? 0) / this.texelMm + this.shiftY;
  }

  private tex(gx: number, gy: number): number {
    const size = this.size;
    return this.texels[(((gy % size) + size) % size) * size + (((gx % size) + size) % size)] ?? 0;
  }

  /**
   * Edge reconstruction at continuous texel coordinates (fx, fy): the two local plateau levels and a crisp,
   * anti-aliased blend weight between them. A plain bilinear sample ramps over about two texels (7 cm on Medium); this
   * keeps the plateau values (so multi-pass thinning survives) and narrows every edge to about one screen pixel.
   *   out[0] = low plateau (swept share 0..1), out[1] = high plateau, out[2] = weight of the high plateau (0..1).
   * (jxx, jyx) and (jxy, jyy) are the changes of (fx, fy) per screen pixel in x and in y (what fwidth sees on a GPU).
   * Cost: 16 texel fetches (4 gathers). Within 2 texels of a strong edge, weaker level differences are absorbed.
   */
  edgeAt(fx: number, fy: number, jxx: number, jyx: number, jxy: number, jyy: number, out: Float64Array): void {
    out[0] = 0;
    out[1] = 0;
    out[2] = 0;
    if (!this.anchored) return;
    const ix = Math.floor(fx - 0.5);
    const iy = Math.floor(fy - 0.5);
    const size = this.size;
    if (ix - 2 < this.gx0 || iy - 2 < this.gy0 || ix + 3 >= this.gx0 + size || iy + 3 >= this.gy0 + size) return;
    const tx = fx - 0.5 - ix;
    const ty = fy - 0.5 - iy;
    const s00 = this.tex(ix, iy);
    const s10 = this.tex(ix + 1, iy);
    const s01 = this.tex(ix, iy + 1);
    const s11 = this.tex(ix + 1, iy + 1);
    let lo = s00 < s10 ? s00 : s10;
    let hi = s00 > s10 ? s00 : s10;
    if (s01 < lo) lo = s01;
    if (s01 > hi) hi = s01;
    if (s11 < lo) lo = s11;
    if (s11 > hi) hi = s11;
    // 12 taps around the cell: 2 texels out along the axes, 1 texel out on the diagonals.
    for (let k = 0; k < 12; k++) {
      const ox = k < 2 ? -2 : k < 4 ? 3 : k < 8 ? (k & 1) : k < 10 ? -1 : 2;
      const oy = k < 4 ? (k & 1) : k < 6 ? -2 : k < 8 ? 3 : (k & 1) === 0 ? -1 : 2;
      const v = this.tex(ix + ox, iy + oy);
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    const s0 = (s00 * (1 - tx) + s10 * tx) * (1 - ty) + (s01 * (1 - tx) + s11 * tx) * ty;
    const range = hi - lo;
    if (range < 2) {
      out[0] = s0 / 255;
      out[1] = s0 / 255;
      return;
    }
    const gx = ((s10 - s00) * (1 - ty) + (s11 - s01) * ty) / range;
    const gy = ((s01 - s00) * (1 - tx) + (s11 - s10) * tx) / range;
    const fw = Math.abs(gx * jxx + gy * jyx) + Math.abs(gx * jxy + gy * jyy);
    let w = 0.8 * fw;
    w = w < 0.01 ? 0.01 : w > 0.5 ? 0.5 : w;
    let e = ((s0 - lo) / range - (0.5 - w)) / (2 * w);
    e = e < 0 ? 0 : e > 1 ? 1 : e;
    out[0] = lo / 255;
    out[1] = hi / 255;
    out[2] = e * e * (3 - 2 * e);
  }

  takeDirtyTexels(): number {
    const n = this.dirtyTexels;
    this.dirtyTexels = 0;
    return n;
  }
}
