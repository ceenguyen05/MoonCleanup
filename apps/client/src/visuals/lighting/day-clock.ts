// Day / night time source of the look rig (M1-W2-T02): contract time -> sun direction, plus the scripted-exposure ramp.
// Pure: no three, no DOM.
//
// Sun path (decision D1, `@moon-cleanup/game-data` `sun-path.ts`): the ELEVATION is the gameplay arc of Outpost Boreal
// (half sine up to +40 degrees over the lit half, half sine down to -20 over the dark half; 30 min each). The AZIMUTH is
// set here so the Earth's phase comes out of the geometry alone (VT-M1-11): the Earth stands still over the sub-Earth
// point, the sun rises 90 degrees of azimuth before it, passes its azimuth at noon (new Earth), sets 90 degrees after it
// and stands opposite at midnight (full Earth). Dawn and dusk are a half Earth.
//
// Exposure (rendering-pipeline 8.4, art-direction 2.2): the scripted EV100 of the key follows its target at two rates
// while the clock runs: the scene gets brighter -> the exposure falls at 3 EV/s; the scene gets darker -> the sunset
// ramp, dawn EV to night EV in 8 s. With the clock stopped (captures, look-dev scenes) the exposure is exactly the script.

import { BOREAL_SUN_PATH, dayPhase, sunElevationDeg, type DayCycle, type SunPathParams } from "@moon-cleanup/game-data";
import { EV100 } from "./key-light";

/**
 * The cycle of `world.json` (60-minute day, half lit, contract starts at sunrise). A look-dev default only: the composition
 * root passes the loaded world table (`VisualsModuleOptions.dayCycle`); `day-clock.test.ts` fails if the two drift apart.
 */
export const DEFAULT_DAY_CYCLE: DayCycle = Object.freeze({
  dayLengthS: 3600,
  daylightFrac: 0.5,
  contractStartSunPhase: 0,
});

/** Seconds of the sunset exposure ramp (art-direction 2.2 "Ramp to night over 8 s"). */
export const SUNSET_RAMP_S = 8;
/** EV per second while the scene gets darker: the dawn key to the near-side night key in `SUNSET_RAMP_S`. */
export const EV_RATE_DARKER_PER_S = (EV100.dawn - EV100.nightNear) / SUNSET_RAMP_S;
/** EV per second while the scene gets brighter (rendering-pipeline 8.4). */
export const EV_RATE_BRIGHTER_PER_S = 3;

/** Sun azimuth in degrees at `timeS` for an Earth standing at `earthAzimuthDeg` (see the file header). In [0, 360). */
export function sunAzimuthDeg(cycle: DayCycle, timeS: number, earthAzimuthDeg: number): number {
  const p = dayPhase(cycle, timeS);
  const f = cycle.daylightFrac;
  const sweep = p < f ? -90 + (180 * p) / f : 90 + (180 * (p - f)) / (1 - f);
  const az = (earthAzimuthDeg + sweep) % 360;
  return az < 0 ? az + 360 : az;
}

/** What the clock writes: the sun fields of the look state. */
export interface SunTarget {
  sunElevationDeg: number;
  sunAzimuthDeg: number;
}

/** Writes the sun's elevation and azimuth at contract time `timeS` into `out`. Allocates nothing. */
export function applySunPath(
  cycle: DayCycle,
  timeS: number,
  earthAzimuthDeg: number,
  out: SunTarget,
  path: SunPathParams = BOREAL_SUN_PATH,
): SunTarget {
  out.sunElevationDeg = sunElevationDeg(cycle, timeS, path);
  out.sunAzimuthDeg = sunAzimuthDeg(cycle, timeS, earthAzimuthDeg);
  return out;
}

/**
 * The scripted EV100 as the eye follows it. `step(target, dt, true)` slews toward the target at the two adaptation rates;
 * `step(target, dt, false)` (clock stopped, captures) and the first call return the target itself.
 */
export class ExposureRamp {
  /** Current EV100. */
  ev: number = EV100.noon;
  private primed = false;

  /** Forgets the history: the next `step` snaps to its target. */
  reset(): void {
    this.primed = false;
  }

  step(targetEv: number, dtS: number, ramp: boolean): number {
    if (!ramp || !this.primed || !(dtS >= 0)) {
      this.primed = true;
      this.ev = targetEv;
      return targetEv;
    }
    const delta = targetEv - this.ev;
    // A higher EV is a shorter exposure: the scene got brighter.
    const limit = (delta > 0 ? EV_RATE_BRIGHTER_PER_S : EV_RATE_DARKER_PER_S) * dtS;
    this.ev = Math.abs(delta) <= limit ? targetEv : this.ev + Math.sign(delta) * limit;
    return this.ev;
  }
}
