import { clampRect, luma709, type Img, type Rect } from "./image";
import { labB, lumaPatch, sobelSharpness, starCount } from "./measures";

/**
 * Per-region (ROI) measures (visual-target 6.7: patches and edge profiles, not only whole-frame numbers). Rects and lines are in
 * DEVICE pixels of the PNG; every result carries the rect it was computed over so a reviewer can open the PNG and spot-check.
 */
export interface PatchRoi {
  readonly kind: "patch";
  readonly name: string;
  readonly rect: Rect;
}
export interface LineRoi {
  readonly kind: "line";
  readonly name: string;
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}
export type RoiSpec = PatchRoi | LineRoi;

export interface PatchRoiResult {
  readonly kind: "patch";
  readonly rect: Rect;
  readonly lumaMean: number;
  readonly labB: number;
  readonly sobel: number;
  readonly stars: number;
}

export interface LineRoiResult {
  readonly kind: "line";
  readonly line: { x0: number; y0: number; x1: number; y1: number };
  readonly lengthPx: number;
  readonly lumaStart: number;
  readonly lumaEnd: number;
  /** 10-90 % width (px along the line) of the steepest transition; null when the line has no edge of >= 16 luma. */
  readonly edge1090Px: number | null;
  /** Device pixel of the steepest transition. */
  readonly edgeAt: { x: number; y: number } | null;
  /** Luma every pixel along the line (1 decimal), so a reviewer can re-derive any number. */
  readonly profile: readonly number[];
}
export type RoiResult = PatchRoiResult | LineRoiResult;

/** Luma at 1-px steps along a line (nearest pixel, clamped to the image). */
export function lineProfile(
  img: Img,
  l: Omit<LineRoi, "kind" | "name">,
): { luma: number[]; xs: number[]; ys: number[] } {
  const len = Math.max(1, Math.round(Math.hypot(l.x1 - l.x0, l.y1 - l.y0)));
  const luma: number[] = [];
  const xs: number[] = [];
  const ys: number[] = [];
  for (let i = 0; i <= len; i++) {
    const k = i / len;
    const x = Math.min(img.width - 1, Math.max(0, Math.round(l.x0 + (l.x1 - l.x0) * k)));
    const y = Math.min(img.height - 1, Math.max(0, Math.round(l.y0 + (l.y1 - l.y0) * k)));
    const p = (y * img.width + x) * 4;
    luma.push(luma709(img.data[p]!, img.data[p + 1]!, img.data[p + 2]!));
    xs.push(x);
    ys.push(y);
  }
  return { luma, xs, ys };
}

/**
 * Steepest transition of a 1-D luma profile and its 10-90 % width. Plateaus are the min/max inside +-`half` samples of the
 * steepest sample (so far-away features of a multi-feature line do not stretch the levels).
 */
export function profileEdge1090(
  luma: readonly number[],
  half = 12,
  minContrast = 16,
): { widthPx: number; index: number } | null {
  let best = -1;
  let bestG = 0;
  for (let i = 1; i < luma.length; i++) {
    const g = Math.abs(luma[i]! - luma[i - 1]!);
    if (g > bestG) {
      bestG = g;
      best = i;
    }
  }
  if (best < 0) return null;
  const a = Math.max(0, best - half);
  const b = Math.min(luma.length - 1, best + half);
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = a; i <= b; i++) {
    lo = Math.min(lo, luma[i]!);
    hi = Math.max(hi, luma[i]!);
  }
  if (hi - lo < minContrast) return null;
  const rising = luma[b]! > luma[a]!;
  const cross = (level: number): number | null => {
    for (let i = a + 1; i <= b; i++) {
      const p = luma[i - 1]!;
      const c = luma[i]!;
      if (rising ? p < level && c >= level : p > level && c <= level) return i - 1 + (level - p) / (c - p);
    }
    return null;
  };
  const x10 = cross(lo + 0.1 * (hi - lo));
  const x90 = cross(lo + 0.9 * (hi - lo));
  if (x10 === null || x90 === null) return null;
  return { widthPx: Math.abs(x90 - x10), index: best };
}

