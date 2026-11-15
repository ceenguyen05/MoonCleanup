import { describe, expect, it } from "vitest";
import { FootIk, LegInput, batchedGround, footAlignment, solveTwoBone, type AnimGround } from "./foot-ik";
import {
  LAND_HARD,
  LAND_NONE,
  LAND_SOFT,
  LAND_STUMBLE,
  LandingCompression,
  ballisticApex,
  bounceGain,
  landingClass,
  stepPelvisOffset,
  timeToGround,
} from "./low-g";
import { PLACEHOLDER_RIG, profileFromBindPose } from "./rig-profile";
import { SphereFrame } from "./sphere-frame";

const R = 2000;
const v3 = (x: number, y: number, z: number): Float64Array => new Float64Array([x, y, z]);
const len = (a: ArrayLike<number>, o = 0): number => Math.hypot(a[o]!, a[o + 1]!, a[o + 2]!);
const dist = (a: ArrayLike<number>, b: ArrayLike<number>, ao = 0, bo = 0): number =>
  Math.hypot(a[ao]! - b[bo]!, a[ao + 1]! - b[bo + 1]!, a[ao + 2]! - b[bo + 2]!);

describe("low-g bounce", () => {
  it("ballistic apex g T^2 / 8 matches spec 4.1 rows", () => {
    expect(ballisticApex(1.62, 0.2)).toBeCloseTo(0.0081, 4);
    expect(ballisticApex(1.62, 0.45)).toBeCloseTo(0.041, 3);
    expect(ballisticApex(9.81, 0.14)).toBeCloseTo(0.024, 3);
  });
  it("bounce gain 1 / r^2 clamped [0.6, 1.6]", () => {
    expect(bounceGain(1)).toBe(1);
    expect(bounceGain(1.25)).toBeCloseTo(0.64);
    expect(bounceGain(0.75)).toBeCloseTo(1.6, 2);
    expect(bounceGain(2)).toBe(0.6);
    expect(bounceGain(0.5)).toBe(1.6);
  });
  it("step pelvis: stance dip, then a flight arc whose apex is g (T/r)^2 / 8", () => {
    // Lope step 0.6 s, flight 0.45 s at rate 1 -> apex 4.1 cm.
    let maxY = -1;
    let minY = 1;
    for (let u = 0; u < 1; u += 0.001) {
      const y = stepPelvisOffset(u, 0.6, 0.45, 0.065, 1, 1.62, 1);
      maxY = Math.max(maxY, y);
      minY = Math.min(minY, y);
    }
    expect(maxY).toBeCloseTo(ballisticApex(1.62, 0.45), 3);
    expect(minY).toBeCloseTo(-0.065, 3);
    // Rate 1.25 shortens the flight: apex scales by G = 1 / r^2.
    let maxFast = 0;
    for (let u = 0; u < 1; u += 0.001)
      maxFast = Math.max(maxFast, stepPelvisOffset(u, 0.6, 0.45, 0.065, 1.25, 1.62, 1));
    expect(maxFast / maxY).toBeCloseTo(bounceGain(1.25), 2);
    // Ballast (9.81) at the same timing bounces ~6x higher; exaggeration multiplies the arc only.
    expect(stepPelvisOffset(0.9, 0.6, 0.45, 0.065, 1, 1.62, 1.5)).toBeCloseTo(
      1.5 * stepPelvisOffset(0.9, 0.6, 0.45, 0.065, 1, 1.62, 1),
    );
  });
  it("shuffle has no flight", () => {
    for (let u = 0; u < 1; u += 0.01) expect(stepPelvisOffset(u, 0.42, 0, 0.03, 1, 1.62, 1)).toBeLessThanOrEqual(0);
  });
});

