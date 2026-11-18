// Animator -> blockout custodian adapter (M1-W3-T07, hooks the M1-W5-T04 logic layer onto the blockout rig).
//
// The blockout has no skeleton: its shader rotates rigid limbs (thigh, shin, upper arm, forearm) about the asset's
// pivot nodes, in the sagittal plane only (material.ts). This adapter is the blockout's "mixer": it reads a stepped
// `AvatarAnimator` (rig-agnostic `AvatarPose`, foot-IK targets, tool layer) and writes the custodian's joint fields:
//
// - Body: pelvis offset (gait bounce + landing compression + IK pelvis), lean (pitch / bank + slope stance) and tool
//   twist, pivoting about the hips (not the feet) so the planted soles stay put.
// - Legs: each ankle target (foot-IK sole target, or the placeholder gait when IK is off at far LOD buckets) is moved
//   into the leaning body's space and solved with a planar two-bone; the knee points forward.
// - Arms: counter-swing from the legs while walking, a hold pose for the held tool, and the Desk Duster work pose:
//   standing still the custodian drops to hands and knees and scrubs, the bristle tips IK-pinned to a stroke point on
//   the ground that follows the sim's push / lift cycle (tool layer clip phase), left palm planted. While walking with
//   the tool down it bends over and reaches toward the ground instead (the v0 arm cannot touch the ground standing).
// - Air: legs tuck and split, arms rise.
//
// Frames: the animator's local frame is (right, up, forward); the asset's is (left = +X, up = +Y, forward = +Z), so
// x flips sign. Angles are "forward" angles measured from hanging straight down (-Y) toward +Z, as in motion.ts.
// Hot path: `apply()` allocates nothing: plain arithmetic on Float64Array scratch, no doubles through calls.

import type { Quaternion, Vector3 } from "three/webgpu";
import {
  AIR_APEX,
  BASE,
  LOCO_IDLE,
  STRAFE_IDLE,
  TOOL_CLASS,
  type AvatarAnimator,
  type RigProfile,
} from "../../../animation";
import type { LoadedAsset } from "./assets";
import type { BlockoutCustodian } from "./custodian";

/** Joint positions of the blockout in asset space (metres), read from its pivot / socket nodes. */
export interface BlockoutRigGeometry {
  /** Hip joint height and lateral offset (|x|), knee pivot height / forward offset. */
  readonly hipY: number;
  readonly hipX: number;
  readonly kneeY: number;
  readonly kneeZ: number;
  /** Ankle height above the sole (the shin is rigid down to the sole; animation-spec 4.3: 0.095). */
  readonly ankleY: number;
  readonly shoulderY: number;
  readonly shoulderX: number;
  readonly elbowY: number;
  readonly elbowZ: number;
  /** Hand socket (glove centre): |x|, height, forward offset. */
  readonly handX: number;
  readonly handY: number;
  readonly handZ: number;
  /** Right-hand tool contact (Desk Duster bristle tips) at bind; the glove centre when there is no tool. */
  readonly tipY: number;
  readonly tipZ: number;
}

function sock(asset: LoadedAsset, name: string): { position: Vector3; quaternion: Quaternion } {
  const s = asset.sockets.get(name);
  if (s === undefined) throw new Error(`${asset.id}: ${name} missing`);
  return s;
}

/** Reads the rig geometry from the loaded assets (cold path; allocates). */
export function blockoutRigGeometry(custodian: LoadedAsset, duster: LoadedAsset | null): BlockoutRigGeometry {
  const hip = sock(custodian, "pivot_hip_R").position;
  const knee = sock(custodian, "pivot_knee_R").position;
  const shoulder = sock(custodian, "pivot_shoulder_R").position;
  const elbow = sock(custodian, "pivot_elbow_R").position;
  const hand = sock(custodian, "socket_hand_R");
  const tip = hand.position.clone();
  const contact = duster?.sockets.get("socket_contact");
  if (contact !== undefined) tip.add(contact.position.clone().applyQuaternion(hand.quaternion));
  return {
    hipY: hip.y,
    hipX: Math.abs(hip.x),
    kneeY: knee.y,
    kneeZ: knee.z,
    ankleY: 0.095,
    shoulderY: shoulder.y,
    shoulderX: Math.abs(shoulder.x),
    elbowY: elbow.y,
    elbowZ: elbow.z,
    handX: Math.abs(hand.position.x),
    handY: hand.position.y,
    handZ: hand.position.z,
    tipY: tip.y,
    tipZ: tip.z,
  };
}

