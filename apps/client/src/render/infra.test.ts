// Unit tests of the render-infra pure logic (M1-W2-T03): culling, LOD selection, draw budget, memory ledger, warm-up
// tracker and the frame-rate goal. No three, no DOM.

import { QUALITY_PRESETS } from "@moon-cleanup/shared";
import { describe, expect, it } from "vitest";
import {
  createCullCounts,
  CULL_BASE_DISTANCE_M,
  cullDistanceM,
  cullSpheres,
  HorizonCuller,
  projectedSizePx,
  selectLod,
  SideFrustum,
} from "./culling";
import { DrawBudgetCounter } from "./draw-budget";
import { FRAME_TARGET_FPS, frameTargetFor, parseFrameTarget, type FrameTarget } from "./frame-target";
import { GpuMemoryLedger, MEMORY_BUDGET_MB, MEMORY_CATEGORIES, textureBytes } from "./memory-ledger";
import { PipelineWarmup, warmupBudgetMs } from "./warmup";

const MOON_R = 2000;

describe("cull distances (rendering-pipeline 10.1)", () => {
  it("scales the base distances by the preset multiplier", () => {
    expect(cullDistanceM("prop", QUALITY_PRESETS.low)).toBeCloseTo(150 * 0.6);
    expect(cullDistanceM("prop", QUALITY_PRESETS.medium)).toBeCloseTo(150 * 0.8);
    expect(cullDistanceM("puck", QUALITY_PRESETS.high)).toBeCloseTo(CULL_BASE_DISTANCE_M.puck);
    expect(cullDistanceM("build", QUALITY_PRESETS.ultra)).toBeCloseTo(400 * 1.3);
  });

  it("robots use the distance the preset states", () => {
    expect(cullDistanceM("robot", QUALITY_PRESETS.low)).toBe(QUALITY_PRESETS.low.distances.robotRenderM);
    expect(cullDistanceM("robot", QUALITY_PRESETS.medium)).toBe(QUALITY_PRESETS.medium.distances.robotRenderM);
  });
});

describe("HorizonCuller", () => {
  /** Point on the sphere of radius `r` at arc angle `phi` from the +Y pole, toward +X. */
  const onSphere = (r: number, phi: number): [number, number, number] => [r * Math.sin(phi), r * Math.cos(phi), 0];

  it("puts the horizon 82.5 m from an eye 1.7 m above a 2 km moon", () => {
    const h = new HorizonCuller();
    h.setCamera(0, MOON_R + 1.7, 0, MOON_R);
    expect(h.horizonDistanceM).toBeCloseTo(82.5, 0);
  });

  it("keeps everything on the near side of the horizon and hides small objects well beyond it", () => {
    const h = new HorizonCuller();
    h.setCamera(0, MOON_R + 1.7, 0, MOON_R);
    // Arc distance = R * phi. Horizon at 82.5 m; x metres beyond it the sight line is x^2 / 2R above the ground, so a
    // 1 m object is still visible 130 m out (0.56 m) and hidden 200 m out (3.5 m).
    for (const arcM of [1, 20, 60, 80]) {
      const [x, y, z] = onSphere(MOON_R + 0.5, arcM / MOON_R);
      expect(h.isHidden(x, y, z, 0.5)).toBe(false);
    }
    for (const arcM of [200, 300, 2000, 6000]) {
      const [x, y, z] = onSphere(MOON_R + 0.5, arcM / MOON_R);
      expect(h.isHidden(x, y, z, 0.5)).toBe(true);
    }
  });

  it("is conservative: a tall object beyond the horizon stays while its top can show", () => {
    const h = new HorizonCuller();
    h.setCamera(0, MOON_R + 1.7, 0, MOON_R);
    // 165 m away an object must rise h = R / cos(phi - phi_h) - R above the ground to reach the sight line: about 1.7 m.
    const [x, y, z] = onSphere(MOON_R + 6, 165 / MOON_R);
    expect(h.isHidden(x, y, z, 6)).toBe(false);
    const [fx, fy, fz] = onSphere(MOON_R + 6, 400 / MOON_R);
    expect(h.isHidden(fx, fy, fz, 6)).toBe(true);
  });

  it("never hides a sphere a brute-force ray test can see", () => {
    const h = new HorizonCuller();
    const cam: [number, number, number] = [0, MOON_R + 40, 0];
    h.setCamera(cam[0], cam[1], cam[2], MOON_R);
    // Ray from the camera to the sphere's top-most point (toward the camera's up): hits the moon first?
    const blocked = (px: number, py: number, pz: number): boolean => {
      const dx = px - cam[0];
      const dy = py - cam[1];
      const dz = pz - cam[2];
      const a = dx * dx + dy * dy + dz * dz;
      const b = 2 * (cam[0] * dx + cam[1] * dy + cam[2] * dz);
      const c = cam[0] * cam[0] + cam[1] * cam[1] + cam[2] * cam[2] - MOON_R * MOON_R;
      const disc = b * b - 4 * a * c;
      if (disc <= 0) return false;
      const t = (-b - Math.sqrt(disc)) / (2 * a);
      return t > 0 && t < 1;
    };
    let hidden = 0;
    for (let i = 0; i < 400; i++) {
      const phi = (i / 400) * Math.PI;
      const r = 1 + (i % 7);
      const [x, y, z] = onSphere(MOON_R + r, phi);
      if (!h.isHidden(x, y, z, r)) continue;
      hidden += 1;
      // Every sampled point of a hidden sphere must be blocked.
      for (let k = 0; k < 8; k++) {
        const ang = (k / 8) * 2 * Math.PI;
        expect(blocked(x + r * Math.cos(ang), y + r * Math.sin(ang), z)).toBe(true);
      }
    }
    expect(hidden).toBeGreaterThan(300);
  });

  it("culls nothing from inside the occluder", () => {
    const h = new HorizonCuller();
    h.setCamera(0, MOON_R - 5, 0, MOON_R);
    expect(h.isHidden(0, -MOON_R, 0, 1)).toBe(false);
    expect(h.horizonDistanceM).toBe(0);
  });
});