describe("landing", () => {
  it("classes from movement.json thresholds (no clip < 2.0)", () => {
    expect(landingClass(1.9, 3.2, 8)).toBe(LAND_NONE);
    expect(landingClass(2.28, 3.2, 8)).toBe(LAND_SOFT);
    expect(landingClass(5, 3.2, 8)).toBe(LAND_HARD);
    expect(landingClass(8, 3.2, 8)).toBe(LAND_HARD);
    expect(landingClass(8.1, 3.2, 8)).toBe(LAND_STUMBLE);
  });
  it("time to ground solves the ballistic quadratic", () => {
    const t = timeToGround(1.6, 0, 1.62);
    expect(t).toBeCloseTo(Math.sqrt((2 * 1.6) / 1.62), 6);
    expect(timeToGround(0, -1, 1.62)).toBe(0);
    // Rising: full arc time back to the ground.
    expect(timeToGround(1e-9, 2.28, 1.62)).toBeCloseTo((2 * 2.28) / 1.62, 3);
  });
  it("AN-M1-05: normal jump drops 10-16 cm within 150 ms and settles to +-1 cm in 0.45-0.70 s", () => {
    const c = new LandingCompression();
    c.trigger(2.28);
    const dt = 1 / 240;
    let minY = 0;
    let tMin = 0;
    let lastOut = 0;
    let maxOvershoot = 0;
    for (let t = dt; t < 1.5; t += dt) {
      c.update(dt);
      if (c.offset < minY) {
        minY = c.offset;
        tMin = t;
      }
      if (Math.abs(c.offset) > 0.01) lastOut = t;
      maxOvershoot = Math.max(maxOvershoot, c.offset);
    }
    expect(-minY).toBeGreaterThanOrEqual(0.1);
    expect(-minY).toBeLessThanOrEqual(0.16);
    expect(tMin).toBeLessThanOrEqual(0.15);
    expect(lastOut).toBeGreaterThanOrEqual(0.45);
    expect(lastOut).toBeLessThanOrEqual(0.7);
    // ~13 % overshoot.
    expect(maxOvershoot / -minY).toBeGreaterThan(0.1);
    expect(maxOvershoot / -minY).toBeLessThan(0.16);
    expect(c.active).toBe(false);
  });
  it("compression is frame-rate independent (closed form)", () => {
    const a = new LandingCompression();
    const b = new LandingCompression();
    a.trigger(5);
    b.trigger(5);
    for (let i = 0; i < 30; i++) a.update(1 / 60);
    for (let i = 0; i < 15; i++) b.update(1 / 30);
    expect(a.offset).toBeCloseTo(b.offset, 9);
  });
});

describe("two-bone IK", () => {
  const root = v3(0, 0.86, 0);
  const pole = v3(0, 0, 1);
  const mid = new Float64Array(3);
  const end = new Float64Array(3);
  it("reachable target: exact end, bone lengths preserved, knee bends toward the pole", () => {
    const target = v3(0.05, 0.2, 0.1);
    solveTwoBone(root, target, pole, 0.4, 0.38, mid, end);
    expect(dist(end, target)).toBeLessThan(1e-9);
    expect(dist(mid, root)).toBeCloseTo(0.4, 9);
    expect(dist(mid, end)).toBeCloseTo(0.38, 9);
    expect(mid[2]!).toBeGreaterThan(0.1);
  });
  it("out of reach: stretch capped at 0.999 x chain", () => {
    const r = solveTwoBone(root, v3(0, -2, 0), pole, 0.4, 0.38, mid, end);
    expect(r).toBeCloseTo(0.78 * 0.999, 9);
    expect(dist(mid, root)).toBeCloseTo(0.4, 9);
    expect(dist(mid, end)).toBeCloseTo(0.38, 9);
  });
  it("singular pole (parallel to the chain) and target on the root stay finite", () => {
    solveTwoBone(root, v3(0, 0.3, 0), v3(0, -1, 0), 0.4, 0.38, mid, end);
    for (const x of [...mid, ...end]) expect(Number.isFinite(x)).toBe(true);
    expect(dist(mid, root)).toBeCloseTo(0.4, 9);
    solveTwoBone(root, root, pole, 0.4, 0.38, mid, end);
    for (const x of [...mid, ...end]) expect(Number.isFinite(x)).toBe(true);
  });
  it("foot alignment clamps pitch +-30 and roll +-18 deg", () => {
    const o = new Float64Array(2);
    footAlignment(0, Math.cos(1), Math.sin(1), o, 0);
    expect(o[0]).toBeCloseTo((30 * Math.PI) / 180);
    footAlignment(-Math.sin(1), Math.cos(1), 0, o, 0);
    expect(o[1]).toBeCloseTo((-18 * Math.PI) / 180);
  });
  it("profile from a bind pose", () => {
    const p = profileFromBindPose("rig.test", {
      thigh_r: [-0.1, 0.86, 0],
      calf_r: [-0.1, 0.46, 0.01],
      foot_r: [-0.1, 0.095, 0],
      upperarm_r: [-0.2, 1.48, 0],
      forearm_r: [-0.4, 1.3, 0],
      hand_r: [-0.55, 1.08, 0],
    });
    expect(p.hipHeightM).toBeCloseTo(0.86);
    expect(p.thighM).toBeCloseTo(Math.hypot(0.4, 0.01));
  });
});