/** Rest knee softness: the hip sits this far below its bind height so the IK never runs the legs fully straight. */
export const STANCE_DROP_M = 0.025;

/** `RigProfile` for the animator built from the blockout's own joints (pass to `AvatarAnimator.rig`). */
export function blockoutRigProfile(g: BlockoutRigGeometry): RigProfile {
  const thigh = Math.hypot(g.hipY - g.kneeY, g.kneeZ);
  const calf = Math.hypot(g.kneeY - g.ankleY, g.kneeZ);
  return {
    id: "rig.custodian.blockout",
    hipHeightM: g.hipY - STANCE_DROP_M,
    hipHalfWidthM: g.hipX,
    thighM: thigh,
    calfM: calf,
    ankleHeightM: g.ankleY,
    shoulderHeightM: g.shoulderY,
    shoulderHalfWidthM: g.shoulderX,
    upperArmM: Math.hypot(g.shoulderY - g.elbowY, g.elbowZ),
    forearmM: Math.hypot(g.elbowY - g.handY, g.handZ - g.elbowZ),
  };
}

/** Posing constants (tuning estimates for the blockout; the production rig gets clips instead). */
export interface PoserTuning {
  /** Kneel-to-scrub weight rates (1/s, exponential) and the locomotion weight above which the custodian stands. */
  readonly kneelInRate: number;
  readonly kneelOutRate: number;
  readonly kneelMaxMoving: number;
  /** Hands-and-knees pose: hip height, torso pitch (rad), ankle (shin flat behind) height and back offset. */
  readonly kneelHipY: number;
  readonly kneelPitch: number;
  readonly kneelAnkleY: number;
  readonly kneelAnkleZ: number;
  /** Scrub stroke: centre of the stroke ahead of the feet, stroke length along forward, lift height on return. */
  readonly kneelWorkZ: number;
  readonly strokeLenM: number;
  readonly strokeLiftM: number;
  /** Bristle contact height above the ground (bristle tuft radius). */
  readonly contactY: number;
  /** Left palm plant: height of the glove centre, forward offset from the shoulder. */
  readonly palmY: number;
  readonly palmAheadM: number;
  /** Walking with the tool down: torso pitch, hip drop and stroke centre. */
  readonly bendPitch: number;
  readonly bendDropM: number;
  readonly bendWorkZ: number;
  /** Arm counter-swing gain (fraction of the leg swing) and the walking elbow bend. */
  readonly armSwing: number;
  readonly elbowWalk: number;
  /** Tool hold pose of the right arm (shoulder / elbow forward angles). */
  readonly holdShoulder: number;
  readonly holdElbow: number;
  /** Air: foot tuck height, fore / aft foot split, arm rise. */
  readonly airTuckM: number;
  readonly airSplitM: number;
  readonly airArms: number;
  /**
   * Tool-head glue: blend rate (1/s) toward the sim head, the kneeling body's crawl toward the stroke centre (rate 1/s,
   * forward limits and lateral limit, metres) so the right hand works over the dust contact. `glueWorkZ` is where the
   * stroke centre sits ahead of the kneeling feet; `rockM` the body's fore / aft rock with the push (the shoulders
   * lead the stroke, so a long sim push stays within the arm's reach).
   */
  readonly glueRate: number;
  readonly glueWorkZ: number;
  readonly rockM: number;
  readonly crawlRate: number;
  readonly crawlBackM: number;
  readonly crawlFwdM: number;
  readonly crawlSideM: number;
}