describe("SideFrustum and cullSpheres", () => {
  /** Column-major perspective x identity view: camera at the origin looking down -Z, 90 degree fov, aspect 1. */
  const perspective = (): number[] => {
    const f = 1;
    const near = 0.1;
    const far = 1000;
    return [f, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) / (near - far), -1, 0, 0, (2 * far * near) / (near - far), 0];
  };

  it("accepts what is inside the side planes and rejects what is beside them", () => {
    const frustum = new SideFrustum();
    frustum.setFromMatrix(perspective());
    expect(frustum.intersectsSphere(0, 0, -10, 1)).toBe(true);
    expect(frustum.intersectsSphere(9, 0, -10, 1)).toBe(true);
    expect(frustum.intersectsSphere(20, 0, -10, 1)).toBe(false);
    expect(frustum.intersectsSphere(0, -20, -10, 1)).toBe(false);
    // Touching the plane from outside by less than its radius still counts.
    expect(frustum.intersectsSphere(11, 0, -10, 1)).toBe(true);
    // Behind the camera: outside both left and right.
    expect(frustum.intersectsSphere(0, 0, 10, 1)).toBe(false);
  });

  it("counts each reject once, cheapest test first, and allocates no result objects", () => {
    const frustum = new SideFrustum();
    frustum.setFromMatrix(perspective());
    const spheres = new Float32Array([0, 0, -10, 1, 0, 0, -500, 1, 30, 0, -10, 1, 0, 0, -50, 1]);
    const visible = new Uint8Array(4);
    const counts = createCullCounts();
    const n = cullSpheres(spheres, 4, 0, 0, 0, 100, null, frustum, visible, counts);
    expect(n).toBe(2);
    expect(Array.from(visible)).toEqual([1, 0, 0, 1]);
    expect(counts).toEqual({ visible: 2, distance: 1, horizon: 0, frustum: 1 });
  });

  it("applies the horizon test between distance and frustum", () => {
    const horizon = new HorizonCuller();
    horizon.setCamera(0, MOON_R + 1.7, 0, MOON_R);
    const phi = 250 / MOON_R;
    const spheres = new Float32Array([
      (MOON_R + 0.5) * Math.sin(phi),
      (MOON_R + 0.5) * Math.cos(phi),
      0,
      0.5,
      3,
      MOON_R + 0.5,
      0,
      0.5,
    ]);
    const visible = new Uint8Array(2);
    const counts = createCullCounts();
    cullSpheres(spheres, 2, 0, MOON_R + 1.7, 0, 400, horizon, null, visible, counts);
    expect(Array.from(visible)).toEqual([0, 1]);
    expect(counts.horizon).toBe(1);
  });
});

