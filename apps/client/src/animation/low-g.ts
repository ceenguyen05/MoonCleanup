// Low-gravity motion math (spec 4.1, 4.2): ballistic bounce, bounce gain, landing class, time to ground and the
// landing-compression spring. Driven by sim velocity / move state only; this is never a second physics simulation.

import { BOUNCE } from "./tuning";

/** Ballistic apex of a flight of length T at gravity g: h = g T^2 / 8. */
export function ballisticApex(g: number, flightS: number): number {
  return (g * flightS * flightS) / 8;
}

/** Bounce gain G = 1 / r^2 clamped to [0.6, 1.6] (spec 4.1): keeps a clip's flight arc ballistic at playback rate r. */
export function bounceGain(rate: number): number {
  const g = rate > 1e-6 ? 1 / (rate * rate) : BOUNCE.gainMax;
  return g < BOUNCE.gainMin ? BOUNCE.gainMin : g > BOUNCE.gainMax ? BOUNCE.gainMax : g;
}

/**
 * Procedural pelvis height offset (metres) over one step for the placeholder rig and as the reference curve the real
 * clips are checked against (AN-M1-06). `stepU` in [0, 1) is the progress through one step from foot plant
 * (l_down / r_down markers): a stance segment (sine dip of `stanceDipM`) followed by a flight segment whose length is
 * `flightS / rate` seconds of a `stepS / rate` step and whose arc is exactly ballistic at `g`, times `exaggeration`.
 */
export function stepPelvisOffset(
  stepU: number,
  stepS: number,
  flightS: number,
  stanceDipM: number,
  rate: number,
  g: number,
  exaggeration: number,
): number {
  const io = pelvisScratch;
  io[0] = stepU;
  io[1] = stepS;
  io[2] = flightS;
  io[3] = stanceDipM;
  io[4] = rate;
  io[5] = g;
  io[6] = exaggeration;
  stepPelvisIO(io);
  return io[7]!;
}

const pelvisScratch = new Float64Array(8);

/** Allocation-free core of `stepPelvisOffset`: io[0..6] = its arguments in order, io[7] = result. */
export function stepPelvisIO(io: Float64Array): void {
  const stepU = io[0]!;
  const stepS = io[1]!;
  const flightS = io[2]!;
  const stanceDipM = io[3]!;
  const rate = io[4]!;
  const g = io[5]!;
  const exaggeration = io[6]!;
  const r = rate > 1e-6 ? rate : 1;
  const stepDur = stepS / r;
  const flightDur = flightS / r;
  const flightFrac = stepDur > 1e-6 ? (flightDur < stepDur ? flightDur / stepDur : 1) : 0;
  const stanceFrac = 1 - flightFrac;
  if (stepU < stanceFrac) {
    const u = stanceFrac > 1e-6 ? stepU / stanceFrac : 0;
    io[7] = -stanceDipM * Math.sin(Math.PI * u);
    return;
  }
  const t = (stepU - stanceFrac) * stepDur;
  const arc = 0.5 * g * t * (flightDur - t);
  io[7] = (arc > 0 ? arc : 0) * exaggeration;
}

/** Landing classes (spec 2.3, 4.2). */
export const LAND_NONE = 0;
export const LAND_SOFT = 1;
export const LAND_HARD = 2;
export const LAND_STUMBLE = 3;

/**
 * Landing class from impact speed. `softMaxMps` / `faceplantMps` come from movement.json (landingSoftMps,
 * faceplantMps), never a local constant; below 2.0 m/s there is no clip, only the compression.
 */
export function landingClass(impactMps: number, softMaxMps: number, faceplantMps: number): number {
  if (impactMps < BOUNCE.landClipMinMps) return LAND_NONE;
  if (impactMps < softMaxMps) return LAND_SOFT;
  if (impactMps <= faceplantMps) return LAND_HARD;
  return LAND_STUMBLE;
}

/**
 * Time to ground (spec 4.2): solve h + vUp t - g t^2 / 2 = 0 for the first t >= 0 with h = sole height above ground.
 * Returns 0 at or below the ground, +Infinity if the arc never reaches it (g <= 0 and rising).
 */
export function timeToGround(heightM: number, vUp: number, g: number): number {
  if (heightM <= 0) return 0;
  if (g <= 1e-9) return vUp < 0 ? heightM / -vUp : Number.POSITIVE_INFINITY;
  return (vUp + Math.sqrt(vUp * vUp + 2 * g * heightM)) / g;
}

/** Compression depth for an impact (spec 4.2): clamp(0.055 s x impact, 0.02, 0.32) m. */
export function compressionDepth(impactMps: number): number {
  const d = BOUNCE.compressionPerMps * impactMps;
  return d < BOUNCE.compressionMinM ? BOUNCE.compressionMinM : d > BOUNCE.compressionMaxM ? BOUNCE.compressionMaxM : d;
}

/**
 * Landing compression (spec 4.2), additive on the pelvis. Ease-out to -d in 90 ms, then a closed-form damped spring
 * (f = 1.8 Hz, zeta = 0.55) back to 0. Evaluated analytically from elapsed time, so it is frame-rate independent and
 * stable at any dt. `offset` is metres (negative = down); `torsoPitch` radians forward.
 */
export class LandingCompression {
  offset = 0;
  torsoPitch = 0;
  active = false;
  private depth = 0;
  private t = 0;

  trigger(impactMps: number): void {
    this.depth = compressionDepth(impactMps);
    this.t = 0;
    this.active = true;
  }

  reset(): void {
    this.active = false;
    this.offset = 0;
    this.torsoPitch = 0;
    this.t = 0;
  }

  /** Step length for `step()` (set by the hot path; no double crosses a call). */
  dt = 0;

  update(dt: number): void {
    this.dt = dt;
    this.step();
  }

  step(): void {
    if (!this.active) return;
    this.t += this.dt;
    const d = this.depth;
    const reach = BOUNCE.compressionReachS;
    let x: number;
    if (this.t < reach) {
      const u = 1 - this.t / reach;
      x = -d * (1 - u * u);
    } else {
      const ts = this.t - reach;
      const w0 = 2 * Math.PI * BOUNCE.springHz;
      const z = BOUNCE.springZeta;
      const wd = w0 * Math.sqrt(1 - z * z);
      const env = Math.exp(-z * w0 * ts);
      // x0 = -d, v0 = 0 (the ease-out ends at rest).
      x = env * (-d * Math.cos(wd * ts) + ((z * w0 * -d) / wd) * Math.sin(wd * ts));
      if (env * d < 1e-4) {
        this.active = false;
        x = 0;
      }
    }
    this.offset = x;
    const down = x < 0 ? -x : 0;
    this.torsoPitch = (BOUNCE.torsoPitchRadAtMax * down) / BOUNCE.compressionMaxM;
  }
}
