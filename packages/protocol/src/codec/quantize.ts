// Quantization helpers of netcode.md section 2 (constants: QUANT in @moon-cleanup/shared).
//
// Rule: `q = clamp(Math.round(value / resolution), min, max)`; decode is `q * resolution`. Every function is pure and
// allocation-free. The server calls the `quantize*` helpers at the end of each tick for predicted entities (own avatar,
// driven vehicle) so client replays start from bit-identical state ("Server rule" of netcode.md section 2).
//
// Precision (worst-case absolute error = resolution / 2 unless clamped):
//   position own        1/2048 m  -> 0.24 mm,   range +-4096 m
//   position others     6.25 mm   -> 3.1 mm,    range +-3276.8 m
//   velocity own        1/256 m/s -> 1.95 mm/s, range +-128 m/s
//   yaw (10 bit)        0.352 deg -> 0.176 deg
//   pitch (6 bit)       2.857 deg (180/63) -> 1.43 deg
//   heading (8 bit)     1.406 deg -> 0.70 deg
//   vehicle orient 10b  smallest-three, 511 * sqrt(2) steps per unit -> < 0.1 deg
//   vehicle orient 15b  16383 * sqrt(2) steps per unit -> < 0.004 deg
//   steer (own, i8)     1/127;  steer (others, 6 bit signed) 1/31;  speed 0.25 m/s

import { QUANT, VEHICLE_SPEED_STEP_MPS } from "@moon-cleanup/shared";

const TWO_PI = Math.PI * 2;
const SQRT2 = Math.SQRT2;

export const POS_OWN_MIN = -(2 ** (QUANT.positionOwn.bits - 1));
export const POS_OWN_MAX = 2 ** (QUANT.positionOwn.bits - 1) - 1;
export const POS_OTHERS_MIN = -(2 ** (QUANT.positionOthers.bits - 1));
export const POS_OTHERS_MAX = 2 ** (QUANT.positionOthers.bits - 1) - 1;
export const VEL_MIN = -(2 ** (QUANT.velocityOwn.bits - 1));
export const VEL_MAX = 2 ** (QUANT.velocityOwn.bits - 1) - 1;

/** Step sizes as plain constants for allocation-free inline decoding (`steps * POS_OWN_RES`). */
export const POS_OWN_RES = QUANT.positionOwn.resolutionM;
export const POS_OTHERS_RES = QUANT.positionOthers.resolutionM;
export const VEL_RES = QUANT.velocityOwn.resolutionMps;

const POS_OWN_INV = 1 / QUANT.positionOwn.resolutionM;
const POS_OTHERS_INV = 1 / QUANT.positionOthers.resolutionM;
const VEL_INV = 1 / QUANT.velocityOwn.resolutionMps;

/** Clamp-and-round to an integer in [min, max]. NaN becomes 0. */
export function clampRound(value: number, min: number, max: number): number {
  const r = Math.round(value);
  if (r !== r) return 0;
  return r < min ? min : r > max ? max : r;
}

/** Own position, metres to 24-bit steps. */
export function posOwnToSteps(metres: number): number {
  const v = metres * POS_OWN_INV;
  if (v >= POS_OWN_MAX) return POS_OWN_MAX;
  if (v <= POS_OWN_MIN) return POS_OWN_MIN;
  return Math.round(v) | 0; // int32 result (NaN becomes 0): returned untagged-as-Smi, no HeapNumber
}
export function posOwnFromSteps(steps: number): number {
  return steps * QUANT.positionOwn.resolutionM;
}
/** Position of other entities, metres to 20-bit steps. */
export function posOthersToSteps(metres: number): number {
  const v = metres * POS_OTHERS_INV;
  if (v >= POS_OTHERS_MAX) return POS_OTHERS_MAX;
  if (v <= POS_OTHERS_MIN) return POS_OTHERS_MIN;
  return Math.round(v) | 0; // int32 result (NaN becomes 0): returned untagged-as-Smi, no HeapNumber
}
export function posOthersFromSteps(steps: number): number {
  return steps * QUANT.positionOthers.resolutionM;
}
/** Own velocity, m/s to 16-bit steps. */
export function velToSteps(mps: number): number {
  const v = mps * VEL_INV;
  if (v >= VEL_MAX) return VEL_MAX;
  if (v <= VEL_MIN) return VEL_MIN;
  return Math.round(v) | 0; // int32 result (NaN becomes 0): returned untagged-as-Smi, no HeapNumber
}
export function velFromSteps(steps: number): number {
  return steps * QUANT.velocityOwn.resolutionMps;
}