export const DEFAULT_POSER_TUNING: PoserTuning = {
  kneelInRate: 7,
  kneelOutRate: 9,
  kneelMaxMoving: 0.35,
  kneelHipY: 0.5,
  kneelPitch: 1.3,
  kneelAnkleY: 0.11,
  kneelAnkleZ: -0.4,
  kneelWorkZ: 0.56,
  strokeLenM: 0.2,
  strokeLiftM: 0.045,
  contactY: 0.012,
  palmY: 0.06,
  palmAheadM: 0.02,
  bendPitch: 0.42,
  bendDropM: 0.1,
  bendWorkZ: 0.6,
  armSwing: 0.85,
  elbowWalk: 0.3,
  holdShoulder: 0.3,
  holdElbow: 1.05,
  airTuckM: 0.14,
  airSplitM: 0.1,
  airArms: 0.45,
  glueRate: 14,
  glueWorkZ: 0.45,
  rockM: 0.14,
  crawlRate: 6,
  crawlBackM: 0.15,
  crawlFwdM: 0.6,
  crawlSideM: 0.5,
};

// Scratch layout of the planar two-bone (no double crosses a call; AN-M1-09 style).
const IO_RY = 0;
const IO_RZ = 1;
const IO_TY = 2;
const IO_TZ = 3;
const IO_A = 4;
const IO_B = 5;
const IO_BEND = 6;
const IO_P1 = 7;
const IO_P2 = 8;
const IO_REACH = 9;

/**
 * Planar two-bone in the sagittal (y, z) plane: root io[0..1], target io[2..3], segment lengths io[4..5], bend io[6]
 * (+1 middle joint ahead of the root-target line: knee; -1 behind: elbow). Writes the forward angles of the two
 * segments to io[7], io[8] and the reach used (after clamping to the reachable band) to io[9].
 */
export function planarTwoBoneIO(io: Float64Array): void {
  const dy = io[IO_TY]! - io[IO_RY]!;
  const dz = io[IO_TZ]! - io[IO_RZ]!;
  const a = io[IO_A]!;
  const b = io[IO_B]!;
  let d = Math.sqrt(dy * dy + dz * dz);
  const lo = Math.abs(a - b) + 1e-4;
  const hi = (a + b) * 0.9995;
  if (d < lo) d = lo;
  else if (d > hi) d = hi;
  const phi = Math.atan2(dz, -dy);
  let ca = (a * a + d * d - b * b) / (2 * a * d);
  let cb = (b * b + d * d - a * a) / (2 * b * d);
  ca = ca > 1 ? 1 : ca < -1 ? -1 : ca;
  cb = cb > 1 ? 1 : cb < -1 ? -1 : cb;
  const alpha = Math.acos(ca);
  const beta = Math.acos(cb);
  const s = io[IO_BEND]! >= 0 ? 1 : -1;
  io[IO_P1] = phi + s * alpha;
  io[IO_P2] = phi - s * beta;
  io[IO_REACH] = d;
}

// Per-update scalars of the poser (indices into BlockoutPoser.k), so its step methods exchange no doubles.
const K_DT = 0;
const K_AIR = 1;
const K_MOVING = 2;
const K_KNEEL = 3;
const K_BEND = 4;
const K_SWEEP = 5;
const K_HOLD = 6;
const K_GLUE = 7;
/** Stroke reach at the clip phase (0 pulled back .. 1 full push), no anticipation lead. */
const K_REACH = 8;

/** Per-custodian adapter state (smoothed work weights) and scratch. */
export class BlockoutPoser {
  /** Frame step (s) for the adapter's own smoothing; set before `apply` (a field, so no double crosses the call). */
  dt = 1 / 60;
  /** Smoothed hands-and-knees weight and the bent-over walking weight (0..1). */
  kneel = 0;
  bend = 0;
  /**
   * Tool-head target in the custodian's object frame (asset axes, metres from the feet): the sim's head point at render
   * time and the middle of its stroke (set by the view from the animator pose). While valid, the bristle tips are
   * IK-pinned to the head (glue) and the kneeling body crawls so the right hand works over the stroke centre.
   */
  readonly headLocal = new Float64Array(3);
  readonly centreLocal = new Float64Array(3);
  headValid = false;
  /** Smoothed tool-head glue weight (0..1) and the kneeling crawl offset (object frame x, z; metres). */
  glue = 0;
  crawlX = 0;
  crawlZ = 0;
  /** Debug: distance (m) the bristle tips could not cover to the stroke target in the last update. */
  reachErrorM = 0;

