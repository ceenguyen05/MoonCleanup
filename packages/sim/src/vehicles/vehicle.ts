// Raycast-suspension vehicle kinematics (game-feel-and-controls.md section 5, ADR-0010): the Trundle in the MVP.
//
// Kinematic, no physics engine: the chassis rides the analytic ground g(u) = R + H(u) of packages/world. Each tick:
//   1. boost meter, gear / Throttle Lock, speed target (cruise x Gear Ratio x Wide Mouth-while-intake-down x boost);
//   2. longitudinal speed moves toward the target (accel / brake / coast), lateral speed decays by the grip rate,
//      Steep traction fades from 20 to 25 degrees and above 25 degrees the vehicle slides at g (sin - mu cos);
//   3. yaw rate is set kinematically (turn cap, in-place cap), the world velocity is re-expressed in the new heading;
//   4. VEHICLE_SUBSTEPS (4) sub-steps move the chassis: grounded it snaps to the ground inside `groundSnapM`, otherwise it
//      leaves the ground carrying the ramp's vertical rate and flies ballistically at g until the ground comes back;
//   5. the three probes (drum, left wheel, right wheel) are cast once at the final pose: they give the slope used by
//      the next tick (Steep, tilt) and the visual body spring targets. The spring is a damped oscillator (f, zeta).
//
// Everything is end-of-tick quantised like the avatar. `stepVehicle` allocates nothing: helpers take objects and
// typed-array scratch only (a float64 argument to a non-inlined call is boxed into a HeapNumber), and the ground is
// called from exactly two sites (probe loop, sub-step loop).

import type { SimConfig } from "../config/sim-config";
import { Fnv1a32, quantize } from "../math/quantize";
import type { SimGround } from "../movement/avatar";
import { VEHICLE_SUBSTEPS } from "./handling";
import { resolveVehicleStats, VehicleStats, type VehicleKindTuning, type VehicleTuning } from "./tuning";

/** Position and heading of a vehicle (a VehicleState, or a client pose rebuilt from a frame): chassis ground point and tangent heading. */
export interface VehiclePoseLike {
  readonly px: number;
  readonly py: number;
  readonly pz: number;
  readonly fx: number;
  readonly fy: number;
  readonly fz: number;
}

/** Vehicle move state. */
export const VEHICLE_GROUNDED = 0;
export const VEHICLE_AIRBORNE = 1;

/** Gear codes (shared VEHICLE_GEARS order: neutral, drive, reverse, locked). */
export const GEAR_NEUTRAL = 0;
export const GEAR_DRIVE = 1;
export const GEAR_REVERSE = 2;
export const GEAR_LOCKED = 3;

/** Number of suspension probes of the Trundle (drum, left wheel, right wheel). */
export const VEHICLE_PROBES = 3;

/** Per-tick driver intent derived from the input command. */
export class VehicleIntent {
  /** Forward / reverse axis, -1 .. 1. */
  throttle = 0;
  /** Steering axis, -1 .. 1 (positive = right / clockwise from above). */
  steer = 0;
  boost = false;
  handbrake = false;
  /** Edge flags (true for the tick the button went down). */
  lockPressed = false;
  lightsPressed = false;
  /** Wide Mouth cycle (holsterNext while driving): steps the selected intake width down, wrapping to the owned level. */
  cycleIntakePressed = false;

  constructor() {
    // Double field representation from the start (same reason as MoveIntent).
    this.throttle = 0.5;
    this.throttle = 0;
    this.steer = 0.5;
    this.steer = 0;
  }
}