/** Wrap-safe angle code: `bits`-bit code of an angle in radians (any real; wraps modulo 2 pi). */
function angleToCode(radians: number, steps: number): number {
  const turns = radians / TWO_PI;
  const frac = turns - Math.floor(turns);
  const code = Math.round(frac * steps);
  return code >= steps ? 0 : code;
}

/** Yaw, radians to the 10-bit code (0 .. 1023). */
export function yawToCode(radians: number): number {
  return Number.isFinite(radians) ? angleToCode(radians, QUANT.yaw.steps) : 0;
}
export function yawFromCode(code: number): number {
  return (code * TWO_PI) / QUANT.yaw.steps;
}
/** Robot heading, radians to the 8-bit code. */
export function headingToCode(radians: number): number {
  return Number.isFinite(radians) ? angleToCode(radians, 256) : 0;
}
export function headingFromCode(code: number): number {
  return (code * TWO_PI) / 256;
}
/** Pitch, radians in [-pi/2, pi/2] to the unsigned 6-bit code (0 = -90 deg, 63 = +90 deg). */
export function pitchToCode(radians: number): number {
  return clampRound(((radians + Math.PI / 2) / Math.PI) * (QUANT.pitch.steps - 1), 0, QUANT.pitch.steps - 1);
}
export function pitchFromCode(code: number): number {
  return (code / (QUANT.pitch.steps - 1)) * Math.PI - Math.PI / 2;
}

/** Input yaw (u16 over 0 .. 2 pi) to radians and back. */
export function inputYawToRadians(yaw: number): number {
  return (yaw * TWO_PI) / 65536;
}
export function radiansToInputYaw(radians: number): number {
  return Number.isFinite(radians) ? angleToCode(radians, 65536) : 0;
}
/** Input pitch (i8, +-127 = +-90 deg) to radians and back. */
export function inputPitchToRadians(pitch: number): number {
  return (pitch / 127) * (Math.PI / 2);
}
export function radiansToInputPitch(radians: number): number {
  return clampRound((radians / (Math.PI / 2)) * 127, -127, 127);
}

/** Vehicle speed code (0 .. 255 at 0.25 m/s). */
export function speedToCode(mps: number): number {
  return clampRound(mps / VEHICLE_SPEED_STEP_MPS, 0, 255);
}
export function speedFromCode(code: number): number {
  return code * VEHICLE_SPEED_STEP_MPS;
}
/** Steering -1 .. 1 to the 6-bit signed code of vehicle records (-31 .. 31). */
export function steerToCode6(steer: number): number {
  return clampRound(steer * 31, -32, 31);
}
export function steerFromCode6(code: number): number {
  return code / 31;
}
/** Steering -1 .. 1 to the i8 code of the Self vehicle block (-127 .. 127). */
export function steerToCode8(steer: number): number {
  return clampRound(steer * 127, -128, 127);
}
export function steerFromCode8(code: number): number {
  return code / 127;
}

// ---- Smallest-three quaternion ------------------------------------------------------------------------------------

/** Output of `packQuat`: dropped-component index (0 x, 1 y, 2 z, 3 w) and three signed component codes. */
export interface PackedQuat {
  index: number;
  a: number;
  b: number;
  c: number;
}

/**
 * Packs a unit quaternion (x, y, z, w; not required to be normalised) to the smallest-three form: drop the component
 * with the largest magnitude (flipping the sign of the quaternion so the dropped one is >= 0), keep the other three in
 * index order, each scaled by `(2^(bits-1) - 1) * sqrt(2)` (the kept components lie within +-1/sqrt(2)).
 */
