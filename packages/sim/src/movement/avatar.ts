// Low-gravity avatar kinematics on the analytic ground (game-feel-and-controls.md section 2, ADR-0010).
//
// One monomorphic AvatarState per actor slot (the typed store); `stepAvatar` mutates it in place and allocates nothing.
// The capsule bottom rides the ground g(u) = R + H(u) from packages/world. Integration: semi-implicit Euler with
// clamp(ceil(|v| dt / 0.15 m), 2, 8) sub-steps; after each sub-step the velocity is re-split against the new up.
//
// Heading frame (section 2.1, pole safe): frame A projects +Y (north) onto the tangent plane, frame B projects +X. The
// sim keeps the frame bit in state with hysteresis (to B when |n.y| > 0.8, back to A when |n.y| < 0.6), so the
// predicting client and the server derive the same frame from the same state. Yaw 0 = the frame's north, increasing
// clockwise seen from above (toward east = north x up).

import type { SimConfig } from "../config/sim-config";
import { cosTurn, sinTurn } from "../math/trig";
import { quantize } from "../math/quantize";

/** Ground height source: H above the reference sphere at a unit direction (packages/world GroundHeight). */
export interface SimGround {
  heightAtXYZ(x: number, y: number, z: number): number;
}

/** Move state codes (index into shared MOVE_STATES). */
export const MOVE_GROUNDED = 0;
export const MOVE_AIRBORNE = 1;
export const MOVE_HOPPING = 2;

/** Landing class of the last touchdown (presentation hooks). */
export const LAND_NONE = 0;
export const LAND_SOFT = 1;
export const LAND_MEDIUM = 2;
export const LAND_HEAVY = 3;
export const LAND_FACEPLANT = 4;

/** Per-tick intent the room derives from the input for the movement step. */
export class MoveIntent {
  /** Normalised stick, length <= 1. x = strafe, y = forward. */
  moveX = 0;
  moveY = 0;
  /** Camera yaw in turn units (0 .. 65535). */
  yaw = 0;
  jumpPressed = false;
  jumpHeld = false;
  jumpReleased = false;
  hopPressed = false;
  lope = false;
  descend = false;
  sweeping = false;
  /** Extra multiplier on the ground target speed (Detailing x0.3, Lane Lock bonus). */
  speedMult = 1;
  /** Body faces the camera yaw (sweeping) instead of the movement direction. */
  faceAim = false;

  constructor() {
    // Give `speedMult` the double field representation from the start: a Smi field that later receives a fraction
    // (Steep x0.6) generalises the map mid-run, and the re-optimised stepAvatar then boxed ~470 B/tick (alloc test).
    this.speedMult = 0.5;
    this.speedMult = 1;
    // Same for the stick axes (fractions of INPUT_AXIS_MAX), stored every actor-tick by the room.
    this.moveX = 0.5;
    this.moveX = 0;
    this.moveY = 0.5;
    this.moveY = 0;
  }
}

export class AvatarState {
  active = false;
  // Kinematics, moon-centred metres and m/s (quantised at the end of each tick).
  px = 0;
  py = 0;
  pz = 0;
  vx = 0;
  vy = 0;
  vz = 0;
  /** Body facing, unit tangent vector. */
  fx = 1;
  fy = 0;
  fz = 0;
  /** Heading frame bit: 0 = A (north), 1 = B (+X). */
  yawFrame = 0;
  moveState = MOVE_GROUNDED;
  /** Height of the capsule bottom above the ground, metres (0 when grounded). */
  heightAboveGround = 0;
  // Integer tick timers (all part of the reconciled state).
  coyoteTicks = 0;
  jumpBufferTicks = 0;
  snapOffTicks = 0;
  jumpCutUsed = false;
  jumped = false;
  hopCharges = 0;
  hopMaxCharges = 0;
  hopRechargeTicks = 0;
  hopIntervalTicks = 0;
  recoverTicks = 0;
  recoverAccelMult = 1;
  moveLockTicks = 0;
  jumpLockTicks = 0;
  /** Horizontal speed cap for air control (max(takeoff, walk)). */
  airSpeedCap = 0;
  touchdown = false;
  lastLanding = LAND_NONE;
  lastImpactMps = 0;
  /** Plot hint for point -> plot. */
  plotHint = 0;
}

