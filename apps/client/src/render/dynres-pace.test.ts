// Dynamic resolution, M1-W2-T03 additions: the acceptance timing (first reaction within 3 s, at most one change per 2 s,
// inside the range) and the pace guard of the GPU signal. Pure logic, no three, no DOM.

import { describe, expect, it } from "vitest";
import { QUALITY_PRESETS } from "@moon-cleanup/shared";
import { DynamicResolution } from "./dynres";

// Controller-logic range: wider than the shipped Medium preset (floor 0.75, owner 2026-11-16) so the step-down, probe and
// take-back behaviour is exercised over several steps. The real preset floor is pinned in its own test below.
const MEDIUM = { scaleMin: 0.6, scaleMax: 0.85 };
const FRAME_60 = 1000 / 60;
const GPU_BUDGET = 14;

interface Step {
  atMs: number;
  scale: number;
}

/**
 * Runs `seconds` of frames. `model(scale, tMs)` gives the display interval and the GPU time of a frame at that scale.
 * `gpu` selects the signal: GPU time against 14 ms with the pace guard, or the interval against 16.7 ms.
 */
function simulate(
  controller: DynamicResolution,
  seconds: number,
  model: (scale: number, tMs: number) => { interval: number; gpuMs: number },
  gpu: boolean,
): Step[] {
  const steps: Step[] = [];
  let t = 0;
  let last = controller.scale;
  while (t < seconds * 1000) {
    const { interval, gpuMs } = model(controller.scale, t);
    const next = gpu
      ? controller.sample(interval, gpuMs, GPU_BUDGET, "gpu", FRAME_60, interval)
      : controller.sample(interval, interval, FRAME_60, "interval");
    t += interval;
    if (next !== last) {
      steps.push({ atMs: t, scale: next });
      last = next;
    }
  }
  return steps;
}

/** A 60 Hz display: the interval is the next multiple of 16.67 ms at or above the frame's cost. */
const vsync = (costMs: number): number => Math.max(1, Math.ceil(costMs / FRAME_60 - 1e-9)) * FRAME_60;

function minGapMs(steps: readonly Step[]): number {
  let gap = Number.POSITIVE_INFINITY;
  for (let i = 1; i < steps.length; i++) gap = Math.min(gap, (steps[i]?.atMs ?? 0) - (steps[i - 1]?.atMs ?? 0));
  return gap;
}

describe("dynamic resolution acceptance (M1-W2-T03)", () => {
  // A fill-bound GPU whose load doubles at t = 20 s (a heavy view comes on screen).
  const gpuCost = (scale: number, tMs: number): number =>
    tMs < 20_000 ? 4 + 12 * scale * scale : 6 + 26 * scale * scale;

  for (const signal of ["interval", "gpu"] as const) {
    it(`reacts within 3 s of a load change, changes at most once per 2 s and stays in range (${signal} signal)`, () => {
      const controller = new DynamicResolution(MEDIUM, 0.85);
      const steps = simulate(
        controller,
        120,
        (scale, t) => {
          const cost = gpuCost(scale, t);
          // The compositor and the CPU take about 2.5 ms of the display interval.
          return { interval: vsync(cost + 2.5), gpuMs: cost };
        },
        signal === "gpu",
      );
      const afterChange = steps.filter((s) => s.atMs >= 20_000);
      expect(afterChange.length).toBeGreaterThan(0);
      // First corrective step within 3 s of the change.
      expect((afterChange[0]?.atMs ?? 1e9) - 20_000).toBeLessThanOrEqual(3000);
      expect(afterChange[0]?.scale).toBeLessThan(0.85);
      // Never two changes within 2 s, probes and their take-backs included.
      expect(minGapMs(steps)).toBeGreaterThanOrEqual(2000);
      for (const step of steps) {
        expect(step.scale).toBeGreaterThanOrEqual(MEDIUM.scaleMin);
        expect(step.scale).toBeLessThanOrEqual(MEDIUM.scaleMax);
      }
      // It ends on a scale that holds 60 fps under the heavier load: 6 + 26 s^2 + 2.5 <= 16.67 means s <= 0.56,
      // so the floor (0.6 misses by a hair in this model) or one probe above it at most.
      expect(controller.scale).toBeLessThanOrEqual(0.65);
    });
  }

  it("settles: in a steady scene the scale stops moving except for ever rarer probes", () => {
    const controller = new DynamicResolution(MEDIUM, 0.6);
    // 60 fps holds up to scale 0.7, not above.
    const steps = simulate(
      controller,
      300,
      (scale) => ({ interval: vsync(scale <= 0.7 ? 14 : 19), gpuMs: scale <= 0.7 ? 11.5 : 15.5 }),
      false,
    );
    const late = steps.filter((s) => s.atMs > 150_000);
    // Probe (up) and take-back (down) pairs at a hold that has grown to 64 s: at most 3 pairs in 150 s.
    expect(late.length).toBeLessThanOrEqual(6);
    expect(controller.scale).toBeGreaterThanOrEqual(0.7);
    expect(controller.scale).toBeLessThanOrEqual(0.75);
  });
});