  private readonly io = new Float64Array(10);
  private readonly k = new Float64Array(9);
  /** Body rotation (three Euler XYZ, column-major 3 x 3) and translation in the object frame. */
  private readonly rm = new Float64Array(9);
  private readonly tr = new Float64Array(3);
  /** Point scratch: [0..2] in, [3..5] out. */
  private readonly pt = new Float64Array(6);
  private readonly hipAngles = new Float64Array(2);
  // Planar segment lengths and bind angles (from the geometry).
  private readonly thigh: number;
  private readonly calf: number;
  private readonly thigh0: number;
  private readonly shin0: number;
  private readonly upper: number;
  private readonly upper0: number;
  private readonly tipLen: number;
  private readonly tip0: number;
  private readonly handLen: number;
  private readonly hand0: number;

  constructor(
    readonly geo: BlockoutRigGeometry,
    readonly tuning: PoserTuning = DEFAULT_POSER_TUNING,
  ) {
    const g = geo;
    this.thigh = Math.hypot(g.hipY - g.kneeY, g.kneeZ);
    this.calf = Math.hypot(g.kneeY - g.ankleY, g.kneeZ);
    this.thigh0 = Math.atan2(g.kneeZ, g.hipY - g.kneeY);
    this.shin0 = Math.atan2(-g.kneeZ, g.kneeY - g.ankleY);
    this.upper = Math.hypot(g.shoulderY - g.elbowY, g.elbowZ);
    this.upper0 = Math.atan2(g.elbowZ, g.shoulderY - g.elbowY);
    this.tipLen = Math.hypot(g.elbowY - g.tipY, g.tipZ - g.elbowZ);
    this.tip0 = Math.atan2(g.tipZ - g.elbowZ, g.elbowY - g.tipY);
    this.handLen = Math.hypot(g.elbowY - g.handY, g.handZ - g.elbowZ);
    this.hand0 = Math.atan2(g.handZ - g.elbowZ, g.elbowY - g.handY);
  }

  /** Forgets the smoothed weights (spawn, teleport). */
  reset(): void {
    this.kneel = 0;
    this.bend = 0;
    this.glue = 0;
    this.crawlX = 0;
    this.crawlZ = 0;
  }

  /**
   * Poses `c` from the animator's last step and writes it (`c.applyPose()`). `this.dt` drives only the adapter's own
   * smoothing. The caller places `c.object` at `animator.pose.root` with the pose's tangent frame. No allocation.
   */
  apply(animator: AvatarAnimator, c: BlockoutCustodian): void {
    const d = this.dt;
    this.k[K_DT] = d > 0 ? (d < 0.1 ? d : 0.1) : 0;
    this.stepWeights(animator);
    this.stepBody(animator, c);
    this.stepLegs(animator, c);
    this.stepArms(animator, c);
    c.applyPose();
  }

