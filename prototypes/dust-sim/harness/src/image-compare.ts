// Pure-TS image comparison helpers for the dust contest: edge width, coverage, sweep-vs-dissolve correlation.
// Images are single-channel float rasters (luma or dust opacity), row-major, so any renderer's PNG decoder can feed them.
import { CAPTURE_VIEW, pixelFootprintM } from "./capture-scene";

export interface GrayImage {
  readonly width: number;
  readonly height: number;
  /** width*height values, row-major, nominally 0..1. */
  readonly data: Float32Array | readonly number[];
}

export function makeImage(width: number, height: number, fill = 0): { width: number; height: number; data: Float32Array } {
  const data = new Float32Array(width * height);
  if (fill !== 0) data.fill(fill);
  return { width, height, data };
}

export interface Rect {
  readonly x0: number;
  readonly y0: number;
  /** Exclusive. */
  readonly x1: number;
  readonly y1: number;
}

const full = (img: GrayImage): Rect => ({ x0: 0, y0: 0, x1: img.width, y1: img.height });

// ---- Edge width -------------------------------------------------------------------------------------------------------
//
// DEFINITION (lead decision flagged in the README): the edge width is the 10-90 % rise distance, in screen pixels, of the
// mean profile across a clean/dirty boundary. The profile is the mean of the rows (or columns) of a crop whose edge runs
// perpendicular to `axis`; low level = mean of the outer 10 % of the profile on one side, high level = the other side.
// Positions of the 10 % and 90 % crossings are linearly interpolated (sub-pixel). Measured from OPACITY (dust opacity
// 0..1 or luma, normalised by the two plateau levels), never from a thresholded mask, so a hard 1-texel step gives its
// real softness and a wide dissolve is not hidden by a 50 % threshold.

export interface EdgeOptions {
  /** `x`: profile runs along x (a vertical edge, averaged over rows). `y`: profile along y. */
  readonly axis: "x" | "y";
  readonly rect?: Rect;
  /** Minimum plateau contrast (|high - low|) below which no edge is reported. Default 0.05. */
  readonly minContrast?: number;
}

export function meanProfile(img: GrayImage, axis: "x" | "y", rect: Rect = full(img)): number[] {
  const len = axis === "x" ? rect.x1 - rect.x0 : rect.y1 - rect.y0;
  const cross = axis === "x" ? rect.y1 - rect.y0 : rect.x1 - rect.x0;
  const out = new Array<number>(len).fill(0);
  for (let i = 0; i < len; i++) {
    let s = 0;
    for (let j = 0; j < cross; j++) {
      const x = axis === "x" ? rect.x0 + i : rect.x0 + j;
      const y = axis === "x" ? rect.y0 + j : rect.y0 + i;
      s += img.data[y * img.width + x] ?? 0;
    }
    out[i] = s / cross;
  }
  return out;
}

/** 10-90 % rise width of a 1-D profile in samples (sub-sample). Null if there is no single clear transition. */
export function riseWidth10to90(profile: readonly number[], minContrast = 0.05): number | null {
  const n = profile.length;
  if (n < 4) return null;
  const k = Math.max(1, Math.floor(n / 10));
  const mean = (a: number, b: number): number => {
    let s = 0;
    for (let i = a; i < b; i++) s += profile[i] ?? 0;
    return s / (b - a);
  };
  const first = mean(0, k);
  const last = mean(n - k, n);
  if (Math.abs(last - first) < minContrast) return null;
  const norm = profile.map((v) => (v - first) / (last - first)); // 0 at the start plateau, 1 at the end plateau
  const cross = (level: number): number | null => {
    // First crossing from below level to at/above level, scanning from the start plateau.
    for (let i = 1; i < n; i++) {
      const a = norm[i - 1] ?? 0;
      const b = norm[i] ?? 0;
      if (a < level && b >= level) return i - 1 + (level - a) / (b - a);
    }
    return null;
  };
  const x10 = cross(0.1);
  const x90 = cross(0.9);
  if (x10 === null || x90 === null) return null;
  return Math.max(0, x90 - x10);
}

export function edgeWidthPx(img: GrayImage, opt: EdgeOptions): number | null {
  return riseWidth10to90(meanProfile(img, opt.axis, opt.rect ?? full(img)), opt.minContrast ?? 0.05);
}

/** Convert a screen-pixel edge width to world centimetres at `distM` (flat ground facing the camera; foreshortening ignored). */
export function edgeWidthCm(px: number, distM: number, view = CAPTURE_VIEW): number {
  return px * pixelFootprintM(distM, view) * 100;
}

/** Convert a world width in cm to screen pixels at `distM`. */
export function cmToPx(cm: number, distM: number, view = CAPTURE_VIEW): number {
  return cm / 100 / pixelFootprintM(distM, view);
}

// ---- Edge bars --------------------------------------------------------------------------------------------------------

/**
 * Bars for the edge. Sources: WDS section 10 S1 "edge <= 2 px at 2 m" (px at CAPTURE_VIEW, 1080p, vFOV 60: one pixel is
 * 2.14 mm at 2 m, so 2 px = 4.3 mm); visual-target section 2.2 stroke-edge 10-90 % <= 2 cm world (<= 6 px at 3 m).
 * These two disagree by about 5x at 2 m (2 cm = 9.3 px). The harness reports both and gates on the WDS one
 * (primary); the visual-target one is the secondary "release" bar. LEAD DECISION recorded in the T02b report.
 */
