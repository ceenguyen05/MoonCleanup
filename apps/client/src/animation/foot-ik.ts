// Foot IK on the sphere (spec 4.3): ground probing with the sim's own height function, foot alignment, foot lock
// (anti-slide), pelvis offset, slope stance and an analytic two-bone leg solver. Everything is expressed in the avatar
// local frame (x right, y up, z forward, origin at the sim root = sole level) so a rig adapter can apply it directly.
// Allocation-free: all state lives in typed arrays created once per avatar.

import type { RigProfile } from "./rig-profile";
import type { SphereFrame } from "./sphere-frame";
import { FOOT_IK } from "./tuning";

/**
 * The sim's ground, batched (packages/world GroundHeight.heightsAt, bit-identical to heightAtXYZ): out[i] = height
 * above the moon radius along unit direction dirs[3i .. 3i + 2], i < n. One call per avatar with typed-array I/O, so
 * no double is boxed per sample (AN-M1-09).
 */
export interface AnimGround {
  heightsAt(dirs: Float64Array, out: Float64Array, n: number): void;
}

/** Adapts a per-sample ground ({ heightAtXYZ }) for tests / cold callers. Allocates once. */
export function batchedGround(g: { heightAtXYZ(x: number, y: number, z: number): number }): AnimGround {
  return {
    heightsAt(dirs: Float64Array, out: Float64Array, n: number): void {
      for (let i = 0; i < n; i++) out[i] = g.heightAtXYZ(dirs[i * 3]!, dirs[i * 3 + 1]!, dirs[i * 3 + 2]!);
    },
  };
}

/**
 * Analytic two-bone IK (law of cosines). Inputs/outputs are 3-vectors in one frame. `pole` picks the bend plane
 * (the clip's knee direction). Reach is capped at stretchCap x (l1 + l2) and floored at |l1 - l2|; a pole parallel to
 * the chain (singular) falls back to any perpendicular so the result is always finite. Returns the clamped reach.
 */
export function solveTwoBone(
  root: Float64Array,
  target: Float64Array,
  pole: Float64Array,
  l1: number,
  l2: number,
  outMid: Float64Array,
  outEnd: Float64Array,
): number {
  lenScratch[0] = l1;
  lenScratch[1] = l2;
  solveTwoBoneIO(root, target, pole, lenScratch, outMid, outEnd);
  return lenScratch[2]!;
}

const lenScratch = new Float64Array(3);

/** Allocation-free core of `solveTwoBone`: lens[0] = l1, lens[1] = l2 in; lens[2] = clamped reach out. */
export function solveTwoBoneIO(
  root: Float64Array,
  target: Float64Array,
  pole: Float64Array,
  lens: Float64Array,
  outMid: Float64Array,
  outEnd: Float64Array,
): void {
  const l1 = lens[0]!;
  const l2 = lens[1]!;
  let dx = target[0]! - root[0]!;
  let dy = target[1]! - root[1]!;
  let dz = target[2]! - root[2]!;
  let dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (dist < 1e-9) {
    // Target on the root: aim the chain along -pole-perpendicular fallback (straight down).
    dx = 0;
    dy = -1;
    dz = 0;
    dist = 0;
  } else {
    dx /= dist;
    dy /= dist;
    dz /= dist;
  }
  const maxReach = (l1 + l2) * FOOT_IK.stretchCap;
  const minReach = Math.abs(l1 - l2) + 1e-6;
  if (dist > maxReach) dist = maxReach;
  if (dist < minReach) dist = minReach;
  let cosA = (l1 * l1 + dist * dist - l2 * l2) / (2 * l1 * dist);
  if (cosA > 1) cosA = 1;
  else if (cosA < -1) cosA = -1;
  const sinA = Math.sqrt(1 - cosA * cosA);
  // Bend direction: pole minus its component along the chain.
  let pd = pole[0]! * dx + pole[1]! * dy + pole[2]! * dz;
  let px = pole[0]! - dx * pd;
  let py = pole[1]! - dy * pd;
  let pz = pole[2]! - dz * pd;
  let pl = Math.sqrt(px * px + py * py + pz * pz);
  if (pl < 1e-6) {
    // Singular pole: use the axis least aligned with the chain.
    const ax = dx < 0 ? -dx : dx;
    const ay = dy < 0 ? -dy : dy;
    const az = dz < 0 ? -dz : dz;
    const rx = az <= ax && az <= ay ? 0 : ax <= ay ? 1 : 0;
    const ry = 0;
    const rz = rx === 0 ? 1 : 0;
    pd = rx * dx + ry * dy + rz * dz;
    px = rx - dx * pd;
    py = ry - dy * pd;
    pz = rz - dz * pd;
    pl = Math.sqrt(px * px + py * py + pz * pz);
  }
  px /= pl;
  py /= pl;
  pz /= pl;
  const along = l1 * cosA;
  const side = l1 * sinA;
  outMid[0] = root[0]! + dx * along + px * side;
  outMid[1] = root[1]! + dy * along + py * side;
  outMid[2] = root[2]! + dz * along + pz * side;
  outEnd[0] = root[0]! + dx * dist;
  outEnd[1] = root[1]! + dy * dist;
  outEnd[2] = root[2]! + dz * dist;
  lens[2] = dist;
}

