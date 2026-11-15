// Locomotion blend math (spec 3.2). Allocation rule (AN-M1-09, same as packages/sim movement): hot-path cores never
// take or return a double through a call V8 may decline to inline (that boxes a HeapNumber per call). Cores read and
// write a caller-owned Float64Array `io`; the number-signature wrappers exist for tests and cold callers only.

import { AIR, LOCO } from "./tuning";

/** 1D node indices (weights array of length 4). */
export const LOCO_IDLE = 0;
export const LOCO_SHUFFLE = 1;
export const LOCO_WALK = 2;
export const LOCO_LOPE = 3;
export const LOCO_NODE_COUNT = 4;

/** 2D strafe node indices (weights array of length 5): idle centre + shuffle fwd/right/bwd/left. */
export const STRAFE_IDLE = 0;
export const STRAFE_FWD = 1;
export const STRAFE_RIGHT = 2;
export const STRAFE_BWD = 3;
export const STRAFE_LEFT = 4;
export const STRAFE_NODE_COUNT = 5;

/** Air 1D node indices (weights array of length 3). */
export const AIR_RISE = 0;
export const AIR_APEX = 1;
export const AIR_FALL = 2;
export const AIR_NODE_COUNT = 3;

const scratch = new Float64Array(4);

/**
 * 1D weights by planar speed io[0]; writes the playback rate to io[1]. At most two adjacent nodes are non-zero and the
 * weights sum to 1. Rate = s / v_blended clamped to [rateMin, rateMax] (exactly 1 on the idle->shuffle segment).
 */
export function locomotion1DIO(io: Float64Array, nodeSpeeds: ArrayLike<number>, out: Float32Array): void {
  const s = io[0]!;
  out[0] = 0;
  out[1] = 0;
  out[2] = 0;
  out[3] = 0;
  if (!(s > 0)) {
    out[LOCO_IDLE] = 1;
    io[1] = 1;
    return;
  }
  const last = LOCO_NODE_COUNT - 1;
  const top = nodeSpeeds[last]!;
  if (s >= top) {
    out[last] = 1;
    const r = s / top;
    io[1] = r > LOCO.rateMax ? LOCO.rateMax : r;
    return;
  }
  let i = 0;
  while (i < last - 1 && s >= nodeSpeeds[i + 1]!) i++;
  const a = nodeSpeeds[i]!;
  const b = nodeSpeeds[i + 1]!;
  const t = (s - a) / (b - a);
  out[i] = 1 - t;
  out[i + 1] = t;
  const vBlend = a * (1 - t) + b * t;
  let r = vBlend > 1e-6 ? s / vBlend : 1;
  if (r < LOCO.rateMin) r = LOCO.rateMin;
  else if (r > LOCO.rateMax) r = LOCO.rateMax;
  io[1] = r;
}

/** Wrapper of `locomotion1DIO` (cold paths / tests). Returns the rate. */
export function locomotion1D(s: number, nodeSpeeds: ArrayLike<number>, out: Float32Array): number {
  scratch[0] = s;
  locomotion1DIO(scratch, nodeSpeeds, out);
  return scratch[1]!;
}

/**
 * Gait statistics over the moving nodes (weighted by their share of the moving weight): io[0] = sync-group cycle (s,
 * rate 1), io[1] = flight per step (s), io[2] = stance dip (m). With only idle weighted, the shuffle cycle keeps the
 * phase ticking slowly so a wake-up resumes in phase, and flight / dip are 0.
 */
export function gaitStatsIO(weights: Float32Array, io: Float64Array): void {
  let wSum = 0;
  let c = 0;
  let f = 0;
  let d = 0;
  for (let i = 1; i < LOCO_NODE_COUNT; i++) {
    const w = weights[i]!;
    wSum += w;
    c += w * LOCO.cycleS[i]!;
    f += w * LOCO.flightS[i]!;
    d += w * LOCO.stanceDipM[i]!;
  }
  if (wSum > 1e-6) {
    io[0] = c / wSum;
    io[1] = f / wSum;
    io[2] = d / wSum;
  } else {
    io[0] = LOCO.cycleS[LOCO_SHUFFLE];
    io[1] = 0;
    io[2] = 0;
  }
}

/** Sync-group cycle duration (wrapper of `gaitStatsIO`). */
export function gaitCycleS(weights: Float32Array): number {
  gaitStatsIO(weights, scratch);
  return scratch[0]!;
}

/** Weighted per-node quantity over the moving nodes, normalised by moving weight (cold helper). */
export function gaitWeighted(weights: Float32Array, table: ArrayLike<number>): number {
  let wSum = 0;
  let v = 0;
  for (let i = 1; i < LOCO_NODE_COUNT; i++) {
    const w = weights[i]!;
    wSum += w;
    v += w * table[i]!;
  }
  return wSum > 1e-6 ? v / wSum : 0;
}

