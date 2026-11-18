// Main-thread Solo prediction of the own driven vehicle (M1-W7-T01; solo-first rule, E13 "input-to-first-visual <= 1
// frame"). Mirrors avatar/solo-predictor.ts for the Trundle: the render thread steps the vehicle with the SAME pure
// `stepVehicle` + `fillVehicleIntent` the worker runs (packages/sim), on the SAME inputs at send time, over the SAME
// ground and the SAME game-data tuning (`resolveVehicleTuning`). Each FRAME's Self (after input `ackSeq`) reconciles:
// restore the prediction recorded after the acked input, overwrite what the FRAME carries, replay the unacknowledged
// inputs (<= 16) and keep the visual jump as a render offset that halves every 80 ms.
//
// Two Self shapes are accepted:
// - With the Self vehicle block (`moveState === seated_driver`, protocol frame-state): chassis position, 15-bit
//   orientation, linear velocity, steer, gear, boost and lights overwrite the prediction (exact path).
// - Avatar only (the Solo frame encoder does not fill the vehicle block yet): the chassis is rebuilt from the handle
//   point and the 10-bit body yaw (feel `handleBackM`); the pose is only overwritten when it differs from the
//   prediction by more than the wire's quantisation (2 cm / 2 yaw steps), so in a deterministic Solo shift the prediction
//   runs on undisturbed and the speed, boost meter and springs stay the predictor's own.
// Allocation-free after construction (preallocated history ring).

import { FRAME_SELF_DRIVER_MOVE_STATE, QUANT, type SimInputCommand } from "@moon-cleanup/shared";
import { steerFromCode8, unpackQuat, yawFromCode, type QuatOut, type SelfState } from "@moon-cleanup/protocol";
import {
  AvatarState,
  copyVehicleState,
  fillVehicleIntent,
  headingBasis,
  refreshVehicleStats,
  spawnVehicle,
  stepVehicle,
  vehicleBasis,
  VehicleIntent,
  vehicleKindOf,
  VehicleState,
  type SimConfig,
  type SimGround,
  type VehicleTuning,
} from "@moon-cleanup/sim";
import type { VehicleCameraPose } from "./vehicle-camera";

/** Most inputs replayed per reconcile (same budget as the avatar predictors). */
export const TRUNDLE_PREDICTION_MAX_REPLAY = 16;
export const TRUNDLE_PREDICTION_HISTORY = 64;
export const TRUNDLE_CORRECTION_HALF_LIFE_MS = 80;
/** Avatar-only reconcile: pose differences below these are wire quantisation, not error. */
export const TRUNDLE_HANDLE_SNAP_M = 0.02;
export const TRUNDLE_HANDLE_SNAP_RAD = (2 * Math.PI * 2) / (1 << QUANT.yaw.bits);

/** What reconcile reads (protocol `SelfState` satisfies it). */
export type VehicleSelfLike = Pick<
  SelfState,
  | "moveState"
  | "px"
  | "py"
  | "pz"
  | "yawCode"
  | "vpx"
  | "vpy"
  | "vpz"
  | "orientIndex"
  | "orientA"
  | "orientB"
  | "orientC"
  | "lvx"
  | "lvy"
  | "lvz"
  | "steer"
  | "gear"
  | "boost"
  | "lights"
>;

export interface TrundlePredictorStats {
  predicted: number;
  reconciles: number;
  exactReconciles: number;
  handleSnaps: number;
  replayed: number;
  unknownAcks: number;
  lastCorrectionM: number;
  maxCorrectionM: number;
}

/** Mutable render pose written by `sample` (satisfies VehicleCameraPose). */
export class PredictedVehiclePose implements VehicleCameraPose {
  px = 0;
  py = 0;
  pz = 0;
  fx = 1;
  fy = 0;
  fz = 0;
  speed = 0;
  latSpeed = 0;
  boosting = false;
}

class Quat implements QuatOut {
  x = 0;
  y = 0;
  z = 0;
  w = 1;
}

