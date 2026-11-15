// Per-avatar animator (M1-W5-T04 logic layer). One code path for local and remote avatars (spec 3.3): the caller fills
// `AvatarAnimInput` from predicted sim state (local, alpha-interpolated) or the interpolation buffer (remote, through
// `RemoteVelocityEstimator`); the animator writes a rig-agnostic `AvatarPose` (clip weights, phases, procedural
// offsets, IK targets) and pooled presentation events. It never writes sim state. No allocation in `update`.
//
// Until the custodian rig and clips exist (M1-W4-T07 / clip delivery), the leg input comes from a procedural
// placeholder gait (`PlaceholderGait`) sharing the sync-group phase, plant masks and step timing the clips will use.

import { ANIM_EVENT, type AnimEventQueue } from "./anim-events";
import { FootIk, LegInput, type AnimGround } from "./foot-ik";
import {
  AIR_NODE_COUNT,
  LOCO_IDLE,
  LOCO_NODE_COUNT,
  STRAFE_NODE_COUNT,
  airBlendIO,
  gaitStatsIO,
  locomotion1DIO,
  locomotion2DIO,
  rampAt,
} from "./locomotion-blend";
import { LAND_HARD, LAND_NONE, LAND_SOFT, LAND_STUMBLE, LandingCompression, stepPelvisIO } from "./low-g";
import { PLACEHOLDER_RIG, type RigProfile } from "./rig-profile";
import { SphereFrame } from "./sphere-frame";
import { BASE, StateMachine, UPPER, type StateInput } from "./state-machine";
import { ToolLayer } from "./tool-layer";
import { AIR, BOUNCE, LEAN, LOCO, TELEPORT_SNAP_M, TOOL } from "./tuning";

/** Per-frame animation input (spec 3.3). Mutable, preallocated; filled by the caller. */
export class AvatarAnimInput {
  /** Moon-centred render position of the sole-level root (alpha-interpolated / interpolation buffer). */
  readonly pos = new Float64Array(3);
  /** World facing vector (sim body facing). */
  readonly facing = new Float64Array([1, 0, 0]);
  /** World velocity: predicted sim velocity (local) or the smoothed estimate (remote). Never the display derivative. */
  readonly vel = new Float64Array(3);
  grounded = true;
  /** Sole height above ground while airborne (sim heightAboveGround), metres. */
  heightAboveGround = 0;
  /** -vUp on the airborne -> grounded edge (sim lastImpactMps); read only on the landing edge. */
  impactMps = 0;
  /** Sim reported a jump take-off this tick. */
  jumped = false;
  actionState = 0;
  /** Gravity for the wearer (1.62, Ballast 9.81) and landing thresholds from movement.json. */
  gravity = 1.62;
  landingSoftMps = 3.2;
  faceplantMps = 8;
  /** Tool: class code, sim sweeping flag, cycle phase [0, 1), period (s), contact fraction, head-in-contact. */
  toolClass = 0;
  toolActive = false;
  toolPhase = 0;
  toolPeriodS = 0.9;
  toolContactFrac: number = TOOL.defaultContactFrac;
  toolInContact = false;
  /** Sim tool-head contact point (world) and validity; tool-head IK pins the head here (spec 4.6). */
  readonly headTarget = new Float64Array(3);
  headValid = false;
  /** Step length (s) and moon radius (m) for this update. */
  dt = 1 / 60;
  moonRadiusM = 2000;
  /** Force a 0 ms reset (teleport, spawn, LOD wake-up). Cleared by the animator. */
  teleport = false;
}

