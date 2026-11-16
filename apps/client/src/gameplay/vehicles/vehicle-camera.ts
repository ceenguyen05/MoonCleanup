// Vehicle chase camera (game-feel-and-controls.md section 4.3), three-free math in moon-centred metres.
//
// - Chase (default): after `chaseDelayS` with no look input the view swings back behind the vehicle's VELOCITY heading
//   at `chaseDegPerS`; Free Look (setting) disables the auto-align.
// - The pivot (a point above the chassis, plus a capped look-ahead along the velocity) follows with a half-life, so the
//   smoothing is frame-rate independent: `alpha = 1 - 2^(-dt / halfLife)`.
// - Speed FOV: +0.4 degrees per m/s above 5 m/s (cap +5) plus the boost kick, total offset capped at +10. Reduced
//   motion: chase rate halved, no FOV offsets, no look-ahead.
// - Enter / exit blend: 0.35 s ease-in-out cubic (`blend01`) for the caller to mix with the avatar camera.
// - In the air the horizon stays level (no roll) and the view follows the velocity heading, never the body.
//
// The rig only reads the vehicle state the sim owns (`vehicleBasis`); render mapping stays a port like the avatar rig.

import { vehicleBasis, type VehiclePoseLike } from "@moon-cleanup/sim";

/** What the rig reads of the vehicle: the sim's VehicleState satisfies it, and so does a pose rebuilt from a frame. */
export interface VehicleCameraPose extends VehiclePoseLike {
  /** Longitudinal and lateral (right) ground speed, m/s. */
  readonly speed: number;
  readonly latSpeed: number;
  readonly boosting: boolean;
}

/** Per-vehicle camera numbers (section 4.3 table). Only the Trundle is in the MVP. */
export interface VehicleCameraSpec {
  readonly boomM: number;
  readonly pivotHeightM: number;
  /** Default pitch, degrees (negative = looking down). */
  readonly pitchDeg: number;
  readonly fovDeg: number;
  readonly boostFovKickDeg: number;
  readonly lookAheadS: number;
  readonly lookAheadCapM: number;
  readonly followHalfLifeS: number;
  readonly chaseDelayS: number;
  readonly chaseDegPerS: number;
}

export const VEHICLE_CAMERA_SPECS: Readonly<Record<string, VehicleCameraSpec>> = Object.freeze({
  "vehicle.trundle": Object.freeze({
    boomM: 4.6,
    pivotHeightM: 1.5,
    pitchDeg: -20,
    fovDeg: 60,
    boostFovKickDeg: 3,
    lookAheadS: 0.15,
    lookAheadCapM: 0.8,
    followHalfLifeS: 0.05,
    chaseDelayS: 1.0,
    chaseDegPerS: 120,
  }),
});

/** Speed FOV rule and the total cap (section 4.3). */
export const SPEED_FOV_START_MPS = 5;
export const SPEED_FOV_DEG_PER_MPS = 0.4;
export const SPEED_FOV_CAP_DEG = 5;
export const TOTAL_FOV_OFFSET_CAP_DEG = 10;
/** Boost kick blend: 0.25 s ease-out in, 0.6 s out. */
const BOOST_IN_S = 0.25;
const BOOST_OUT_S = 0.6;
/** Enter / exit blend length. */
export const VEHICLE_CAMERA_BLEND_S = 0.35;
/** Wheel zoom range (section 4.3: +-30 %). */
export const ZOOM_MIN = 0.7;
export const ZOOM_MAX = 1.3;
const DEG = Math.PI / 180;

export interface VehicleCameraSettings {
  reducedMotion: boolean;
  /** Free Look: never auto-align. */
  freeLook: boolean;
}

/** Live look change this frame (objects, not doubles, cross the call). */
export interface VehicleLookDelta {
  readonly yawRad: number;
  readonly pitchRad: number;
}

const NO_LOOK: VehicleLookDelta = { yawRad: 0, pitchRad: 0 };
const basis = new Float64Array(9);

function easeInOutCubic(t: number): number {
  const x = t < 0 ? 0 : t > 1 ? 1 : t;
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
}