describe("LOD selection (10 % hysteresis)", () => {
  const thresholds = [200, 60];

  it("projects a bounding sphere to output pixels", () => {
    // 1 m radius at 10 m with a 90 degree vertical fov on 720 px: 1 / (10 * tan 45) * 720 = 72 px.
    expect(projectedSizePx(1, 10, Math.PI / 2, 720)).toBeCloseTo(72);
    expect(projectedSizePx(1, 0.5, Math.PI / 2, 720)).toBe(720);
  });

  it("picks the ideal LOD on a first selection", () => {
    expect(selectLod(-1, 500, thresholds)).toBe(0);
    expect(selectLod(-1, 100, thresholds)).toBe(1);
    expect(selectLod(-1, 10, thresholds)).toBe(2);
  });

  it("holds the current LOD inside the hysteresis band on both sides", () => {
    // Around the 200 px threshold: finer needs >= 220, coarser needs < 180.
    expect(selectLod(1, 210, thresholds)).toBe(1);
    expect(selectLod(1, 221, thresholds)).toBe(0);
    expect(selectLod(0, 190, thresholds)).toBe(0);
    expect(selectLod(0, 179, thresholds)).toBe(1);
  });

  it("does not flicker when the size oscillates around a threshold", () => {
    let lod = selectLod(-1, 205, thresholds);
    let switches = 0;
    for (let i = 0; i < 200; i++) {
      const next = selectLod(lod, i % 2 === 0 ? 195 : 205, thresholds);
      if (next !== lod) switches += 1;
      lod = next;
    }
    expect(switches).toBe(0);
  });

  it("crosses several levels at once when the size jumps, and applies the preset multiplier", () => {
    expect(selectLod(2, 500, thresholds)).toBe(0);
    expect(selectLod(0, 10, thresholds)).toBe(2);
    // Medium multiplier 0.8: 240 px counts as 192 px.
    expect(selectLod(-1, 240, thresholds, 0.8)).toBe(1);
  });
});

describe("DrawBudgetCounter (350 on Low / Medium, 600 on High / Ultra)", () => {
  it("takes the ceilings from the preset", () => {
    const counter = new DrawBudgetCounter();
    counter.setBudget(QUALITY_PRESETS.medium.budgets);
    expect(counter.state.budgetDrawCalls).toBe(350);
    counter.setBudget(QUALITY_PRESETS.high.budgets);
    expect(counter.state.budgetDrawCalls).toBe(600);
  });

  it("flags frames over either ceiling and keeps the peaks", () => {
    const counter = new DrawBudgetCounter();
    counter.setBudget(QUALITY_PRESETS.medium.budgets);
    counter.record(294, 518_919);
    expect(counter.state.over).toBe(false);
    counter.record(351, 500_000);
    expect(counter.state.over).toBe(true);
    counter.record(100, 1_500_001);
    expect(counter.state.over).toBe(true);
    counter.record(100, 100);
    expect(counter.state).toMatchObject({ over: false, frames: 4, overFrames: 2, peakDrawCalls: 351 });
    counter.reset();
    expect(counter.state).toMatchObject({ frames: 0, overFrames: 0, peakDrawCalls: 0, budgetDrawCalls: 350 });
  });
});