export class TrundlePredictor {
  readonly state: VehicleState;
  readonly offset = new Float64Array(3);
  readonly stats: TrundlePredictorStats = {
    predicted: 0,
    reconciles: 0,
    exactReconciles: 0,
    handleSnaps: 0,
    replayed: 0,
    unknownAcks: 0,
    lastCorrectionM: 0,
    maxCorrectionM: 0,
  };
  private readonly hist: VehicleState[] = [];
  private readonly histSeq = new Int32Array(TRUNDLE_PREDICTION_HISTORY).fill(-1);
  private readonly inMoveX = new Int16Array(TRUNDLE_PREDICTION_HISTORY);
  private readonly inMoveY = new Int16Array(TRUNDLE_PREDICTION_HISTORY);
  private readonly inButtons = new Uint16Array(TRUNDLE_PREDICTION_HISTORY);
  private readonly prevButtonsAfter = new Uint16Array(TRUNDLE_PREDICTION_HISTORY);
  private readonly intent = new VehicleIntent();
  private readonly levels: Uint8Array;
  private readonly basis = new Float64Array(9);
  private readonly frame = new AvatarState();
  private readonly quat = new Quat();
  private readonly derived = new Float64Array(6);
  private kindCode = -1;
  private handleBackM = 0;
  private active = false;
  private started = false;
  private prevButtons = 0;
  private lastSeq = -1;
  private stepMs = 0;
  private lastDecayMs = 0;
  private readonly tickMs: number;

  constructor(
    private readonly cfg: SimConfig,
    private readonly tuning: VehicleTuning,
    private readonly ground: SimGround,
    private readonly now: () => number,
  ) {
    this.tickMs = 1000 / cfg.tickHz;
    const n = tuning.lines.length;
    this.state = new VehicleState(n);
    this.levels = new Uint8Array(n);
    for (let i = 0; i < TRUNDLE_PREDICTION_HISTORY; i++) this.hist.push(new VehicleState(n));
  }

  /** Predicting (seated, and the first Self arrived). */
  get ready(): boolean {
    return this.active && this.started;
  }

  /** Sits down in a vehicle of `kindId` (unknown or undrivable kinds are not predicted). */
  begin(kindId: string): void {
    const k = vehicleKindOf(this.tuning, kindId);
    this.active = k >= 0 && this.tuning.kinds[k]!.handling !== null;
    this.kindCode = k;
    this.handleBackM = this.active ? this.tuning.kinds[k]!.handling!.def.handleBackM : 0;
    this.started = false;
    this.histSeq.fill(-1);
    this.offset.fill(0);
  }

  /** Lets go. */
  end(): void {
    this.active = false;
    this.started = false;
  }

  /** Upgrade levels of the driven vehicle (ShiftState `VehicleInfo.upgrades`, by line id). Rare; may allocate. */
  setUpgrades(upgrades: Readonly<Record<string, number>>): void {
    const lines = this.tuning.lines;
    let changed = false;
    for (let l = 0; l < lines.length; l++) {
      const lv = upgrades[lines[l]!.id] ?? 0;
      if (this.levels[l] !== lv) changed = true;
      this.levels[l] = lv;
    }
    if (!changed || !this.started) return;
    const v = this.state;
    for (let l = 0; l < lines.length; l++) v.levels[l] = this.levels[l]!;
    refreshVehicleStats(this.tuning, v);
  }

  /** One local tick with the input just sent to the host (pump listener). Allocation-free. */
  predict(input: SimInputCommand): void {
    if (!this.ready) return;
    const k = input.seq % TRUNDLE_PREDICTION_HISTORY;
    this.inMoveX[k] = input.moveX;
    this.inMoveY[k] = input.moveY;
    this.inButtons[k] = input.buttons;
    this.stepSlot(k);
    this.prevButtonsAfter[k] = this.prevButtons;
    copyVehicleState(this.state, this.hist[k]!);
    this.histSeq[k] = input.seq & 0xffff;
    this.lastSeq = input.seq & 0xffff;
    this.stepMs = this.now();
    this.stats.predicted++;
  }