  private stepWeights(animator: AvatarAnimator): void {
    const t = this.tuning;
    const pose = animator.pose;
    const tl = animator.tool;
    const k = this.k;
    const base = pose.base;
    let air = base[BASE.air]! + base[BASE.landPrep]!;
    air = air > 1 ? 1 : air;
    const mix = pose.strafeMix;
    let moving = 1 - (pose.loco1D[LOCO_IDLE]! * (1 - mix) + pose.loco2D[STRAFE_IDLE]! * mix);
    moving = (moving < 0 ? 0 : moving > 1 ? 1 : moving) * base[BASE.locomotion]!;
    const sweep = tl.sweepWeight;
    let kneelTarget = 0;
    if (tl.toolClass === TOOL_CLASS.palm) {
      // smoothstep(0.1, kneelMaxMoving, moving): the custodian stands up once it really walks.
      const e0 = 0.1;
      const x = moving <= e0 ? 0 : moving >= t.kneelMaxMoving ? 1 : (moving - e0) / (t.kneelMaxMoving - e0);
      kneelTarget = sweep * (1 - x * x * (3 - 2 * x)) * (1 - air);
    }
    const rate = kneelTarget > this.kneel ? t.kneelInRate : t.kneelOutRate;
    this.kneel += (kneelTarget - this.kneel) * (1 - Math.exp(-rate * k[K_DT]!));
    const kneel = this.kneel;
    this.bend = sweep * (1 - kneel) * (1 - air);
    k[K_AIR] = air;
    k[K_MOVING] = moving;
    k[K_KNEEL] = kneel;
    k[K_BEND] = this.bend;
    k[K_SWEEP] = sweep;
    k[K_HOLD] = tl.holdWeight;
    // Glue toward the sim head while it is valid and the tool works; fades from the last head point otherwise.
    const glueTarget = this.headValid && sweep > 1e-3 ? 1 : 0;
    this.glue += (glueTarget - this.glue) * (1 - Math.exp(-t.glueRate * k[K_DT]!));
    if (this.glue < 1e-4) this.glue = 0;
    k[K_GLUE] = this.glue;
    {
      const cf = tl.inContactFrac;
      const ph = tl.clipPhase - Math.floor(tl.clipPhase);
      let u = ph < cf ? (cf > 0 ? ph / cf : 1) : 1 - (cf < 1 ? (ph - cf) / (1 - cf) : 1);
      u = u < 0 ? 0 : u > 1 ? 1 : u;
      k[K_REACH] = u * u * (3 - 2 * u);
    }
    // Crawl: the right hand (object x = -handX) over the stroke centre, the stroke centred on the kneeling reach.
    if (this.headValid) {
      let cx = this.centreLocal[0]! + this.geo.handX;
      cx = cx < -t.crawlSideM ? -t.crawlSideM : cx > t.crawlSideM ? t.crawlSideM : cx;
      let cz = this.centreLocal[2]! - t.glueWorkZ;
      cz = cz < -t.crawlBackM ? -t.crawlBackM : cz > t.crawlFwdM ? t.crawlFwdM : cz;
      const a = 1 - Math.exp(-t.crawlRate * k[K_DT]!);
      this.crawlX += (cx - this.crawlX) * a;
      this.crawlZ += (cz - this.crawlZ) * a;
    }
  }

  /** Body offset, lean and twist about the hip centre; caches the body transform (rm, tr). */
  private stepBody(animator: AvatarAnimator, c: BlockoutCustodian): void {
    const t = this.tuning;
    const g = this.geo;
    const k = this.k;
    const pose = animator.pose;
    const ik = animator.ik;
    const m = c.motion;
    const useIk = animator.ikEnabled;
    const kneel = k[K_KNEEL]!;
    const bend = k[K_BEND]!;
    const pitch = pose.leanPitch + (useIk ? ik.slopeLean[0]! : 0) + kneel * t.kneelPitch + bend * t.bendPitch;
    const roll = pose.leanBank + (useIk ? ik.slopeLean[1]! : 0);
    const twist = pose.toolTwist * (1 - 0.6 * kneel);
    const standHip = g.hipY - STANCE_DROP_M + pose.pelvisY - bend * t.bendDropM;
    const hipY = standHip + (t.kneelHipY - standHip) * kneel;
    // three Euler XYZ (Object3D.rotation order) as a column-major 3 x 3 (Matrix4.makeRotationFromEuler).
    const a = Math.cos(pitch);
    const b = Math.sin(pitch);
    const cy = Math.cos(twist);
    const dy = Math.sin(twist);
    const e = Math.cos(roll);
    const f = Math.sin(roll);
    const ae = a * e;
    const af = a * f;
    const be = b * e;
    const bf = b * f;
    const r = this.rm;
    r[0] = cy * e;
    r[3] = -cy * f;
    r[6] = dy;
    r[1] = af + be * dy;
    r[4] = ae - bf * dy;
    r[7] = -b * cy;
    r[2] = bf - ae * dy;
    r[5] = be + af * dy;
    r[8] = a * cy;
    // Translation so the hip centre (0, hipY_bind, 0) lands at (shift x, hipY, shift z): t = target - R * hip.
    const h = g.hipY;
    const tr = this.tr;
    const crawl = kneel * k[K_GLUE]!;
    // Rock with the stroke itself (not the anticipated body curve, which already pulls back before the push ends).
    const rock = (k[K_REACH]! - 0.5) * t.rockM;
    tr[0] = (useIk ? -ik.pelvisShift[0]! : 0) + this.crawlX * crawl - r[3]! * h;
    tr[1] = hipY - r[4]! * h;
    tr[2] = (useIk ? ik.pelvisShift[1]! : 0) + (this.crawlZ + rock) * crawl - r[5]! * h;
    m.yaw = 0;
    m.pitch = pitch;
    m.roll = roll;
    m.twist = twist;
    m.bodyX = tr[0]!;
    m.bob = tr[1]!;
    m.bodyZ = tr[2]!;
  }