// Scratch (module-level, reused; the sim is single-threaded per instance).
//
// Allocation rule for this hot path (M1-W3-T09): never pass or return a float64 through a helper call that V8 may
// decline to inline. A non-inlined call boxes every double argument (and the double result) into a fresh HeapNumber,
// which was ~200 B per actor-tick here. Helpers therefore take objects / typed-array scratch only, and the ground is
// called from exactly two sites (slope probe loop, sub-step loop) so the tiny `heightAtXYZ` stays inlined.
const basis = new Float64Array(9); // n, forward, right
/** turnToward operands: up n (0..2), tangent target t (3..5), max step cos (6) and sin (7). */
const turnArgs = new Float64Array(8);
/** Slope probe heights: east +k, east -k, north +k, north -k. */
const probeH = new Float64Array(4);

/** Writes up n, heading-frame north N and east E at the avatar position into `out[0..8]`, updating the frame bit. */
export function headingBasis(a: AvatarState, out: Float64Array): void {
  const len = Math.sqrt(a.px * a.px + a.py * a.py + a.pz * a.pz);
  const nx = a.px / len;
  const ny = a.py / len;
  const nz = a.pz / len;
  const any = ny < 0 ? -ny : ny;
  if (a.yawFrame === 0 && any > 0.8) a.yawFrame = 1;
  else if (a.yawFrame === 1 && any < 0.6) a.yawFrame = 0;
  // Reference axis: +Y (frame A) or +X (frame B), projected onto the tangent plane.
  let rx: number;
  let ry: number;
  let rz: number;
  if (a.yawFrame === 0) {
    rx = -ny * nx;
    ry = 1 - ny * ny;
    rz = -ny * nz;
  } else {
    rx = 1 - nx * nx;
    ry = -nx * ny;
    rz = -nx * nz;
  }
  const rl = Math.sqrt(rx * rx + ry * ry + rz * rz);
  rx /= rl;
  ry /= rl;
  rz /= rl;
  out[0] = nx;
  out[1] = ny;
  out[2] = nz;
  out[3] = rx;
  out[4] = ry;
  out[5] = rz;
  // East = N x n.
  out[6] = ry * nz - rz * ny;
  out[7] = rz * nx - rx * nz;
  out[8] = rx * ny - ry * nx;
}

/** Places an avatar standing on the ground at unit direction (dx, dy, dz). */
export function spawnAvatar(
  a: AvatarState,
  cfg: SimConfig,
  ground: SimGround,
  dx: number,
  dy: number,
  dz: number,
): void {
  const l = Math.sqrt(dx * dx + dy * dy + dz * dz);
  const ux = dx / l;
  const uy = dy / l;
  const uz = dz / l;
  const r = cfg.moonRadiusM + ground.heightAtXYZ(ux, uy, uz);
  a.active = true;
  a.px = quantize(ux * r);
  a.py = quantize(uy * r);
  a.pz = quantize(uz * r);
  a.vx = a.vy = a.vz = 0;
  a.moveState = MOVE_GROUNDED;
  a.heightAboveGround = 0;
  a.coyoteTicks = a.jumpBufferTicks = a.snapOffTicks = 0;
  a.jumpCutUsed = a.jumped = false;
  a.hopCharges = a.hopMaxCharges;
  a.hopRechargeTicks = a.hopIntervalTicks = 0;
  a.recoverTicks = a.moveLockTicks = a.jumpLockTicks = 0;
  a.recoverAccelMult = 1;
  a.lastLanding = LAND_NONE;
  a.lastImpactMps = 0;
  a.yawFrame = 0;
  headingBasis(a, basis);
  a.fx = basis[3]!;
  a.fy = basis[4]!;
  a.fz = basis[5]!;
}

