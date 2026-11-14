import { describe, expect, it } from "vitest";
import { sampleCameraPath, validateCameraPath, type CameraPose } from "./camera-path";
import { PerfCollector } from "./collector";
import { formatHudText } from "./hud";
import { PERF_SNAPSHOT_SCHEMA } from "./snapshot";
import { emptySummary, percentileSorted, RollingWindow } from "./stats";

describe("percentileSorted", () => {
  it("uses nearest rank", () => {
    const v = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    expect(percentileSorted(v, 10, 0.5)).toBe(5);
    expect(percentileSorted(v, 10, 0.95)).toBe(10);
    expect(percentileSorted(v, 10, 0)).toBe(1);
    expect(percentileSorted(v, 0, 0.5)).toBe(0);
  });
});

describe("RollingWindow", () => {
  it("summarizes a partial window", () => {
    const w = new RollingWindow(8);
    for (const x of [3, 1, 2]) w.push(x);
    const s = w.summarize(emptySummary());
    expect(s).toMatchObject({ samples: 3, min: 1, max: 3, p50: 2, avg: 2 });
  });

  it("keeps only the latest capacity samples", () => {
    const w = new RollingWindow(4);
    for (let i = 1; i <= 10; i++) w.push(i);
    const s = w.summarize(emptySummary());
    expect(s.samples).toBe(4);
    expect(s.min).toBe(7);
    expect(s.max).toBe(10);
  });

  it("is empty-safe and clearable", () => {
    const w = new RollingWindow(4);
    expect(w.summarize(emptySummary()).p99).toBe(0);
    w.push(5);
    w.clear();
    expect(w.size).toBe(0);
  });

  it("rejects a bad capacity", () => {
    expect(() => new RollingWindow(0)).toThrow(RangeError);
  });
});

describe("camera path", () => {
  const spec = {
    keys: [
      { t: 0, position: [0, 0, 0], target: [0, 0, -1] },
      { t: 10, position: [10, 0, 0], target: [10, 0, -1] },
    ],
  } as const;
  const pose = (): CameraPose => ({ px: 0, py: 0, pz: 0, tx: 0, ty: 0, tz: 0 });

  it("interpolates, holds and loops", () => {
    expect(sampleCameraPath(spec, 5, pose()).px).toBeCloseTo(5);
    expect(sampleCameraPath({ ...spec, loop: false }, 99, pose()).px).toBeCloseTo(10);
    expect(sampleCameraPath(spec, 15, pose()).px).toBeCloseTo(5);
  });

  it("is deterministic for equal times", () => {
    expect(sampleCameraPath(spec, 3.3, pose())).toEqual(sampleCameraPath(spec, 3.3, pose()));
  });

  it("validates keys", () => {
    expect(() => validateCameraPath({ keys: [spec.keys[0]] })).toThrow();
    expect(() => validateCameraPath({ keys: [spec.keys[1], spec.keys[0]] })).toThrow();
    expect(() => validateCameraPath(spec)).not.toThrow();
  });
});

describe("PerfCollector export", () => {
  const ctx = {
    env: {
      backend: "webgpu",
      tier: "B",
      preset: "medium",
      gpu: "test",
      userAgent: "ua",
      dpr: 1,
      renderScale: 1,
      canvasCssPx: [100, 100] as const,
    },
    pipelinesAfterWarmup: null,
    jsHeapBytes: null,
    net: { rttMs: null, conn: null },
    nowMs: 1,
  };

  it("exports CPU windows and flags GPU as not measured without queries", () => {
    const c = new PerfCollector(["net", "render"]);
    for (let i = 0; i < 10; i++) c.recordFrame(16 + i, [0.5, 3]);
    const snap = c.snapshot({ ...ctx, gpuSource: "none" });
    expect(snap.schema).toBe(PERF_SNAPSHOT_SCHEMA);
    expect(snap.cpuMs["render"]?.avg).toBeCloseTo(3);
    expect(snap.cpuTotalMs.avg).toBeCloseTo(3.5);
    expect(snap.gpu.measured).toBe(false);
    expect(snap.gpu.renderMs.samples).toBe(0);
    expect(JSON.parse(JSON.stringify(snap))).toEqual(snap);
    expect(formatHudText(snap, 0.05)).toContain("CPU only");
  });

  it("marks GPU measured once a timestamp arrived", () => {
    const c = new PerfCollector(["render"]);
    c.recordFrame(16, [1]);
    c.recordGpu(4.2, 0.3);
    const snap = c.snapshot({ ...ctx, gpuSource: "timestamp-query" });
    expect(snap.gpu.measured).toBe(true);
    expect(snap.gpu.renderMs.p50).toBeCloseTo(4.2);
    expect(formatHudText(snap, 0.05)).toContain("timestamp-query");
  });
});
