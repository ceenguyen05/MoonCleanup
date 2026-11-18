// Driving presentation glue (M1-W7-T01): while the own avatar sits at a vehicle handle, the Solo worker's FRAME carries
// only the avatar (riding the handle, body yaw = vehicle heading; the frame encoders do not stream vehicle records yet).
// This view rebuilds the vehicle pose from that interpolated avatar pose (handle offset along the heading), estimates
// the ground speed from the pose motion, runs the chase camera, and mixes it with the on-foot camera over the 0.35 s
// enter / exit blend. Nothing here runs while the player is on foot and the blend is 0 (`engaged` is false).
// The handle offset comes from the SAME data-driven table the authoritative sim reads (game-data `VEHICLE_FEEL`,
// `handleBackM`), so the rebuilt chassis lands where the sim's vehicle is (to the 10-bit yaw quantization).
// With the Solo Trundle predictor ready, `updatePredicted` takes its pose instead (no rebuild, no frame delay).

import { VEHICLE_FEEL, type VehicleFeelDef } from "@moon-cleanup/game-data";
import { AvatarState, headingBasis } from "@moon-cleanup/sim";
import { VehicleCameraRig, type VehicleCameraPose, type VehicleLookDelta } from "./vehicle-camera";

const TWO_PI = Math.PI * 2;
/** Speed estimate low-pass (per frame at 60 Hz; scaled by dt). */
const SPEED_SMOOTH_PER_S = 18;
/** Fallback feel for an unknown kind id (the MVP vehicle). */
const DEFAULT_KIND = "vehicle.trundle";

class DrivePose implements VehicleCameraPose {
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

class Look implements VehicleLookDelta {
  yawRad = 0;
  pitchRad = 0;
}

export class VehicleDriveView {
  readonly camera = new VehicleCameraRig();
  /** The rig is active (seated) or still blending out: the module should mix `camera` into its output. */
  engaged = false;
  private active = false;
  private handleBackM: number;
  private readonly pose = new DrivePose();
  private readonly look = new Look();
  private readonly frame = new AvatarState();
  private readonly basis = new Float64Array(9);
  private readonly lastFeet = new Float64Array(3);
  private hasLast = false;
  private lastLookYaw = 0;
  private lastLookPitch = 0;
  private hasLook = false;

  /** `feel` = handling-feel table by `vehicle.<id>` (default game-data `VEHICLE_FEEL`, the table the sim reads). */
  constructor(private readonly feel: Readonly<Record<string, VehicleFeelDef>> = VEHICLE_FEEL) {
    this.handleBackM = this.feelOf(DEFAULT_KIND)?.handleBackM ?? 0;
  }

  get isActive(): boolean {
    return this.active;
  }

  /** The rebuilt vehicle pose of the last `update` (chassis point, heading, speed estimate). Read-only view. */
  get vehiclePose(): Readonly<VehicleCameraPose> {
    return this.pose;
  }

  private feelOf(kindId: string): VehicleFeelDef | undefined {
    return this.feel[kindId] ?? this.feel[DEFAULT_KIND];
  }

  /** Sits down (`kindId` of the vehicle, for its camera spec and handle offset) or lets go. */
  setActive(on: boolean, kindId: string): void {
    this.active = on;
    if (on) {
      this.camera.setVehicle(kindId);
      this.handleBackM = this.feelOf(kindId)?.handleBackM ?? this.handleBackM;
      this.hasLast = false;
      this.hasLook = false;
      this.pose.speed = this.pose.latSpeed = 0;
      this.engaged = true;
    }
    this.camera.setActive(on);
  }