export function measureRoi(img: Img, roi: RoiSpec): RoiResult {
  if (roi.kind === "patch") {
    const rect = clampRect(img, roi.rect);
    return {
      kind: "patch",
      rect,
      lumaMean: lumaPatch(img, rect).value,
      labB: labB(img, rect).value,
      sobel: sobelSharpness(img, rect).value,
      stars: starCount(img, rect).value,
    };
  }
  const { luma, xs, ys } = lineProfile(img, roi);
  const edge = profileEdge1090(luma);
  return {
    kind: "line",
    line: { x0: roi.x0, y0: roi.y0, x1: roi.x1, y1: roi.y1 },
    lengthPx: luma.length - 1,
    lumaStart: luma[0] ?? 0,
    lumaEnd: luma[luma.length - 1] ?? 0,
    edge1090Px: edge === null ? null : edge.widthPx,
    edgeAt: edge === null ? null : { x: xs[edge.index]!, y: ys[edge.index]! },
    profile: luma.map((v) => Math.round(v * 10) / 10),
  };
}

export function measureRois(img: Img, rois: readonly RoiSpec[]): Record<string, RoiResult> {
  const out: Record<string, RoiResult> = {};
  for (const roi of rois) out[roi.name] = measureRoi(img, roi);
  return out;
}

/** Layout regions every scene gets: sky band (stars), horizon-ish middle, ground (bottom third), centre and left/right thirds. */
export function frameRois(width: number, height: number): PatchRoi[] {
  const r = (name: string, x: number, y: number, w: number, h: number): PatchRoi => ({
    kind: "patch",
    name,
    rect: { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) },
  });
  return [
    r("frame:upper", 0, 0, width, height * 0.2),
    r("frame:middle", 0, height * 0.4, width, height * 0.2),
    r("frame:lower", 0, height * (2 / 3), width, height / 3),
    r("frame:left", 0, 0, width / 3, height),
    r("frame:center", width / 3, height / 3, width / 3, height / 3),
    r("frame:right", (2 * width) / 3, 0, width / 3, height),
  ];
}

export interface RawProbes {
  readonly dpr: number;
  /** `__mcLookdev.probes()` in CSS px (S02 / S03). */
  readonly lookdev: {
    readonly chips: Readonly<Record<string, Rect>>;
    readonly lines: Readonly<Record<string, { x0: number; y0: number; x1: number; y1: number }>>;
  } | null;
  /** `__mcLook.probes()`: named world points projected to CSS px (S01, S05, S06). */
  readonly look: Readonly<Record<string, { px: { x: number; y: number; visible: boolean } }>> | null;
}

/** Probe patch size in CSS px for world probe points. */
export const PROBE_PATCH_CSS = 48;

/** Tight probe patch (CSS px): stays inside a small shadow, where the 48 px patch straddles its edge. */
export const PROBE_TIGHT_CSS = 16;

/** ROIs from the scene's own probes: albedo chips (patch), edge lines (line), visible world probes (patch). */
export function probeRois(p: RawProbes): RoiSpec[] {
  const out: RoiSpec[] = [];
  const k = p.dpr;
  for (const [id, c] of Object.entries(p.lookdev?.chips ?? {})) {
    out.push({
      kind: "patch",
      name: `chip:${id}`,
      rect: { x: Math.round(c.x * k), y: Math.round(c.y * k), w: Math.round(c.w * k), h: Math.round(c.h * k) },
    });
  }
  for (const [id, l] of Object.entries(p.lookdev?.lines ?? {})) {
    out.push({ kind: "line", name: `line:${id}`, x0: l.x0 * k, y0: l.y0 * k, x1: l.x1 * k, y1: l.y1 * k });
  }
  for (const [id, probe] of Object.entries(p.look ?? {})) {
    if (!probe.px.visible) continue;
    const s = PROBE_PATCH_CSS * k;
    const t = PROBE_TIGHT_CSS * k;
    out.push({
      kind: "patch",
      name: `probe16:${id}`,
      rect: {
        x: Math.round(probe.px.x * k - t / 2),
        y: Math.round(probe.px.y * k - t / 2),
        w: Math.round(t),
        h: Math.round(t),
      },
    });
    out.push({
      kind: "patch",
      name: `probe:${id}`,
      rect: {
        x: Math.round(probe.px.x * k - s / 2),
        y: Math.round(probe.px.y * k - s / 2),
        w: Math.round(s),
        h: Math.round(s),
      },
    });
  }
  return out;
}