/** Clamps a local ground normal (x right, y up, z fwd) to foot pitch/roll limits. Writes [pitch, roll] radians. */
export function footAlignment(nx: number, ny: number, nz: number, out: Float64Array, offset: number): void {
  alignScratch[0] = nx;
  alignScratch[1] = ny;
  alignScratch[2] = nz;
  footAlignmentIO(alignScratch, 0, out, offset);
}

const alignScratch = new Float64Array(3);

/** Allocation-free core of `footAlignment`: normal read from n[nOff .. nOff + 2]. */
export function footAlignmentIO(n: Float64Array, nOff: number, out: Float64Array, offset: number): void {
  const nx = n[nOff]!;
  const ny = n[nOff + 1]!;
  const nz = n[nOff + 2]!;
  // pitch: rotation about +x tilting the foot's up toward +z (toe down on a descending slope); roll: toward +x.
  let pitch = Math.atan2(nz, ny);
  let roll = Math.atan2(nx, ny);
  if (pitch > FOOT_IK.pitchMaxRad) pitch = FOOT_IK.pitchMaxRad;
  else if (pitch < -FOOT_IK.pitchMaxRad) pitch = -FOOT_IK.pitchMaxRad;
  if (roll > FOOT_IK.rollMaxRad) roll = FOOT_IK.rollMaxRad;
  else if (roll < -FOOT_IK.rollMaxRad) roll = -FOOT_IK.rollMaxRad;
  out[offset] = pitch;
  out[offset + 1] = roll;
}

/** Per-frame leg input, filled by the animator from the clip / placeholder gait. Local frame, metres. */
export class LegInput {
  /** Animated sole positions: left 0..2, right 3..5 (before IK and pelvis offset). */
  readonly sole = new Float64Array(6);
  /** Animated hip joint positions: left 0..2, right 3..5. */
  readonly hip = new Float64Array(6);
  /** Knee pole directions (clip knee direction): left 0..2, right 3..5. */
  readonly pole = new Float64Array([0, 0, 1, 0, 0, 1]);
  /** Plant mask 0..1 per foot (sidecar / gait phase). */
  readonly plant = new Float64Array(2);
  /** Cap on IK weight: 1 grounded, 0.5 land_prep, 0 air (spec 4.3). */
  weightCap = 1;
  /** Step length and moon radius for `FootIk.step` (fields, so no double crosses a call). */
  dt = 1 / 60;
  moonRadiusM = 2000;
  /** Placeholder gait parameters: phase, speed, cycleS, rate, flightS, movingWeight (see placeholderLegs). */
  readonly gait = new Float64Array(6);
}