export const EDGE_BARS = {
  /** Primary, from the contest decision rule. */
  wdsPxAt2m: { limitPx: 2, distM: 2 },
  /** Secondary, from the visual target. */
  visualTargetCm: { limitCm: 2 },
} as const;

export interface EdgeVerdict {
  readonly px: number | null;
  readonly cm: number | null;
  readonly passWds: boolean | null;
  readonly passVisualTarget: boolean | null;
}

export function judgeEdge(px: number | null, distM: number): EdgeVerdict {
  if (px === null) return { px, cm: null, passWds: null, passVisualTarget: null };
  const cm = edgeWidthCm(px, distM);
  return {
    px,
    cm,
    passWds: distM === EDGE_BARS.wdsPxAt2m.distM ? px <= EDGE_BARS.wdsPxAt2m.limitPx : null,
    passVisualTarget: cm <= EDGE_BARS.visualTargetCm.limitCm,
  };
}

// ---- Coverage ---------------------------------------------------------------------------------------------------------

/** Fraction of pixels in `rect` whose value is >= `threshold` (cleaned fraction when the image is "brightness"). */
export function coverageAtLeast(img: GrayImage, threshold: number, rect: Rect = full(img)): number {
  let hit = 0;
  let n = 0;
  for (let y = rect.y0; y < rect.y1; y++) {
    for (let x = rect.x0; x < rect.x1; x++) {
      n++;
      if ((img.data[y * img.width + x] ?? 0) >= threshold) hit++;
    }
  }
  return n === 0 ? 0 : hit / n;
}

/** Mean absolute per-pixel difference between two same-size images, 0..1 for 0..1 data. */
export function meanAbsDiff(a: GrayImage, b: GrayImage): number {
  assertSameSize(a, b);
  let s = 0;
  const n = a.width * a.height;
  for (let i = 0; i < n; i++) s += Math.abs((a.data[i] ?? 0) - (b.data[i] ?? 0));
  return n === 0 ? 0 : s / n;
}

// ---- Sweep vs dissolve correlation -------------------------------------------------------------------------------------

export interface PixelSweep {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
  readonly widthPx: number;
}

/** Expected "cleaned" mask (1 inside any capsule of the sweeps, else 0), used as the sweep side of the correlation. */
export function rasterizeSweeps(width: number, height: number, sweeps: readonly PixelSweep[]): GrayImage {
  const img = makeImage(width, height);
  for (const s of sweeps) {
    const r = s.widthPx / 2;
    const dx = s.x1 - s.x0;
    const dy = s.y1 - s.y0;
    const len2 = dx * dx + dy * dy;
    const xa = Math.max(0, Math.floor(Math.min(s.x0, s.x1) - r));
    const xb = Math.min(width - 1, Math.ceil(Math.max(s.x0, s.x1) + r));
    const ya = Math.max(0, Math.floor(Math.min(s.y0, s.y1) - r));
    const yb = Math.min(height - 1, Math.ceil(Math.max(s.y0, s.y1) + r));
    for (let y = ya; y <= yb; y++) {
      for (let x = xa; x <= xb; x++) {
        const t = len2 === 0 ? 0 : Math.min(1, Math.max(0, ((x + 0.5 - s.x0) * dx + (y + 0.5 - s.y0) * dy) / len2));
        const px = s.x0 + t * dx - (x + 0.5);
        const py = s.y0 + t * dy - (y + 0.5);
        if (px * px + py * py <= r * r) img.data[y * width + x] = 1;
      }
    }
  }
  return img;
}

/** Pearson correlation of two same-size images; 0 when either is constant. Used for sweep mask vs observed dissolve. */
export function pearson(a: GrayImage, b: GrayImage): number {
  assertSameSize(a, b);
  const n = a.width * a.height;
  if (n === 0) return 0;
  let ma = 0;
  let mb = 0;
  for (let i = 0; i < n; i++) {
    ma += a.data[i] ?? 0;
    mb += b.data[i] ?? 0;
  }
  ma /= n;
  mb /= n;
  let sab = 0;
  let saa = 0;
  let sbb = 0;
  for (let i = 0; i < n; i++) {
    const da = (a.data[i] ?? 0) - ma;
    const db = (b.data[i] ?? 0) - mb;
    sab += da * db;
    saa += da * da;
    sbb += db * db;
  }
  return saa === 0 || sbb === 0 ? 0 : sab / Math.sqrt(saa * sbb);
}

/**
 * Correlation between where the sweeps went (expected cleaned mask) and the cleaned-ness observed in a capture, where
 * `cleanedness` = 1 - dustOpacity (or normalised brightness). A bar of >= 0.9 is proposed (INFO until the lead sets one).
 */
export function sweepDissolveCorrelation(cleanedness: GrayImage, sweeps: readonly PixelSweep[]): number {
  return pearson(rasterizeSweeps(cleanedness.width, cleanedness.height, sweeps), cleanedness);
}

function assertSameSize(a: GrayImage, b: GrayImage): void {
  if (a.width !== b.width || a.height !== b.height) {
    throw new Error(`image size mismatch: ${a.width}x${a.height} vs ${b.width}x${b.height}`);
  }
}
