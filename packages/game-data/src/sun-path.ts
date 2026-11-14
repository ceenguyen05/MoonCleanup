// Gameplay sun path for Outpost Boreal (decision D1, M1-mvp.md): a full 60-minute day (30 min lit, 30 min dark) with a
// contract that starts at sunrise. The real Boreal is polar (visual-target VM-01/VT-M2-11 pin the sun near +2 deg), but the
// MVP needs a readable day/night cycle, so gameplay uses this arc instead.
//
// `world.json` carries the cycle (dayLengthS, daylightFrac, contractStartSunPhase). The peak/trough elevations are not
// in any table yet because `WorldSchema` is a strict object; they live here until contracts-architect adds
// `world.sunPath { maxElevationDeg, minElevationDeg }` (proposal in the M1-W2-T05 report). Then this constant becomes the
// default for that field and the file shrinks to the function.
//
// Pure: no DOM, no Node, no three.

export interface SunPathParams {
  /** Elevation at local noon (middle of the lit half), degrees. */
  readonly maxElevationDeg: number;
  /** Elevation at local midnight (middle of the dark half), degrees; negative. */
  readonly minElevationDeg: number;
}

/**
 * Boreal gameplay path.
 * - Peak 40 deg: noon shadows stay 1.2x object height so dust trails and berms keep their side light (a 60 deg noon would
 *   flatten them); VT thresholds written for a 60 deg noon are judged at 40 deg for the MVP (decision D1).
 * - Trough -20 deg: matches the `night-near` capture preset (visual-target section 5) and keeps the Earth-key night readable.
 * - Sunrise is phase 0: 4 deg (the `dawn` preset) is reached about 58 s after Clock In; sunset at 1,800 s.
 */
export const BOREAL_SUN_PATH: SunPathParams = Object.freeze({ maxElevationDeg: 40, minElevationDeg: -20 });

export interface DayCycle {
  readonly dayLengthS: number;
  readonly daylightFrac: number;
  readonly contractStartSunPhase: number;
}

/** Day phase in [0, 1) at `timeS` seconds of contract time (0 = sunrise when `contractStartSunPhase` is 0). */
export function dayPhase(cycle: DayCycle, timeS: number): number {
  const p = (timeS / cycle.dayLengthS + cycle.contractStartSunPhase) % 1;
  return p < 0 ? p + 1 : p;
}

/** True while the sun is above the horizon (the lit half of the day). */
export function isDaylight(cycle: DayCycle, timeS: number): boolean {
  return dayPhase(cycle, timeS) < cycle.daylightFrac;
}

/**
 * Sun elevation in degrees at `timeS`: a half sine over the lit part (0 at sunrise, `maxElevationDeg` at noon, 0 at
 * sunset) and a half sine below the horizon over the dark part (down to `minElevationDeg` at midnight).
 */
export function sunElevationDeg(cycle: DayCycle, timeS: number, path: SunPathParams = BOREAL_SUN_PATH): number {
  const p = dayPhase(cycle, timeS);
  if (p < cycle.daylightFrac) return path.maxElevationDeg * Math.sin((Math.PI * p) / cycle.daylightFrac);
  return -Math.abs(path.minElevationDeg) * Math.sin((Math.PI * (p - cycle.daylightFrac)) / (1 - cycle.daylightFrac));
}
