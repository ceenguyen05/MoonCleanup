import { describe, expect, it } from "vitest";
import { compareClient, compareDownload, compareServer, formatBudgetRows } from "./budgets";
import { parseFlags } from "./cli";
import { assertLocalUrl, captureUrl, chromeArgs, type CaptureOptions } from "./capture/runner";
import { reduceRun } from "./capture/reduce";
import type { CaptureResult, PerfSnapshot, WindowSummary } from "./schema";
import { aggregate, median, percentile, relativeSpread } from "./stats";
import { aggregateRuns, renderSummary } from "./summary";

const win = (p50: number, p95 = p50, p99 = p95): WindowSummary => ({
  samples: 100,
  avg: p50,
  min: p50,
  max: p99,
  p50,
  p95,
  p99,
});

function snap(over: { gpuMeasured?: boolean; draws?: number; cpuP95?: number } = {}): PerfSnapshot {
  const measured = over.gpuMeasured ?? false;
  return {
    schema: 1,
    atMs: 0,
    env: {
      backend: "webgpu",
      tier: "B",
      preset: "medium",
      gpu: "UHD 620",
      userAgent: "ua",
      dpr: 1,
      renderScale: 1,
      canvasCssPx: [1920, 1080],
    },
    frameMs: win(16),
    fps: 60,
    cpuMs: { render: win(2, 3), net: win(0.1, 0.2) },
    cpuTotalMs: win(4, over.cpuP95 ?? 6),
    gpu: {
      source: measured ? "timestamp-query" : "none",
      measured,
      renderMs: win(measured ? 5 : 0, measured ? 9 : 0),
      computeMs: win(0),
      perPass: "unavailable",
    },
    render: {
      drawCalls: over.draws ?? 100,
      triangles: 1000,
      geometries: 5,
      textures: 5,
      gpuMemoryBytes: 50 * 1024 * 1024,
      texturesBytes: 0,
      pipelinesAfterWarmup: 0,
      framesRendered: 10,
      lossCount: 0,
    },
    memory: { jsHeapBytes: 100 * 1024 * 1024 },
    net: { rttMs: null, conn: null },
    frames: 100,
  };
}

function result(over: Parameters<typeof snap>[0] = {}, tier: "A" | "B" | "C" = "B"): CaptureResult {
  const frames = Array.from({ length: 600 }, (_, i) => (i % 100 === 0 ? 40 : 16));
  const runs = [1, 2, 3].map(() => reduceRun(frames, [snap(over), snap(over)]));
  return {
    kind: "client-capture",
    createdAt: "2026-11-12T00:00:00Z",
    milestone: "m0",
    scene: "smoke",
    seed: "s",
    cameraPath: "orbit-v0",
    tier,
    preset: "medium",
    backend: "webgpu",
    warmupS: 10,
    captureS: 60,
    machine: {
      cpu: "cpu",
      cores: 4,
      ramGb: 8,
      os: "os",
      gpu: "UHD 620",
      browser: "Chrome 1",
      adapterFlag: "default",
      nodeVersion: "v22",
    },
    provisional: true,
    gpuTimingSource: over.gpuMeasured === true ? "timestamp-query" : "none",
    runs,
    aggregate: aggregateRuns(runs),
    lastSnapshot: snap(over),
  };
}

describe("stats", () => {
  it("percentile, median, aggregate, spread", () => {
    expect(percentile([5, 1, 3, 2, 4], 0.5)).toBe(3);
    expect(percentile([], 0.9)).toBe(0);
    expect(median([1, 2, 3, 4])).toBe(2.5);
    const a = aggregate([10, 12, 11]);
    expect(a).toEqual({ median: 11, min: 10, max: 12, runs: 3 });
    expect(relativeSpread(a!)).toBeCloseTo(2 / 11);
    expect(aggregate([])).toBeNull();
  });
});