/** Foot IK state + output for one avatar. */
export class FootIk {
  /** Output: ankle targets (after IK reach clamp), knees, soles, local frame. L 0..2, R 3..5. */
  readonly ankle = new Float64Array(6);
  readonly knee = new Float64Array(6);
  readonly soleTarget = new Float64Array(6);
  /** Output: IK weight, foot pitch/roll (L 0..1, R 2..3), ground height under each foot. */
  readonly weight = new Float64Array(2);
  readonly align = new Float64Array(4);
  readonly groundH = new Float64Array(2);
  /** Output: whether each foot is locked, and the planted drift (world metres) for the debug metrics. */
  readonly locked = new Uint8Array(2);
  readonly lockDriftM = new Float64Array(2);
  /** Output: pelvis vertical offset (smoothed), slope shift (local x/z) and slope lean (pitch about x, roll about z). */
  pelvisOffset = 0;
  readonly pelvisShift = new Float64Array(2);
  readonly slopeLean = new Float64Array(2);
  /** Ground probe count of the last solve (spec: 6 per avatar). */
  samples = 0;

  private readonly lockWorld = new Float64Array(6);
  private readonly lockBlend = new Float64Array(2);
  private readonly releasing = new Uint8Array(2);
  private readonly normal = new Float64Array(6);
  private readonly v = new Float64Array(3);
  private readonly w = new Float64Array(3);
  private readonly hip = new Float64Array(3);
  private readonly tgt = new Float64Array(3);
  private readonly pole = new Float64Array(3);
  private readonly mid = new Float64Array(3);
  private readonly end = new Float64Array(3);
  private pelvisInit = false;
  private readonly lens = new Float64Array(3);

  reset(): void {
    this.locked[0] = 0;
    this.locked[1] = 0;
    this.lockBlend[0] = 0;
    this.lockBlend[1] = 0;
    this.releasing[0] = 0;
    this.releasing[1] = 0;
    this.weight[0] = 0;
    this.weight[1] = 0;
    this.pelvisOffset = 0;
    this.pelvisInit = false;
  }

  /** Local sample points (x, z) for 6 probes and their local ground heights (spec 4.3: 6 per avatar). */
  private readonly pts = new Float64Array(12);
  private readonly hs = new Float64Array(6);
  private readonly dirs = new Float64Array(18);
  private readonly radii = new Float64Array(6);

  /**
   * Samples the ground at the 6 local points in `pts` with one batched call (no double crosses a call). Heights are local: metres along up from the root.
   */
  private sampleGround(frame: SphereFrame, root: Float64Array, ground: AnimGround, moonRadiusM: number): void {
    const r = frame.right;
    const f = frame.fwd;
    const u = frame.up;
    const pts = this.pts;
    const dirs = this.dirs;
    for (let j = 0; j < 6; j++) {
      const x = pts[j * 2]!;
      const z = pts[j * 2 + 1]!;
      const wx = root[0]! + r[0]! * x + f[0]! * z;
      const wy = root[1]! + r[1]! * x + f[1]! * z;
      const wz = root[2]! + r[2]! * x + f[2]! * z;
      const l = Math.sqrt(wx * wx + wy * wy + wz * wz);
      dirs[j * 3] = wx / l;
      dirs[j * 3 + 1] = wy / l;
      dirs[j * 3 + 2] = wz / l;
    }
    const radii = this.radii;
    ground.heightsAt(dirs, radii, 6);
    for (let j = 0; j < 6; j++) {
      const dx = dirs[j * 3]!;
      const dy = dirs[j * 3 + 1]!;
      const dz = dirs[j * 3 + 2]!;
      const rg = moonRadiusM + radii[j]!;
      this.hs[j] = (dx * rg - root[0]!) * u[0]! + (dy * rg - root[1]!) * u[1]! + (dz * rg - root[2]!) * u[2]!;
    }
    this.samples = 6;
  }

  /** Convenience wrapper (tests / cold callers). */
  solve(
    frame: SphereFrame,
    root: Float64Array,
    ground: AnimGround,
    moonRadiusM: number,
    rig: RigProfile,
    leg: LegInput,
    dt: number,
  ): void {
    leg.moonRadiusM = moonRadiusM;
    leg.dt = dt;
    this.step(frame, root, ground, rig, leg);
  }