describe("sphere frame (pole singularities)", () => {
  const check = (f: SphereFrame): void => {
    expect(len(f.up)).toBeCloseTo(1, 9);
    expect(len(f.fwd)).toBeCloseTo(1, 9);
    expect(len(f.right)).toBeCloseTo(1, 9);
    expect(f.up[0]! * f.fwd[0]! + f.up[1]! * f.fwd[1]! + f.up[2]! * f.fwd[2]!).toBeCloseTo(0, 9);
  };
  it("exact pole with facing parallel to up uses a fallback, then transports", () => {
    const f = new SphereFrame();
    f.update(v3(0, R, 0), v3(0, 1, 0));
    check(f);
    const prev = Float64Array.from(f.fwd);
    f.update(v3(0, R, 0.001), v3(0, 1, 0));
    check(f);
    expect(prev[0]! * f.fwd[0]! + prev[1]! * f.fwd[1]! + prev[2]! * f.fwd[2]!).toBeGreaterThan(0.999);
  });
  it("+-89.9 deg latitude and crossing the pole along a meridian: continuous forward, no flips", () => {
    for (const sign of [1, -1]) {
      const f = new SphereFrame();
      let prev: Float64Array | null = null;
      for (let lat = 89.5; lat <= 90.5; lat += 0.0005) {
        const a = (lat * Math.PI) / 180;
        // Meridian in the x-y plane; over the pole the walker keeps heading the same way (toward -x after crossing).
        const pos = v3(Math.cos(a) * R, sign * Math.sin(a) * R, 0);
        const facing = v3(-Math.sin(a), sign * Math.cos(a), 0);
        f.update(pos, facing);
        check(f);
        if (prev !== null)
          expect(prev[0]! * f.fwd[0]! + prev[1]! * f.fwd[1]! + prev[2]! * f.fwd[2]!).toBeGreaterThan(0.999);
        prev = Float64Array.from(f.fwd);
      }
    }
  });
  it("right = fwd x up, yaw delta sign (+ = right turn)", () => {
    const f = new SphereFrame();
    f.update(v3(0, R, 0), v3(0, 0, 1));
    expect(f.right[0]).toBeCloseTo(-1);
    f.update(v3(0, R, 0), v3(-0.1, 0, 1));
    expect(f.yawDelta).toBeGreaterThan(0);
  });
});

/** A plane tilted by `slopeRad` rising toward +x (east) near the north pole. */
const slopeGround = (slopeRad: number): AnimGround =>
  batchedGround({ heightAtXYZ: (ux: number) => Math.tan(slopeRad) * ux * R });
const flat: AnimGround = batchedGround({ heightAtXYZ: () => 0 });

function standingLegs(leg: LegInput): void {
  for (let k = 0; k < 2; k++) {
    const side = k === 0 ? -1 : 1;
    leg.sole.set([side * 0.1, 0, 0], k * 3);
    leg.hip.set([side * 0.1, 0.86, 0], k * 3);
    leg.plant[k] = 1;
  }
  leg.weightCap = 1;
}

