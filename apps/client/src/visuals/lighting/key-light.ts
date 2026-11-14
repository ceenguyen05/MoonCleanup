// Key-light model of the look rig (art-direction.md sections 2.1-2.2, rendering-pipeline.md sections 5.1 and 8.4).
// Pure: no three, no DOM. Lights are authored in physical lux and pre-exposed on the CPU with
// scale = 1 / (1.2 * 2^EV100), so the half-float buffer holds display-relative values and the tone-map exposure stays 1.
//
// REFERENCE MODE (docs/design/REFERENCE_TARGET.md): every number here is tunable for the bright, readable reference mood;
// the art-direction values are the starting point, not a gate.

const DEG = Math.PI / 180;

/** Sun illuminance on ground facing the sun (lux). */
export const SUN_LUX_NORMAL = 133_800;
/** Authored earthshine at full Earth (lux): 30x the physical value so the night stays playable (art-direction D-06). */
export const EARTHSHINE_LUX_FULL = 300;
/** Far-side night floor (lux), art-direction D-07. */
export const FAR_SIDE_FLOOR_LUX = 40;

/** Scripted key exposure (EV100), art-direction section 2.2. */
export const EV100 = {
  dawn: 11.5,
  morning: 13.6,
  noon: 14.3,
  nightNear: 7.3,
  nightFar: 6.5,
} as const;

/** Fill as a fraction of the key's flat-ground illuminance: up-facing, vertical, down-facing (art-direction D-05). */
export const FILL_FRACTION = { up: 0.15, side: 0.25, down: 0.35 } as const;

/** Sun below this elevation no longer lights the ground; the key hands over to the Earth (art-direction section 2.2). */
export const SUN_SET_ELEVATION_DEG = -0.5;
/** Earth must stand at least this high to act as the night key (rendering-pipeline section 5.2). */
export const EARTH_KEY_MIN_ELEVATION_DEG = 5;

/** Illuminance of the sun on flat ground at `elevationDeg` (lux). */
export function sunFlatLux(elevationDeg: number): number {
  return SUN_LUX_NORMAL * Math.max(0, Math.sin(elevationDeg * DEG));
}

/** Scripted EV100 for a sun elevation: dawn 11.3 up to 4 degrees, 13.6 at 30, 14.3 from 60 (piecewise linear). */
export function sunEv100(elevationDeg: number): number {
  if (elevationDeg <= 4) return EV100.dawn;
  if (elevationDeg <= 30) return EV100.dawn + ((elevationDeg - 4) / 26) * (EV100.morning - EV100.dawn);
  if (elevationDeg <= 60) return EV100.morning + ((elevationDeg - 30) / 30) * (EV100.noon - EV100.morning);
  return EV100.noon;
}

/** CPU pre-exposure scale of the half-float buffer for an EV100 (rendering-pipeline section 8.4). */
export function preExposureScale(ev100: number): number {
  return 1 / (1.2 * Math.pow(2, ev100));
}

/** Earthshine multiplier from the lit fraction of the Earth disk: full 1.0, gibbous 0.6, half 0.3, crescent 0.08, new 0. */
export function earthPhaseFactor(litFraction: number): number {
  const f = Math.min(1, Math.max(0, litFraction));
  const table: readonly (readonly [number, number])[] = [
    [0, 0],
    [0.12, 0.08],
    [0.5, 0.3],
    [0.75, 0.6],
    [1, 1],
  ];
  for (let i = 1; i < table.length; i++) {
    const a = table[i - 1];
    const b = table[i];
    if (a === undefined || b === undefined) continue;
    if (f <= b[0]) return a[1] + ((f - a[0]) / (b[0] - a[0])) * (b[1] - a[1]);
  }
  return 1;
}

/**
 * Lit fraction of a sphere seen from a viewer when the light comes from `sunDir` and the sphere stands in direction
 * `earthDir` from the viewer: (1 + cos(phase angle)) / 2 with the phase angle between the light and the viewer's
 * line of sight to the sphere. Both directions are unit vectors in the same frame.
 */
export function litFraction(
  sunX: number,
  sunY: number,
  sunZ: number,
  earthX: number,
  earthY: number,
  earthZ: number,
): number {
  // The viewer sees the side of the sphere that faces it: its normal is -earthDir. Lit side: normal . sunDir > 0.
  const cosPhase = -(sunX * earthX + sunY * earthY + sunZ * earthZ);
  return (1 + cosPhase) / 2;
}

export type KeyMode = "sun" | "earth" | "floor";

export interface KeyState {
  mode: KeyMode;
  /** Flat-ground illuminance of the active key (lux), before pre-exposure. */
  keyLux: number;
  ev100: number;
  /** Pre-exposure scale for `ev100`. */
  scale: number;
  /** Sun light lux (0 when the sun is down). */
  sunLux: number;
  /** Earthshine lux on a surface facing the Earth (0 when the Earth is not the key). */
  earthLux: number;
  /** Ambient floor lux (far-side night only). */
  floorLux: number;
}

/** Resolves the active key from the sun elevation, the Earth elevation and the lit fraction of the Earth disk. Writes `out`. */
export function resolveKey(
  sunElevationDeg: number,
  earthElevationDeg: number,
  earthLitFraction: number,
  out: KeyState,
): KeyState {
  if (sunElevationDeg > SUN_SET_ELEVATION_DEG) {
    out.mode = "sun";
    out.sunLux = sunFlatLux(sunElevationDeg);
    out.keyLux = out.sunLux;
    out.ev100 = sunEv100(sunElevationDeg);
    out.earthLux = 0;
    out.floorLux = 0;
  } else if (earthElevationDeg > EARTH_KEY_MIN_ELEVATION_DEG) {
    out.mode = "earth";
    out.sunLux = 0;
    out.earthLux = EARTHSHINE_LUX_FULL * earthPhaseFactor(earthLitFraction);
    out.keyLux = out.earthLux;
    out.ev100 = EV100.nightNear;
    out.floorLux = 0;
  } else {
    out.mode = "floor";
    out.sunLux = 0;
    out.earthLux = 0;
    out.keyLux = 0;
    out.ev100 = EV100.nightFar;
    out.floorLux = FAR_SIDE_FLOOR_LUX;
  }
  out.scale = preExposureScale(out.ev100);
  return out;
}

export function createKeyState(): KeyState {
  return {
    mode: "sun",
    keyLux: 0,
    ev100: EV100.noon,
    scale: preExposureScale(EV100.noon),
    sunLux: 0,
    earthLux: 0,
    floorLux: 0,
  };
}

/** Bright-reference Earth: display luminance cap of a sunlit Earth (art-direction D-10 "own exposure compensation"). */
export const EARTH_LUMINANCE_CAP = 0.9;
/** Earth albedo used for the exposure compensation. */
export const EARTH_ALBEDO = 0.3;

/** Gain applied to the Earth's emissive so it holds a readable luminance at every exposure (never brighter than the cap). */
export function earthExposureGain(scale: number): number {
  const raw = ((EARTH_ALBEDO * SUN_LUX_NORMAL) / Math.PI) * scale;
  return raw <= EARTH_LUMINANCE_CAP ? scale : (EARTH_LUMINANCE_CAP / raw) * scale;
}