describe("GpuMemoryLedger (rendering-pipeline 13)", () => {
  it("sums per category and follows add, resize and remove", () => {
    const ledger = new GpuMemoryLedger();
    const scene = ledger.add("render", "renderTargets", "scene pass", textureBytes(1088, 612, 8 + 4));
    const cube = ledger.add("terrain", "terrainDust", "height cube", 16.7 * 1024 * 1024);
    expect(ledger.bytesIn("renderTargets")).toBe(1088 * 612 * 12);
    ledger.resize(scene, textureBytes(768, 432, 12));
    expect(ledger.bytesIn("renderTargets")).toBe(768 * 432 * 12);
    expect(ledger.totals.entries).toBe(2);
    expect(ledger.totals.totalBytes).toBe(768 * 432 * 12 + Math.round(16.7 * 1024 * 1024));
    ledger.remove(cube);
    ledger.remove(cube);
    expect(ledger.bytesIn("terrainDust")).toBe(0);
    expect(ledger.list().map((e) => e.label)).toEqual(["scene pass"]);
  });

  it("judges each category against the preset's budget", () => {
    const ledger = new GpuMemoryLedger();
    ledger.setPreset("low");
    ledger.add("visuals", "shadowMaps", "cascades", 10 * 1024 * 1024);
    expect(ledger.isOver("shadowMaps")).toBe(true);
    expect(ledger.totals.overCategories).toBe(1);
    ledger.setPreset("medium");
    expect(ledger.isOver("shadowMaps")).toBe(false);
    expect(ledger.totals.overCategories).toBe(0);
  });

  it("carries the section 13 totals", () => {
    const total = (preset: keyof typeof MEMORY_BUDGET_MB): number =>
      MEMORY_CATEGORIES.reduce((sum, c) => sum + MEMORY_BUDGET_MB[preset][c], 0);
    // About 0.69 / 0.87 / 2.15 / 3.94 GB.
    expect(total("low") / 1000).toBeCloseTo(0.69, 1);
    expect(total("medium") / 1000).toBeCloseTo(0.87, 1);
    expect(total("high") / 1000).toBeCloseTo(2.15, 1);
    expect(total("ultra") / 1000).toBeCloseTo(3.94, 1);
  });

  it("sizes textures with mips and layers", () => {
    expect(textureBytes(1024, 1024, 4)).toBe(4 * 1024 * 1024);
    expect(textureBytes(1024, 1024, 4, { layers: 3 })).toBe(12 * 1024 * 1024);
    expect(textureBytes(512, 512, 4, { mips: true })).toBe(Math.ceil((512 * 512 * 4 * 4) / 3));
  });

  it("the totals read-out allocates nothing", () => {
    const ledger = new GpuMemoryLedger();
    ledger.add("a", "geometry", "g", 100);
    expect(ledger.totals).toBe(ledger.totals);
  });
});

