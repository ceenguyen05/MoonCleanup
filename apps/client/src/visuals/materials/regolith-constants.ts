// Numbers of the regolith / dust material (art-direction.md sections 2.3, 3.2, 3.3; world-and-dust-simulation.md 7.7).
// Pure data, no three. REFERENCE MODE (docs/design/REFERENCE_TARGET.md): bright, smooth clean ground against dusty
// ground is the goal; these are the calibrated starting values, tunable only together with the S02 chart.

/** Linear albedo of dusty ground and clean ground (art-direction 3.2 / D-02: about 4x). Single source for the game. */
/** 0.085 in the spec; 0.0785 here compensates the dielectric specular lift (+4 codes on dark chips, measured M0-W3-T03b) so grime lands on its 119 target and the clean/grime ratio stays >= 1.5. */
export const ALBEDO_GRIME = 0.0785;
export const ALBEDO_CLEAN = 0.34;

/** Calibration chart patches (VT-M0-06): linear albedo and expected display luma at the noon key, AgX on, +-8. */
export const CHART_PATCHES = [
  { albedo: 0.1, expectedLuma: 126 },
  { albedo: 0.33, expectedLuma: 181 },
  { albedo: 0.8, expectedLuma: 213 },
] as const;
export const CHART_TOLERANCE_LUMA = 8;

/** Rec.709 luma weights (linear), used to normalise colour tints so a tint never changes the calibrated albedo. */
const LUMA_R = 0.2126;
const LUMA_G = 0.7152;
const LUMA_B = 0.0722;

export type Rgb = readonly [number, number, number];

/** Scales `rgb` so its Rec.709 luma is exactly 1: a tint that moves hue and not brightness. */
export function lumaNormalised(rgb: Rgb): Rgb {
  const l = rgb[0] * LUMA_R + rgb[1] * LUMA_G + rgb[2] * LUMA_B;
  return [rgb[0] / l, rgb[1] / l, rgb[2] / l];
}

/** Dust is warm gray-brown (a* +1..+3, b* +4..+7); clean ground neutral with a hair of cool (art-direction 3.2). */
export const GRIME_TINT: Rgb = lumaNormalised([1.1, 1.0, 0.84]);
export const CLEAN_TINT: Rgb = lumaNormalised([0.985, 1.0, 1.025]);

/** Roughness: dust 0.97; clean 0.82 after one pass down to 0.62 fully polished (art-direction 3.2). */
export const ROUGHNESS_GRIME = 0.97;
export const ROUGHNESS_CLEAN = 0.82;
export const ROUGHNESS_POLISHED = 0.62;

/** Visual dust layer depth (D-03): 2 cm for hand tools. */
export const DUST_LAYER_DEPTH_M = 0.02;
/** Mask byte 255 of the berm channel (G) stands for this berm height (D-03: hand tools 1.5-3 cm, vehicles 4-8 cm). */
export const BERM_HEIGHT_MAX_M = 0.08;

/** Presence threshold of partial removal: tau = TAU_BASE + TAU_RELIEF * h_eff (art-direction 3.3 / WDS 7.7). */
export const TAU_BASE = 0.04;
export const TAU_RELIEF = 0.08;
/** Thickness of a thin layer: t = m * (THIN_BASE + THIN_SLOPE * R). */
export const THIN_BASE = 0.35;
export const THIN_SLOPE = 0.65;

/** Detail texture: two scales of one packed tile (pebbles and clods); tile edge in world metres. */
export const DETAIL_TILE_M = { fine: 1.2, coarse: 4.3 } as const;
/** Detail relief amplitude in metres at each scale (D-04 exaggeration; pebbles < 5 cm, clods 5-30 cm). */
export const DETAIL_AMPLITUDE_M = { fine: 0.008, coarse: 0.022 } as const;
/** Distance (m) over which each detail scale fades to flat (both are cheap, so these are the Medium values). */
export const DETAIL_FADE_M = { fine: [10, 26], coarse: [20, 70] } as const;
/** Detail normals are softer on dust than on clean ground (art-direction 3.2 "soft, clumpy" vs "crisper grain"). */
export const DETAIL_GAIN = { grime: 0.65, clean: 1.0 } as const;

/** Glint grains on clean ground: at most 4x the diffuse, never past 0.6 of the bloom threshold (art-direction 3.2). */
export const SPARKLE = { cellM: 0.01, fadeNearM: 5, fadeFarM: 11, density: 0.006, boost: 3 } as const;

/**
 * Grazing-sun detail fade (M0 look-polish r2). The detail relief has slopes of 10 to 25 degrees; under a sun lower than
 * that every bump facing away has N.L <= 0 and goes black with a hard edge (the "black patches" of the stand-in ground at
 * 4 and 1 degrees). The detail slopes are scaled by clamp(N_geometry . L / GRAZING_DETAIL_SIN, GRAZING_DETAIL_MIN, 1): full
 * relief from 20 degrees of local sun elevation up (so noon calibration is untouched), proportionally flatter below, which
 * keeps the RELATIVE shading contrast of the relief constant instead of letting it clip to black.
 */
export const GRAZING_DETAIL_SIN = 0.342;
export const GRAZING_DETAIL_MIN = 0.08;

/**
 * Optional large-scale variation (look scenes; off on calibration scenes): tone +-MACRO_TONE at two scales and a hue drift
 * between a warm and a cool variant of each state at constant luminance (the T03b stand-in look: warm sand <-> lavender-grey
 * clean ground, umber <-> slate dust).
 */
export const MACRO_CELL_M = { large: 43, medium: 9.5 } as const;
export const MACRO_TONE = { large: 0.1, medium: 0.07 } as const;
export const CLEAN_TINT_WARM: Rgb = lumaNormalised([0.364, 0.338, 0.303]);
export const CLEAN_TINT_COOL: Rgb = lumaNormalised([0.312, 0.338, 0.376]);
export const GRIME_TINT_WARM: Rgb = lumaNormalised([0.104, 0.083, 0.061]);
export const GRIME_TINT_COOL: Rgb = lumaNormalised([0.082, 0.082, 0.093]);