describe("reduceRun", () => {
  it("computes frame percentiles over all frames and leaves GPU null without timing", () => {
    const frames = [...Array.from({ length: 98 }, () => 16), 30, 50];
    const m = reduceRun(frames, [snap()]);
    expect(m.frameMsP50).toBe(16);
    expect(m.frameMsP99).toBe(30);
    expect(m.gpuRenderMsP95).toBeNull();
    expect(m.cpuStepMsP95["render"]).toBe(3);
  });
  it("rejects a run without snapshots", () => {
    expect(() => reduceRun([16], [])).toThrow();
  });
});

describe("budget comparison", () => {
  it("passes within limits and reports margin", () => {
    const rows = compareClient(result());
    const draws = rows.find((r) => r.id === "draws");
    expect(draws).toMatchObject({ status: "PASS", value: 100, limit: 350, margin: 250 });
    expect(rows.find((r) => r.id === "fps")?.status).toBe("PASS");
  });

  it("fails over the limit with negative margin", () => {
    const rows = compareClient(result({ draws: 700 }, "A"));
    expect(rows.find((r) => r.id === "draws")).toMatchObject({ status: "FAIL", margin: -100 });
    // frame p95 here is 16 ms against 16.7 on tier A
    expect(rows.find((r) => r.id === "frame.p95")?.status).toBe("PASS");
  });

  it("marks GPU budgets UNVERIFIED when timing is absent, never PASS", () => {
    const row = compareClient(result()).find((r) => r.id === "gpu.total.p95");
    expect(row?.status).toBe("UNVERIFIED");
    expect(row?.note).toContain("CPU only");
    const measured = compareClient(result({ gpuMeasured: true })).find((r) => r.id === "gpu.total.p95");
    expect(measured).toMatchObject({ status: "PASS", value: 9 });
  });

  it("flags provisional hardware in notes", () => {
    expect(compareClient(result()).find((r) => r.id === "draws")?.note).toContain("provisional");
  });

  it("download and server rows", () => {
    const dl = compareDownload({ jsGzipBytes: 2 * 1024 * 1024, totalGzipBytes: 5 * 1024 * 1024, files: 3 });
    expect(dl[0]?.status).toBe("FAIL");
    expect(dl[1]?.status).toBe("PASS");
    const srv = compareServer({ tick: { p50Ms: 1, p95Ms: 3, maxMs: 9 } });
    expect(srv.find((r) => r.id === "srv.tick.p95")?.status).toBe("PASS");
    expect(srv.find((r) => r.id === "srv.tick.max")?.status).toBe("FAIL");
    expect(srv.find((r) => r.id === "srv.bw")?.status).toBe("UNVERIFIED");
    expect(compareServer(null).every((r) => r.status === "UNVERIFIED")).toBe(true);
  });

  it("formats a table", () => {
    expect(formatBudgetRows(compareClient(result()))).toContain("| PASS |");
  });
});

describe("summary export", () => {
  it("states the machine, provisional status and GPU source", () => {
    const r = result();
    const md = renderSummary(r, compareClient(r));
    expect(md).toContain("PROVISIONAL");
    expect(md).toContain("UHD 620");
    expect(md).toContain("CPU only");
    expect(JSON.parse(JSON.stringify(r))).toEqual(r);
  });
});

describe("runner helpers", () => {
  it("refuses non-local targets", () => {
    expect(() => assertLocalUrl("https://example.com/")).toThrow();
    expect(() => assertLocalUrl("http://localhost:5174/")).not.toThrow();
  });
  it("builds the capture url and adapter flags", () => {
    const o = {
      url: "http://localhost:5174/",
      scene: "smoke",
      preset: "low",
      seed: "x",
      backend: "webgl2",
    } as CaptureOptions;
    const u = new URL(captureUrl(o));
    expect(u.searchParams.get("backend")).toBe("webgl2");
    expect(u.searchParams.get("perf")).toBe("1");
    expect(chromeArgs("low-power")).toContain("--force_low_power_gpu");
    expect(chromeArgs("default").some((a) => a.startsWith("--force_"))).toBe(false);
  });
  it("parses flags", () => {
    expect(parseFlags(["capture", "--tier", "B", "--runs=2", "--headless"])).toEqual({
      positional: ["capture"],
      flags: { tier: "B", runs: "2", headless: "true" },
    });
  });
});