describe("PipelineWarmup (rendering-pipeline 12)", () => {
  it("is ready once the pipeline count stood still, and reports pipelinesReadyMs", () => {
    const warmup = new PipelineWarmup();
    warmup.begin("boot", 1000);
    const counts = [12, 30, 41, 41, 41, 41];
    const done = counts.map((c, i) => warmup.frame(c, 1000 + (i + 1) * 100));
    expect(done).toEqual([false, false, false, false, false, true]);
    expect(warmup.state).toMatchObject({
      phase: "ready",
      completed: 1,
      pipelinesReadyMs: 600,
      lastFrames: 6,
      timedOut: false,
      pipelinesAtReady: 41,
      pipelinesAfterWarmup: 0,
    });
  });

  it("counts every pipeline created after warm-up", () => {
    const warmup = new PipelineWarmup();
    warmup.begin("boot", 0);
    for (let i = 0; i < 5; i++) warmup.frame(20, i * 16);
    expect(warmup.state.phase).toBe("ready");
    warmup.frame(20, 100);
    warmup.frame(23, 116);
    warmup.frame(23, 132);
    warmup.frame(24, 148);
    expect(warmup.state.pipelinesAfterWarmup).toBe(4);
    expect(warmup.state.runtimeCreationFrames).toBe(2);
  });

  it("a new warm-up (preset change) absorbs its pipelines and resets the runtime count", () => {
    const warmup = new PipelineWarmup();
    warmup.begin("boot", 0);
    for (let i = 0; i < 5; i++) warmup.frame(20, i * 16);
    warmup.frame(22, 200);
    expect(warmup.state.pipelinesAfterWarmup).toBe(2);
    expect(warmup.begin("preset", 300)).toBe(true);
    expect(warmup.begin("stages", 301)).toBe(false);
    for (let i = 0; i < 5; i++) warmup.frame(i === 0 ? 31 : 35, 316 + i * 16);
    expect(warmup.state).toMatchObject({ phase: "ready", reason: "preset", completed: 2, pipelinesAfterWarmup: 0 });
    // The boot value is kept as the telemetry number.
    expect(warmup.state.pipelinesReadyMs).toBeLessThan(100);
  });

  it("gives up on the time cap instead of blocking play", () => {
    const warmup = new PipelineWarmup({ minFrames: 2, stableFrames: 3, maxMs: 500, maxHeldMs: 5000 });
    warmup.begin("boot", 0);
    let done = false;
    for (let i = 1; i <= 40 && !done; i++) done = warmup.frame(i, i * 16);
    expect(done).toBe(true);
    expect(warmup.state.timedOut).toBe(true);
    expect(warmup.state.lastMs).toBeGreaterThanOrEqual(500);
  });

  it("a hold keeps the warm-up open while content loads; the count must stand still again after the release", () => {
    const warmup = new PipelineWarmup({ minFrames: 2, stableFrames: 3, maxMs: 500, maxHeldMs: 5000 });
    warmup.begin("boot", 0);
    expect(warmup.hold(0)).toBe(false);
    // 2 s of an empty scene with a still count: no settle, and no time cap (it counts from the release).
    for (let t = 16; t <= 2000; t += 16) expect(warmup.frame(29, t)).toBe(false);
    expect(warmup.state).toMatchObject({ phase: "warming", holds: 1 });
    warmup.release(2000);
    warmup.release(2000); // An extra release is ignored.
    expect(warmup.state.holds).toBe(0);
    // The terrain draws from the next frame: 8 more pipelines, then still.
    const done = [37, 37, 37, 37].map((c, i) => warmup.frame(c, 2016 + i * 16));
    expect(done).toEqual([false, false, false, true]);
    expect(warmup.state).toMatchObject({ phase: "ready", timedOut: false, pipelinesAtReady: 37 });
    expect(warmup.state.pipelinesReadyMs).toBeGreaterThan(2000);
  });

  it("a hold taken after warm-up starts a new one; a forgotten hold ends on maxHeldMs", () => {
    const warmup = new PipelineWarmup({ minFrames: 2, stableFrames: 3, maxMs: 500, maxHeldMs: 3000 });
    warmup.begin("boot", 0);
    for (let i = 1; i <= 5; i++) warmup.frame(20, i * 16);
    expect(warmup.state.phase).toBe("ready");
    expect(warmup.hold(100)).toBe(true);
    expect(warmup.state).toMatchObject({ phase: "warming", reason: "request" });
    let done = false;
    let t = 100;
    while (!done && t < 10_000) done = warmup.frame(20, (t += 16));
    expect(done).toBe(true);
    expect(warmup.state.timedOut).toBe(true);
    expect(t - 100).toBeGreaterThanOrEqual(3000);
    expect(t - 100).toBeLessThan(3100);
  });

  it("a forgotten hold is dropped on the held time-out: later warm-ups settle, its late release is a no-op", () => {
    const warmup = new PipelineWarmup({ minFrames: 2, stableFrames: 3, maxMs: 500, maxHeldMs: 3000 });
    warmup.hold(0);
    const leakedGeneration = warmup.holdGeneration;
    let t = 0;
    while (!warmup.frame(10, (t += 16)) && t < 10_000);
    expect(warmup.state).toMatchObject({ phase: "ready", timedOut: true, holds: 0 });
    expect(warmup.holdGeneration).toBe(leakedGeneration + 1);

    // A preset warm-up with a stable count settles on the count, not on maxHeldMs.
    const start = t;
    warmup.begin("preset", t);
    while (!warmup.frame(10, (t += 16)) && t < 20_000);
    expect(warmup.state.timedOut).toBe(false);
    expect(t - start).toBeLessThan(200);

    // A new owner's hold is not cancelled by the stale release of the dropped one.
    warmup.hold(t);
    const current = warmup.holdGeneration;
    warmup.release(t, leakedGeneration);
    expect(warmup.state.holds).toBe(1);
    warmup.release(t, current);
    expect(warmup.state.holds).toBe(0);
  });

  it("restart (renderer recreated): the clock, cap and stable run start over; holds stay out", () => {
    const warmup = new PipelineWarmup({ minFrames: 2, stableFrames: 3, maxMs: 500, maxHeldMs: 3000 });
    warmup.begin("boot", 0);
    warmup.frame(10, 16);
    // 2 s of recovery with no frames, then the new renderer: without a restart the first frame times out.
    warmup.restart(2000);
    expect(warmup.frame(4, 2016)).toBe(false);
    expect(warmup.state.phase).toBe("warming");
    let t = 2016;
    while (!warmup.frame(4, (t += 16)) && t < 4000);
    expect(warmup.state).toMatchObject({ phase: "ready", timedOut: false });
    expect(warmup.state.lastMs).toBeLessThan(200);

    // Holds survive a restart and still wait out maxHeldMs from the restart.
    const held = new PipelineWarmup({ minFrames: 2, stableFrames: 3, maxMs: 500, maxHeldMs: 3000 });
    held.hold(0);
    held.restart(2900);
    expect(held.frame(4, 2916)).toBe(false);
    expect(held.state.holds).toBe(1);
    expect(held.frame(4, 5800)).toBe(false);
    expect(held.frame(4, 5950)).toBe(true);
    expect(held.state).toMatchObject({ timedOut: true, holds: 0 });

    // Ready or idle: the stale pipeline count of the lost renderer is forgotten, no phantom runtime creation.
    const ready = new PipelineWarmup({ minFrames: 1, stableFrames: 1, maxMs: 500, maxHeldMs: 3000 });
    ready.begin("boot", 0);
    ready.frame(30, 16);
    ready.frame(30, 32);
    expect(ready.state.phase).toBe("ready");
    ready.restart(100);
    ready.frame(40, 116);
    expect(ready.state.pipelinesAfterWarmup).toBe(0);
  });

  it("budget: 4 s on Tier A, 8 s otherwise", () => {
    expect(warmupBudgetMs("A")).toBe(4000);
    expect(warmupBudgetMs("B")).toBe(8000);
    expect(warmupBudgetMs("C")).toBe(8000);
  });
});

