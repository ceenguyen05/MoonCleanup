import { clampRect, fullRect, lumaPlane, type Img, type Rect } from "./image";

/** Every result carries the pixel rect it was computed over so reviewers can open the PNG and spot-check. */
export interface Located<T> {
  readonly value: T;
  readonly rect: Rect;
}

/** Mean luma (0..255, Rec.709 on sRGB-encoded values) of a patch. */
export function lumaPatch(img: Img, rect: Rect): Located<number> {
  const r = clampRect(img, rect);
  const { plane } = lumaPlane(img, r);
  let s = 0;
  for (const v of plane) s += v;
  return { value: plane.length ? s / plane.length : 0, rect: r };
}

/** First sub-pixel position where the profile crosses `level` in the given direction. */
function cross(row: Float32Array, level: number, rising: boolean): number | null {
  for (let i = 1; i < row.length; i++) {
    const p = row[i - 1]!;
    const c = row[i]!;
    const hit = rising ? p < level && c >= level : p > level && c <= level;
    if (hit) return i - 1 + (level - p) / (c - p);
  }
  return null;
}

/**
 * 10-90 % edge width in pixels for a (near-)vertical edge inside `rect`.
 * Each row is a horizontal luma profile; the low/high plateaus are the min/max of the row.
 * Crossing positions use linear interpolation (sub-pixel). Result is the mean over rows with contrast >= minContrast.
 */
export function edgeWidth1090(img: Img, rect: Rect, minContrast = 16): Located<number> {
  const r = clampRect(img, rect);
  const { plane, w, h } = lumaPlane(img, r);
  let total = 0;
  let rows = 0;
  for (let y = 0; y < h; y++) {
    const row = plane.subarray(y * w, (y + 1) * w);
    let lo = Infinity;
    let hi = -Infinity;
    for (const v of row) {
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    if (hi - lo < minContrast) continue;
    const rising = (row[w - 1] ?? 0) > (row[0] ?? 0);
    const a = cross(row, lo + 0.1 * (hi - lo), rising);
    const b = cross(row, lo + 0.9 * (hi - lo), rising);
    if (a === null || b === null) continue;
    total += Math.abs(b - a);
    rows++;
  }
  return { value: rows ? total / rows : Number.NaN, rect: r };
}

/** RMS Sobel gradient magnitude of luma (edge energy / sharpness proxy), in luma units per pixel. */
export function sobelSharpness(img: Img, rect: Rect): Located<number> {
  const r = clampRect(img, rect);
  const { plane, w, h } = lumaPlane(img, r);
  let sum = 0;
  let n = 0;
  const at = (x: number, y: number): number => plane[y * w + x]!;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const gx =
        -at(x - 1, y - 1) +
        at(x + 1, y - 1) -
        2 * at(x - 1, y) +
        2 * at(x + 1, y) -
        at(x - 1, y + 1) +
        at(x + 1, y + 1);
      const gy =
        -at(x - 1, y - 1) -
        2 * at(x, y - 1) -
        at(x + 1, y - 1) +
        at(x - 1, y + 1) +
        2 * at(x, y + 1) +
        at(x + 1, y + 1);
      sum += gx * gx + gy * gy;
      n++;
    }
  }
  // RMS (not mean) magnitude: mean magnitude is conserved by blur, RMS energy drops, so it ranks sharpness.
  return { value: n ? Math.sqrt(sum / n) : 0, rect: r };
}

function srgbToLinear(c8: number): number {
  const c = c8 / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** CIELAB b* (D65) of one sRGB 8-bit colour. */
export function labBOf(r8: number, g8: number, b8: number): number {
  const r = srgbToLinear(r8);
  const g = srgbToLinear(g8);
  const b = srgbToLinear(b8);
  const y = 0.2126729 * r + 0.7151522 * g + 0.072175 * b;
  const z = (0.0193339 * r + 0.119192 * g + 0.9503041 * b) / 1.08883;
  const f = (t: number): number => (t > 216 / 24389 ? Math.cbrt(t) : ((24389 / 27) * t + 16) / 116);
  return 200 * (f(y) - f(z));
}

/** Mean CIELAB b* of a patch (positive = yellow, negative = blue). */
export function labB(img: Img, rect: Rect): Located<number> {
  const r = clampRect(img, rect);
  let s = 0;
  let n = 0;
  for (let y = 0; y < r.h; y++) {
    for (let x = 0; x < r.w; x++) {
      const i = ((r.y + y) * img.width + (r.x + x)) * 4;
      s += labBOf(img.data[i]!, img.data[i + 1]!, img.data[i + 2]!);
      n++;
    }
  }
  return { value: n ? s / n : 0, rect: r };
}

/** Disk size of the encoded PNG in bytes (pass the file contents). */
export function pngDiskSize(bytes: Uint8Array): number {
  return bytes.byteLength;
}

export interface StarOptions {
  /** Luma (0..255) a pixel must reach to belong to a star. */
  readonly threshold?: number;
  /** Largest blob (pixels, 4-connected) still counted as a star; bigger blobs (Earth, moon) are ignored. */
  readonly maxArea?: number;
}

/** Count of small bright blobs (stars) in a rect. */
export function starCount(img: Img, rect: Rect, opts: StarOptions = {}): Located<number> {
  const threshold = opts.threshold ?? 96;
  const maxArea = opts.maxArea ?? 16;
  const r = clampRect(img, rect);
  const { plane, w, h } = lumaPlane(img, r);
  const seen = new Uint8Array(w * h);
  const stack: number[] = [];
  let count = 0;
  for (let s = 0; s < w * h; s++) {
    if (seen[s] || plane[s]! < threshold) continue;
    let area = 0;
    seen[s] = 1;
    stack.push(s);
    while (stack.length) {
      const p = stack.pop()!;
      area++;
      const x = p % w;
      const y = (p - x) / w;
      const nb = [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, y > 0 ? p - w : -1, y < h - 1 ? p + w : -1];
      for (const q of nb) {
        if (q >= 0 && !seen[q] && plane[q]! >= threshold) {
          seen[q] = 1;
          stack.push(q);
        }
      }
    }
    if (area <= maxArea) count++;
  }
  return { value: count, rect: r };
}

/** Mean per-pixel luma variance across frames (shimmer / temporal instability). Identical frames give 0. */
export function temporalVariance(frames: readonly Img[], rect?: Rect): Located<number> {
  const first = frames[0];
  if (!first) return { value: 0, rect: { x: 0, y: 0, w: 0, h: 0 } };
  const r = clampRect(first, rect ?? fullRect(first));
  if (frames.length < 2) return { value: 0, rect: r };
  const planes = frames.map((f) => lumaPlane(f, r).plane);
  const n = planes.length;
  const px = r.w * r.h;
  let acc = 0;
  for (let i = 0; i < px; i++) {
    let mean = 0;
    for (const p of planes) mean += p[i]!;
    mean /= n;
    let v = 0;
    for (const p of planes) v += (p[i]! - mean) ** 2;
    acc += v / n;
  }
  return { value: px ? acc / px : 0, rect: r };
}

/** Fraction of pixels with luma above `floor` (smoke helper: is the canvas non-black?). */
export function nonBlackFraction(img: Img, floor = 4): number {
  const { plane } = lumaPlane(img, fullRect(img));
  let n = 0;
  for (const v of plane) if (v > floor) n++;
  return plane.length ? n / plane.length : 0;
}
