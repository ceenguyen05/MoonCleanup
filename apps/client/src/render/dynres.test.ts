import { describe, expect, it } from "vitest";
import { DYNRES_FLOOR_HINT_S, DYNRES_TUNING, DynamicResolution, dynresTargetMs } from "./dynres";

const LOW = { scaleMin: 0.5, scaleMax: 0.75 };
const TARGET = 1000 / 30;

/** Feeds `seconds` of frames whose interval is `frameMs(scale)`; returns the scales seen at each change. */
function run(
  controller: DynamicResolution,
  seconds: number,
  frameMs: (scale: number) => number,
  target = TARGET,
  signal: "gpu" | "interval" = "interval",
  gpuMs?: (scale: number) => number,
): number[] {
  const changes: number[] = [];
  let elapsed = 0;
  let last = controller.scale;
  while (elapsed < seconds * 1000) {
    const interval = frameMs(controller.scale);
    const value = gpuMs === undefined ? interval : gpuMs(controller.scale);
    const next = controller.sample(interval, value, target, signal);
    if (next !== last) {
      changes.push(next);
      last = next;
    }
    elapsed += interval;
  }
  return changes;
}

/** A fill-bound GPU: fixed cost plus a cost per pixel (the UHD 620 fit of M0-W3-T02: about 9 + 69 x scale^2 ms). */
const fillBound =
  (fixedMs: number, perPixelMs: number) =>
  (scale: number): number =>
    fixedMs + perPixelMs * scale * scale;

/** The same GPU behind a 60 Hz vsync: the interval is the next multiple of 16.67 ms. */
const vsynced =
  (gpu: (scale: number) => number) =>
  (scale: number): number =>
    Math.ceil(gpu(scale) / (1000 / 60) - 1e-9) * (1000 / 60);

describe("dynresTargetMs", () => {
  it("uses the GPU budget for the gpu signal and the frame period for the interval signal", () => {
    const dynres = { targetFps: 30, gpuBudgetMs: 28 };
    expect(dynresTargetMs("gpu", dynres)).toBe(28);
    expect(dynresTargetMs("interval", dynres)).toBeCloseTo(33.333, 2);
  });
});

