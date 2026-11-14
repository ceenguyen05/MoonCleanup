// Pixel statistics for the look-dev checks (VT-M0-04b, 16): mean colour of a patch, Rec.709 luma of 8-bit sRGB values, CIELAB
// b*. Pure: works on RGBA byte arrays, so it is unit-tested without a browser.

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export interface PatchStats {
  readonly r: number;
  readonly g: number;
  readonly b: number;
  /** Rec.709 luma of the 8-bit sRGB mean, 0..255. */
  readonly luma: number;
  /** CIELAB b* of the mean colour (D65). */
  readonly labB: number;
}

export function meanPatch(rgba: Uint8ClampedArray | Uint8Array, width: number, height: number, rect: Rect): PatchStats {
  const x0 = Math.max(0, Math.round(rect.x));
  const y0 = Math.max(0, Math.round(rect.y));
  const x1 = Math.min(width, Math.round(rect.x + rect.w));
  const y1 = Math.min(height, Math.round(rect.y + rect.h));
  let r = 0;
  let g = 0;
  let b = 0;
  let n = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * width + x) * 4;
      r += rgba[i] ?? 0;
      g += rgba[i + 1] ?? 0;
      b += rgba[i + 2] ?? 0;
      n++;
    }
  }
  if (n === 0) return { r: 0, g: 0, b: 0, luma: 0, labB: 0 };
  r /= n;
  g /= n;
  b /= n;
  return { r, g, b, luma: 0.2126 * r + 0.7152 * g + 0.0722 * b, labB: labBStar(r, g, b) };
}

function srgbToLinear(c8: number): number {
  const c = c8 / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/** CIELAB b* (D65) of an 8-bit sRGB colour. */
export function labBStar(r8: number, g8: number, b8: number): number {
  const r = srgbToLinear(r8);
  const g = srgbToLinear(g8);
  const b = srgbToLinear(b8);
  const y = 0.2126729 * r + 0.7151522 * g + 0.072175 * b;
  const z = (0.0193339 * r + 0.119192 * g + 0.9503041 * b) / 1.08883;
  const f = (t: number): number => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 / 116) * t + 16 / 116);
  return 200 * (f(y) - f(z));
}

/** Largest luma step between horizontally adjacent patches of width `step` along a row band (VT-M0-15 seam check). */
export function maxLumaStep(
  rgba: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
  band: Rect,
  step: number,
): number {
  let last: number | null = null;
  let worst = 0;
  for (let x = band.x; x + step <= band.x + band.w; x += step) {
    const { luma } = meanPatch(rgba, width, height, { x, y: band.y, w: step, h: band.h });
    if (last !== null) worst = Math.max(worst, Math.abs(luma - last));
    last = luma;
  }
  return worst;
}