/**
 * 2D strafe weights from local velocity io[0] = forward, io[1] = right; writes the rate to io[2]. The two directional
 * nodes adjacent by angle share min(s / strafeSpeed, 1) linearly in angle; idle takes the rest.
 */
export function locomotion2DIO(io: Float64Array, out: Float32Array): void {
  const vFwd = io[0]!;
  const vRight = io[1]!;
  out[0] = 0;
  out[1] = 0;
  out[2] = 0;
  out[3] = 0;
  out[4] = 0;
  const s = Math.sqrt(vFwd * vFwd + vRight * vRight);
  if (s < 1e-6) {
    out[STRAFE_IDLE] = 1;
    io[2] = 1;
    return;
  }
  const scale = s >= LOCO.strafeSpeed ? 1 : s / LOCO.strafeSpeed;
  // Angle clockwise from forward toward right, in quarter turns [0, 4).
  let q = Math.atan2(vRight, vFwd) / (Math.PI / 2);
  if (q < 0) q += 4;
  if (q >= 4) q -= 4;
  const k = Math.floor(q);
  const t = q - k;
  // Directional nodes in clockwise order: fwd(1), right(2), bwd(3), left(4).
  const n0 = 1 + k;
  const n1 = 1 + ((k + 1) & 3);
  out[n0] = (1 - t) * scale;
  out[n1] = out[n1]! + t * scale;
  out[STRAFE_IDLE] = 1 - scale;
  if (s <= LOCO.strafeSpeed) {
    io[2] = 1;
    return;
  }
  const r = s / LOCO.strafeSpeed;
  io[2] = r > LOCO.rateMax ? LOCO.rateMax : r;
}

/** Wrapper of `locomotion2DIO`. Returns the rate. */
export function locomotion2D(vFwd: number, vRight: number, out: Float32Array): number {
  scratch[0] = vFwd;
  scratch[1] = vRight;
  locomotion2DIO(scratch, out);
  return scratch[2]!;
}

/** Air weights by v_up = io[0]: rise (>= +1) -> apex (|v| <= 0.4) -> fall (<= -1), linear between. Sum is 1. */
export function airBlendIO(io: Float64Array, out: Float32Array): void {
  const vUp = io[0]!;
  out[0] = 0;
  out[1] = 0;
  out[2] = 0;
  if (vUp >= AIR.riseVUp) out[AIR_RISE] = 1;
  else if (vUp > AIR.apexVUp) {
    const t = (vUp - AIR.apexVUp) / (AIR.riseVUp - AIR.apexVUp);
    out[AIR_RISE] = t;
    out[AIR_APEX] = 1 - t;
  } else if (vUp >= -AIR.apexVUp) out[AIR_APEX] = 1;
  else if (vUp > AIR.fallVUp) {
    const t = (-AIR.apexVUp - vUp) / (-AIR.apexVUp - AIR.fallVUp);
    out[AIR_FALL] = t;
    out[AIR_APEX] = 1 - t;
  } else out[AIR_FALL] = 1;
}

/** Wrapper of `airBlendIO`. */
export function airBlend(vUp: number, out: Float32Array): void {
  scratch[0] = vUp;
  airBlendIO(scratch, out);
}

/**
 * Banded value with hysteresis (spec 3.6 "speed bands +-0.2 m/s"). `edges` are ascending band boundaries; the band
 * only changes once `s` passes an edge by more than `h`. Returns the new band index in [0, edges.length].
 */
export function bandWithHysteresis(s: number, prevBand: number, edges: ArrayLike<number>, h: number): number {
  let band = prevBand;
  while (band < edges.length && s > edges[band]! + h) band++;
  while (band > 0 && s < edges[band - 1]! - h) band--;
  return band;
}

/**
 * In-place linear ramp of w[i] toward `target` at 1 / blendS per second, dt = w[dtIndex] (blendS <= 0 snaps).
 * Pass constants for target / blendS (embedded, never boxed at run time).
 */
export function rampAt(w: Float64Array, i: number, target: number, blendS: number, dtIndex: number): void {
  const cur = w[i]!;
  if (blendS <= 0) {
    w[i] = target;
    return;
  }
  const step = w[dtIndex]! / blendS;
  if (cur < target) w[i] = cur + step >= target ? target : cur + step;
  else w[i] = cur - step <= target ? target : cur - step;
}

/** Linear weight ramp toward `target` at 1 / blendS per second (blendS <= 0 snaps). Cold helper. */
export function rampWeight(current: number, target: number, blendS: number, dt: number): number {
  if (blendS <= 0) return target;
  const step = dt / blendS;
  if (current < target) return current + step >= target ? target : current + step;
  return current - step <= target ? target : current - step;
}
