/** visual-target 6.6 file naming. Single implementation; tests pin the examples from the spec. */

export type Tod = "dawn" | "morning" | "noon" | "dusk" | "night-near" | "night-far" | "polar";
export type Tier = "A" | "B" | "C";
export type Preset = "low" | "medium" | "high" | "ultra";
export type Backend = "webgpu" | "webgpu-compat" | "webgl2";
export type HudMode = "hud" | "nohud" | "dbg";

export interface CaptureName {
  /** e.g. "S02", "S01a" (a/b suffix is part of the scene id). */
  readonly scene: string;
  readonly tod: Tod;
  readonly tier: Tier;
  readonly preset: Preset;
  readonly backend: Backend;
  /** Output (canvas) pixel size; the PNG size is exactly width x height. */
  readonly width: number;
  readonly height: number;
  readonly dpr: number;
  readonly hud: HudMode;
  readonly scale?: "floor" | "ceil";
  readonly variant?: string;
}

export function captureFileName(n: CaptureName): string {
  const parts = [`${n.scene}-${n.tod}-tier${n.tier}-${n.preset}-${n.backend}-${n.width}x${n.height}@${n.dpr}-${n.hud}`];
  if (n.scale) parts.push(n.scale);
  if (n.variant) parts.push(n.variant);
  return parts.join("-") + ".png";
}

/** 512x512 100% crop name: `crop/<name minus .png>-<label>-x<X>y<Y>.png` */
export function cropFileName(base: string, label: string, x: number, y: number): string {
  return `crop/${base.replace(/\.png$/, "")}-${label}-x${x}y${y}.png`;
}

export function sidecarName(pngName: string): string {
  return pngName.replace(/\.png$/, ".json");
}

/** PNG pixel size for a CSS viewport and DPR (PNG size = CSS size x DPR, never resized). */
export function pngSize(cssW: number, cssH: number, dpr: number): { width: number; height: number } {
  return { width: Math.round(cssW * dpr), height: Math.round(cssH * dpr) };
}