describe("foot IK on the sphere", () => {
  it("flat ground: soles on the ground (<= 1 cm), pelvis offset 0, 6 samples", () => {
    const f = new SphereFrame();
    const root = v3(0, R, 0);
    f.update(root, v3(0, 0, 1));
    const ik = new FootIk();
    const leg = new LegInput();
    standingLegs(leg);
    for (let i = 0; i < 30; i++) ik.solve(f, root, flat, R, PLACEHOLDER_RIG, leg, 1 / 60);
    expect(ik.samples).toBe(6);
    expect(Math.abs(ik.soleTarget[1]!)).toBeLessThan(0.01);
    expect(Math.abs(ik.soleTarget[4]!)).toBeLessThan(0.01);
    // Only the sphere's curvature under a 0.1 m stance (x^2 / 2R = 2.5 um).
    expect(Math.abs(ik.pelvisOffset)).toBeLessThan(1e-5);
    expect(ik.weight[0]).toBe(1);
  });
  it("20 deg slope (side-on): downhill foot reaches down, pelvis drops, ankle on target, slope stance applies", () => {
    const slope = (20 * Math.PI) / 180;
    const f = new SphereFrame();
    const root = v3(0, R, 0);
    // Facing +z: right is -x, so the right foot is downhill.
    f.update(root, v3(0, 0, 1));
    const ik = new FootIk();
    const leg = new LegInput();
    standingLegs(leg);
    for (let i = 0; i < 60; i++) ik.solve(f, root, slopeGround(slope), R, PLACEHOLDER_RIG, leg, 1 / 60);
    const hDown = -Math.tan(slope) * 0.1;
    expect(ik.groundH[1]).toBeCloseTo(hDown, 2);
    expect(ik.pelvisOffset).toBeCloseTo(hDown, 2);
    // Sole target on the ground under each foot (within 1 cm, AN-M1-03).
    expect(Math.abs(ik.soleTarget[4]! - ik.groundH[1]!)).toBeLessThan(0.01);
    // IK reached the ankle (no residual) and the knee keeps the bone lengths.
    expect(ik.lockDriftM[0]!).toBeLessThan(0.005);
    expect(ik.lockDriftM[1]!).toBeLessThan(0.005);
    expect(Math.abs(ik.slopeLean[1]!)).toBeGreaterThan(0);
    expect(Math.abs(ik.align[3]!)).toBeCloseTo((18 * Math.PI) / 180, 5);
  });
  it("steep 40 deg slope stays finite and clamps pelvis to [-0.35, 0.05]", () => {
    const f = new SphereFrame();
    const root = v3(0, R, 0);
    f.update(root, v3(0, 0, 1));
    const ik = new FootIk();
    const leg = new LegInput();
    standingLegs(leg);
    leg.sole[3] = 0.6; // wide stance on the downhill side
    for (let i = 0; i < 60; i++) ik.solve(f, root, slopeGround((40 * Math.PI) / 180), R, PLACEHOLDER_RIG, leg, 1 / 60);
    expect(ik.pelvisOffset).toBeGreaterThanOrEqual(-0.35);
    for (const x of [...ik.ankle, ...ik.knee]) expect(Number.isFinite(x)).toBe(true);
  });
  it("foot lock: planted foot stays fixed in world while the root moves; releases past 12 cm", () => {
    const f = new SphereFrame();
    const root = v3(0, R, 0);
    f.update(root, v3(0, 0, 1));
    const ik = new FootIk();
    const leg = new LegInput();
    standingLegs(leg);
    for (let i = 0; i < 10; i++) ik.solve(f, root, flat, R, PLACEHOLDER_RIG, leg, 1 / 60);
    expect(ik.locked[0]).toBe(1);
    const lockWorldZ = root[2]! + ik.soleTarget[2]!;
    // Root slides forward 5 cm without the clip moving the foot: the locked target compensates.
    root[2] = 0.05;
    f.update(root, v3(0, 0, 1));
    ik.solve(f, root, flat, R, PLACEHOLDER_RIG, leg, 1 / 60);
    expect(root[2]! + ik.soleTarget[2]!).toBeCloseTo(lockWorldZ, 4);
    root[2] = 0.2;
    f.update(root, v3(0, 0, 1));
    ik.solve(f, root, flat, R, PLACEHOLDER_RIG, leg, 1 / 60);
    expect(ik.locked[0]).toBe(0);
  });
  it("air: weight ramps to 0 over 60 ms", () => {
    const f = new SphereFrame();
    const root = v3(0, R, 0);
    f.update(root, v3(0, 0, 1));
    const ik = new FootIk();
    const leg = new LegInput();
    standingLegs(leg);
    for (let i = 0; i < 10; i++) ik.solve(f, root, flat, R, PLACEHOLDER_RIG, leg, 1 / 60);
    leg.weightCap = 0;
    ik.solve(f, root, flat, R, PLACEHOLDER_RIG, leg, 1 / 60);
    expect(ik.weight[0]).toBeGreaterThan(0.5);
    for (let i = 0; i < 4; i++) ik.solve(f, root, flat, R, PLACEHOLDER_RIG, leg, 1 / 60);
    expect(ik.weight[0]).toBe(0);
  });
});
