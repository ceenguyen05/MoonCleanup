// Per-feature look knobs (M0-W3-T08): URL parameters that switch single stages of the look rig on or off, or swap them for a
// cheaper / more expensive variant, so the cost of each stage can be measured at equal pixels (`tools/perf --query "..."`)
// and a look can be compared A/B. Pure parsing, no DOM and no three: the caller passes `location.search`.
//
//   aa=smaa|fxaa|traa|none     anti-aliasing of the chain (default: the preset's); `fxaa` is the one-pass alternative to
//                              SMAA's three full-output-resolution passes
//   traa=on|off                shorthand: `on` = aa=traa, `off` = SMAA on a TRAA preset (`aa=` wins when both are given)
//   aainput=rgba8|half-float   format of the tone-mapped frame the spatial AA reads (default rgba8; half-float = the old path)
//   gtao=on|off                ambient occlusion (default: on exactly when the chain runs TRAA, as the presets do)
//   shadowres=512|1024|2048|4096   edge of one cascade's shadow map
//   cascades=0..4              number of sun cascades; 0 = no sun shadows at all
//   shadowfilter=vogel5|pcf3|pcf5|tent4|hard   PCF kernel (default: see `SunRig`): three's 5-tap Vogel disk with per-pixel
//                              dither, the exact 3x3 tent from 4 bilinear taps, the exact 5x5 tent from 9, the old fixed
//                              4-tap pattern (it has a hole at radius 2: kept for A/B), or one hardware 2x2 comparison
//   shadowfilter0=<id>         PCF kernel of cascade 0 only (default: the same as the other cascades)
//   pcf=<texels>               PCF radius in shadow texels (default: the preset's, capped as in `SunRig`)
//   bloom=off|quarter|half     bloom off, or the resolution of its first level
//   grade=look|neutral|off     reference-mood grade (default), the neutral calibration grade, or no grade stage at all
//   sky=<number>|off           backdrop gradient level (default 1, 0 = black space); `off` hides the whole sky rig
//   skyoff=dome,stars,earth,halo,sun   hides single sky parts
//   stars=layer|scene          stars drawn as a layer after the temporal resolve (default on TRAA chains) or inside the scene
//                              pass (default on SMAA / FXAA chains; `scene` on a TRAA chain = the old path, for A/B)
//   skydome=baked|procedural   backdrop evaluated from the baked sky texture (default) or per pixel from noise (the old path)
//   shadowkernel=square        the sun cascades' kernel keeps its full size on receivers the light grazes and every receiver
//                              takes the shadow normal offset (the rule before M0 look-polish round 4; A/B and cost only)
//   debug=cascades             tints the sunlight by shadow cascade: 0 red, 1 green, 2 blue, 3 yellow, past the last white
//                              (VT-M0-03 debug view; a debug view, not a look)
//
// Every knob defaults to "what the preset does": a URL without knobs runs the shipped look.

import type { QualitySettings } from "@moon-cleanup/shared";

export const LOOK_AA_MODES = ["smaa", "fxaa", "traa", "none"] as const;
export type LookAaMode = (typeof LOOK_AA_MODES)[number];

export const SHADOW_FILTER_IDS = ["vogel5", "pcf3", "pcf5", "tent4", "hard"] as const;
export type ShadowFilterId = (typeof SHADOW_FILTER_IDS)[number];

export const SHADOW_RES_STEPS = [512, 1024, 2048, 4096] as const;
export type ShadowResPx = (typeof SHADOW_RES_STEPS)[number];

export const LOOK_BLOOM_MODES = ["off", "quarter", "half"] as const;
export type LookBloomMode = (typeof LOOK_BLOOM_MODES)[number];

export const LOOK_GRADE_MODES = ["look", "neutral", "off"] as const;
export type LookGradeMode = (typeof LOOK_GRADE_MODES)[number];

export const SKY_PARTS = ["dome", "stars", "earth", "halo", "sun"] as const;
export type SkyPart = (typeof SKY_PARTS)[number];

export const SKY_DOME_MODES = ["baked", "procedural"] as const;
export type SkyDomeMode = (typeof SKY_DOME_MODES)[number];