/** Rig-agnostic pose output consumed by the rig adapter (mixer weights + direct bone writes). */
export class AvatarPose {
  /** Visual root and tangent frame (right, up, fwd). */
  readonly root = new Float64Array(3);
  readonly frame = new SphereFrame();
  /** Base-state weights (BASE.*; sum 1). */
  readonly base = new Float32Array(12);
  /** Locomotion: 1D weights (idle, shuffle, walk, lope), 2D weights (idle, fwd, right, bwd, left), 2D mix. */
  readonly loco1D = new Float32Array(LOCO_NODE_COUNT);
  readonly loco2D = new Float32Array(STRAFE_NODE_COUNT);
  strafeMix = 0;
  /** Sync-group gait phase [0, 1) (l_down at 0, r_down at 0.5) and playback rate. */
  gaitPhase = 0;
  gaitRate = 1;
  /** Air: rise/apex/fall weights, hang additive weight. */
  readonly air = new Float32Array(AIR_NODE_COUNT);
  hangWeight = 0;
  /** Upper: state, override weight w_U; tool hold/sweep weights, clip phase, twist, palm wobble. */
  upperState = 0;
  upperWeight = 0;
  toolHoldWeight = 0;
  toolSweepWeight = 0;
  toolClipPhase = 0;
  toolTwist = 0;
  readonly toolWobble = new Float64Array(2);
  /** Clip pelvis flight-deviation gain G = 1 / r^2 (apply during flight segments of real clips). */
  bounceGain = 1;
  /** Procedural pelvis vertical offset (placeholder bounce + landing compression + IK), metres. */
  pelvisY = 0;
  /** Placeholder gait bounce alone (for the rig adapter that has no clip yet). */
  gaitBounceY = 0;
  /** Spine lean: pitch (forward +) and bank (right +), radians, before the 0.3/0.3/0.4 spine share. */
  leanPitch = 0;
  leanBank = 0;
}

/**
 * Procedural placeholder gait: plant masks, sole and hip positions from the sync-group phase. Parameters come from
 * `leg.gait` = [phase, speed, cycleS, rate, flightS, movingWeight] (no double crosses a call).
 */
export function placeholderLegs(rig: RigProfile, leg: LegInput): void {
  const g = leg.gait;
  const phase = g[0]!;
  const speed = g[1]!;
  const cycleS = g[2]!;
  const rate = g[3]! > 1e-6 ? g[3]! : 1;
  const flightS = g[4]!;
  const movingWeight = g[5]!;
  const cycle = cycleS / rate;
  const stepDur = cycle / 2;
  const flight = flightS / rate;
  const doubleSupport = flight > 0 ? 0 : 0.08;
  // Each foot's stance fraction of the cycle.
  let stance = (stepDur - flight) / cycle + doubleSupport;
  if (stance > 0.95) stance = 0.95;
  const stride = speed * cycle; // distance travelled in one cycle (two steps)
  const lift = speed > 0.6 ? 0.12 : (0.12 * speed) / 0.6;
  for (let k = 0; k < 2; k++) {
    const o = k * 3;
    const side = k === 0 ? -1 : 1;
    const local = phase - k * 0.5 - Math.floor(phase - k * 0.5); // 0 at this foot's plant
    let z: number;
    let y: number;
    let plant: number;
    if (local < stance) {
      z = stride * stance * (0.5 - local / stance);
      y = 0;
      plant = 1;
    } else {
      const u = (local - stance) / (1 - stance);
      z = stride * stance * (u - 0.5);
      y = lift * Math.sin(Math.PI * u);
      plant = 0;
    }
    leg.sole[o] = side * rig.hipHalfWidthM;
    leg.sole[o + 1] = y * movingWeight;
    leg.sole[o + 2] = z * movingWeight;
    leg.plant[k] = movingWeight > 0.05 ? plant : 1;
    leg.hip[o] = side * rig.hipHalfWidthM;
    leg.hip[o + 1] = rig.hipHeightM;
    leg.hip[o + 2] = 0;
  }
}

// Per-update scalars shared by the animator's step methods (indices into AvatarAnimator.k).
const K_DT = 0;
const K_VUP = 1;
const K_VF = 2;
const K_VR = 3;
const K_S = 4;
const K_RATE = 5;
const K_CYCLE = 6;
const K_FLIGHT = 7;
const K_DIP = 8;
const K_MOVING = 9;
const K_STRAFE = 10;
const K_HANG = 11;
const K_IO0 = 12; // 12..19: helper io

export class AvatarAnimator {
  readonly pose = new AvatarPose();
  readonly sm = new StateMachine();
  readonly ik = new FootIk();
  readonly leg = new LegInput();
  readonly tool = new ToolLayer();
  readonly landing = new LandingCompression();
  /** Leg IK enabled for this update (U0/U1 buckets). */
  ikEnabled = true;
  /** Debug metrics (spec 9.1). */
  updates = 0;
  maxLockDriftM = 0;
  baseWeightSumMin = 1;
  private readonly prevRoot = new Float64Array(3);
  private hasPrev = false;
  private wasGrounded = true;
  private fwdSpeed = 0;
  private accelFwd = 0;
  private airTime = 0;
  private strafeTimer = 0;
  private prevPlant0 = 1;
  private prevPlant1 = 1;
  /** Per-update scalars (K_*), so the step methods exchange no doubles through calls (AN-M1-09). */
  private readonly k = new Float64Array(20);
  private readonly io = this.k.subarray(K_IO0, K_IO0 + 8);
  private readonly stateInput: { -readonly [P in keyof StateInput]: StateInput[P] } = {
    grounded: true,
    vUp: 0,
    timeToGround: Number.POSITIVE_INFINITY,
    landedClass: LAND_NONE,
    jumped: false,
    actionState: 0,
    speed: 0,
    toolClass: 0,
  };