/** One vehicle (the typed store entry). Monomorphic, mutated in place. */
export class VehicleState {
  active = false;
  /** Index in the vehicle kind table. */
  kindCode = 0;
  ownerSlot = 0;
  /** Driver actor slot, -1 when parked. */
  driverSlot = -1;
  // Chassis ground point, moon-centred metres (quantised each tick).
  px = 0;
  py = 0;
  pz = 0;
  /** Heading, unit tangent vector. */
  fx = 1;
  fy = 0;
  fz = 0;
  /** Longitudinal and lateral (right) ground speed, m/s. */
  speed = 0;
  latSpeed = 0;
  /** Radial speed while airborne, m/s. */
  vr = 0;
  /** Smoothed steering, -1 .. 1. */
  steer = 0;
  gear = GEAR_NEUTRAL;
  lockTarget = 0;
  moveState = VEHICLE_GROUNDED;
  /** Chassis height above the ground, metres (0 grounded). */
  heightAboveGround = 0;
  /** Radius of the ground under the chassis at the last sub-step (for the ramp launch rate). */
  groundR = 0;
  boosting = false;
  boostMeterMs = 0;
  boostDelayMs = 0;
  lights = false;
  /** Cleaning intake is down (derived at the end of each tick). */
  intakeDown = false;
  /** Dust in the hopper, grams, and the milligram remainder carried between strokes. */
  hopperGrams = 0;
  hopperMg = 0;
  /** Slope of the ground at the probes: rise per metre along the heading and to the right. */
  slopeF = 0;
  slopeR = 0;
  /** Visual body spring: compression and its rate per probe (drum, left, right), metres. */
  readonly comp = new Float64Array(VEHICLE_PROBES);
  readonly compV = new Float64Array(VEHICLE_PROBES);
  // Presentation hooks, valid for one tick (the host emits events from them).
  boostStarted = false;
  tookOff = false;
  landed = false;
  lastImpactMps = 0;
  airTicks = 0;
  lastAirTicks = 0;
  plotHint = 0;
  // Intake bookkeeping (see intake.ts).
  anchorValid = false;
  anchorX = 0;
  anchorY = 0;
  anchorZ = 0;
  /** Upgrade level per `VehicleTuning.lines` index. */
  readonly levels: Uint8Array;
  /** Levels in effect: `levels` with the intake-bound lines (Wide Mouth) capped at `intakeCap`. */
  readonly effLevels: Uint8Array;
  /** Selected intake width level (Wide Mouth cycle); 255 = the owned level. */
  intakeCap = 255;
  readonly stats = new VehicleStats();

  constructor(lineCount: number) {
    this.levels = new Uint8Array(lineCount);
    this.effLevels = new Uint8Array(lineCount);
  }
}

// Scratch (module level, single-threaded per instance).
/** n (0..2), f (3..5), r (6..8). */
const basis = new Float64Array(9);
const probeH = new Float64Array(VEHICLE_PROBES);

/** Re-derives `v.stats` from `v.levels` (call after an upgrade or when the vehicle is created). */
export function refreshVehicleStats(tuning: VehicleTuning, v: VehicleState): void {
  const eff = v.effLevels;
  for (let l = 0; l < eff.length; l++) {
    const owned = v.levels[l]!;
    eff[l] = tuning.lines[l]!.intakeBound && owned > v.intakeCap ? v.intakeCap : owned;
  }
  resolveVehicleStats(tuning, tuning.kinds[v.kindCode]!, eff, v.stats);
}

/** Wide Mouth cycle: the next narrower intake (0 = off), wrapping back to the owned level. No-op without Wide Mouth. */
function cycleIntake(tuning: VehicleTuning, v: VehicleState): void {
  let line = -1;
  for (let l = 0; l < tuning.lines.length; l++) {
    if (tuning.lines[l]!.intakeBound && v.levels[l]! > 0) line = l;
  }
  if (line < 0) return;
  const owned = v.levels[line]!;
  const cur = v.intakeCap < owned ? v.intakeCap : owned;
  v.intakeCap = cur === 0 ? 255 : cur - 1;
  refreshVehicleStats(tuning, v);
}