export interface LookKnobs {
  /** `null` = the preset's anti-aliasing. */
  readonly aa: LookAaMode | null;
  /** Intermediate the spatial AA (SMAA / FXAA) reads: 8-bit display-referred (default) or three's half-float default. */
  readonly aaInput: "rgba8" | "half-float";
  /** `null` = on exactly when the chain runs TRAA. */
  readonly gtao: boolean | null;
  readonly shadowRes: ShadowResPx | null;
  /** 0 = no sun shadows; `null` = the preset's count. */
  readonly cascades: number | null;
  readonly shadowFilter: ShadowFilterId | null;
  /** Kernel of cascade 0 only; `null` = the same as the other cascades. */
  readonly shadowFilterNear: ShadowFilterId | null;
  readonly pcfRadius: number | null;
  readonly bloom: LookBloomMode | null;
  readonly grade: LookGradeMode;
  /** Backdrop gradient level; 0 = pure black space. */
  readonly skyLevel: number;
  /** Which sky parts are drawn. */
  readonly sky: Readonly<Record<SkyPart, boolean>>;
  readonly skyDome: SkyDomeMode;
  /** Stars as a post-resolve layer (`true`) or in the scene pass (`false`); `null` = layer exactly on TRAA chains. */
  readonly starLayer: boolean | null;
  /** `shadowkernel=square`: no receiver-aware kernel size and no per-receiver normal offset on the sun cascades (A/B). */
  readonly shadowKernelSquare: boolean;
  /** `debug=cascades`: sunlight tinted per shadow cascade. */
  readonly debugCascades: boolean;
}

export const DEFAULT_LOOK_KNOBS: LookKnobs = {
  aa: null,
  aaInput: "rgba8",
  gtao: null,
  shadowRes: null,
  cascades: null,
  shadowFilter: null,
  shadowFilterNear: null,
  pcfRadius: null,
  bloom: null,
  grade: "look",
  skyLevel: 1,
  sky: { dome: true, stars: true, earth: true, halo: true, sun: true },
  skyDome: "baked",
  starLayer: null,
  shadowKernelSquare: false,
  debugCascades: false,
};

function oneOf<T extends string>(values: readonly T[], raw: string | null): T | null {
  if (raw === null) return null;
  const lowered = raw.trim().toLowerCase();
  return values.find((value) => value === lowered) ?? null;
}

function onOff(raw: string | null): boolean | null {
  const value = raw?.trim().toLowerCase() ?? "";
  if (value === "on" || value === "1" || value === "true") return true;
  if (value === "off" || value === "0" || value === "false") return false;
  return null;
}