export class VehicleCameraRig {
  readonly settings: VehicleCameraSettings = { reducedMotion: false, freeLook: false };
  spec: VehicleCameraSpec = VEHICLE_CAMERA_SPECS["vehicle.trundle"]!;
  /** Outputs, valid after `update`. */
  readonly eye = new Float64Array(3);
  readonly forward = new Float64Array(3);
  readonly up = new Float64Array(3);
  fovDeg = 60;
  /** 0 = avatar camera, 1 = vehicle camera (eased). */
  blend01 = 0;
  /** User orbit relative to the velocity heading (radians) and extra pitch. */
  yawOffsetRad = 0;
  pitchOffsetRad = 0;
  zoom = 1;
  private active = false;
  private has = false;
  private idleS = 0;
  private blendT = 0;
  private boostBlend = 0;
  /** Smoothed pivot and smoothed travel heading (unit tangent). */
  private readonly pivot = new Float64Array(3);
  private readonly heading = new Float64Array(3);
  private readonly lookAhead = new Float64Array(3);

  /** Switches to the camera spec of `vehicleId` (falls back to the Trundle). */
  setVehicle(vehicleId: string): void {
    this.spec = VEHICLE_CAMERA_SPECS[vehicleId] ?? VEHICLE_CAMERA_SPECS["vehicle.trundle"]!;
  }

  /** Start / stop the enter / exit blend; entering snaps the follow state to the vehicle. */
  setActive(on: boolean): void {
    if (on && !this.active) {
      this.has = false;
      this.yawOffsetRad = 0;
      this.pitchOffsetRad = 0;
      this.idleS = 0;
    }
    this.active = on;
  }

  get isActive(): boolean {
    return this.active;
  }

  /** Mouse wheel: +1 zooms out, -1 in, 10 % per notch, clamped to +-30 %. */
  wheel(notches: number): void {
    const z = this.zoom * (1 + 0.1 * notches);
    this.zoom = z < ZOOM_MIN ? ZOOM_MIN : z > ZOOM_MAX ? ZOOM_MAX : z;
  }