export function packQuat(x: number, y: number, z: number, w: number, bits: number, out: PackedQuat): PackedQuat {
  const len = Math.sqrt(x * x + y * y + z * z + w * w);
  if (!(len > 1e-12)) {
    out.index = 3;
    out.a = 0;
    out.b = 0;
    out.c = 0;
    return out;
  }
  let qx = x / len;
  let qy = y / len;
  let qz = z / len;
  let qw = w / len;
  let index = 0;
  let max = Math.abs(qx);
  if (Math.abs(qy) > max) {
    index = 1;
    max = Math.abs(qy);
  }
  if (Math.abs(qz) > max) {
    index = 2;
    max = Math.abs(qz);
  }
  if (Math.abs(qw) > max) {
    index = 3;
  }
  const dropped = index === 0 ? qx : index === 1 ? qy : index === 2 ? qz : qw;
  if (dropped < 0) {
    qx = -qx;
    qy = -qy;
    qz = -qz;
    qw = -qw;
  }
  const limit = 2 ** (bits - 1);
  const scale = (limit - 1) * SQRT2;
  let a: number;
  let b: number;
  let c: number;
  switch (index) {
    case 0:
      a = qy;
      b = qz;
      c = qw;
      break;
    case 1:
      a = qx;
      b = qz;
      c = qw;
      break;
    case 2:
      a = qx;
      b = qy;
      c = qw;
      break;
    default:
      a = qx;
      b = qy;
      c = qz;
      break;
  }
  out.index = index;
  out.a = clampRound(a * scale, -limit, limit - 1);
  out.b = clampRound(b * scale, -limit, limit - 1);
  out.c = clampRound(c * scale, -limit, limit - 1);
  return out;
}

/** Mutable quaternion for `unpackQuat`. */
export interface QuatOut {
  x: number;
  y: number;
  z: number;
  w: number;
}

/** Inverse of `packQuat`: rebuilds the dropped component as sqrt(1 - sum of squares). */
export function unpackQuat(index: number, a: number, b: number, c: number, bits: number, out: QuatOut): QuatOut {
  const scale = (2 ** (bits - 1) - 1) * SQRT2;
  const ka = a / scale;
  const kb = b / scale;
  const kc = c / scale;
  const rest = 1 - ka * ka - kb * kb - kc * kc;
  const d = rest > 0 ? Math.sqrt(rest) : 0;
  switch (index) {
    case 0:
      out.x = d;
      out.y = ka;
      out.z = kb;
      out.w = kc;
      break;
    case 1:
      out.x = ka;
      out.y = d;
      out.z = kb;
      out.w = kc;
      break;
    case 2:
      out.x = ka;
      out.y = kb;
      out.z = d;
      out.w = kc;
      break;
    default:
      out.x = ka;
      out.y = kb;
      out.z = kc;
      out.w = d;
      break;
  }
  return out;
}

// ---- Array-reading variants (hot path) ----------------------------------------------------------------------------
// A double passed as an argument to a call V8 does not inline is boxed into a HeapNumber (16 B). The frame encoder
// therefore copies its doubles into a Float64Array scratch (a plain store, no call) and calls these, whose arguments
// are integers (array and index) and whose multiply happens inside the callee.

export function posOwnStepsAt(a: Float64Array, i: number): number {
  const v = (a[i] ?? 0) * POS_OWN_INV;
  if (v >= POS_OWN_MAX) return POS_OWN_MAX;
  if (v <= POS_OWN_MIN) return POS_OWN_MIN;
  return Math.round(v) | 0;
}
export function posOthersStepsAt(a: Float64Array, i: number): number {
  const v = (a[i] ?? 0) * POS_OTHERS_INV;
  if (v >= POS_OTHERS_MAX) return POS_OTHERS_MAX;
  if (v <= POS_OTHERS_MIN) return POS_OTHERS_MIN;
  return Math.round(v) | 0;
}
export function velStepsAt(a: Float64Array, i: number): number {
  const v = (a[i] ?? 0) * VEL_INV;
  if (v >= VEL_MAX) return VEL_MAX;
  if (v <= VEL_MIN) return VEL_MIN;
  return Math.round(v) | 0;
}