function finite(raw: string | null): number | null {
  if (raw === null || raw.trim() === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

/** Parses `location.search` (with or without the leading `?`). Unknown or malformed values keep the default. */
export function parseLookKnobs(search: string): LookKnobs {
  const params = new URLSearchParams(search);
  const traa = onOff(params.get("traa"));
  const aa = oneOf(LOOK_AA_MODES, params.get("aa")) ?? (traa === null ? null : traa ? "traa" : "smaa");

  const res = finite(params.get("shadowres"));
  const shadowRes = SHADOW_RES_STEPS.find((step) => step === res) ?? null;
  const cascadesRaw = finite(params.get("cascades"));
  const cascades = cascadesRaw === null ? null : Math.min(4, Math.max(0, Math.round(cascadesRaw)));
  const pcfRaw = finite(params.get("pcf"));

  const skyRaw = params.get("sky")?.trim().toLowerCase() ?? null;
  const skyAllOff = skyRaw === "off";
  const skyNumber = skyAllOff ? null : finite(skyRaw);
  const hidden = new Set((params.get("skyoff") ?? "").split(",").map((part) => part.trim().toLowerCase()));
  const part = (id: SkyPart): boolean => !skyAllOff && !hidden.has(id);
  const starsRaw = params.get("stars")?.trim().toLowerCase() ?? null;

  return {
    aa,
    aaInput: params.get("aainput")?.trim().toLowerCase() === "half-float" ? "half-float" : "rgba8",
    gtao: onOff(params.get("gtao")),
    shadowRes,
    cascades,
    shadowFilter: oneOf(SHADOW_FILTER_IDS, params.get("shadowfilter")),
    shadowFilterNear: oneOf(SHADOW_FILTER_IDS, params.get("shadowfilter0")),
    pcfRadius: pcfRaw === null ? null : Math.min(8, Math.max(0, pcfRaw)),
    bloom: oneOf(LOOK_BLOOM_MODES, params.get("bloom")),
    grade: oneOf(LOOK_GRADE_MODES, params.get("grade")) ?? "look",
    skyLevel: skyNumber === null ? 1 : Math.max(0, skyNumber),
    sky: { dome: part("dome"), stars: part("stars"), earth: part("earth"), halo: part("halo"), sun: part("sun") },
    skyDome: oneOf(SKY_DOME_MODES, params.get("skydome")) ?? "baked",
    starLayer: starsRaw === "layer" ? true : starsRaw === "scene" ? false : null,
    shadowKernelSquare: params.get("shadowkernel")?.trim().toLowerCase() === "square",
    debugCascades: params.get("debug")?.trim().toLowerCase() === "cascades",
  };
}

/**
 * Anti-aliasing the chain runs for `settings` under `knobs`. An explicit `?aa=` / `?traa=` wins. Without one, Low runs the
 * one-pass FXAA (SMAA's three full-output-resolution passes cost too much on the floor device); Medium keeps SMAA and
 * High / Ultra keep TRAA. The preset table in `shared` stays `smaa` / `traa` (its schema has no `fxaa`).
 */
export function effectiveAa(settings: QualitySettings, knobs: LookKnobs): LookAaMode {
  if (knobs.aa !== null) return knobs.aa;
  return settings.preset === "low" && settings.post.aa === "smaa" ? "fxaa" : settings.post.aa;
}

/** Whether the chain runs GTAO (needs the depth / normal prepass). */
export function effectiveGtao(settings: QualitySettings, knobs: LookKnobs): boolean {
  return knobs.gtao ?? effectiveAa(settings, knobs) === "traa";
}

/** Whether the sun casts cascaded shadows at all. */
export function sunShadowsEnabled(knobs: LookKnobs): boolean {
  return knobs.cascades !== 0;
}

/**
 * The quality settings with the knobs that HAVE a slot in `QualitySettings` applied (cascade count and size, the AA technique
 * where it is one of the preset values, the bloom resolution). Returns `settings` itself when nothing changes, so identity
 * checks on the settings object keep working. Knobs without a slot (`aa=none`, `gtao`, `bloom=off`, `cascades=0`, `grade`,
 * sky, filter, `aa=fxaa`) are read from `knobs` by the stage that owns them.
 */
export function applyLookKnobs(settings: QualitySettings, knobs: LookKnobs): QualitySettings {
  const cascades = knobs.cascades === null || knobs.cascades === 0 ? settings.shadows.cascades : knobs.cascades;
  const cascadeSizePx = knobs.shadowRes ?? settings.shadows.cascadeSizePx;
  const aa = knobs.aa === "smaa" || knobs.aa === "traa" ? knobs.aa : settings.post.aa;
  const bloomResolution = knobs.bloom === null || knobs.bloom === "off" ? settings.post.bloom.resolution : knobs.bloom;
  if (
    cascades === settings.shadows.cascades &&
    cascadeSizePx === settings.shadows.cascadeSizePx &&
    aa === settings.post.aa &&
    bloomResolution === settings.post.bloom.resolution
  ) {
    return settings;
  }
  return {
    ...settings,
    shadows: { ...settings.shadows, cascades, cascadeSizePx },
    post: { ...settings.post, aa, bloom: { ...settings.post.bloom, resolution: bloomResolution } },
  };
}

/** One line for logs and capture sidecars: only the knobs that differ from the defaults. */
export function describeLookKnobs(knobs: LookKnobs): string {
  const out: string[] = [];
  if (knobs.aa !== null) out.push(`aa=${knobs.aa}`);
  if (knobs.aaInput !== "rgba8") out.push(`aainput=${knobs.aaInput}`);
  if (knobs.gtao !== null) out.push(`gtao=${knobs.gtao ? "on" : "off"}`);
  if (knobs.shadowRes !== null) out.push(`shadowres=${String(knobs.shadowRes)}`);
  if (knobs.cascades !== null) out.push(`cascades=${String(knobs.cascades)}`);
  if (knobs.shadowFilter !== null) out.push(`shadowfilter=${knobs.shadowFilter}`);
  if (knobs.shadowFilterNear !== null) out.push(`shadowfilter0=${knobs.shadowFilterNear}`);
  if (knobs.pcfRadius !== null) out.push(`pcf=${String(knobs.pcfRadius)}`);
  if (knobs.bloom !== null) out.push(`bloom=${knobs.bloom}`);
  if (knobs.grade !== "look") out.push(`grade=${knobs.grade}`);
  if (knobs.skyLevel !== 1) out.push(`sky=${String(knobs.skyLevel)}`);
  const hidden = SKY_PARTS.filter((id) => !knobs.sky[id]);
  if (hidden.length > 0) out.push(`skyoff=${hidden.join(",")}`);
  if (knobs.skyDome !== "baked") out.push(`skydome=${knobs.skyDome}`);
  if (knobs.starLayer !== null) out.push(`stars=${knobs.starLayer ? "layer" : "scene"}`);
  if (knobs.shadowKernelSquare) out.push("shadowkernel=square");
  if (knobs.debugCascades) out.push("debug=cascades");
  return out.length === 0 ? "default" : out.join(" ");
}