  /** One rendered frame. `look` is the look input accumulated since the last frame (zeros when none). */
  update(v: VehicleCameraPose, look: VehicleLookDelta | null, t: { readonly dt: number }): void {
    const dt = t.dt;
    const s = this.spec;
    const reduced = this.settings.reducedMotion;
    const lk = look ?? NO_LOOK;

    // Blend (ease-in-out cubic over 0.35 s).
    this.blendT += (this.active ? dt : -dt) / VEHICLE_CAMERA_BLEND_S;
    if (this.blendT < 0) this.blendT = 0;
    else if (this.blendT > 1) this.blendT = 1;
    this.blend01 = easeInOutCubic(this.blendT);

    vehicleBasis(v, basis);
    const nx = basis[0]!;
    const ny = basis[1]!;
    const nz = basis[2]!;
    // Travel heading: velocity direction when moving, body heading otherwise (the body never decides in the air).
    let hx = basis[3]! * v.speed + basis[6]! * v.latSpeed;
    let hy = basis[4]! * v.speed + basis[7]! * v.latSpeed;
    let hz = basis[5]! * v.speed + basis[8]! * v.latSpeed;
    const hl = Math.sqrt(hx * hx + hy * hy + hz * hz);
    if (hl < 0.5) {
      hx = basis[3]!;
      hy = basis[4]!;
      hz = basis[5]!;
    } else {
      hx /= hl;
      hy /= hl;
      hz /= hl;
    }
    const alpha = 1 - Math.pow(2, -dt / s.followHalfLifeS);
    const pivot = this.pivot;
    const head = this.heading;
    const tx = v.px + nx * s.pivotHeightM;
    const ty = v.py + ny * s.pivotHeightM;
    const tz = v.pz + nz * s.pivotHeightM;
    let laX = 0;
    let laY = 0;
    let laZ = 0;
    if (!reduced) {
      let la = hl * s.lookAheadS;
      if (la > s.lookAheadCapM) la = s.lookAheadCapM;
      laX = hx * la;
      laY = hy * la;
      laZ = hz * la;
    }
    const las = this.lookAhead;
    if (!this.has) {
      pivot[0] = tx;
      pivot[1] = ty;
      pivot[2] = tz;
      head[0] = hx;
      head[1] = hy;
      head[2] = hz;
      las[0] = laX;
      las[1] = laY;
      las[2] = laZ;
      this.has = true;
    } else {
      pivot[0] = pivot[0]! + (tx - pivot[0]!) * alpha;
      pivot[1] = pivot[1]! + (ty - pivot[1]!) * alpha;
      pivot[2] = pivot[2]! + (tz - pivot[2]!) * alpha;
      // The heading eases too (so the swing behind a turn reads as a swing, not a snap).
      head[0] = head[0]! + (hx - head[0]!) * alpha;
      head[1] = head[1]! + (hy - head[1]!) * alpha;
      head[2] = head[2]! + (hz - head[2]!) * alpha;
      las[0] = las[0]! + (laX - las[0]!) * alpha;
      las[1] = las[1]! + (laY - las[1]!) * alpha;
      las[2] = las[2]! + (laZ - las[2]!) * alpha;
    }
    // Re-project the smoothed heading onto the tangent plane and normalise.
    const dn = head[0]! * nx + head[1]! * ny + head[2]! * nz;
    let sx = head[0]! - dn * nx;
    let sy = head[1]! - dn * ny;
    let sz = head[2]! - dn * nz;
    const sl = Math.sqrt(sx * sx + sy * sy + sz * sz);
    if (sl < 1e-9) {
      sx = basis[3]!;
      sy = basis[4]!;
      sz = basis[5]!;
    } else {
      sx /= sl;
      sy /= sl;
      sz /= sl;
    }
    head[0] = sx;
    head[1] = sy;
    head[2] = sz;

    // Look input and Chase auto-align.
    if (lk.yawRad !== 0 || lk.pitchRad !== 0) {
      this.yawOffsetRad += lk.yawRad;
      this.pitchOffsetRad += lk.pitchRad;
      const lim = 80 * DEG - s.pitchDeg * DEG * -1; // keep the total pitch inside +-80 degrees
      if (this.pitchOffsetRad > lim) this.pitchOffsetRad = lim;
      else if (this.pitchOffsetRad < -lim) this.pitchOffsetRad = -lim;
      this.idleS = 0;
    } else {
      this.idleS += dt;
    }
    if (!this.settings.freeLook && this.idleS >= s.chaseDelayS) {
      const rate = s.chaseDegPerS * (reduced ? 0.5 : 1) * DEG * dt;
      const y = this.yawOffsetRad;
      this.yawOffsetRad = y > rate ? y - rate : y < -rate ? y + rate : 0;
      const p = this.pitchOffsetRad;
      this.pitchOffsetRad = p > rate ? p - rate : p < -rate ? p + rate : 0;
    }

    // Orbit: rotate the heading about up by the yaw offset, then tilt by the default pitch + offset.
    const ca = Math.cos(this.yawOffsetRad);
    const sa = Math.sin(this.yawOffsetRad);
    const nfx = ny * sz - nz * sy;
    const nfy = nz * sx - nx * sz;
    const nfz = nx * sy - ny * sx;
    // n x h points to the LEFT of h; a positive yaw offset turns the view clockwise (to the right), hence the minus.
    const dx = sx * ca - nfx * sa;
    const dy = sy * ca - nfy * sa;
    const dz = sz * ca - nfz * sa;
    const pitch = s.pitchDeg * DEG + this.pitchOffsetRad;
    const cp = Math.cos(pitch);
    const sp = Math.sin(pitch);
    const fx = dx * cp + nx * sp;
    const fy = dy * cp + ny * sp;
    const fz = dz * cp + nz * sp;
    const boom = s.boomM * this.zoom;
    this.forward[0] = fx;
    this.forward[1] = fy;
    this.forward[2] = fz;
    this.up[0] = nx;
    this.up[1] = ny;
    this.up[2] = nz;
    this.eye[0] = pivot[0]! + las[0]! - fx * boom;
    this.eye[1] = pivot[1]! + las[1]! - fy * boom;
    this.eye[2] = pivot[2]! + las[2]! - fz * boom;

    // FOV: speed term + boost kick, capped; none under reduced motion.
    const boostTarget = v.boosting && !reduced ? 1 : 0;
    const bs = boostTarget > this.boostBlend ? dt / BOOST_IN_S : -dt / BOOST_OUT_S;
    this.boostBlend += bs;
    if (boostTarget > 0 ? this.boostBlend > 1 : this.boostBlend < 0) this.boostBlend = boostTarget;
    let offset = 0;
    if (!reduced) {
      const over = (v.speed < 0 ? -v.speed : v.speed) - SPEED_FOV_START_MPS;
      if (over > 0) offset += Math.min(SPEED_FOV_CAP_DEG, over * SPEED_FOV_DEG_PER_MPS);
      // Ease-out on the way in.
      const b = this.boostBlend;
      offset += s.boostFovKickDeg * (1 - (1 - b) * (1 - b));
      if (offset > TOTAL_FOV_OFFSET_CAP_DEG) offset = TOTAL_FOV_OFFSET_CAP_DEG;
    }
    this.fovDeg = s.fovDeg + offset;
  }
}