  constructor(
    readonly slot: number,
    readonly events: AnimEventQueue,
    public rig: RigProfile = PLACEHOLDER_RIG,
  ) {}

  /** Full reset (spawn, teleport, LOD wake-up from frozen): IK, locks, springs, 0 ms blends. */
  reset(): void {
    this.sm.reset();
    this.ik.reset();
    this.tool.reset();
    this.landing.reset();
    this.pose.frame.reset();
    this.hasPrev = false;
    this.airTime = 0;
    this.accelFwd = 0;
    this.strafeTimer = 0;
  }

  /** Convenience wrapper (tests / cold callers). The module sets input.dt / moonRadiusM and calls `step`. */
  update(input: AvatarAnimInput, ground: AnimGround, moonRadiusM: number, dt: number, ikEnabled = true): void {
    input.moonRadiusM = moonRadiusM;
    input.dt = dt;
    this.ikEnabled = ikEnabled;
    this.step(input, ground);
  }

  /** One animation update from `input` (dt and moon radius are input fields). Allocation-free. */
  step(input: AvatarAnimInput, ground: AnimGround): void {
    this.k[K_DT] = input.dt;
    this.stepRoot(input);
    this.stepState(input);
    this.stepLoco();
    this.stepAirLean(input);
    this.stepTool(input);
    this.stepLegs(input, ground);
    this.stepMetrics();
  }

  private stepRoot(input: AvatarAnimInput): void {
    const pose = this.pose;
    const pos = input.pos;
    // Teleport / snap detection (spec 3.5 rule 2).
    if (this.hasPrev) {
      const dx = pos[0]! - this.prevRoot[0]!;
      const dy = pos[1]! - this.prevRoot[1]!;
      const dz = pos[2]! - this.prevRoot[2]!;
      if (dx * dx + dy * dy + dz * dz > TELEPORT_SNAP_M * TELEPORT_SNAP_M) input.teleport = true;
    }
    if (input.teleport) {
      this.reset();
      input.teleport = false;
    }
    this.prevRoot.set(pos);
    this.hasPrev = true;
    pose.root.set(pos);
    const frame = pose.frame;
    frame.update(pos, input.facing);
    // Velocity decomposition in the tangent frame.
    const v = input.vel;
    const u = frame.up;
    const f = frame.fwd;
    const r = frame.right;
    const k = this.k;
    k[K_VUP] = v[0]! * u[0]! + v[1]! * u[1]! + v[2]! * u[2]!;
    const vF = v[0]! * f[0]! + v[1]! * f[1]! + v[2]! * f[2]!;
    const vR = v[0]! * r[0]! + v[1]! * r[1]! + v[2]! * r[2]!;
    k[K_VF] = vF;
    k[K_VR] = vR;
    const s = Math.sqrt(vF * vF + vR * vR);
    k[K_S] = s < LOCO.speedFloor ? 0 : s;
  }