  /**
   * One rendered frame. `feet` = the interpolated avatar (handle) position, `yawRad` = the frame's body yaw (heading
   * frame, + toward east), `lookYawRad` / `lookPitchRad` = the live mouse look angles, `boostHeld` the boost key.
   * Objects and arrays in, no allocation.
   */
  update(
    feet: Float64Array,
    yawRad: number,
    lookYawRad: number,
    lookPitchRad: number,
    boostHeld: boolean,
    t: { readonly dt: number },
  ): void {
    const dt = t.dt > 0 ? t.dt : 1 / 60;
    const f = this.frame;
    f.px = feet[0]!;
    f.py = feet[1]!;
    f.pz = feet[2]!;
    f.yawFrame = 0;
    const b = this.basis;
    headingBasis(f, b);
    const cy = Math.cos(yawRad);
    const sy = Math.sin(yawRad);
    // Heading = north cos + east sin (the sim's yaw convention), tangent and unit.
    const fx = b[3]! * cy + b[6]! * sy;
    const fy = b[4]! * cy + b[7]! * sy;
    const fz = b[5]! * cy + b[8]! * sy;
    const p = this.pose;
    p.fx = fx;
    p.fy = fy;
    p.fz = fz;
    p.px = feet[0]! + fx * this.handleBackM;
    p.py = feet[1]! + fy * this.handleBackM;
    p.pz = feet[2]! + fz * this.handleBackM;
    // Ground speed from the pose motion (forward and right components), low-passed.
    const last = this.lastFeet;
    if (this.hasLast) {
      const dx = (feet[0]! - last[0]!) / dt;
      const dy = (feet[1]! - last[1]!) / dt;
      const dz = (feet[2]! - last[2]!) / dt;
      const along = dx * fx + dy * fy + dz * fz;
      // right = f x up(n)
      const rx = fy * b[2]! - fz * b[1]!;
      const ry = fz * b[0]! - fx * b[2]!;
      const rz = fx * b[1]! - fy * b[0]!;
      const side = dx * rx + dy * ry + dz * rz;
      const a = 1 - Math.exp(-SPEED_SMOOTH_PER_S * dt);
      p.speed += (along - p.speed) * a;
      p.latSpeed += (side - p.latSpeed) * a;
    }
    last[0] = feet[0]!;
    last[1] = feet[1]!;
    last[2] = feet[2]!;
    this.hasLast = true;
    p.boosting = boostHeld && p.speed > 0.5;
    this.finish(lookYawRad, lookPitchRad, t);
  }

  /**
   * One rendered frame from a predicted vehicle pose (TrundlePredictor.sample): chassis point, heading, speeds and
   * boost are taken as they are. Allocation-free.
   */
  updatePredicted(
    src: Readonly<VehicleCameraPose>,
    lookYawRad: number,
    lookPitchRad: number,
    t: { readonly dt: number },
  ): void {
    const p = this.pose;
    p.px = src.px;
    p.py = src.py;
    p.pz = src.pz;
    p.fx = src.fx;
    p.fy = src.fy;
    p.fz = src.fz;
    p.speed = src.speed;
    p.latSpeed = src.latSpeed;
    p.boosting = src.boosting;
    this.hasLast = false; // a later frame-rebuild restarts its speed estimate from this pose
    this.finish(lookYawRad, lookPitchRad, t);
  }

  private finish(lookYawRad: number, lookPitchRad: number, t: { readonly dt: number }): void {
    const p = this.pose;
    // Look delta since the last frame (yaw wraps).
    const lk = this.look;
    if (this.hasLook) {
      let dyaw = lookYawRad - this.lastLookYaw;
      dyaw -= Math.round(dyaw / TWO_PI) * TWO_PI;
      lk.yawRad = dyaw;
      lk.pitchRad = lookPitchRad - this.lastLookPitch;
    } else {
      lk.yawRad = lk.pitchRad = 0;
      this.hasLook = true;
    }
    this.lastLookYaw = lookYawRad;
    this.lastLookPitch = lookPitchRad;
    this.camera.update(p, lk, t);
    if (!this.active && this.camera.blend01 === 0) this.engaged = false;
  }
}