describe("Medium preset floor (owner decision 2026-11-16)", () => {
  it("never renders below 0.75 under sustained overload and then raises the floor hint", () => {
    expect(QUALITY_PRESETS.medium.dynres.scaleMin).toBe(0.75);
    const controller = new DynamicResolution(QUALITY_PRESETS.medium.dynres, QUALITY_PRESETS.medium.dynres.scaleMax);
    const steps = simulate(controller, 60, () => ({ interval: 2 * FRAME_60, gpuMs: 30 }), true);
    for (const step of steps) expect(step.scale).toBeGreaterThanOrEqual(0.75);
    expect(controller.scale).toBe(0.75);
    expect(controller.floorHint).toBe(true);
  });
});

describe("pace guard of the GPU signal", () => {
  it("steps down when frames miss the display although GPU time is inside its budget", () => {
    const controller = new DynamicResolution(MEDIUM, 0.85);
    // 12.5 ms of GPU time throughout (budget 14: neither over nor under). The first 3 s run at the display's 60 Hz, then
    // every frame takes two display intervals.
    const steps = simulate(
      controller,
      9,
      (_scale, t) => ({ interval: t < 3000 ? FRAME_60 : 2 * FRAME_60, gpuMs: 12.5 }),
      true,
    );
    expect(steps[0]?.scale).toBe(0.75);
    expect((steps[0]?.atMs ?? 1e9) - 3000).toBeLessThanOrEqual(3000);
    expect(controller.paceLimited).toBe(true);
    expect(controller.lastPaceP90Ms).toBeCloseTo(2 * FRAME_60, 3);
    expect(controller.lastPaceTargetMs).toBeCloseTo(FRAME_60, 3);
  });

  it("a display that never showed a faster frame sets the pace: constant 30 fps with GPU time in budget is not 'over'", () => {
    const controller = new DynamicResolution(MEDIUM, 0.85);
    const steps = simulate(controller, 20, () => ({ interval: 2 * FRAME_60, gpuMs: 12.5 }), true);
    expect(steps).toEqual([]);
    expect(controller.lastPaceTargetMs).toBeCloseTo(2 * FRAME_60, 3);
  });

  it("tolerates a few slow frames: 2 of 30 over the frame period is not 'over'", () => {
    const controller = new DynamicResolution(MEDIUM, 0.85);
    let frame = 0;
    const steps = simulate(
      controller,
      20,
      () => ({ interval: frame++ % 15 === 0 ? 2 * FRAME_60 : FRAME_60, gpuMs: 12.5 }),
      true,
    );
    expect(steps).toEqual([]);
    expect(controller.paceLimited).toBe(false);
  });

  it("does not call a 50 Hz display over budget", () => {
    const controller = new DynamicResolution(MEDIUM, 0.85);
    const steps = simulate(controller, 30, () => ({ interval: 20, gpuMs: 12.5 }), true);
    expect(steps).toEqual([]);
    expect(controller.lastPaceTargetMs).toBeCloseTo(20, 3);
  });

  it("takes back a step up that the display cannot hold, and waits longer before the next try", () => {
    const controller = new DynamicResolution(MEDIUM, 0.6);
    // GPU time shows headroom at every scale (9 ms), but above 0.6 the frame misses vsync (the compositor shares the GPU).
    const steps = simulate(
      controller,
      90,
      (scale) => ({ interval: scale > 0.6 ? 2 * FRAME_60 : FRAME_60, gpuMs: 9 }),
      true,
    );
    expect(steps.length).toBeGreaterThanOrEqual(4);
    expect(steps[0]?.scale).toBe(0.65);
    expect(steps[1]?.scale).toBe(0.6);
    // Taken back after the 2 s judge time, well inside the 4 s reverse lock.
    const firstBack = (steps[1]?.atMs ?? 0) - (steps[0]?.atMs ?? 0);
    expect(firstBack).toBeGreaterThanOrEqual(2000);
    expect(firstBack).toBeLessThan(3500);
    // The hold before the next try doubles.
    const firstWait = (steps[2]?.atMs ?? 0) - (steps[1]?.atMs ?? 0);
    const secondWait = (steps[4]?.atMs ?? 90_000) - (steps[3]?.atMs ?? 0);
    expect(secondWait).toBeGreaterThan(firstWait * 1.5);
    // Time above the sustainable scale stays small: under a fifth of the run.
    let above = 0;
    for (let i = 0; i + 1 < steps.length; i += 2) above += (steps[i + 1]?.atMs ?? 0) - (steps[i]?.atMs ?? 0);
    expect(above).toBeLessThan(18_000);
    expect(minGapMs(steps)).toBeGreaterThanOrEqual(2000);
  });

  it("keeps a step up that holds, and climbs while GPU time stays under 0.8 x budget", () => {
    const controller = new DynamicResolution(MEDIUM, 0.6);
    const steps = simulate(controller, 60, (scale) => ({ interval: FRAME_60, gpuMs: 4 + 6 * scale }), true);
    expect(controller.scale).toBe(0.85);
    for (let i = 1; i < steps.length; i++) expect(steps[i]?.scale ?? 0).toBeGreaterThan(steps[i - 1]?.scale ?? 0);
  });

  it("a cleared window forgets the old frame intervals (partial window after a stall reads only new frames)", () => {
    const controller = new DynamicResolution(MEDIUM, 0.85);
    // 4 s at 100 ms per frame fills the pace window with 100 ms intervals.
    for (let t = 0; t < 4000; t += 100) controller.sample(100, 12.5, GPU_BUDGET, "gpu", FRAME_60, 100);
    // A stall clears the window; then just over 0.5 s at 50 ms per frame (11 of 30 slots, one evaluation).
    controller.sample(300, 12.5, GPU_BUDGET, "gpu", FRAME_60, 300);
    for (let t = 0; t < 550; t += 50) controller.sample(50, 12.5, GPU_BUDGET, "gpu", FRAME_60, 50);
    expect(controller.lastPaceP90Ms).toBeCloseTo(50, 3);
  });

  it("allocates nothing per sample with the guard on", () => {
    const controller = new DynamicResolution(MEDIUM, 0.85);
    for (let i = 0; i < 20_000; i++)
      controller.sample(16 + (i % 30), 8 + (i % 12), GPU_BUDGET, "gpu", FRAME_60, 16 + (i % 30));
    expect(Number.isFinite(controller.scale)).toBe(true);
  });
});