/** Turns the facing vector toward the tangent unit target by at most the step (operands in `turnArgs`). */
function turnToward(a: AvatarState, args: Float64Array): void {
  const nx = args[0]!;
  const ny = args[1]!;
  const nz = args[2]!;
  const tx = args[3]!;
  const ty = args[4]!;
  const tz = args[5]!;
  const c = args[6]!;
  const s = args[7]!;
  // Re-project the facing onto the tangent plane first.
  let fx = a.fx;
  let fy = a.fy;
  let fz = a.fz;
  const fn = fx * nx + fy * ny + fz * nz;
  fx -= fn * nx;
  fy -= fn * ny;
  fz -= fn * nz;
  const fl = Math.sqrt(fx * fx + fy * fy + fz * fz);
  if (fl < 1e-9) {
    a.fx = tx;
    a.fy = ty;
    a.fz = tz;
    return;
  }
  fx /= fl;
  fy /= fl;
  fz /= fl;
  const d = fx * tx + fy * ty + fz * tz;
  if (d >= c) {
    a.fx = tx;
    a.fy = ty;
    a.fz = tz;
    return;
  }
  // Side: sign of n . (f x t). Rotating f by +angle about n gives f c + (n x f) s.
  const cx = fy * tz - fz * ty;
  const cy = fz * tx - fx * tz;
  const cz = fx * ty - fy * tx;
  const sign = cx * nx + cy * ny + cz * nz >= 0 ? 1 : -1;
  const px = ny * fz - nz * fy;
  const py = nz * fx - nx * fz;
  const pz = nx * fy - ny * fx;
  a.fx = fx * c + px * s * sign;
  a.fy = fy * c + py * s * sign;
  a.fz = fz * c + pz * s * sign;
}