  /** Runs the full foot/leg solve for one update (dt / moon radius from `leg`). `root` = sole-level root. */
  step(frame: SphereFrame, root: Float64Array, ground: AnimGround, rig: RigProfile, leg: LegInput): void {
    const dt = leg.dt;
    const sole = leg.sole;
    const e = FOOT_IK.normalProbeM;
    const pts = this.pts;
    for (let k = 0; k < 2; k++) {
      const x = sole[k * 3]!;
      const z = sole[k * 3 + 2]!;
      const o = k * 6;
      pts[o] = x;
      pts[o + 1] = z;
      pts[o + 2] = x + e;
      pts[o + 3] = z;
      pts[o + 4] = x;
      pts[o + 5] = z + e;
    }
    this.sampleGround(frame, root, ground, leg.moonRadiusM);
    // 1) ground under each foot (+ normal by finite difference), weights.
    const hs = this.hs;
    const n = this.normal;
    for (let k = 0; k < 2; k++) {
      const o = k * 3;
      const h = hs[k * 3]!;
      let nx = -(hs[k * 3 + 1]! - h) / e;
      let ny = 1;
      let nz = -(hs[k * 3 + 2]! - h) / e;
      const l = Math.sqrt(nx * nx + ny * ny + nz * nz);
      nx /= l;
      ny /= l;
      nz /= l;
      n[o] = nx;
      n[o + 1] = ny;
      n[o + 2] = nz;
      this.groundH[k] = h;
      const above = sole[o + 1]! - h;
      const inWindow = above <= FOOT_IK.windowUpM && above >= -FOOT_IK.windowDownM;
      let target = inWindow ? leg.plant[k]! * leg.weightCap : 0;
      if (target > 1) target = 1;
      const step = dt / FOOT_IK.weightRampS;
      const cur = this.weight[k]!;
      this.weight[k] =
        cur < target ? (cur + step > target ? target : cur + step) : cur - step < target ? target : cur - step;
    }
    // 2) pelvis offset: min of the ground deltas, clamped, exponentially smoothed (tau up 70 / down 50 ms).
    const dl = this.groundH[0]!;
    const dr = this.groundH[1]!;
    let p = leg.weightCap <= 0 ? 0 : dl < dr ? dl : dr;
    if (p < FOOT_IK.pelvisMinM) p = FOOT_IK.pelvisMinM;
    else if (p > FOOT_IK.pelvisMaxM) p = FOOT_IK.pelvisMaxM;
    if (!this.pelvisInit) {
      this.pelvisOffset = p;
      this.pelvisInit = true;
    } else {
      const tau = p > this.pelvisOffset ? FOOT_IK.pelvisTauUpS : FOOT_IK.pelvisTauDownS;
      this.pelvisOffset += (p - this.pelvisOffset) * (1 - Math.exp(-dt / tau));
    }
    // 3) slope stance from the mean foot normal.
    let mx = n[0]! + n[3]!;
    let my = n[1]! + n[4]!;
    let mz = n[2]! + n[5]!;
    const ml = Math.sqrt(mx * mx + my * my + mz * mz);
    mx /= ml;
    my /= ml;
    mz /= ml;
    const slope = Math.acos(my > 1 ? 1 : my);
    const over = slope - FOOT_IK.slopeStartRad;
    const hl = Math.sqrt(mx * mx + mz * mz);
    if (over > 0 && hl > 1e-6 && leg.weightCap > 0) {
      let shift = over * FOOT_IK.slopeShiftPerRad;
      if (shift > FOOT_IK.slopeShiftMaxM) shift = FOOT_IK.slopeShiftMaxM;
      let lean = over * FOOT_IK.slopeLeanPerRad;
      if (lean > FOOT_IK.slopeLeanMaxRad) lean = FOOT_IK.slopeLeanMaxRad;
      // Normal's horizontal part points downhill.
      this.pelvisShift[0] = (mx / hl) * shift;
      this.pelvisShift[1] = (mz / hl) * shift;
      // Lean uphill: pitch back when downhill is forward (+z), roll toward uphill side.
      this.slopeLean[0] = -(mz / hl) * lean;
      this.slopeLean[1] = -(mx / hl) * lean;
    } else {
      this.pelvisShift[0] = 0;
      this.pelvisShift[1] = 0;
      this.slopeLean[0] = 0;
      this.slopeLean[1] = 0;
    }
    // 4) per-foot target, lock, alignment, two-bone solve.
    const v = this.v;
    const w = this.w;
    for (let k = 0; k < 2; k++) {
      const o = k * 3;
      const wk = this.weight[k]!;
      const gh = this.groundH[k]!;
      const ay = sole[o + 1]!;
      const unplantedY = ay + this.pelvisOffset;
      const plantedY = gh + (ay > 0 ? ay : 0);
      let tx = sole[o]! + this.pelvisShift[0]!;
      let ty = unplantedY + (plantedY - unplantedY) * wk;
      let tz = sole[o + 2]! + this.pelvisShift[1]!;
      // Foot lock in world space.
      const fullyPlanted = wk >= 0.999 && leg.plant[k]! >= 0.999;
      if (fullyPlanted && this.locked[k] === 0 && this.releasing[k] === 0) {
        v[0] = tx;
        v[1] = ty;
        v[2] = tz;
        frame.toWorld(v, w);
        this.lockWorld[o] = root[0]! + w[0]!;
        this.lockWorld[o + 1] = root[1]! + w[1]!;
        this.lockWorld[o + 2] = root[2]! + w[2]!;
        this.locked[k] = 1;
        this.lockBlend[k] = 1;
      }
      if (this.locked[k] === 1 || this.releasing[k] === 1) {
        w[0] = this.lockWorld[o]! - root[0]!;
        w[1] = this.lockWorld[o + 1]! - root[1]!;
        w[2] = this.lockWorld[o + 2]! - root[2]!;
        frame.toLocal(w, v);
        const ex = v[0]! - tx;
        const ez = v[2]! - tz;
        const err = Math.sqrt(ex * ex + ez * ez);
        if (this.locked[k] === 1 && (err > FOOT_IK.lockReleaseM || leg.plant[k]! < 0.999)) {
          this.locked[k] = 0;
          this.releasing[k] = 1;
        }
        if (this.releasing[k] === 1) {
          const b = this.lockBlend[k]! - dt / FOOT_IK.lockBlendOutS;
          this.lockBlend[k] = b > 0 ? b : 0;
          if (b <= 0) this.releasing[k] = 0;
        }
        const lb = this.lockBlend[k]!;
        tx += (v[0]! - tx) * lb;
        ty += (v[1]! - ty) * lb;
        tz += (v[2]! - tz) * lb;
      }
      this.soleTarget[o] = tx;
      this.soleTarget[o + 1] = ty;
      this.soleTarget[o + 2] = tz;
      // Foot alignment (blended by weight), ankle above the sole along the aligned normal.
      footAlignmentIO(n, o, this.align, k * 2);
      const pitch = this.align[k * 2]! * wk;
      const roll = this.align[k * 2 + 1]! * wk;
      this.align[k * 2] = pitch;
      this.align[k * 2 + 1] = roll;
      const ah = rig.ankleHeightM;
      const tgt = this.tgt;
      tgt[0] = tx + Math.sin(roll) * ah;
      tgt[1] = ty + Math.cos(pitch) * Math.cos(roll) * ah;
      tgt[2] = tz + Math.sin(pitch) * ah;
      const hip = this.hip;
      hip[0] = leg.hip[o]! + this.pelvisShift[0]!;
      hip[1] = leg.hip[o + 1]! + this.pelvisOffset;
      hip[2] = leg.hip[o + 2]! + this.pelvisShift[1]!;
      const pole = this.pole;
      pole[0] = leg.pole[o]!;
      pole[1] = leg.pole[o + 1]!;
      pole[2] = leg.pole[o + 2]!;
      const lens = this.lens;
      lens[0] = rig.thighM;
      lens[1] = rig.calfM;
      solveTwoBoneIO(hip, tgt, pole, lens, this.mid, this.end);
      this.knee[o] = this.mid[0]!;
      this.knee[o + 1] = this.mid[1]!;
      this.knee[o + 2] = this.mid[2]!;
      this.ankle[o] = this.end[0]!;
      this.ankle[o + 1] = this.end[1]!;
      this.ankle[o + 2] = this.end[2]!;
      // Drift metric: distance between the reached ankle and the requested one while locked.
      if (this.locked[k] === 1) {
        const ex = this.end[0]! - tgt[0]!;
        const ey = this.end[1]! - tgt[1]!;
        const ez = this.end[2]! - tgt[2]!;
        this.lockDriftM[k] = Math.sqrt(ex * ex + ey * ey + ez * ez);
      } else this.lockDriftM[k] = 0;
    }
  }
}