/** Writes up n, tangent heading f and right r of `v` into `out[0..8]`. */
export function vehicleBasis(v: VehiclePoseLike, out: Float64Array): void {
  const len = Math.sqrt(v.px * v.px + v.py * v.py + v.pz * v.pz);
  const nx = v.px / len;
  const ny = v.py / len;
  const nz = v.pz / len;
  let fx = v.fx;
  let fy = v.fy;
  let fz = v.fz;
  const d = fx * nx + fy * ny + fz * nz;
  fx -= d * nx;
  fy -= d * ny;
  fz -= d * nz;
  const fl = Math.sqrt(fx * fx + fy * fy + fz * fz);
  fx /= fl;
  fy /= fl;
  fz /= fl;
  out[0] = nx;
  out[1] = ny;
  out[2] = nz;
  out[3] = fx;
  out[4] = fy;
  out[5] = fz;
  // right = f x n
  out[6] = fy * nz - fz * ny;
  out[7] = fz * nx - fx * nz;
  out[8] = fx * ny - fy * nx;
}

/**
 * Casts the three probes at the current pose and stores the slope (`slopeF`, `slopeR`) and, in `probeH`, the heights.
 * The ground call sits at one site.
 */
function castProbes(v: VehicleState, kind: VehicleKindTuning, R: number, ground: SimGround): void {
  const D = kind.handling!.def;
  vehicleBasis(v, basis);
  const nx = basis[0]!;
  const ny = basis[1]!;
  const nz = basis[2]!;
  for (let p = 0; p < VEHICLE_PROBES; p++) {
    const a = D.probeForwardM[p]!;
    const b = D.probeRightM[p]!;
    const x = nx + (basis[3]! * a + basis[6]! * b) / R;
    const y = ny + (basis[4]! * a + basis[7]! * b) / R;
    const z = nz + (basis[5]! * a + basis[8]! * b) / R;
    const l = Math.sqrt(x * x + y * y + z * z);
    probeH[p] = ground.heightAtXYZ(x / l, y / l, z / l);
  }
  const wheelBase = D.probeForwardM[0]! - D.probeForwardM[1]!;
  const track = D.probeRightM[2]! - D.probeRightM[1]!;
  v.slopeF = (probeH[0]! - (probeH[1]! + probeH[2]!) * 0.5) / wheelBase;
  v.slopeR = (probeH[2]! - probeH[1]!) / track;
}

/** Places a vehicle of `kindCode` standing on the ground at unit direction (dx, dy, dz) heading along (hx, hy, hz). */
export function spawnVehicle(
  v: VehicleState,
  tuning: VehicleTuning,
  cfg: SimConfig,
  ground: SimGround,
  kindCode: number,
  ownerSlot: number,
  dx: number,
  dy: number,
  dz: number,
  hx: number,
  hy: number,
  hz: number,
): void {
  const kind = tuning.kinds[kindCode]!;
  if (!kind.handling) throw new RangeError(`vehicle ${kind.id}: no handling defined`);
  const l = Math.sqrt(dx * dx + dy * dy + dz * dz);
  const ux = dx / l;
  const uy = dy / l;
  const uz = dz / l;
  const rg = cfg.moonRadiusM + ground.heightAtXYZ(ux, uy, uz);
  v.active = true;
  v.kindCode = kindCode;
  v.ownerSlot = ownerSlot;
  v.driverSlot = -1;
  v.px = quantize(ux * rg);
  v.py = quantize(uy * rg);
  v.pz = quantize(uz * rg);
  v.groundR = rg;
  // Heading: project the requested direction onto the tangent plane (a degenerate request falls back to world +Y / +X).
  const hd = hx * ux + hy * uy + hz * uz;
  let fx = hx - hd * ux;
  let fy = hy - hd * uy;
  let fz = hz - hd * uz;
  let fl = Math.sqrt(fx * fx + fy * fy + fz * fz);
  if (fl < 1e-9) {
    // Axis a = +Y (or +X near the poles) projected onto the tangent plane.
    const polar = uy > 0.9 || uy < -0.9;
    const ad = polar ? ux : uy;
    fx = (polar ? 1 : 0) - ad * ux;
    fy = (polar ? 0 : 1) - ad * uy;
    fz = -ad * uz;
    fl = Math.sqrt(fx * fx + fy * fy + fz * fz);
  }
  v.fx = quantize(fx / fl);
  v.fy = quantize(fy / fl);
  v.fz = quantize(fz / fl);
  v.speed = v.latSpeed = v.vr = v.steer = 0;
  v.gear = GEAR_NEUTRAL;
  v.lockTarget = 0;
  v.moveState = VEHICLE_GROUNDED;
  v.heightAboveGround = 0;
  v.boosting = false;
  v.boostMeterMs = kind.handling.boostMeterMs;
  v.boostDelayMs = 0;
  v.lights = false;
  v.intakeDown = false;
  v.hopperGrams = 0;
  v.hopperMg = 0;
  v.boostStarted = v.tookOff = v.landed = false;
  v.lastImpactMps = 0;
  v.airTicks = v.lastAirTicks = 0;
  v.anchorValid = false;
  v.intakeCap = 255;
  v.comp.fill(0);
  v.compV.fill(0);
  refreshVehicleStats(tuning, v);
  castProbes(v, kind, cfg.moonRadiusM, ground);
  const trav = kind.handling.def.travelM;
  for (let p = 0; p < VEHICLE_PROBES; p++) v.comp[p] = quantize(trav * 0.5);
  v.slopeF = quantize(v.slopeF);
  v.slopeR = quantize(v.slopeR);
}