/** Advances one avatar by one fixed tick. Allocation-free. */
export function stepAvatar(a: AvatarState, intent: MoveIntent, cfg: SimConfig, ground: SimGround): void {
  const F = cfg.feel;
  const dt = cfg.dt;
  const R = cfg.moonRadiusM;
  const g = cfg.gravityMps2;
  headingBasis(a, basis);
  const nx = basis[0]!;
  const ny = basis[1]!;
  const nz = basis[2]!;
  // Camera forward / right from yaw (deterministic table).
  const cy = cosTurn(intent.yaw);
  const sy = sinTurn(intent.yaw);
  const fwx = basis[3]! * cy + basis[6]! * sy;
  const fwy = basis[4]! * cy + basis[7]! * sy;
  const fwz = basis[5]! * cy + basis[8]! * sy;
  // right = forward x n
  const rtx = fwy * nz - fwz * ny;
  const rty = fwz * nx - fwx * nz;
  const rtz = fwx * ny - fwy * nx;

  let mx = intent.moveX;
  let my = intent.moveY;
  if (a.moveLockTicks > 0) mx = my = 0;
  const mag = Math.sqrt(mx * mx + my * my);
  // Wish direction (unit tangent) and magnitude.
  let wx = 0;
  let wy = 0;
  let wz = 0;
  let wishFrac = 0;
  if (mag > 1e-6) {
    wx = (fwx * my + rtx * mx) / mag;
    wy = (fwy * my + rty * mx) / mag;
    wz = (fwz * my + rtz * mx) / mag;
    wishFrac = mag > 1 ? 1 : mag < F.minStickFrac ? F.minStickFrac : mag;
  }

  // Split velocity.
  const vn = a.vx * nx + a.vy * ny + a.vz * nz;
  let vtx = a.vx - vn * nx;
  let vty = a.vy - vn * ny;
  let vtz = a.vz - vn * nz;
  let vnew = vn;
  const grounded = a.moveState === MOVE_GROUNDED;

  // Timers.
  if (a.jumpBufferTicks > 0) a.jumpBufferTicks--;
  if (a.snapOffTicks > 0) a.snapOffTicks--;
  if (a.hopIntervalTicks > 0) a.hopIntervalTicks--;
  if (a.recoverTicks > 0) a.recoverTicks--;
  else a.recoverAccelMult = 1;
  if (a.moveLockTicks > 0) a.moveLockTicks--;
  if (a.jumpLockTicks > 0) a.jumpLockTicks--;
  if (!grounded && a.coyoteTicks > 0) a.coyoteTicks--;

  let gravityMult = 1;
  if (grounded) {
    // Hop recharge accumulates on the ground.
    if (a.hopCharges < a.hopMaxCharges) {
      a.hopRechargeTicks++;
      if (a.hopRechargeTicks >= cfg.hopRechargeTicks) {
        a.hopCharges = a.hopMaxCharges;
        a.hopRechargeTicks = 0;
      }
    }
    // Slope from central differences at +-0.25 m along the frame axes.
    const k = F.slopeProbeM / R;
    const ex = basis[6]!;
    const ey = basis[7]!;
    const ez = basis[8]!;
    const tnx = basis[3]!;
    const tny = basis[4]!;
    const tnz = basis[5]!;
    // H at the unit direction n + kk * axis (normalised); one call site keeps the ground call inlined.
    for (let p = 0; p < 4; p++) {
      const ax = p < 2 ? ex : tnx;
      const ay = p < 2 ? ey : tny;
      const az = p < 2 ? ez : tnz;
      const kk = (p & 1) === 0 ? k : -k;
      const x = nx + ax * kk;
      const y = ny + ay * kk;
      const z = nz + az * kk;
      const l = Math.sqrt(x * x + y * y + z * z);
      probeH[p] = ground.heightAtXYZ(x / l, y / l, z / l);
    }
    const ge = (probeH[0]! - probeH[1]!) / (2 * F.slopeProbeM);
    const gn = (probeH[2]! - probeH[3]!) / (2 * F.slopeProbeM);
    // Gradient (uphill) vector in world space and tan(theta).
    const gx = ex * ge + tnx * gn;
    const gy = ey * ge + tny * gn;
    const gz = ez * ge + tnz * gn;
    const tanT = Math.sqrt(ge * ge + gn * gn);

    if (tanT > cfg.tanSlopeNoTraction) {
      // No traction: slide downhill at g (sin - mu cos).
      const inv = 1 / Math.sqrt(1 + tanT * tanT);
      const acc = g * (tanT * inv - F.slideFriction * inv);
      const s = (acc * dt) / tanT;
      vtx -= gx * s;
      vty -= gy * s;
      vtz -= gz * s;
    } else {
      let speed: number;
      if (intent.sweeping) speed = cfg.sweepWalkMps;
      else if (intent.lope) speed = cfg.lopeMps;
      else speed = cfg.walkMps;
      speed *= intent.speedMult;
      let tx = wx * speed * wishFrac;
      let ty = wy * speed * wishFrac;
      let tz = wz * speed * wishFrac;
      // Uphill slowdown while walking or loping (sweeping uses only the Steep rule, folded into speedMult by the room: movement/steep.ts).
      if (!intent.sweeping && wishFrac > 0) {
        const up = wx * gx + wy * gy + wz * gz; // tan of the slope along the move direction
        if (up > cfg.tanSlopeSlowStart) {
          const span = cfg.tanSlopeNoTraction - cfg.tanSlopeSlowStart;
          let f = (up - cfg.tanSlopeSlowStart) / span;
          if (f > 1) f = 1;
          const mult = 1 - (1 - F.slopeSlowMinMult) * f;
          tx *= mult;
          ty *= mult;
          tz *= mult;
        }
      }
      const tl = Math.sqrt(tx * tx + ty * ty + tz * tz);
      const vl = Math.sqrt(vtx * vtx + vty * vty + vtz * vtz);
      let rate: number;
      if (tl < 1e-9) rate = F.releaseMps2;
      else if (vtx * tx + vty * ty + vtz * tz < 0) rate = F.reverseMps2;
      else if (tl < vl) rate = F.releaseMps2;
      else rate = vl < cfg.walkMps ? F.accelWalkMps2 : F.accelLopeMps2;
      rate *= a.recoverAccelMult;
      const dx = tx - vtx;
      const dy = ty - vty;
      const dz = tz - vtz;
      const dl = Math.sqrt(dx * dx + dy * dy + dz * dz);
      const maxDv = rate * dt;
      if (dl <= maxDv) {
        vtx = tx;
        vty = ty;
        vtz = tz;
      } else {
        const s = maxDv / dl;
        vtx += dx * s;
        vty += dy * s;
        vtz += dz * s;
      }
    }
    vnew = 0;
    // Jump (press, or buffered press) with coyote handled below for airborne.
    const wantJump = intent.jumpPressed || a.jumpBufferTicks > 0;
    if (wantJump && a.jumpLockTicks === 0) {
      doJump(a, cfg);
      const hs = Math.sqrt(vtx * vtx + vty * vty + vtz * vtz);
      a.airSpeedCap = hs > cfg.walkMps ? hs : cfg.walkMps;
      vnew = cfg.jumpV0Mps;
    }
  } else {
    // Airborne.
    if (intent.jumpPressed && a.coyoteTicks > 0 && !a.jumped && a.jumpLockTicks === 0) {
      // Coyote jump.
      doJump(a, cfg);
      const hs = Math.sqrt(vtx * vtx + vty * vty + vtz * vtz);
      a.airSpeedCap = hs > cfg.walkMps ? hs : cfg.walkMps;
      vnew = cfg.jumpV0Mps;
    } else {
      const hop = intent.hopPressed || (intent.jumpPressed && a.coyoteTicks === 0);
      if (hop && a.hopCharges > 0 && a.hopIntervalTicks === 0) {
        // Hop Pack burst with fall arrest.
        if (vnew < 0) vnew = 0;
        const b = cfg.hopBurstMps;
        if (mag > 1e-6) {
          vnew += b * F.hopCos35;
          vtx += wx * b * F.hopSin35;
          vty += wy * b * F.hopSin35;
          vtz += wz * b * F.hopSin35;
        } else {
          vnew += b;
        }
        if (vnew > F.hopMaxUpMps) vnew = F.hopMaxUpMps;
        const hl = Math.sqrt(vtx * vtx + vty * vty + vtz * vtz);
        if (hl > F.hopMaxHorizontalMps) {
          const s = F.hopMaxHorizontalMps / hl;
          vtx *= s;
          vty *= s;
          vtz *= s;
        }
        if (hl > a.airSpeedCap) a.airSpeedCap = hl > F.hopMaxHorizontalMps ? F.hopMaxHorizontalMps : hl;
        a.hopCharges--;
        a.hopRechargeTicks = 0;
        a.hopIntervalTicks = cfg.hopMinIntervalTicks;
        a.moveState = MOVE_HOPPING;
      } else if (intent.jumpPressed) {
        a.jumpBufferTicks = cfg.jumpBufferTicks;
      }
    }
    // Jump cut: release while rising, once per jump.
    if (intent.jumpReleased && a.jumped && !a.jumpCutUsed && vnew > 0) {
      vnew *= F.jumpCutMult;
      a.jumpCutUsed = true;
    }
    // Air control.
    if (wishFrac > 0) {
      const along = vtx * wx + vty * wy + vtz * wz;
      const rate = along < 0 ? F.airBrakeMps2 : F.airAccelMps2;
      const s = rate * dt * wishFrac;
      vtx += wx * s;
      vty += wy * s;
      vtz += wz * s;
      const hl = Math.sqrt(vtx * vtx + vty * vty + vtz * vtz);
      if (hl > a.airSpeedCap) {
        const k = a.airSpeedCap / hl;
        vtx *= k;
        vty *= k;
        vtz *= k;
      }
    }
    a.touchdown = intent.descend;
    if (intent.descend) gravityMult = F.touchdownGravityMult;
  }

  // Facing.
  const faceAim = intent.faceAim;
  if (faceAim || (wishFrac > 0 && a.moveState === MOVE_GROUNDED)) {
    const ta = turnArgs;
    ta[0] = nx;
    ta[1] = ny;
    ta[2] = nz;
    ta[3] = faceAim ? fwx : wx;
    ta[4] = faceAim ? fwy : wy;
    ta[5] = faceAim ? fwz : wz;
    ta[6] = faceAim ? cfg.sweepTurnCos : cfg.turnCos;
    ta[7] = faceAim ? cfg.sweepTurnSin : cfg.turnSin;
    turnToward(a, ta);
  }

  // Integrate with sub-steps.
  let vx = vtx + vnew * nx;
  let vy = vty + vnew * ny;
  let vz = vtz + vnew * nz;
  const speed = Math.sqrt(vx * vx + vy * vy + vz * vz);
  let n = Math.ceil((speed * dt) / F.maxSubstepM);
  if (n < F.minSubsteps) n = F.minSubsteps;
  else if (n > F.maxSubsteps) n = F.maxSubsteps;
  const h = dt / n;
  let px = a.px;
  let py = a.py;
  let pz = a.pz;
  const snapDist = intent.sweeping ? F.snapSweepM : intent.lope ? F.snapLopeM : F.snapWalkM;
  for (let i = 0; i < n; i++) {
    let l = Math.sqrt(px * px + py * py + pz * pz);
    let ux = px / l;
    let uy = py / l;
    let uz = pz / l;
    if (a.moveState !== MOVE_GROUNDED) {
      const gs = g * gravityMult * h;
      vx -= ux * gs;
      vy -= uy * gs;
      vz -= uz * gs;
    }
    // Tangential speed before the move (to keep it after re-projection).
    const vnb = vx * ux + vy * uy + vz * uz;
    const tbx = vx - vnb * ux;
    const tby = vy - vnb * uy;
    const tbz = vz - vnb * uz;
    const tSpeed = Math.sqrt(tbx * tbx + tby * tby + tbz * tbz);
    px += vx * h;
    py += vy * h;
    pz += vz * h;
    l = Math.sqrt(px * px + py * py + pz * pz);
    ux = px / l;
    uy = py / l;
    uz = pz / l;
    const rg = R + ground.heightAtXYZ(ux, uy, uz);
    const above = l - rg;
    // Re-split velocity against the new up, keeping the tangential speed.
    const vna = vx * ux + vy * uy + vz * uz;
    let tax = vx - vna * ux;
    let tay = vy - vna * uy;
    let taz = vz - vna * uz;
    const tl = Math.sqrt(tax * tax + tay * tay + taz * taz);
    if (tl > 1e-12) {
      const s = tSpeed / tl;
      tax *= s;
      tay *= s;
      taz *= s;
    }
    if (a.moveState === MOVE_GROUNDED) {
      if (above <= snapDist && a.snapOffTicks === 0) {
        px = ux * rg;
        py = uy * rg;
        pz = uz * rg;
        vx = tax;
        vy = tay;
        vz = taz;
        a.heightAboveGround = 0;
      } else {
        // Walked off a ledge: airborne, coyote window opens.
        a.moveState = MOVE_AIRBORNE;
        a.coyoteTicks = a.jumped ? 0 : cfg.coyoteTicks;
        a.airSpeedCap = Math.max(tSpeed, cfg.walkMps);
        vx = tax + vna * ux;
        vy = tay + vna * uy;
        vz = taz + vna * uz;
        a.heightAboveGround = above;
      }
    } else if (above <= 0 && vna <= 0) {
      // Landing.
      px = ux * rg;
      py = uy * rg;
      pz = uz * rg;
      vx = tax;
      vy = tay;
      vz = taz;
      a.lastImpactMps = -vna; // impact speed, read by land (no double argument)
      land(a, cfg);
    } else {
      vx = tax + vna * ux;
      vy = tay + vna * uy;
      vz = taz + vna * uz;
      a.heightAboveGround = above;
    }
  }
  a.px = quantize(px);
  a.py = quantize(py);
  a.pz = quantize(pz);
  a.vx = quantize(vx);
  a.vy = quantize(vy);
  a.vz = quantize(vz);
  a.heightAboveGround = quantize(a.heightAboveGround);
  const fl = Math.sqrt(a.fx * a.fx + a.fy * a.fy + a.fz * a.fz);
  a.fx = quantize(a.fx / fl);
  a.fy = quantize(a.fy / fl);
  a.fz = quantize(a.fz / fl);
}