  /** pt[0..2] (object frame) -> pt[3..5] (body frame): R^T (p - t). */
  private toBody(): void {
    const p = this.pt;
    const r = this.rm;
    const x = p[0]! - this.tr[0]!;
    const y = p[1]! - this.tr[1]!;
    const z = p[2]! - this.tr[2]!;
    p[3] = r[0]! * x + r[1]! * y + r[2]! * z;
    p[4] = r[3]! * x + r[4]! * y + r[5]! * z;
    p[5] = r[6]! * x + r[7]! * y + r[8]! * z;
  }

  /** pt[0..2] (body frame) -> pt[3..5] (object frame): R p + t. */
  private toObject(): void {
    const p = this.pt;
    const r = this.rm;
    const x = p[0]!;
    const y = p[1]!;
    const z = p[2]!;
    p[3] = r[0]! * x + r[3]! * y + r[6]! * z + this.tr[0]!;
    p[4] = r[1]! * x + r[4]! * y + r[7]! * z + this.tr[1]!;
    p[5] = r[2]! * x + r[5]! * y + r[8]! * z + this.tr[2]!;
  }

  private stepLegs(animator: AvatarAnimator, c: BlockoutCustodian): void {
    const t = this.tuning;
    const g = this.geo;
    const k = this.k;
    const pose = animator.pose;
    const m = c.motion;
    const io = this.io;
    const pt = this.pt;
    const src = animator.ikEnabled ? animator.ik.soleTarget : animator.leg.sole;
    const air = k[K_AIR]!;
    const kneel = k[K_KNEEL]!;
    const glue = k[K_GLUE]!;
    const split = air * t.airSplitM;
    const tuck = air * t.airTuckM * (0.6 + 0.4 * pose.air[AIR_APEX]!);
    for (let s = 0; s < 2; s++) {
      const o = s * 3;
      let tx = -src[o]!;
      let ty = src[o + 1]! + g.ankleY + tuck;
      let tz = src[o + 2]! + (s === 0 ? split : -split * 0.8);
      if (kneel > 0) {
        // The knees come along with the crawl (the body shift is kneel x glue x crawl, see stepBody).
        const side = (s === 0 ? g.hipX : -g.hipX) + this.crawlX * glue;
        tx += (side - tx) * kneel;
        ty += (t.kneelAnkleY - ty) * kneel;
        tz += (t.kneelAnkleZ + this.crawlZ * glue - tz) * kneel;
      }
      pt[0] = tx;
      pt[1] = ty;
      pt[2] = tz;
      this.toBody();
      io[IO_RY] = g.hipY;
      io[IO_RZ] = 0;
      io[IO_TY] = pt[4]!;
      io[IO_TZ] = pt[5]!;
      io[IO_A] = this.thigh;
      io[IO_B] = this.calf;
      io[IO_BEND] = 1;
      planarTwoBoneIO(io);
      const hip = io[IO_P1]! - this.thigh0;
      const knee = this.shin0 + hip - io[IO_P2]!;
      this.hipAngles[s] = hip;
      if (s === 0) {
        m.hipL = hip;
        m.kneeL = knee;
      } else {
        m.hipR = hip;
        m.kneeR = knee;
      }
    }
  }

