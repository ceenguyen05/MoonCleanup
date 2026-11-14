// Pure logic of the bench scene (M0-W2-T02): options, cascade splits, draw calibration, camera paths, terrain data.

import { describe, expect, it } from "vitest";
import { QUALITY_PRESETS } from "@moon-cleanup/shared";
import { benchPathSpec, p1Pose, p3Pose, P1_PERIOD_S, P3_PERIOD_S, type PathPose } from "./camera-paths";
import { cascadeEndsM, CSM_LAMBDA, makeSplitsCallback } from "./csm-splits";
import { DrawCalibrator } from "./draw-calibration";
import { BENCH_DEFAULT_DRAWS, BENCH_MAX_DRAWS, parseBenchOptions } from "./options";
import {
  CHUNK_EDGES_M,
  chunkRects,
  groundY,
  rasterizeDust,
  surfacePoint,
  terrainHeightM,
  type Stroke,
} from "./terrain-data";

describe("parseBenchOptions", () => {
  it("defaults", () => {
    expect(parseBenchOptions("?scene=bench")).toMatchObject({
      draws: BENCH_DEFAULT_DRAWS,
      path: null,
      animate: true,
      zFightProbe: false,
      debugView: 0,
    });
  });
  it("reads draws, path, anim and probe; clamps draws", () => {
    expect(parseBenchOptions("?draws=600&path=P3&anim=0&probe=zfight")).toMatchObject({
      draws: 600,
      path: "p3",
      animate: false,
      zFightProbe: true,
      debugView: 0,
    });
    expect(parseBenchOptions("?draws=99999").draws).toBe(BENCH_MAX_DRAWS);
    expect(parseBenchOptions("?draws=-5").draws).toBe(0);
    expect(parseBenchOptions("?draws=abc").draws).toBe(BENCH_DEFAULT_DRAWS);
    expect(parseBenchOptions("?path=zzz").path).toBeNull();
  });
});

describe("cascade splits", () => {
  it("ends at cascade 0 split and the max far, ascending, for every preset", () => {
    for (const preset of Object.values(QUALITY_PRESETS)) {
      const { cascades, cascade0SplitM, maxFarM } = preset.shadows;
      const ends = cascadeEndsM(cascades, cascade0SplitM, maxFarM, CSM_LAMBDA);
      expect(ends).toHaveLength(cascades);
      expect(ends[0]).toBe(cascade0SplitM);
      expect(ends[cascades - 1]).toBe(maxFarM);
      for (let i = 1; i < ends.length; i++) expect(ends[i]).toBeGreaterThan(ends[i - 1] ?? 0);
    }
  });
  it("practical lambda 0.75 puts cascade 1 between uniform and logarithmic", () => {
    const [, c1] = cascadeEndsM(3, 10, 120, CSM_LAMBDA);
    const uniform = 10 + (120 - 10) * 0.5;
    const logarithmic = 10 * Math.pow(12, 0.5);
    expect(c1).toBeGreaterThan(Math.min(uniform, logarithmic));
    expect(c1).toBeLessThan(Math.max(uniform, logarithmic));
  });
  it("callback fills fractions of far, last equal to 1", () => {
    const target: number[] = [];
    makeSplitsCallback(10, CSM_LAMBDA)(3, 0.05, 120, target);
    expect(target).toHaveLength(3);
    expect(target[0]).toBeCloseTo(10 / 120);
    expect(target[2]).toBe(1);
  });
  it("rejects nonsense", () => {
    expect(() => cascadeEndsM(0, 10, 100, 0.75)).toThrow(RangeError);
    expect(() => cascadeEndsM(3, 100, 10, 0.75)).toThrow(RangeError);
  });
});

describe("DrawCalibrator", () => {
  // A scene with `base` draws plus `per` draws per filler, observed one frame late like the module's stats.
  function run(target: number, base: number, per: number, maxFillers: number) {
    const c = new DrawCalibrator({ target, maxFillers, lagFrames: 1 });
    let fillers = 0;
    let measured = base;
    for (let frame = 0; frame < 200 && !c.settled; frame++) {
      fillers = c.next(measured);
      measured = base + fillers * per;
    }
    return { c, draws: base + fillers * per };
  }
  it("reaches the target exactly with 1 draw per filler", () => {
    for (const target of [200, 350, 600, 900]) {
      const r = run(target, 180, 1, 1600);
      expect(r.c.settled).toBe(true);
      expect(r.draws).toBe(target);
    }
  });
  it("reaches the target with 2 draws per filler (prepass)", () => {
    const r = run(600, 200, 2, 1600);
    expect(r.draws).toBe(600);
  });
  it("stops at zero when the base already exceeds the target", () => {
    const r = run(200, 350, 1, 1600);
    expect(r.c.settled).toBe(true);
    expect(r.c.fillers).toBe(0);
  });
  it("stops at the pool limit", () => {
    const r = run(900, 100, 1, 300);
    expect(r.c.settled).toBe(true);
    expect(r.c.fillers).toBe(300);
  });
});