  private stepState(input: AvatarAnimInput): void {
    const k = this.k;
    const dt = k[K_DT]!;
    const vUp = k[K_VUP]!;
    const grounded = input.grounded;
    let landed = LAND_NONE;
    if (grounded && !this.wasGrounded) {
      const imp = input.impactMps;
      landed =
        imp < BOUNCE.landClipMinMps
          ? LAND_NONE
          : imp < input.landingSoftMps
            ? LAND_SOFT
            : imp <= input.faceplantMps
              ? LAND_HARD
              : LAND_STUMBLE;
      this.landing.trigger(imp);
      const pos = input.pos;
      const e = this.events.claim(ANIM_EVENT.landed, this.slot, landed);
      e.value = imp;
      e.x = pos[0]!;
      e.y = pos[1]!;
      e.z = pos[2]!;
    }
    this.airTime = grounded ? 0 : this.airTime + dt;
    this.wasGrounded = grounded;
    // Time to ground (spec 4.2): first t >= 0 of h + vUp t - g t^2 / 2 = 0.
    const h = input.heightAboveGround;
    const g = input.gravity;
    let ttg = 0;
    if (!grounded && h > 0) {
      ttg = g > 1e-9 ? (vUp + Math.sqrt(vUp * vUp + 2 * g * h)) / g : vUp < 0 ? h / -vUp : Number.POSITIVE_INFINITY;
    }
    const si = this.stateInput;
    si.grounded = grounded;
    si.vUp = vUp;
    si.timeToGround = ttg;
    si.landedClass = landed;
    si.jumped = input.jumped;
    si.actionState = input.actionState;
    si.speed = k[K_S]!;
    si.toolClass = input.toolClass;
    this.sm.dt = dt;
    this.sm.step(si);
    const pose = this.pose;
    pose.base.set(this.sm.baseWeights);
    pose.upperState = this.sm.upper;
    pose.upperWeight = this.sm.upperWeight;
  }

  private stepLoco(): void {
    const k = this.k;
    const io = this.io;
    const pose = this.pose;
    const dt = k[K_DT]!;
    const s = k[K_S]!;
    io[0] = s;
    locomotion1DIO(io, LOCO.nodeSpeeds, pose.loco1D);
    const rate1 = io[1]!;
    io[0] = k[K_VF]!;
    io[1] = k[K_VR]!;
    locomotion2DIO(io, pose.loco2D);
    const rate2 = io[2]!;
    const upperWantsStrafe = this.sm.upper === UPPER.tool || this.sm.upper === UPPER.throwing;
    const vF = k[K_VF]!;
    const vR = k[K_VR]!;
    const offAxis = s > 0.3 && Math.abs(Math.atan2(vR, vF)) > LOCO.strafeAngleRad;
    this.strafeTimer = offAxis ? this.strafeTimer + dt : 0;
    const strafe = (upperWantsStrafe || this.strafeTimer > LOCO.strafeEnterS) && s <= LOCO.strafeSpeed * LOCO.rateMax;
    k[K_STRAFE] = pose.strafeMix;
    rampAt(k, K_STRAFE, strafe ? 1 : 0, LOCO.strafeBlendS, K_DT);
    const mix = k[K_STRAFE]!;
    pose.strafeMix = mix;
    const rate = rate1 + (rate2 - rate1) * mix;
    k[K_RATE] = rate;
    pose.gaitRate = rate;
    gaitStatsIO(pose.loco1D, io);
    const cycleS = io[0]!;
    k[K_CYCLE] = cycleS;
    k[K_FLIGHT] = io[1]!;
    k[K_DIP] = io[2]!;
    k[K_MOVING] = 1 - pose.loco1D[LOCO_IDLE]! * (1 - mix) - pose.loco2D[0]! * mix;
    // Phase-preserving sync group: one accumulator for every locomotion clip.
    let ph = pose.gaitPhase + (dt * rate) / cycleS;
    ph -= Math.floor(ph);
    pose.gaitPhase = ph;
    // Low-g bounce: G = 1 / r^2 (clamped) for real clips' flight segments.
    const gain = rate > 1e-6 ? 1 / (rate * rate) : BOUNCE.gainMax;
    pose.bounceGain = gain < BOUNCE.gainMin ? BOUNCE.gainMin : gain > BOUNCE.gainMax ? BOUNCE.gainMax : gain;
  }