describe("frame-rate goal", () => {
  const out: FrameTarget = { targetFps: 0, gpuBudgetMs: 0 };

  it("steers Low and Medium to 60 fps and a 14 ms GPU budget", () => {
    expect(frameTargetFor(QUALITY_PRESETS.medium.dynres, null, out)).toEqual({ targetFps: 60, gpuBudgetMs: 14 });
    expect(frameTargetFor(QUALITY_PRESETS.low.dynres, null, out)).toEqual({
      targetFps: FRAME_TARGET_FPS,
      gpuBudgetMs: 14,
    });
  });

  it("leaves presets that already meet the goal as the contract has them", () => {
    const high = QUALITY_PRESETS.high.dynres;
    expect(frameTargetFor(high, null, out)).toEqual({
      targetFps: Math.max(60, high.targetFps),
      gpuBudgetMs: Math.min(14, high.gpuBudgetMs),
    });
  });

  it("?fps=contract restores the contract; ?fps=<n> sets another goal", () => {
    expect(parseFrameTarget("?fps=contract")).toBe("contract");
    expect(parseFrameTarget("?fps=30")).toBe(30);
    expect(parseFrameTarget("?fps=5")).toBeNull();
    expect(parseFrameTarget("?fps=")).toBeNull();
    expect(parseFrameTarget("")).toBeNull();
    expect(frameTargetFor(QUALITY_PRESETS.medium.dynres, "contract", out)).toEqual({ targetFps: 30, gpuBudgetMs: 28 });
    expect(frameTargetFor(QUALITY_PRESETS.medium.dynres, 30, out)).toEqual({ targetFps: 30, gpuBudgetMs: 28 });
    expect(frameTargetFor(QUALITY_PRESETS.medium.dynres, 120, out)).toEqual({ targetFps: 120, gpuBudgetMs: 7 });
  });

  it("writes the caller's object", () => {
    expect(frameTargetFor(QUALITY_PRESETS.medium.dynres, null, out)).toBe(out);
  });
});
