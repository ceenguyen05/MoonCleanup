// CPU port of three r187's AgX tone mapper (`agxToneMapping` in nodes/display/ToneMappingFunctions.js) plus the sRGB
// encode and Rec.709 luma: the maths behind the albedo calibration of art-direction section 2.3 and VT-M0-06/08.
// Pure: no three, no DOM. Used by tests and by the lookdev driver to predict what the screenshot must show.

const REC2020_FROM_SRGB = [0.6274, 0.3293, 0.0433, 0.0691, 0.9195, 0.0113, 0.0164, 0.088, 0.8956] as const;
const SRGB_FROM_REC2020 = [1.6605, -0.5876, -0.0728, -0.1246, 1.1329, -0.0083, -0.0182, -0.1006, 1.1187] as const;
// Row-major, derived from the column-major mat3(vec3, vec3, vec3) of three (each vec3 is a COLUMN).
const INSET = [
  0.856627153315983, 0.0951212405381588, 0.0482516061458583, 0.137318972929847, 0.761241990602591, 0.101439036467562,
  0.11189821299995, 0.0767994186031903, 0.811302368396859,
] as const;
const OUTSET = [
  1.1271005818144368, -0.11060664309660323, -0.016493938717834573, -0.1413297634984383, 1.157823702216272,
  -0.016493938717834257, -0.14132976349843826, -0.11060664309660294, 1.2519364065950405,
] as const;
const MIN_EV = -12.47393;
const MAX_EV = 4.026069;

function mul3(m: readonly number[], r: number, g: number, b: number, out: number[]): void {
  out[0] = (m[0] ?? 0) * r + (m[1] ?? 0) * g + (m[2] ?? 0) * b;
  out[1] = (m[3] ?? 0) * r + (m[4] ?? 0) * g + (m[5] ?? 0) * b;
  out[2] = (m[6] ?? 0) * r + (m[7] ?? 0) * g + (m[8] ?? 0) * b;
}

function contrast(x: number): number {
  const x2 = x * x;
  const x4 = x2 * x2;
  return 15.5 * x4 * x2 - 40.14 * x4 * x + 31.96 * x4 - 6.868 * x2 * x + 0.4298 * x2 + 0.1191 * x - 0.00232;
}

const scratch: number[] = [0, 0, 0];

/** AgX of a scene-linear sRGB colour (exposure 1). Writes the display-linear sRGB colour (0..1) to `out`. */
export function agxToneMap(r: number, g: number, b: number, out: number[]): number[] {
  mul3(REC2020_FROM_SRGB, r, g, b, scratch);
  mul3(INSET, scratch[0] ?? 0, scratch[1] ?? 0, scratch[2] ?? 0, scratch);
  for (let i = 0; i < 3; i++) {
    const v = Math.max(scratch[i] ?? 0, 1e-10);
    const t = Math.min(Math.max((Math.log2(v) - MIN_EV) / (MAX_EV - MIN_EV), 0), 1);
    scratch[i] = contrast(t);
  }
  mul3(OUTSET, scratch[0] ?? 0, scratch[1] ?? 0, scratch[2] ?? 0, scratch);
  for (let i = 0; i < 3; i++) scratch[i] = Math.pow(Math.max(0, scratch[i] ?? 0), 2.2);
  mul3(SRGB_FROM_REC2020, scratch[0] ?? 0, scratch[1] ?? 0, scratch[2] ?? 0, out);
  for (let i = 0; i < 3; i++) out[i] = Math.min(Math.max(out[i] ?? 0, 0), 1);
  return out;
}

/** sRGB OETF of a linear value in 0..1. */
export function srgbEncode(linear: number): number {
  const x = Math.min(Math.max(linear, 0), 1);
  return x <= 0.0031308 ? x * 12.92 : 1.055 * Math.pow(x, 1 / 2.4) - 0.055;
}

/** Rec.709 luma of 8-bit sRGB codes (0..255). */
export function lumaOfCodes(r: number, g: number, b: number): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

const rgbScratch: number[] = [0, 0, 0];

/**
 * 8-bit sRGB display luma (0..255) of a scene-linear colour after AgX: what a screenshot patch of that colour reads.
 * `rgb` is the colour AFTER pre-exposure (the buffer value), as lights are pre-exposed on the CPU.
 */
export function displayLuma(r: number, g: number, b: number): number {
  agxToneMap(r, g, b, rgbScratch);
  return lumaOfCodes(
    srgbEncode(rgbScratch[0] ?? 0) * 255,
    srgbEncode(rgbScratch[1] ?? 0) * 255,
    srgbEncode(rgbScratch[2] ?? 0) * 255,
  );
}

/**
 * Display luma of a neutral Lambertian albedo lit by `flatLux` of key plus `fillFraction` of it, pre-exposed for
 * `ev100` (x = albedo * E / pi / (1.2 * 2^EV100), art-direction section 2.3 step 1).
 */
export function neutralAlbedoLuma(albedo: number, flatLux: number, fillFraction: number, ev100: number): number {
  const x = ((albedo * flatLux * (1 + fillFraction)) / Math.PI) * (1 / (1.2 * Math.pow(2, ev100)));
  return displayLuma(x, x, x);
}
