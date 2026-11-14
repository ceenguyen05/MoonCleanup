// URL parameters the render module honours (QA, support and the screenshot harness; M0-W1-T05 input contract).
// Pure parsing, no DOM access: the caller passes `location.search`.
//
//   ?backend=webgpu|webgl2   rendering-pipeline.md section 2.1 step 1 (override wins over detection)
//   ?preset=low|medium|high|ultra   forces the quality preset (clamped to what the backend offers, section 2.2)
//   ?dpr=<number>            replaces window.devicePixelRatio as the device value; the preset's DPR cap still applies
//   ?scale=floor|ceil|<n>    pins the render scale: the preset's dynamic-resolution floor or ceiling, or a fixed number
//                            (0.25..1, e.g. `?scale=1` for device captures; NOT limited to the preset's range). Any pin
//                            switches the dynamic-resolution controller off
//   ?dynres=off              keeps the render scale at its starting value without pinning it (the setter still works)
//   ?scene=smoke             adds the built-in backend-parity test mesh (VT-M0-09 smoke); other ids belong to the app
//   ?capture=1               frame-stepped capture mode (the composition root drives FrameLoop.step)

import { QUALITY_PRESET_IDS, type QualityPresetId } from "@moon-cleanup/shared";

/** The two values `?backend=` accepts. `webgpu-compat` cannot be requested: it is what `webgpu` may start as. */
export const BACKEND_OVERRIDES = ["webgpu", "webgl2"] as const;
export type BackendOverride = (typeof BACKEND_OVERRIDES)[number];

export const RENDER_SCALE_PINS = ["floor", "ceil"] as const;
/** A named end of the preset's range, or a fixed scale. */
export type RenderScalePin = (typeof RENDER_SCALE_PINS)[number] | number;

/** Limits of a numeric `?scale=`: the range `DynresQuality` allows for any preset. */
export const SCALE_PIN_MIN = 0.25;
export const SCALE_PIN_MAX = 1;

/** Scene id of the built-in parity test mesh. */
export const SMOKE_SCENE_ID = "smoke";

/** Limits of `?dpr=`: below 0.5 the canvas is unreadable, above 4 it only wastes memory. */
export const DPR_OVERRIDE_MIN = 0.5;
export const DPR_OVERRIDE_MAX = 4;

export interface RenderUrlOptions {
  readonly backend: BackendOverride | null;
  readonly preset: QualityPresetId | null;
  readonly dpr: number | null;
  readonly scale: RenderScalePin | null;
  /** `false` for `?dynres=off`; `null` = the default (on unless pinned or capturing). */
  readonly dynres: boolean | null;
  /** Raw `?scene=` value (any id); `null` when absent. */
  readonly scene: string | null;
  readonly capture: boolean;
}

function oneOf<T extends string>(values: readonly T[], raw: string | null): T | null {
  if (raw === null) return null;
  const lowered = raw.trim().toLowerCase();
  for (const value of values) {
    if (value === lowered) return value;
  }
  return null;
}

/** Parses `location.search` (with or without the leading `?`). Unknown or malformed values become `null`. */
export function parseRenderUrlOptions(search: string): RenderUrlOptions {
  const params = new URLSearchParams(search);
  const dprRaw = params.get("dpr");
  const dprNumber = dprRaw === null || dprRaw.trim() === "" ? Number.NaN : Number(dprRaw);
  const dpr = Number.isFinite(dprNumber) ? Math.min(DPR_OVERRIDE_MAX, Math.max(DPR_OVERRIDE_MIN, dprNumber)) : null;
  const scene = params.get("scene");
  const scaleRaw = params.get("scale");
  const scaleNumber = scaleRaw === null || scaleRaw.trim() === "" ? Number.NaN : Number(scaleRaw);
  const scalePin: RenderScalePin | null =
    oneOf(RENDER_SCALE_PINS, scaleRaw) ??
    (Number.isFinite(scaleNumber) ? Math.min(SCALE_PIN_MAX, Math.max(SCALE_PIN_MIN, scaleNumber)) : null);
  const dynresRaw = params.get("dynres")?.trim().toLowerCase() ?? "";
  return {
    backend: oneOf(BACKEND_OVERRIDES, params.get("backend")),
    preset: oneOf(QUALITY_PRESET_IDS, params.get("preset")),
    dpr,
    scale: scalePin,
    dynres: dynresRaw === "off" || dynresRaw === "0" ? false : dynresRaw === "on" || dynresRaw === "1" ? true : null,
    scene: scene === null || scene === "" ? null : scene,
    capture: params.get("capture") === "1",
  };
}
