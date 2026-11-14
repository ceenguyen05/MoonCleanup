// Pure pixel analysis of the r187 verification matrix (M0-W2-T07). The page decodes a screenshot into RGBA bytes and
// these functions turn named screen rectangles into numbers; verdicts compare the numbers (`rows`). No DOM, no three.

/** Screen rectangle in fractions of the image (0..1, y down). */
export interface Rect {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

export interface RegionStats {
  /** Pixels in the region. */
  readonly pixels: number;
  /** Mean display value 0..255 per channel and Rec.709 luma of the display values. */
  readonly r: number;
  readonly g: number;
  readonly b: number;
  readonly luma: number;
  /** Mean of |dLuma/dx| + |dLuma/dy| over the region (0..255 per pixel): a sharpness / detail measure. */
  readonly edge: number;
  /** Mean of dLuma/dx squared + dLuma/dy squared: falls when an edge is blurred (the plain `edge` sum does not). */
  readonly edgeSq: number;
  /** Fraction of pixels whose red / green / blue channel beats both others by more than 40. */
  readonly redFrac: number;
  readonly greenFrac: number;
  readonly blueFrac: number;
  /** Fraction of pixels strictly between 20 % and 80 % of the way from the region's 5th to its 95th luma percentile. */
  readonly transitionFrac: number;
  /** Lowest and highest luma in the region (5th and 95th percentile). */
  readonly lumaLo: number;
  readonly lumaHi: number;
}

export interface ImageRgba {
  readonly width: number;
  readonly height: number;
  readonly data: ArrayLike<number>;
}

const DOMINANCE = 40;

/** Rec.709 luma of display-referred bytes. */
export function lumaOf(r: number, g: number, b: number): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** sRGB byte of a linear value (what `renderOutput` writes for a pixel of that linear value, no tone mapping). */
export function linearToSrgbByte(linear: number): number {
  const v = Math.min(1, Math.max(0, linear));
  const encoded = v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
  return Math.round(encoded * 255);
}

/** Pixel bounds of a rectangle, clamped to the image; at least one pixel. */
export function pixelBounds(
  image: { readonly width: number; readonly height: number },
  rect: Rect,
): { x0: number; y0: number; x1: number; y1: number } {
  const x0 = Math.max(0, Math.min(image.width - 1, Math.floor(Math.min(rect.x0, rect.x1) * image.width)));
  const y0 = Math.max(0, Math.min(image.height - 1, Math.floor(Math.min(rect.y0, rect.y1) * image.height)));
  const x1 = Math.max(x0 + 1, Math.min(image.width, Math.ceil(Math.max(rect.x0, rect.x1) * image.width)));
  const y1 = Math.max(y0 + 1, Math.min(image.height, Math.ceil(Math.max(rect.y0, rect.y1) * image.height)));
  return { x0, y0, x1, y1 };
}

export function regionStats(image: ImageRgba, rect: Rect): RegionStats {
  const { x0, y0, x1, y1 } = pixelBounds(image, rect);
  const { width, data } = image;
  let r = 0;
  let g = 0;
  let b = 0;
  let edge = 0;
  let edgeSq = 0;
  let red = 0;
  let green = 0;
  let blue = 0;
  let n = 0;
  const lumas: number[] = [];
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * width + x) * 4;
      const pr = data[i] ?? 0;
      const pg = data[i + 1] ?? 0;
      const pb = data[i + 2] ?? 0;
      r += pr;
      g += pg;
      b += pb;
      if (pr > pg + DOMINANCE && pr > pb + DOMINANCE) red++;
      else if (pg > pr + DOMINANCE && pg > pb + DOMINANCE) green++;
      else if (pb > pr + DOMINANCE && pb > pg + DOMINANCE) blue++;
      const l = lumaOf(pr, pg, pb);
      lumas.push(l);
      if (x + 1 < x1 && y + 1 < y1) {
        const j = (y * width + x + 1) * 4;
        const k = ((y + 1) * width + x) * 4;
        const lx = lumaOf(data[j] ?? 0, data[j + 1] ?? 0, data[j + 2] ?? 0);
        const ly = lumaOf(data[k] ?? 0, data[k + 1] ?? 0, data[k + 2] ?? 0);
        edge += Math.abs(lx - l) + Math.abs(ly - l);
        edgeSq += (lx - l) * (lx - l) + (ly - l) * (ly - l);
      }
      n++;
    }
  }
  const sorted = lumas.slice().sort((a, b2) => a - b2);
  const lo = sorted[Math.floor(0.05 * (sorted.length - 1))] ?? 0;
  const hi = sorted[Math.floor(0.95 * (sorted.length - 1))] ?? 0;
  let transition = 0;
  if (hi - lo > 4) {
    const a = lo + 0.2 * (hi - lo);
    const c = lo + 0.8 * (hi - lo);
    for (const l of lumas) if (l > a && l < c) transition++;
  }
  const count = Math.max(1, n);
  return {
    pixels: n,
    r: r / count,
    g: g / count,
    b: b / count,
    luma: lumaOf(r / count, g / count, b / count),
    edge: edge / count,
    edgeSq: edgeSq / count,
    redFrac: red / count,
    greenFrac: green / count,
    blueFrac: blue / count,
    transitionFrac: transition / count,
    lumaLo: lo,
    lumaHi: hi,
  };
}

/** Stats of every named rectangle. */
export function analyseRegions(image: ImageRgba, regions: Readonly<Record<string, Rect>>): Record<string, RegionStats> {
  const out: Record<string, RegionStats> = {};
  for (const name of Object.keys(regions)) {
    const rect = regions[name];
    if (rect !== undefined) out[name] = regionStats(image, rect);
  }
  return out;
}

/** Rectangle around the projection of the corners of an axis-aligned box (NDC corners in, image fractions out). */
export function rectFromNdc(ndc: readonly { readonly x: number; readonly y: number }[]): Rect {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const p of ndc) {
    const sx = (p.x + 1) / 2;
    const sy = (1 - p.y) / 2;
    x0 = Math.min(x0, sx);
    x1 = Math.max(x1, sx);
    y0 = Math.min(y0, sy);
    y1 = Math.max(y1, sy);
  }
  return { x0: Math.max(0, x0), y0: Math.max(0, y0), x1: Math.min(1, x1), y1: Math.min(1, y1) };
}

/** Shrinks a rectangle towards its centre by `factor` (0..1 of its size kept per axis). */
export function shrinkRect(rect: Rect, factor: number): Rect {
  const cx = (rect.x0 + rect.x1) / 2;
  const cy = (rect.y0 + rect.y1) / 2;
  const hw = ((rect.x1 - rect.x0) / 2) * factor;
  const hh = ((rect.y1 - rect.y0) / 2) * factor;
  return { x0: cx - hw, y0: cy - hh, x1: cx + hw, y1: cy + hh };
}