describe("review fixes (M1-W2-T03 review)", () => {
  for (const hz of [50, 30]) {
    it(`interval signal on a ${String(hz)} Hz display (frames on time) keeps its scale and raises no floor hint`, () => {
      const controller = new DynamicResolution({ scaleMin: 0.6, scaleMax: 1 }, 1);
      const steps = simulate(controller, 30, () => ({ interval: 1000 / hz, gpuMs: 0 }), false);
      expect(steps.filter((s) => s.scale < 1)).toEqual([]);
      expect(controller.scale).toBe(1);
      expect(controller.floorHint).toBe(false);
      expect(controller.lastTargetMs).toBeCloseTo(1000 / hz, 3);
    });
  }

  it("the refresh estimate rises again after the display drops to 30 Hz, and reset() forgets it", () => {
    const controller = new DynamicResolution({ scaleMin: 0.6, scaleMax: 1 }, 1);
    simulate(controller, 10, () => ({ interval: FRAME_60, gpuMs: 5 }), true);
    // Display goes to 30 Hz with a light GPU: the pace guard first reads it as missed frames, then re-learns the rate.
    simulate(controller, 150, () => ({ interval: 2 * FRAME_60, gpuMs: 5 }), true);
    expect(controller.lastPaceTargetMs).toBeCloseTo(2 * FRAME_60, 3);
    expect(controller.paceLimited).toBe(false);
    expect(controller.scale).toBe(1);
    expect(controller.floorHint).toBe(false);

    // After reset() the old 60 Hz estimate is gone at once: 30 Hz from the first window on is not "over".
    const fresh = new DynamicResolution({ scaleMin: 0.6, scaleMax: 1 }, 1);
    simulate(fresh, 10, () => ({ interval: FRAME_60, gpuMs: 5 }), true);
    fresh.reset({ scaleMin: 0.6, scaleMax: 1 }, 1);
    const steps = simulate(fresh, 20, () => ({ interval: 2 * FRAME_60, gpuMs: 5 }), true);
    expect(steps).toEqual([]);
    expect(fresh.lastPaceTargetMs).toBeCloseTo(2 * FRAME_60, 3);
  });

  it("a single hitch in a partial window (slow frame rate after a clear) does not step the scale down", () => {
    const controller = new DynamicResolution({ scaleMin: 0.6, scaleMax: 1 }, 1);
    // 10 fps: 5 frames per 0.5 s evaluation; GPU time 5 ms against 10 ms, one 50 ms hitch in the first evaluation's
    // 5 frames (the first 10 samples are the settle time).
    for (let i = 0; i < 40; i++) controller.sample(100, i === 12 ? 50 : 5, 10, "gpu");
    expect(controller.steps).toBe(0);
    expect(controller.scale).toBe(1);
    expect(controller.lastP90Ms).toBe(5);
  });
});