describe("camera paths", () => {
  const a: PathPose = { px: 0, py: 0, pz: 0, tx: 0, ty: 0, tz: 0 };
  const b: PathPose = { px: 0, py: 0, pz: 0, tx: 0, ty: 0, tz: 0 };
  it("P1 keeps eye height above the ground and is deterministic", () => {
    for (let t = 0; t < P1_PERIOD_S; t += 3.3) {
      p1Pose(t, groundY, a);
      p1Pose(t, groundY, b);
      expect(a).toEqual(b);
      expect(a.py - groundY(a.px, a.pz)).toBeCloseTo(1.7, 6);
    }
  });
  it("P1 and P3 close their loops", () => {
    p1Pose(0, groundY, a);
    p1Pose(P1_PERIOD_S, groundY, b);
    expect(b.px).toBeCloseTo(a.px, 6);
    expect(b.pz).toBeCloseTo(a.pz, 6);
    p3Pose(0, groundY, a);
    p3Pose(P3_PERIOD_S, groundY, b);
    expect(b.px).toBeCloseTo(a.px, 6);
    expect(b.py).toBeCloseTo(a.py, 6);
  });
  it("P3 pan looks up into the sky", () => {
    p3Pose(P3_PERIOD_S - 10, groundY, a);
    expect(a.ty).toBeGreaterThan(a.py + 50);
  });
  it("spec keys are strictly increasing and loop", () => {
    for (const id of ["p1", "p3"] as const) {
      const spec = benchPathSpec(id, groundY);
      expect(spec.loop).toBe(true);
      expect(spec.keys.length).toBeGreaterThan(10);
      for (let i = 1; i < spec.keys.length; i++) {
        expect(spec.keys[i]?.t).toBeGreaterThan(spec.keys[i - 1]?.t ?? 0);
      }
    }
  });
});

describe("terrain data", () => {
  it("lays out 64 chunks tiling the patch without gaps or overlap", () => {
    const rects = chunkRects();
    expect(rects).toHaveLength(64);
    const span = (CHUNK_EDGES_M[CHUNK_EDGES_M.length - 1] ?? 0) - (CHUNK_EDGES_M[0] ?? 0);
    const area = rects.reduce((sum, r) => sum + (r.x1 - r.x0) * (r.z1 - r.z0), 0);
    expect(area).toBeCloseTo(span * span, 3);
    expect(rects.filter((r) => r.castsShadow).length).toBe(36);
  });
  it("the origin sits on the pad and the sphere falls away with distance", () => {
    const p = { x: 0, y: 0, z: 0 };
    surfacePoint(0, 0, 0, p);
    expect(p.y).toBeCloseTo(0, 9);
    expect(terrainHeightM(0, 0)).toBeCloseTo(0, 9);
    surfacePoint(500, 0, 0, p);
    expect(Math.hypot(p.x, p.y + 2000, p.z)).toBeCloseTo(2000, 6);
    expect(p.y).toBeLessThan(-50);
    expect(groundY(0, 0)).toBeCloseTo(0, 9);
  });
  it("rasterizes a stroke: clean centre, grimy outside, berm on the edge, order-independent", () => {
    const s1: Stroke = { ax: -4, az: 0, bx: 4, bz: 0, width: 1, strength: 1 };
    const s2: Stroke = { ax: 0, az: -4, bx: 0, bz: 4, width: 1, strength: 0.6 };
    const size = 128;
    const half = 8;
    const one = rasterizeDust(size, half, [s1, s2]);
    const two = rasterizeDust(size, half, [s2, s1]);
    expect(Array.from(one.rgba)).toEqual(Array.from(two.rgba));
    const at = (x: number, z: number): number =>
      Math.floor(((z + half) / (2 * half)) * size) * size + Math.floor(((x + half) / (2 * half)) * size);
    expect(one.rgba[at(-2, 0) * 4]).toBe(0);
    expect(one.rgba[at(-6, 0) * 4]).toBe(255);
    // The second stroke only thins: 40 % of the dust remains where it is the only pass.
    expect(one.rgba[at(0, 3) * 4]).toBe(Math.round(255 * 0.4));
    expect(one.rgba[at(-2, 0.65) * 4 + 3]).toBeGreaterThan(0);
    expect(one.direction[at(-2, 0)]).toBeGreaterThan(0);
  });
  it("a stroke narrower than a texel stays a faint continuous line", () => {
    const size = 64;
    const half = 8; // texel 0.25 m
    const img = rasterizeDust(size, half, [{ ax: -6, az: 0.1, bx: 6, bz: 0.1, width: 0.15, strength: 1 }]);
    const row = Math.floor(((0.1 + half) / (2 * half)) * size);
    for (let x = 8; x < 56; x++) expect(img.rgba[(row * size + x) * 4]).toBeLessThan(255);
  });
});
