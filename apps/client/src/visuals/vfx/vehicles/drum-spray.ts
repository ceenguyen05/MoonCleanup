// Trundle brush-drum spray (M1-W7-T02): the drum throws ballistic grains forward-up off the front edge while the
// intake works. Distance-driven (one burst per DRUM_SPACING_M rolled), so the cadence follows speed and stops with the
// vehicle; the burst is small (fixed count on every preset, minimum-juice floor) and lands on the grain pool's
// closed-form ballistics. Three-free and allocation-free: unit-tested with a bare `GrainPool`.

import type { GrainPool, StrokeEmission } from "../grains";

/** Metres rolled between bursts (about 6 bursts per second at the 3 m/s cruise). */
export const DRUM_SPACING_M = 0.5;
/** A burst of the drum: faster and higher than a hand stroke, thrown forward in a narrow fan. */
export const DRUM_BURST: StrokeEmission = {
  count: 9,
  speedMin: 0.9,
  speedMax: 2.2,
  elevMin: (25 * Math.PI) / 180,
  elevMax: (65 * Math.PI) / 180,
  spread: 0.7,
  radiusMin: 0.006,
  radiusMax: 0.016,
  scatter: 0.35,
};
/** Most bursts per call (a long frame must not flood the pool). */
const MAX_BURSTS_PER_CALL = 3;

export class DrumSpray {
  private carryM = 0;
  /** Total bursts thrown (telemetry for tests). */
  bursts = 0;

  /**
   * Advances by `dtS`. `work01` is the sim's intake intensity (0 = idle: raised, boosting, full, stopped); the spray
   * point is the drum's front edge (x, y, z) in the pool frame heading (dirX, dirZ), `groundY` the local ground.
   */
  step(
    pool: GrainPool,
    dtS: number,
    speedMps: number,
    work01: number,
    x: number,
    y: number,
    z: number,
    dirX: number,
    dirZ: number,
    groundY: number,
  ): number {
    if (work01 <= 0 || speedMps <= 0.05) {
      this.carryM = 0;
      return 0;
    }
    this.carryM += speedMps * dtS;
    let n = 0;
    while (this.carryM >= DRUM_SPACING_M && n < MAX_BURSTS_PER_CALL) {
      this.carryM -= DRUM_SPACING_M;
      pool.emitStroke(x, y, z, dirX, dirZ, groundY, DRUM_BURST);
      n++;
    }
    if (this.carryM > DRUM_SPACING_M) this.carryM = DRUM_SPACING_M;
    this.bursts += n;
    return n;
  }
}