/** Jump state flags; the caller sets `airSpeedCap` (keeps doubles out of the call). */
function doJump(a: AvatarState, cfg: SimConfig): void {
  a.moveState = MOVE_AIRBORNE;
  a.jumped = true;
  a.jumpCutUsed = false;
  a.jumpBufferTicks = 0;
  a.coyoteTicks = 0;
  a.snapOffTicks = cfg.snapOffTicks;
}

/** Touchdown classification; the caller has stored the impact speed in `a.lastImpactMps`. */
function land(a: AvatarState, cfg: SimConfig): void {
  const F = cfg.feel;
  const impact = a.lastImpactMps;
  a.moveState = MOVE_GROUNDED;
  a.heightAboveGround = 0;
  a.jumped = false;
  a.jumpCutUsed = false;
  a.coyoteTicks = 0;
  if (impact < F.landSoftMps) {
    a.lastLanding = LAND_SOFT;
  } else if (impact < F.landHeavyMps || a.touchdown) {
    a.lastLanding = LAND_MEDIUM;
    a.recoverTicks = cfg.landMediumTicks;
    a.recoverAccelMult = F.landMediumAccelMult;
  } else if (impact <= F.landFaceplantMps) {
    a.lastLanding = LAND_HEAVY;
    a.recoverTicks = cfg.landHeavyTicks;
    a.recoverAccelMult = F.landHeavyAccelMult;
  } else {
    a.lastLanding = LAND_FACEPLANT;
    a.moveLockTicks = cfg.faceplantMoveTicks;
    a.jumpLockTicks = cfg.faceplantJumpTicks;
  }
  a.touchdown = false;
}