  /** Authoritative Self after input `ackSeq`. Starts prediction on the first one after `begin`. */
  reconcile(self: VehicleSelfLike, ackSeq: number): void {
    if (!this.active) return;
    const exact = self.moveState === FRAME_SELF_DRIVER_MOVE_STATE;
    const d = this.derived;
    if (exact) this.chassisFromBlock(self, d);
    else this.chassisFromHandle(self, d);
    const v = this.state;
    if (!this.started) {
      this.seed(d);
      if (exact) this.applyBlock(self);
      this.lastSeq = ackSeq & 0xffff;
      this.stepMs = this.now();
      this.started = true;
      return;
    }
    const ox = v.px;
    const oy = v.py;
    const oz = v.pz;
    const ak = ackSeq % TRUNDLE_PREDICTION_HISTORY;
    if (this.histSeq[ak] === (ackSeq & 0xffff)) {
      copyVehicleState(this.hist[ak]!, v);
      this.prevButtons = this.prevButtonsAfter[ak]!;
    } else {
      this.stats.unknownAcks++;
    }
    if (!exact) {
      // The handle rebuild knows the ground under the chassis point, not the sim's wheel-plane height: compare (and
      // snap) along the surface only, at the predicted chassis radius.
      const rp = Math.sqrt(v.px * v.px + v.py * v.py + v.pz * v.pz);
      const rd = Math.sqrt(d[0]! * d[0]! + d[1]! * d[1]! + d[2]! * d[2]!);
      const s = rp / rd;
      d[0] = d[0]! * s;
      d[1] = d[1]! * s;
      d[2] = d[2]! * s;
    }
    const ex = v.px - d[0]!;
    const ey = v.py - d[1]!;
    const ez = v.pz - d[2]!;
    const err = Math.sqrt(ex * ex + ey * ey + ez * ez);
    if (exact) {
      this.applyBlock(self);
      this.stats.exactReconciles++;
    } else {
      // Heading difference by the cross product's length (small angles).
      const cx = v.fy * d[5]! - v.fz * d[4]!;
      const cy = v.fz * d[3]! - v.fx * d[5]!;
      const cz = v.fx * d[4]! - v.fy * d[3]!;
      const ang = Math.sqrt(cx * cx + cy * cy + cz * cz);
      if (err > TRUNDLE_HANDLE_SNAP_M || ang > TRUNDLE_HANDLE_SNAP_RAD) {
        v.px = d[0]!;
        v.py = d[1]!;
        v.pz = d[2]!;
        v.fx = d[3]!;
        v.fy = d[4]!;
        v.fz = d[5]!;
        this.stats.handleSnaps++;
      }
    }
    let n = (this.lastSeq - ackSeq) & 0xffff;
    if (n > 0x8000) n = 0;
    let from = (ackSeq + 1) & 0xffff;
    if (n > TRUNDLE_PREDICTION_MAX_REPLAY) {
      from = (this.lastSeq - TRUNDLE_PREDICTION_MAX_REPLAY + 1) & 0xffff;
      n = TRUNDLE_PREDICTION_MAX_REPLAY;
    }
    for (let i = 0; i < n; i++) {
      const seq = (from + i) & 0xffff;
      const k = seq % TRUNDLE_PREDICTION_HISTORY;
      if (this.histSeq[k] !== seq) continue;
      this.stepSlot(k);
      this.prevButtonsAfter[k] = this.prevButtons;
      copyVehicleState(v, this.hist[k]!);
    }
    this.stats.replayed += n;
    this.stats.reconciles++;
    this.stats.lastCorrectionM = err;
    if (err > this.stats.maxCorrectionM) this.stats.maxCorrectionM = err;
    const o = this.offset;
    o[0] = o[0]! + ox - v.px;
    o[1] = o[1]! + oy - v.py;
    o[2] = o[2]! + oz - v.pz;
  }

  /**
   * Render pose: newest predicted tick + ground velocity x time since it (<= 1 tick) + decaying correction offset.
   * Writes chassis point, heading, speeds and boost into `out`. False while not ready.
   */
  sample(t: { readonly nowMs: number }, out: PredictedVehiclePose): boolean {
    if (!this.ready) return false;
    const nowMs = t.nowMs;
    const o = this.offset;
    const decayDt = nowMs - this.lastDecayMs;
    this.lastDecayMs = nowMs;
    if (decayDt > 0 && (o[0] !== 0 || o[1] !== 0 || o[2] !== 0)) {
      const f = Math.pow(0.5, decayDt / TRUNDLE_CORRECTION_HALF_LIFE_MS);
      o[0] = Math.abs(o[0]! * f) < 1e-5 ? 0 : o[0]! * f;
      o[1] = Math.abs(o[1]! * f) < 1e-5 ? 0 : o[1]! * f;
      o[2] = Math.abs(o[2]! * f) < 1e-5 ? 0 : o[2]! * f;
    }
    const v = this.state;
    const b = this.basis;
    vehicleBasis(v, b);
    let a = (nowMs - this.stepMs) / 1000;
    const maxA = this.tickMs / 1000;
    a = a < 0 ? 0 : a > maxA ? maxA : a;
    const wx = b[3]! * v.speed + b[6]! * v.latSpeed;
    const wy = b[4]! * v.speed + b[7]! * v.latSpeed;
    const wz = b[5]! * v.speed + b[8]! * v.latSpeed;
    out.px = v.px + wx * a + o[0]!;
    out.py = v.py + wy * a + o[1]!;
    out.pz = v.pz + wz * a + o[2]!;
    out.fx = b[3]!;
    out.fy = b[4]!;
    out.fz = b[5]!;
    out.speed = v.speed;
    out.latSpeed = v.latSpeed;
    out.boosting = v.boosting;
    return true;
  }

