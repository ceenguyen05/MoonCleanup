// Numbers of the production terrain regolith (M1-W2-T04). Pure data and CPU twins, no three.
//
// Precision: the world origin is the moon centre, so a world position on the ground is ~1.7e6 m and float32 holds it to
// ~0.125 m: far too coarse to texture 1.28 m pebble tiles. The shader uses the mesh-local position (small, precise) plus
// the mesh position wrapped to REGOLITH_PERIOD_M (computed in doubles on the CPU). Every tile size and every stochastic
// selector cell divides the period exactly, so the wrap never shows.

/** Wrap period of the precise texture coordinate (m). Every tile is REGOLITH_PERIOD_M / tiles. */
export const REGOLITH_PERIOD_M = 4096;

/** Stochastic selector cells span this many tiles; every `tiles` value with a selector is a multiple of it. */
export const SELECTOR_TILES = 8;

/** Default close-tap selector: offset pairs per unit of the macro texel channel (a = fine, r = coarse). */
export const SELECTOR_GAIN = 24;

export interface DetailScale {
  /** Tiles per period: tile edge = REGOLITH_PERIOD_M / tiles (m). */
  readonly tiles: number;
  /** Relief amplitude (m) for the packed-gradient normal; 0 = albedo only. */
  readonly amplitudeM: number;
  /** Weight of the tile's albedo breakup channel in the tone multiplier (+- weight / 2 around 1). */
  readonly albedo: number;
  /** Camera distance (m) over which the scale fades out: [start, end]; `null` = never fades (macro). */
  readonly fadeM: readonly [number, number] | null;
  /** Two stochastic taps (anti-repeat) instead of one. */
  readonly stochastic: boolean;
}

/**
 * Close (fine pebbles, coarse clods), mid (mid undulation, broad mottling) and far (macro tone) scales of one packed detail
 * tile (detail-texture.ts). Fine / coarse take the M0 regolith's amplitudes so the close look matches the S02 calibration.
 */
export const TERRAIN_DETAIL = {
  fine: { tiles: 3200, amplitudeM: 0.008, albedo: 0.16, fadeM: [10, 28], stochastic: true },
  coarse: { tiles: 960, amplitudeM: 0.022, albedo: 0.18, fadeM: [22, 70], stochastic: true },
  mid: { tiles: 432, amplitudeM: 0.05, albedo: 0.22, fadeM: [60, 280], stochastic: false },
  broad: { tiles: 110, amplitudeM: 0.12, albedo: 0.3, fadeM: [180, 1400], stochastic: false },
  macro: { tiles: 7, amplitudeM: 0, albedo: 0.36, fadeM: null, stochastic: false },
} as const satisfies Record<string, DetailScale>;

/** Distance (m) beyond which the close block (fine + coarse, 4 taps) is skipped by a branch. */
export const CLOSE_BLOCK_END_M = TERRAIN_DETAIL.coarse.fadeM[1];
/** Distance (m) beyond which the fine taps are skipped (inside the close branch). */
export const FINE_BLOCK_END_M = TERRAIN_DETAIL.fine.fadeM[1];

/** Cavity darkening from the close relief: albedo x mix(CAVITY.low, CAVITY.high, relief). */
export const CAVITY = { low: 0.92, high: 1.05, fadeM: [8, 24] } as const;

/** Grazing-view fade: detail fades where the pixel footprint is this elongated (anisotropic filter limit). */
export const GRAZE_STRETCH = [6, 18] as const;
/**
 * Grazing-view fade of the mid / broad scales (normals and mottling). At a grazing view every blob of the mid / broad
 * tiles projects to a thin horizontal sliver, and their contrast read as faint streaks at mid range under a high sun
 * (checkpoint 1, sun 60): the mid scale fades out over this stretch range, the broad one down to GRAZE_TONE_FLOOR.
 */
export const GRAZE_STRETCH_FAR = [5, 16] as const;
/** Broad-scale mottling kept at a full grazing view (fraction). */
export const GRAZE_TONE_FLOOR = 0.25;

/** Tile edge (m) of a scale. */
export function tileM(scale: DetailScale): number {
  return REGOLITH_PERIOD_M / scale.tiles;
}

/** `x` wrapped into [0, period): floor-based, so negative inputs wrap the same way the shader's `x - p floor(x / p)` does. */
export function wrapPeriod(x: number, period = REGOLITH_PERIOD_M): number {
  return x - period * Math.floor(x / period);
}

/**
 * Dominant axis of a direction from the moon centre (the cube face the fragment projects on): 1 = Y (Boreal's face,
 * projection on x / z), 0 = X (z / y), 2 = Z (x / y). Ties go to Y, then X: the shader's order.
 */
export function dominantAxis(x: number, y: number, z: number): 0 | 1 | 2 {
  const ax = Math.abs(x);
  const ay = Math.abs(y);
  const az = Math.abs(z);
  if (ay >= ax && ay >= az) return 1;
  return ax >= az ? 0 : 2;
}

/**
 * Anisotropy of the terrain's detail tile. Same-session A/B on UHD 620 (ground, sun 30): 8 cost ~2 ms GPU over the
 * plain terrain, 2 about 1.4 ms less; the grazing-view fade already removes detail where 8 would help.
 */
export const TERRAIN_DETAIL_ANISOTROPY = 2;