/** Advances one vehicle by one fixed tick. Allocation-free. */
export function stepVehicle(
  v: VehicleState,
  intent: VehicleIntent,
  tuning: VehicleTuning,
  cfg: SimConfig,
  ground: SimGround,
): void {
  const kind = tuning.kinds[v.kindCode]!;
  const hnd = kind.handling!;
  const D = hnd.def;
  const st = v.stats;
  const dt = cfg.dt;
  const R = cfg.moonRadiusM;
  const g = cfg.gravityMps2;
  const stepMs = cfg.stepMs;
  v.boostStarted = false;
  v.tookOff = false;
  v.landed = false;

  vehicleBasis(v, basis);
  const nx = basis[0]!;
  const ny = basis[1]!;
  const nz = basis[2]!;
  let fx = basis[3]!;
  let fy = basis[4]!;
  let fz = basis[5]!;
  let rx = basis[6]!;
  let ry = basis[7]!;
  let rz = basis[8]!;
  const grounded = v.moveState === VEHICLE_GROUNDED;
  const driven = v.driverSlot >= 0;
  const throttle = driven ? intent.throttle : 0;
  const steerIn = driven ? intent.steer : 0;

  if (driven && intent.lightsPressed) v.lights = !v.lights;
  if (driven && intent.cycleIntakePressed) cycleIntake(tuning, v);

  // ---- Gear, Throttle Lock ----
  if (driven && intent.lockPressed && st.cruiseControl) {
    if (v.gear === GEAR_LOCKED) v.gear = GEAR_DRIVE;
    else if (v.speed > 0.1) {
      v.gear = GEAR_LOCKED;
      v.lockTarget = v.speed;
    }
  }
  if (v.gear === GEAR_LOCKED && (throttle !== 0 || intent.handbrake)) v.gear = GEAR_DRIVE;
  if (v.gear !== GEAR_LOCKED) {
    if (throttle < 0 && v.speed <= 0.05) v.gear = GEAR_REVERSE;
    else if (throttle > 0 || v.speed > 0.05) v.gear = GEAR_DRIVE;
    else v.gear = GEAR_NEUTRAL;
  }

  // ---- Boost meter (integer milliseconds) ----
  const wantBoost = driven && intent.boost && (throttle > 0 || v.gear === GEAR_LOCKED) && v.boostMeterMs >= stepMs;
  if (wantBoost) {
    if (!v.boosting) v.boostStarted = true;
    v.boosting = true;
    v.boostMeterMs -= hnd.boostDrainMsPerTick;
    if (v.boostMeterMs < 0) v.boostMeterMs = 0;
    v.boostDelayMs = hnd.boostRegenDelayMs;
  } else {
    v.boosting = false;
    if (v.boostDelayMs > 0) {
      v.boostDelayMs -= stepMs;
      if (v.boostDelayMs < 0) v.boostDelayMs = 0;
    } else if (v.boostMeterMs < hnd.boostMeterMs) {
      v.boostMeterMs += hnd.boostRegenMsPerTick;
      if (v.boostMeterMs > hnd.boostMeterMs) v.boostMeterMs = hnd.boostMeterMs;
    }
  }

  if (grounded) {
    // ---- Steep traction from the slope cast last tick ----
    const sF = v.slopeF;
    const sR = v.slopeR;
    const tanT = Math.sqrt(sF * sF + sR * sR);
    let traction = 1;
    if (tanT >= hnd.tanSlideStart) traction = 0;
    else if (tanT > hnd.tanTractionFade)
      traction = (hnd.tanSlideStart - tanT) / (hnd.tanSlideStart - hnd.tanTractionFade);

    // ---- Longitudinal speed ----
    let cruise = st.cruiseMps * st.speedMult;
    if (v.intakeDown) cruise *= st.intakeSpeedMult;
    const accel = cruise * hnd.accelMps2PerCruise;
    let target: number;
    if (intent.handbrake && driven) target = 0;
    else if (v.gear === GEAR_LOCKED) target = v.lockTarget;
    else if (throttle > 0) target = throttle * cruise * (v.boosting ? st.boostMult : 1);
    else if (throttle < 0) target = throttle * D.reverseMps;
    else target = 0;
    target *= traction;
    let rate: number;
    if (intent.handbrake && driven) rate = D.brakeMps2;
    else if (throttle === 0 && v.gear !== GEAR_LOCKED) rate = D.coastMps2;
    else if (target * v.speed < 0 || (target === 0 && v.speed !== 0)) rate = D.brakeMps2;
    else if ((target < 0 ? -target : target) < (v.speed < 0 ? -v.speed : v.speed)) rate = D.coastMps2;
    else rate = accel;
    const maxDv = rate * dt;
    const dv = target - v.speed;
    // No traction (above the slide angle): the drive and brakes do nothing, gravity alone moves the vehicle.
    if (traction > 0) {
      if (dv > maxDv) v.speed += maxDv;
      else if (dv < -maxDv) v.speed -= maxDv;
      else v.speed = target;
    }

    // ---- Steep slide (above the slide angle) ----
    if (tanT > hnd.tanSlideStart) {
      const inv = 1 / Math.sqrt(1 + tanT * tanT);
      const acc = g * (tanT * inv - D.slideFriction * inv);
      const s = (acc * dt) / tanT;
      v.speed -= sF * s;
      v.latSpeed -= sR * s;
      // A slide stays inside the boosted top speed (bounded speed invariant).
      const vCap = cruise * st.boostMult;
      if (v.speed > vCap) v.speed = vCap;
      else if (v.speed < -vCap) v.speed = -vCap;
      if (v.latSpeed > vCap) v.latSpeed = vCap;
      else if (v.latSpeed < -vCap) v.latSpeed = -vCap;
    }

    // ---- Steering, yaw, lateral grip ----
    const steerStep = D.steerRatePerS * dt;
    const steerErr = steerIn - v.steer;
    if (steerErr > steerStep) v.steer += steerStep;
    else if (steerErr < -steerStep) v.steer -= steerStep;
    else v.steer = steerIn;
    const absSpeed = v.speed < 0 ? -v.speed : v.speed;
    const yawRate = absSpeed < D.inPlaceSpeedMps ? hnd.turnInPlaceRadPerS : hnd.turnRadPerS;
    const dpsi = v.steer * yawRate * dt;
    // cos / sin by series (|dpsi| <= ~0.11 rad: error < 1e-9); only + - * so every engine agrees.
    const x2 = dpsi * dpsi;
    const c = 1 - x2 * 0.5 + x2 * x2 * (1 / 24);
    const s = dpsi * (1 - x2 * (1 / 6) + x2 * x2 * (1 / 120));
    // Heading f' = f c - (n x f) s; right r' = r c - f s (r' = f' x n); n x f = -(r) x ... see header derivation.
    const nfx = ny * fz - nz * fy;
    const nfy = nz * fx - nx * fz;
    const nfz = nx * fy - ny * fx;
    const nfx2 = fx * c - nfx * s;
    const nfy2 = fy * c - nfy * s;
    const nfz2 = fz * c - nfz * s;
    const sp = v.speed;
    const lat = v.latSpeed;
    v.speed = sp * c + lat * s;
    v.latSpeed = lat * c - sp * s;
    fx = nfx2;
    fy = nfy2;
    fz = nfz2;
    const fl = Math.sqrt(fx * fx + fy * fy + fz * fz);
    fx /= fl;
    fy /= fl;
    fz /= fl;
    rx = fy * nz - fz * ny;
    ry = fz * nx - fx * nz;
    rz = fx * ny - fy * nx;
    let grip = D.gripPerS;
    if (intent.handbrake && driven) grip *= D.handbrakeGripMult;
    let keep = 1 - grip * traction * dt;
    if (keep < 0) keep = 0;
    v.latSpeed *= keep;
    v.airTicks = 0;
  } else {
    v.airTicks++;
  }

  // ---- Sub-steps ----
  const vx0 = fx * v.speed + rx * v.latSpeed;
  const vy0 = fy * v.speed + ry * v.latSpeed;
  const vz0 = fz * v.speed + rz * v.latSpeed;
  const n = VEHICLE_SUBSTEPS;
  const h = dt / n;
  const snap = D.groundSnapM;
  let px = v.px;
  let py = v.py;
  let pz = v.pz;
  let vr = v.vr;
  let prevRg = v.groundR;
  let probesDone = false;
  if (v.moveState === VEHICLE_GROUNDED) {
    // Grounded fast path: the chassis moves straight for the whole tick and the ground is read once, at the three probes
    // (drum, left wheel, right wheel). The chassis height is the plane through them at the chassis point, which is also
    // how a three-wheeled body sits. 3 ground calls per tick instead of 7; takeoff is detected at the end of the tick.
    px += vx0 * dt;
    py += vy0 * dt;
    pz += vz0 * dt;
    v.px = px;
    v.py = py;
    v.pz = pz;
    v.fx = fx;
    v.fy = fy;
    v.fz = fz;
    castProbes(v, kind, R, ground);
    probesDone = true;
    const l = Math.sqrt(px * px + py * py + pz * pz);
    const wx = px / l;
    const wy = py / l;
    const wz = pz / l;
    const wd = hnd.centerWeightDrum;
    const wheels = 0.5 * (probeH[1]! + probeH[2]!);
    const plane = wd * probeH[0]! + (1 - wd) * wheels;
    // The body rides its wheels: when the drum hangs over an edge the wheels still carry it (no early takeoff).
    const rg = R + (plane > wheels ? plane : wheels);
    const above = l - rg;
    const groundRate = (rg - prevRg) / dt;
    prevRg = rg;
    if (above <= snap) {
      px = wx * rg;
      py = wy * rg;
      pz = wz * rg;
      v.heightAboveGround = 0;
    } else {
      // Left the ground (ramp, crest): carries the ground's vertical rate.
      v.moveState = VEHICLE_AIRBORNE;
      v.tookOff = true;
      vr = groundRate > 0 ? groundRate : 0;
      v.heightAboveGround = above;
    }
  }
  for (let i = 0; i < n && !probesDone; i++) {
    let l = Math.sqrt(px * px + py * py + pz * pz);
    const ux = px / l;
    const uy = py / l;
    const uz = pz / l;
    if (v.moveState !== VEHICLE_GROUNDED) vr -= g * h;
    px += (vx0 + ux * vr) * h;
    py += (vy0 + uy * vr) * h;
    pz += (vz0 + uz * vr) * h;
    l = Math.sqrt(px * px + py * py + pz * pz);
    const wx = px / l;
    const wy = py / l;
    const wz = pz / l;
    const rg = R + ground.heightAtXYZ(wx, wy, wz);
    const above = l - rg;
    const groundRate = (rg - prevRg) / h;
    prevRg = rg;
    if (v.moveState === VEHICLE_GROUNDED) {
      if (above <= snap) {
        px = wx * rg;
        py = wy * rg;
        pz = wz * rg;
        v.heightAboveGround = 0;
      } else {
        // Left the ground (ramp, crest): carries the ground's vertical rate.
        v.moveState = VEHICLE_AIRBORNE;
        v.tookOff = true;
        vr = groundRate > 0 ? groundRate : 0;
        v.heightAboveGround = above;
      }
    } else if (above <= 0 && vr - groundRate <= 0) {
      px = wx * rg;
      py = wy * rg;
      pz = wz * rg;
      v.lastImpactMps = groundRate - vr;
      v.lastAirTicks = v.airTicks;
      v.moveState = VEHICLE_GROUNDED;
      v.landed = true;
      v.heightAboveGround = 0;
      vr = 0;
      // Landing kicks the visual springs (all probes, scaled by the impact).
      const kick = v.lastImpactMps < 3 ? v.lastImpactMps : 3;
      v.compV[0] = v.compV[0]! + kick * 0.5;
      v.compV[1] = v.compV[1]! + kick * 0.5;
      v.compV[2] = v.compV[2]! + kick * 0.5;
    } else {
      v.heightAboveGround = above;
    }
  }
  v.groundR = prevRg;
  v.vr = vr;
  v.px = quantize(px);
  v.py = quantize(py);
  v.pz = quantize(pz);
  v.fx = quantize(fx);
  v.fy = quantize(fy);
  v.fz = quantize(fz);
  v.speed = quantize(v.speed);
  v.latSpeed = quantize(v.latSpeed);
  v.vr = quantize(vr);
  v.steer = quantize(v.steer);
  v.heightAboveGround = quantize(v.heightAboveGround);
  v.groundR = quantize(v.groundR);

  // ---- Probes at the final pose, visual spring, intake state ----
  if (!probesDone) castProbes(v, kind, R, ground);
  v.slopeF = quantize(v.slopeF);
  v.slopeR = quantize(v.slopeR);
  const mean = (probeH[0]! + probeH[1]! + probeH[2]!) / 3;
  const travel = D.travelM;
  const w = hnd.omega;
  const w2 = w * w;
  const damp = 2 * D.springZeta * w;
  for (let p = 0; p < VEHICLE_PROBES; p++) {
    let target = travel * 0.5 + (probeH[p]! - mean);
    if (v.moveState !== VEHICLE_GROUNDED) target = 0;
    else if (target < 0) target = 0;
    else if (target > travel) target = travel;
    let c = v.comp[p]!;
    let cv = v.compV[p]!;
    for (let i = 0; i < n; i++) {
      cv += (-w2 * (c - target) - damp * cv) * h;
      c += cv * h;
    }
    if (c < 0) {
      c = 0;
      cv = 0;
    } else if (c > travel) {
      c = travel;
      cv = 0;
    }
    v.comp[p] = quantize(c);
    v.compV[p] = quantize(cv);
  }
  v.intakeDown =
    v.moveState === VEHICLE_GROUNDED &&
    v.speed > 0.05 &&
    !v.boosting &&
    st.widthM > 0 &&
    v.hopperGrams < st.payloadGrams;
}

/** Hashes the authoritative state of a vehicle into `h` (golden replays, desync checks). */
export function hashVehicle(v: VehicleState, h: Fnv1a32): void {
  h.int(v.active ? 1 : 0);
  h.int(v.kindCode);
  h.int(v.driverSlot);
  h.real(v.px);
  h.real(v.py);
  h.real(v.pz);
  h.real(v.fx);
  h.real(v.fy);
  h.real(v.fz);
  h.real(v.speed);
  h.real(v.latSpeed);
  h.real(v.vr);
  h.real(v.steer);
  h.int(v.gear);
  h.int(v.moveState);
  h.int(v.boostMeterMs);
  h.int(v.boostDelayMs);
  h.int(v.hopperGrams);
  h.int(v.hopperMg);
  h.int((v.boosting ? 1 : 0) | (v.lights ? 2 : 0) | (v.intakeDown ? 4 : 0));
  if (v.intakeCap !== 255) h.int(0x70000 | v.intakeCap); // only once the Wide Mouth cycle was used
  for (let p = 0; p < VEHICLE_PROBES; p++) {
    h.real(v.comp[p]!);
    h.real(v.compV[p]!);
  }
}
