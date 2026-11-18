// Procedural motion of the blockout custodian (M1-W3-T07): bob, turn, lean and limb swing driven by the sim velocity,
// no skeleton (the rig and clips arrive with M1-W4-T07 / M1-W5-T04). Pure and allocation-free: `step()` writes fields.
//
// Low-g lope (art-direction 4.6): the stride hangs, so the body rises on a ballistic arc h = g T^2 / 8 per stride at the
// wearer's gravity (1.62 m/s^2) instead of the short Earth bob; arms counter-swing the legs; the body leans into speed
// and rolls into turns. With `toolActive` the right arm reaches forward and scrubs in small fussy strokes (Desk Duster).

/** Lunar surface gravity (m/s^2). */
export const MOON_G = 1.62;

export interface MotionTuning {
  /** Heading spring rate (1/s): critically damped turn toward the travel direction. */
  readonly turnRate: number;
  /** Speed (m/s) below which the heading holds (no spinning in place on jitter). */
  readonly turnMinSpeed: number;
  /** Stride length (m) = strideBase + strideGain * speed. */
  readonly strideBase: number;
  readonly strideGain: number;
  /** Airborne time per stride (s) at full lope; the bob height is MOON_G * T^2 / 8. */
  readonly hangTime: number;
  /** Speed (m/s) at which the gait reaches its full swing / hang. */
  readonly fullSpeed: number;
  /** Hip / shoulder swing amplitude (rad) at full speed. */
  readonly legSwing: number;
  readonly armSwing: number;
  /** Forward lean (rad per m/s, capped at `leanMax`). */
  readonly leanPerSpeed: number;
  readonly leanMax: number;
  /** Roll into turns (rad per rad/s of yaw rate per m/s, capped at `rollMax`). */
  readonly rollGain: number;
  readonly rollMax: number;
  /** Desk Duster scrub: strokes per second and amplitude (rad). */
  readonly scrubHz: number;
  readonly scrubAmp: number;
}

export const DEFAULT_MOTION_TUNING: MotionTuning = {
  turnRate: 9,
  turnMinSpeed: 0.25,
  strideBase: 0.8,
  strideGain: 0.45,
  hangTime: 0.5,
  fullSpeed: 2.5,
  legSwing: 0.5,
  armSwing: 0.38,
  leanPerSpeed: 0.05,
  leanMax: 0.16,
  rollGain: 0.03,
  rollMax: 0.12,
  scrubHz: 3.2,
  scrubAmp: 0.16,
};

const TAU = Math.PI * 2;

function wrapAngle(a: number): number {
  let r = (a + Math.PI) % TAU;
  if (r < 0) r += TAU;
  return r - Math.PI;
}

/** Exponential approach factor for rate `k` over `dt` (frame-rate independent). */
function approach(k: number, dt: number): number {
  return 1 - Math.exp(-k * dt);
}

/**
 * Per-custodian motion state. Inputs are the velocity in the avatar's tangent frame (x = east-like right, z = forward
 * axis of yaw 0; the caller picks the frame, yaw is measured from +z toward +x), plus an optional explicit facing.
 */
export class CustodianMotion {
  /** Heading (rad, from +z toward +x). */
  yaw = 0;
  /** Vertical body offset (m) and body pitch (forward lean, rad) / roll (rad). */
  bob = 0;
  pitch = 0;
  roll = 0;
  /**
   * Body offset in the yaw frame (m: x = asset left, z = forward) and torso twist about the spine (rad). The procedural
   * motion leaves them 0 (it leans about the feet); the animator adapter (rig-adapter.ts) writes them so the body
   * pivots about the hips.
   */
  bodyX = 0;
  bodyZ = 0;
  twist = 0;
  /** Joint angles (rad, positive = forward swing about the lateral axis): hips, knees (positive = bend), shoulders, elbows. */
  hipL = 0;
  hipR = 0;
  kneeL = 0;
  kneeR = 0;
  shoulderL = 0;
  shoulderR = 0;
  elbowL = 0;
  elbowR = 0;
  /** Gait phase (strides, fractional part used) and the smoothed speed (m/s). */
  phase = 0;
  speed = 0;
  /** Smoothed tool reach 0..1 (blends the scrub pose in and out). */
  reach = 0;
  private yawRate = 0;
  private time = 0;