  private stepAirLean(input: AvatarAnimInput): void {
    const k = this.k;
    const io = this.io;
    const pose = this.pose;
    const dt = k[K_DT]!;
    // Placeholder bounce curve (stance dip + ballistic flight at the wearer's gravity), only in locomotion.
    const ph = pose.gaitPhase;
    io[0] = ph * 2 - Math.floor(ph * 2);
    io[1] = k[K_CYCLE]! / 2;
    io[2] = k[K_FLIGHT]!;
    io[3] = k[K_DIP]!;
    io[4] = k[K_RATE]!;
    io[5] = input.gravity;
    io[6] = BOUNCE.exaggeration;
    stepPelvisIO(io);
    pose.gaitBounceY = io[7]! * k[K_MOVING]! * this.sm.baseWeights[BASE.locomotion]!;
    // Air blend and hang.
    io[0] = k[K_VUP]!;
    airBlendIO(io, pose.air);
    k[K_HANG] = pose.hangWeight;
    rampAt(k, K_HANG, this.sm.isAir() && this.airTime > AIR.hangAfterS ? 1 : 0, AIR.hangFadeS, K_DT);
    pose.hangWeight = k[K_HANG]!;
    // Landing compression spring.
    this.landing.dt = dt;
    this.landing.step();
    // Lean (spec 3.2): forward pitch from smoothed forward acceleration, bank from speed x yaw rate.
    const vF = k[K_VF]!;
    const a = dt > 1e-6 ? (vF - this.fwdSpeed) / dt : 0;
    this.fwdSpeed = vF;
    this.accelFwd += (a - this.accelFwd) * (1 - Math.exp(-dt / LEAN.accelTauS));
    let pitch = this.accelFwd * LEAN.fwdRadPerMps2;
    pitch = pitch < LEAN.fwdMinRad ? LEAN.fwdMinRad : pitch > LEAN.fwdMaxRad ? LEAN.fwdMaxRad : pitch;
    const yawRate = dt > 1e-6 ? pose.frame.yawDelta / dt : 0;
    let bank = k[K_S]! * yawRate * LEAN.bankPerSpeedYawRate;
    bank = bank < -LEAN.bankMaxRad ? -LEAN.bankMaxRad : bank > LEAN.bankMaxRad ? LEAN.bankMaxRad : bank;
    const grounded = input.grounded;
    pose.leanPitch = (pitch + this.landing.torsoPitch) * (grounded ? 1 : 0.5);
    pose.leanBank = grounded ? bank : 0;
  }

  private stepTool(input: AvatarAnimInput): void {
    const tl = this.tool;
    const pose = this.pose;
    tl.inClass = input.toolClass;
    tl.inActive = input.toolActive;
    tl.inPhase = input.toolPhase;
    tl.inPeriodS = input.toolPeriodS;
    tl.inContactFrac = input.toolContactFrac;
    tl.inContact = input.toolInContact;
    tl.dt = this.k[K_DT]!;
    tl.step();
    pose.toolHoldWeight = tl.holdWeight;
    pose.toolSweepWeight = tl.sweepWeight;
    pose.toolClipPhase = tl.clipPhase;
    pose.toolTwist = tl.twist;
    pose.toolWobble[0] = tl.wobbleX;
    pose.toolWobble[1] = tl.wobbleZ;
    const h = input.headValid ? input.headTarget : input.pos;
    if (tl.turn !== 0) {
      const e = this.events.claim(ANIM_EVENT.toolTurn, this.slot, input.toolClass);
      e.value = tl.turn;
      e.x = h[0]!;
      e.y = h[1]!;
      e.z = h[2]!;
    }
    if (tl.contactEdge !== 0) {
      const e = this.events.claim(ANIM_EVENT.toolContact, this.slot, tl.contactEdge > 0 ? 1 : 0);
      e.x = h[0]!;
      e.y = h[1]!;
      e.z = h[2]!;
    }
  }

  private stepLegs(input: AvatarAnimInput, ground: AnimGround): void {
    const k = this.k;
    const pose = this.pose;
    const leg = this.leg;
    const grounded = input.grounded;
    const g = leg.gait;
    g[0] = pose.gaitPhase;
    g[1] = k[K_S]!;
    g[2] = k[K_CYCLE]!;
    g[3] = k[K_RATE]!;
    g[4] = k[K_FLIGHT]!;
    g[5] = grounded ? k[K_MOVING]! : 0;
    placeholderLegs(this.rig, leg);
    const prep = this.sm.base === BASE.landPrep;
    leg.weightCap = grounded ? 1 : prep ? 0.5 : 0;
    if (!grounded) {
      leg.plant[0] = prep ? 1 : 0;
      leg.plant[1] = prep ? 1 : 0;
    }
    let ikPelvis = 0;
    if (this.ikEnabled) {
      leg.dt = k[K_DT]!;
      leg.moonRadiusM = input.moonRadiusM;
      this.ik.step(pose.frame, input.pos, ground, this.rig, leg);
      ikPelvis = this.ik.pelvisOffset;
      const d0 = this.ik.lockDriftM[0]!;
      const d1 = this.ik.lockDriftM[1]!;
      const d = d0 > d1 ? d0 : d1;
      if (d > this.maxLockDriftM) this.maxLockDriftM = d;
    }
    pose.pelvisY = pose.gaitBounceY + this.landing.offset + ikPelvis;
    // Footfall events on plant rising edges while grounded and moving.
    if (grounded && k[K_MOVING]! > 0.05) {
      if (leg.plant[0]! > 0.5 && this.prevPlant0 <= 0.5) this.emitFoot(0);
      if (leg.plant[1]! > 0.5 && this.prevPlant1 <= 0.5) this.emitFoot(1);
    }
    this.prevPlant0 = leg.plant[0]!;
    this.prevPlant1 = leg.plant[1]!;
  }