  /** The driver's standing point (handle) of a sampled pose into `out[0..2]`. */
  handleOf(pose: VehicleCameraPose, out: Float64Array): void {
    out[0] = pose.px - pose.fx * this.handleBackM;
    out[1] = pose.py - pose.fy * this.handleBackM;
    out[2] = pose.pz - pose.fz * this.handleBackM;
  }

  private stepSlot(k: number): void {
    const b = this.inButtons[k]!;
    fillVehicleIntent(this.intent, this.inMoveX[k]!, this.inMoveY[k]!, b, this.prevButtons);
    this.prevButtons = b;
    stepVehicle(this.state, this.intent, this.tuning, this.cfg, this.ground);
  }

  /** Places the predicted vehicle at the derived chassis (position, heading), parked state otherwise. */
  private seed(d: Float64Array): void {
    const v = this.state;
    for (let l = 0; l < this.levels.length; l++) v.levels[l] = this.levels[l]!;
    spawnVehicle(v, this.tuning, this.cfg, this.ground, this.kindCode, 0, d[0]!, d[1]!, d[2]!, d[3]!, d[4]!, d[5]!);
    v.driverSlot = 0;
    this.histSeq.fill(-1);
    this.offset.fill(0);
    this.prevButtons = 0;
  }

  /** Overwrites what the Self vehicle block carries (position, heading, velocity, steer, gear, boost, lights). */
  private applyBlock(self: VehicleSelfLike): void {
    const v = this.state;
    const d = this.derived;
    v.px = d[0]!;
    v.py = d[1]!;
    v.pz = d[2]!;
    v.fx = d[3]!;
    v.fy = d[4]!;
    v.fz = d[5]!;
    const b = this.basis;
    vehicleBasis(v, b);
    v.speed = self.lvx * b[3]! + self.lvy * b[4]! + self.lvz * b[5]!;
    v.latSpeed = self.lvx * b[6]! + self.lvy * b[7]! + self.lvz * b[8]!;
    const vr = self.lvx * b[0]! + self.lvy * b[1]! + self.lvz * b[2]!;
    if (v.moveState !== 0) v.vr = vr;
    v.steer = steerFromCode8(self.steer);
    v.gear = self.gear;
    v.boosting = self.boost;
    v.lights = self.lights;
  }

  /** Chassis point and heading from the Self vehicle block into `d` (px, py, pz, fx, fy, fz). */
  private chassisFromBlock(self: VehicleSelfLike, d: Float64Array): void {
    const q = unpackQuat(
      self.orientIndex,
      self.orientA,
      self.orientB,
      self.orientC,
      QUANT.vehicleOrientationOwn.componentBits,
      this.quat,
    );
    // Body z axis (backward; forward is -z, room-vehicles `components`) = third column of the rotation matrix.
    const zx = 2 * (q.x * q.z + q.w * q.y);
    const zy = 2 * (q.y * q.z - q.w * q.x);
    const zz = 1 - 2 * (q.x * q.x + q.y * q.y);
    d[0] = self.vpx;
    d[1] = self.vpy;
    d[2] = self.vpz;
    d[3] = -zx;
    d[4] = -zy;
    d[5] = -zz;
  }

  /** Chassis point and heading rebuilt from the handle point and body yaw (avatar-only Self) into `d`. */
  private chassisFromHandle(self: VehicleSelfLike, d: Float64Array): void {
    const f = this.frame;
    f.px = self.px;
    f.py = self.py;
    f.pz = self.pz;
    f.yawFrame = 0;
    const b = this.basis;
    headingBasis(f, b);
    const yaw = yawFromCode(self.yawCode);
    const cy = Math.cos(yaw);
    const sy = Math.sin(yaw);
    const fx = b[3]! * cy + b[6]! * sy;
    const fy = b[4]! * cy + b[7]! * sy;
    const fz = b[5]! * cy + b[8]! * sy;
    const x = self.px + fx * this.handleBackM;
    const y = self.py + fy * this.handleBackM;
    const z = self.pz + fz * this.handleBackM;
    // Onto the ground under the chassis (the handle point sits on the ground at the handle).
    const l = Math.sqrt(x * x + y * y + z * z);
    const rg = this.cfg.moonRadiusM + this.ground.heightAtXYZ(x / l, y / l, z / l);
    d[0] = (x / l) * rg;
    d[1] = (y / l) * rg;
    d[2] = (z / l) * rg;
    d[3] = fx;
    d[4] = fy;
    d[5] = fz;
  }
}