  constructor(readonly tuning: MotionTuning = DEFAULT_MOTION_TUNING) {}

  /** Snaps the heading (spawn, teleport). */
  reset(yaw = 0): void {
    this.yaw = wrapAngle(yaw);
    this.yawRate = 0;
    this.speed = 0;
    this.phase = 0;
    this.reach = 0;
    this.bob = this.pitch = this.roll = 0;
  }

  /**
   * Advances by `dt` seconds. `vx`, `vz`: planar velocity (m/s); `facing`: explicit heading (rad) or NaN to face the
   * travel direction; `toolActive`: the tool is in a stroke; `airborne`: feet off the ground (no stride, legs tuck).
   */
  step(dt: number, vx: number, vz: number, facing = Number.NaN, toolActive = false, airborne = false): void {
    const t = this.tuning;
    if (!(dt > 0)) return;
    const d = Math.min(dt, 0.1);
    this.time += d;
    const rawSpeed = Math.hypot(vx, vz);
    this.speed += (rawSpeed - this.speed) * approach(12, d);
    const speed = this.speed;

    // Turn: toward the explicit facing, else toward the travel direction once moving.
    let target = this.yaw;
    if (facing === facing) target = facing;
    else if (rawSpeed > t.turnMinSpeed) target = Math.atan2(vx, vz);
    const err = wrapAngle(target - this.yaw);
    const before = this.yaw;
    this.yaw = wrapAngle(this.yaw + err * approach(t.turnRate, d));
    const rate = wrapAngle(this.yaw - before) / d;
    this.yawRate += (rate - this.yawRate) * approach(10, d);

    // Gait: phase advances one stride per stride length travelled.
    const gait = Math.min(1, speed / t.fullSpeed);
    const stride = t.strideBase + t.strideGain * speed;
    if (!airborne) this.phase = (this.phase + (speed * d) / stride) % 1;
    const s = Math.sin(this.phase * TAU);
    // Lope arc: one hop per step (two per stride), height g T^2 / 8 scaled by how fully the gait has developed.
    const hop = Math.abs(Math.sin(this.phase * TAU));
    const hang = (MOON_G * t.hangTime * t.hangTime) / 8;
    const breathe = 0.004 * Math.sin(this.time * TAU * 0.25) * (1 - gait);
    const bobTarget = airborne ? 0 : hang * gait * hop + breathe;
    this.bob += (bobTarget - this.bob) * approach(20, d);

    const leg = t.legSwing * gait;
    const arm = t.armSwing * gait;
    this.hipL = airborne ? 0.35 : leg * s;
    this.hipR = airborne ? -0.1 : -leg * s;
    // Knee bends on the forward swing (soft knees), more in the air.
    this.kneeL = airborne ? 0.55 : 0.08 + leg * 0.9 * Math.max(0, s);
    this.kneeR = airborne ? 0.25 : 0.08 + leg * 0.9 * Math.max(0, -s);
    this.shoulderL = -arm * s;
    this.shoulderR = arm * s;
    this.elbowL = 0.15 + 0.25 * gait;
    this.elbowR = 0.15 + 0.25 * gait;

    // Desk Duster: the right arm reaches forward and scrubs in small fussy strokes; walking keeps working.
    this.reach += ((toolActive ? 1 : 0) - this.reach) * approach(toolActive ? 10 : 6, d);
    if (this.reach > 1e-3) {
      const scrub = Math.sin(this.time * TAU * t.scrubHz);
      const k = this.reach;
      this.shoulderR += (1.05 + t.scrubAmp * scrub - this.shoulderR) * k;
      this.elbowR += (0.55 - 0.5 * t.scrubAmp * scrub - this.elbowR) * k;
    }

    const leanTarget = Math.min(t.leanMax, t.leanPerSpeed * speed) + 0.12 * this.reach;
    this.pitch += (leanTarget - this.pitch) * approach(8, d);
    const rollTarget = Math.max(-t.rollMax, Math.min(t.rollMax, -t.rollGain * this.yawRate * speed));
    this.roll += (rollTarget - this.roll) * approach(8, d);
  }
}