  private stepMetrics(): void {
    const b = this.pose.base;
    let sum = 0;
    for (let i = 0; i < b.length; i++) sum += b[i]!;
    if (sum < this.baseWeightSumMin) this.baseWeightSumMin = sum;
    this.updates++;
  }

  private emitFoot(foot: number): void {
    const t = this.ik.soleTarget;
    const o = foot * 3;
    const fr = this.pose.frame;
    const rt = this.pose.root;
    const e = this.events.claim(ANIM_EVENT.footPlanted, this.slot, foot);
    e.x = rt[0]! + fr.right[0]! * t[o]! + fr.up[0]! * t[o + 1]! + fr.fwd[0]! * t[o + 2]!;
    e.y = rt[1]! + fr.right[1]! * t[o]! + fr.up[1]! * t[o + 1]! + fr.fwd[1]! * t[o + 2]!;
    e.z = rt[2]! + fr.right[2]! * t[o]! + fr.up[2]! * t[o + 1]! + fr.fwd[2]! * t[o + 2]!;
    e.value = this.pose.gaitRate > 1 ? 1 : this.pose.gaitRate;
  }
}

/**
 * Remote velocity estimate (spec 3.3): finite difference of the interpolated position over ~100 ms, then critically
 * damped smoothing (tau 80 ms); below 0.15 m/s -> 0. Ring of 16 timestamped samples, no allocation. Set `t` (s) and
 * `dt` before `push(pos)`.
 */
export class RemoteVelocityEstimator {
  readonly vel = new Float64Array(3);
  t = 0;
  dt = 1 / 60;
  private readonly ring = new Float64Array(16 * 4);
  private head = 0;
  private count = 0;
  private readonly sv = new Float64Array(3);
  private readonly target = new Float64Array(3);

  reset(): void {
    this.count = 0;
    this.vel.fill(0);
    this.sv.fill(0);
  }

  /** Pushes the interpolated position at time `this.t` and updates `vel`. */
  push(pos: Float64Array): void {
    const tS = this.t;
    const dt = this.dt;
    const ring = this.ring;
    const o = this.head * 4;
    ring[o] = tS;
    ring[o + 1] = pos[0]!;
    ring[o + 2] = pos[1]!;
    ring[o + 3] = pos[2]!;
    this.head = (this.head + 1) & 15;
    if (this.count < 16) this.count++;
    // Oldest sample at least 100 ms back (or the oldest available).
    let j = 1;
    let back = o;
    while (j < this.count) {
      const idx = ((this.head - 1 - j) & 15) * 4;
      back = idx;
      if (tS - ring[idx]! >= 0.1) break;
      j++;
    }
    const span = tS - ring[back]!;
    const tg = this.target;
    if (span > 1e-4) {
      tg[0] = (pos[0]! - ring[back + 1]!) / span;
      tg[1] = (pos[1]! - ring[back + 2]!) / span;
      tg[2] = (pos[2]! - ring[back + 3]!) / span;
    } else {
      tg[0] = 0;
      tg[1] = 0;
      tg[2] = 0;
    }
    // Critically damped smoothing toward the target (closed form step, omega = 2 / tau).
    const w = 2 / 0.08;
    const x = w * dt;
    const e = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
    const v = this.vel;
    const sv = this.sv;
    for (let i = 0; i < 3; i++) {
      const change = v[i]! - tg[i]!;
      const temp = (sv[i]! + w * change) * dt;
      sv[i] = (sv[i]! - w * temp) * e;
      v[i] = tg[i]! + (change + temp) * e;
    }
    const s2 = v[0]! * v[0]! + v[1]! * v[1]! + v[2]! * v[2]!;
    if (s2 < LOCO.speedFloor * LOCO.speedFloor) {
      v[0] = 0;
      v[1] = 0;
      v[2] = 0;
    }
  }
}