  private stepArms(animator: AvatarAnimator, c: BlockoutCustodian): void {
    const t = this.tuning;
    const g = this.geo;
    const k = this.k;
    const tl = animator.tool;
    const m = c.motion;
    const io = this.io;
    const pt = this.pt;
    const air = k[K_AIR]!;
    const moving = k[K_MOVING]!;
    const kneel = k[K_KNEEL]!;
    const sweep = k[K_SWEEP]!;
    const hold = k[K_HOLD]!;
    // Swing (left arm against the left leg), air rise, then the right hand's tool hold.
    const swing = (this.hipAngles[0]! - this.hipAngles[1]!) * 0.5 * t.armSwing * moving * (1 - air);
    const elbowBase = 0.15 + t.elbowWalk * moving + air * 0.4;
    let shL = -swing + air * t.airArms;
    let elL = elbowBase;
    let shR = swing + air * t.airArms;
    let elR = elbowBase;
    shR += (t.holdShoulder - shR) * hold;
    elR += (t.holdElbow - elR) * hold;

    // Right arm: bristle tips IK'd to the stroke point (push along the ground, lifted return).
    this.reachErrorM = 0;
    if (sweep > 1e-3) {
      const cf = tl.inContactFrac;
      const ph = tl.clipPhase - Math.floor(tl.clipPhase);
      let u: number;
      let lift = 0;
      if (ph < cf) u = cf > 0 ? ph / cf : 1;
      else {
        const w = cf < 1 ? (ph - cf) / (1 - cf) : 1;
        u = 1 - w;
        lift = Math.sin(Math.PI * w) * t.strokeLiftM;
      }
      const reach = u * u * (3 - 2 * u);
      const glue = k[K_GLUE]!;
      const crawl = kneel * glue;
      const centre = t.bendWorkZ + (t.kneelWorkZ - t.bendWorkZ) * kneel + this.crawlZ * crawl;
      // Procedural stroke, then glued to the sim head point (the dust contact), wobble and lift kept on top.
      const pz = centre + (reach - 0.5) * t.strokeLenM;
      const hl = this.headLocal;
      pt[0] = -g.handX + this.crawlX * crawl;
      pt[1] = t.contactY + lift + hl[1]! * glue;
      pt[2] = pz + (hl[2]! - pz) * glue + tl.wobbleZ;
      this.toBody();
      io[IO_RY] = g.shoulderY;
      io[IO_RZ] = 0;
      io[IO_TY] = pt[4]!;
      io[IO_TZ] = pt[5]!;
      io[IO_A] = this.upper;
      io[IO_B] = this.tipLen;
      io[IO_BEND] = -1;
      planarTwoBoneIO(io);
      const dy = pt[4]! - g.shoulderY;
      const dz = pt[5]!;
      this.reachErrorM = Math.sqrt(dy * dy + dz * dz) - io[IO_REACH]!;
      const s = io[IO_P1]! - this.upper0;
      const e = io[IO_P2]! - this.tip0 - s;
      shR += (s - shR) * sweep;
      elR += (e - elR) * sweep;
    }

    // Left arm: palm planted just ahead of the shoulder while kneeling.
    if (kneel > 1e-3) {
      pt[0] = g.shoulderX;
      pt[1] = g.shoulderY;
      pt[2] = 0;
      this.toObject();
      pt[0] = g.shoulderX;
      pt[1] = t.palmY;
      pt[2] = pt[5]! + t.palmAheadM;
      this.toBody();
      io[IO_RY] = g.shoulderY;
      io[IO_RZ] = 0;
      io[IO_TY] = pt[4]!;
      io[IO_TZ] = pt[5]!;
      io[IO_A] = this.upper;
      io[IO_B] = this.handLen;
      io[IO_BEND] = -1;
      planarTwoBoneIO(io);
      const s = io[IO_P1]! - this.upper0;
      const e = io[IO_P2]! - this.hand0 - s;
      shL += (s - shL) * kneel;
      elL += (e - elL) * kneel;
    }
    m.shoulderL = shL;
    m.elbowL = elL;
    m.shoulderR = shR;
    m.elbowR = elR;
  }
}