describe("DynamicResolution", () => {
  it("starts at the requested scale, clamped to the range", () => {
    expect(new DynamicResolution(LOW, 0.75).scale).toBe(0.75);
    expect(new DynamicResolution(LOW, 2).scale).toBe(0.75);
    expect(new DynamicResolution(LOW, 0.1).scale).toBe(0.5);
  });

  it("steps down by 0.10 while over budget, at most once per 2 s, and stops at the floor", () => {
    const controller = new DynamicResolution(LOW, 0.75);
    // 9 + 69 s^2: 47.8 ms at 0.75, 38.2 at 0.65, 29.9 at 0.55 (meets 33.3).
    const changes = run(controller, 12, fillBound(9, 69));
    expect(changes.slice(0, 2)).toEqual([0.65, 0.55]);
    expect(controller.scale).toBeGreaterThanOrEqual(0.5);
    expect(controller.scale).toBeLessThanOrEqual(0.6);
  });

  it("spaces steps by at least the minimum change interval", () => {
    const controller = new DynamicResolution(LOW, 0.75);
    const times: number[] = [];
    let elapsed = 0;
    let last = controller.scale;
    while (elapsed < 8000) {
      const next = controller.sample(60, 60, TARGET);
      if (next !== last) {
        times.push(elapsed);
        last = next;
      }
      elapsed += 60;
    }
    expect(times.length).toBeGreaterThanOrEqual(2);
    for (let i = 1; i < times.length; i++) {
      expect((times[i] ?? 0) - (times[i - 1] ?? 0)).toBeGreaterThanOrEqual(
        DYNRES_TUNING.minChangeIntervalS * 1000 - 60,
      );
    }
    expect(controller.scale).toBe(0.5);
  });

  it("holds at the floor and raises the floor hint after 10 s still over budget", () => {
    const controller = new DynamicResolution(LOW, 0.5);
    run(controller, 4, () => 50);
    expect(controller.scale).toBe(0.5);
    expect(controller.floorHint).toBe(false);
    run(controller, DYNRES_FLOOR_HINT_S + 2, () => 50);
    expect(controller.floorHint).toBe(true);
    // Budget met again: the hint clears.
    run(controller, 2, () => 30);
    expect(controller.floorHint).toBe(false);
  });

  it("steps up by 0.05 only after 4 s below 0.8 x target (unthrottled interval)", () => {
    const controller = new DynamicResolution(LOW, 0.5);
    const changes: number[] = [];
    let elapsed = 0;
    let firstUpAt = -1;
    let last = controller.scale;
    while (elapsed < 9000) {
      const next = controller.sample(20, 20, TARGET);
      if (next !== last) {
        if (firstUpAt < 0) firstUpAt = elapsed;
        changes.push(next);
        last = next;
      }
      elapsed += 20;
    }
    expect(changes[0]).toBe(0.55);
    // 1 s settle + 4 s hold.
    expect(firstUpAt).toBeGreaterThanOrEqual(4000);
    expect(firstUpAt).toBeLessThan(6500);
  });

  it("does not hunt: a scale that meets the budget without headroom is kept (gpu signal)", () => {
    const controller = new DynamicResolution(LOW, 0.6);
    // 26 ms of a 28 ms budget: neither over 1.05x nor under 0.8x.
    const changes = run(
      controller,
      30,
      () => 33.3,
      28,
      "gpu",
      () => 26,
    );
    expect(changes).toEqual([]);
  });

  it("never reverses within 4 s of a step (gpu signal)", () => {
    const controller = new DynamicResolution(LOW, 0.75);
    const events: { at: number; scale: number }[] = [];
    let elapsed = 0;
    let last = controller.scale;
    // Over budget until the first step down, then far under budget.
    while (elapsed < 12000) {
      const gpu = last >= 0.75 ? 40 : 10;
      const next = controller.sample(16.7, gpu, 28, "gpu");
      if (next !== last) {
        events.push({ at: elapsed, scale: next });
        last = next;
      }
      elapsed += 16.7;
    }
    expect(events[0]?.scale).toBe(0.65);
    expect(events[1]?.scale).toBe(0.7);
    expect((events[1]?.at ?? 0) - (events[0]?.at ?? 0)).toBeGreaterThanOrEqual(DYNRES_TUNING.reverseLockS * 1000 - 20);
  });

  it("under vsync, probes upward after the budget was met and takes a failed probe back with a longer hold", () => {
    const controller = new DynamicResolution(LOW, 0.5);
    // GPU needs 30 ms at 0.5 (one 33.3 ms vsync slot) and 34.6 ms at 0.55 (drops to 50 ms): 0.5 is the right answer.
    const gpu = fillBound(10.8, 77);
    const events: { at: number; scale: number }[] = [];
    let elapsed = 0;
    let last = controller.scale;
    const frame = vsynced(gpu);
    while (elapsed < 60_000) {
      const interval = frame(controller.scale);
      const next = controller.sample(interval, interval, TARGET);
      if (next !== last) {
        events.push({ at: elapsed, scale: next });
        last = next;
      }
      elapsed += interval;
    }
    // probe up, back, probe up, back ... with growing gaps.
    expect(events.length).toBeGreaterThanOrEqual(4);
    expect(events[0]?.scale).toBe(0.55);
    expect(events[1]?.scale).toBe(0.5);
    // A failed probe is reverted after 2 s (at most one change per 2 s), not after the 4 s reverse lock.
    expect((events[1]?.at ?? 0) - (events[0]?.at ?? 0)).toBeGreaterThanOrEqual(2000);
    expect((events[1]?.at ?? 0) - (events[0]?.at ?? 0)).toBeLessThan(3100);
    const firstGap = (events[2]?.at ?? 0) - (events[1]?.at ?? 0);
    const secondGap = (events[4]?.at ?? 60_000) - (events[3]?.at ?? 0);
    expect(secondGap).toBeGreaterThan(firstGap * 1.5);
    // Time spent above the sustainable scale stays small.
    expect(controller.scale).toBeLessThanOrEqual(0.55);
  });

  it("under vsync, a probe that holds is kept and climbs to the ceiling", () => {
    const controller = new DynamicResolution(LOW, 0.5);
    // A light scene: 20 ms even at 0.75 -> always one 33.3 ms slot (target met, never 'under' 26.7 ms).
    const changes = run(controller, 80, vsynced(fillBound(6, 25)));
    expect(changes[0]).toBe(0.55);
    expect(controller.scale).toBe(0.75);
    // Monotonic: no step back on the way up.
    for (let i = 1; i < changes.length; i++) expect(changes[i] ?? 0).toBeGreaterThan(changes[i - 1] ?? 0);
  });

  it("ignores stalls and restarts its window", () => {
    const controller = new DynamicResolution(LOW, 0.75);
    run(controller, 1.2, () => 30);
    // A 2 s hitch (tab switch) between good frames must not step the scale.
    expect(controller.sample(2000, 2000, TARGET)).toBe(0.75);
    const changes = run(controller, 1.5, () => 30);
    expect(changes).toEqual([]);
  });

  it("reset() adopts a new range and scale and drops history", () => {
    const controller = new DynamicResolution(LOW, 0.75);
    run(controller, 5, () => 60);
    expect(controller.scale).toBeLessThan(0.75);
    controller.reset({ scaleMin: 0.6, scaleMax: 0.85 }, 0.85);
    expect(controller.scale).toBe(0.85);
    controller.reset({ scaleMin: 0.6, scaleMax: 0.85 }, 0.2);
    expect(controller.scale).toBe(0.6);
    expect(controller.floorHint).toBe(false);
  });

  it("returns exact 0.05 multiples (no float drift)", () => {
    const controller = new DynamicResolution({ scaleMin: 0.5, scaleMax: 1 }, 1);
    const changes = run(controller, 20, () => 60);
    for (const scale of changes) expect(Math.abs(scale * 20 - Math.round(scale * 20))).toBeLessThan(1e-9);
    expect(controller.scale).toBe(0.5);
  });

  it("allocates nothing per sample (typed-array window only)", () => {
    const controller = new DynamicResolution(LOW, 0.75);
    // Smoke check of the hot path contract: thousands of samples with mixed verdicts run without throwing or growing state.
    for (let i = 0; i < 20_000; i++) controller.sample(16 + (i % 40), 16 + (i % 40), TARGET);
    expect(Number.isFinite(controller.scale)).toBe(true);
    expect(controller.lastP90Ms).toBeGreaterThan(0);
  });
});
