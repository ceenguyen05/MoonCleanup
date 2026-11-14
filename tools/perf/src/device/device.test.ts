import { describe, expect, it } from "vitest";
import {
  DEVICE_REPORT_SCHEMA,
  collectSecrets,
  findLeaks,
  isSoftwareRenderer,
  newAnonymousId,
  renderDeviceMarkdown,
  scrubDeep,
  scrubString,
  validateReport,
  type DeviceCell,
  type DeviceReport,
} from "./report";
import { computeVerdict, formatVerdict } from "./verdict";
import { readFileSync } from "node:fs";
import { PRESET_SCALE_CEIL, estimateSeconds, matrixPlan, scaleFor, scaleModeLabel } from "./run";

describe("device-report scale", () => {
  it("uses the preset spec ceiling unless --scale is explicit", () => {
    expect(scaleFor("low")).toBe(0.75);
    expect(scaleFor("medium")).toBe(0.85);
    expect(scaleFor("high")).toBe(1);
    expect(scaleFor("low", 1)).toBe(1);
    expect(scaleModeLabel()).toContain("spec ceiling");
    expect(scaleModeLabel(0.6)).toBe("pinned 0.6");
  });

  it("matches dynres.scaleMax in packages/shared quality presets", () => {
    const src = readFileSync(new URL("../../../../packages/shared/src/render/quality.ts", import.meta.url), "utf8");
    const maxes = [...src.matchAll(/scaleMax:\s*([0-9.]+)/g)].map((m) => Number(m[1]));
    // Preset order in the file: low, medium, high, ultra.
    expect(maxes.slice(0, 3)).toEqual([PRESET_SCALE_CEIL.low, PRESET_SCALE_CEIL.medium, PRESET_SCALE_CEIL.high]);
  });
});

function cell(over: Partial<DeviceCell> = {}): DeviceCell {
  return {
    scene: "bench",
    backendRequested: "webgpu",
    backendActual: "webgpu",
    presetRequested: "medium",
    presetActual: "medium",
    renderScale: 0.85,
    dpr: 1,
    status: "ok",
    note: null,
    terrainSource: "real",
    frameMs: { p50: 20, p95: 25, p99: 30 },
    fps: 50,
    gpuMs: null,
    gpuTimingSource: "none",
    cpuTotalMsP95: 6,
    draws: 300,
    tris: 900_000,
    ...over,
  };
}

function report(
  over: { cells?: DeviceCell[]; description?: string; vendor?: string; software?: boolean } = {},
): DeviceReport {
  return {
    kind: "device-report",
    schema: DEVICE_REPORT_SCHEMA,
    id: "0123456789ab",
    createdAt: "2026-11-13T00:00:00.000Z",
    system: { os: "Windows_NT 10 (x64)", cpu: "CPU", cores: 8, ramGb: 16 },
    browser: { name: "Chromium-based", version: "157", channel: "chrome", headless: false },
    display: { screen: [1920, 1080], viewport: [1920, 1080], dpr: 1 },
    gpu: {
      rendererString: over.description ?? "Intel(R) Iris(R) Xe Graphics",
      softwareRenderer: over.software ?? false,
      webgpu: {
        available: true,
        adapter: {
          vendor: over.vendor ?? "intel",
          architecture: "xe-lpg",
          device: "",
          description: over.description ?? "Intel(R) Iris(R) Xe Graphics",
        },
        limits: { maxTextureDimension2D: 16384 },
        features: ["timestamp-query"],
        timestampQuery: true,
        error: null,
      },
    },
    detector: { backend: "webgpu", tier: "B", preset: "medium" },
    capture: { warmupS: 4, captureS: 10, scaleMode: "ceil", seed: "s" },
    cells: over.cells ?? [cell()],
    warnings: [],
  };
}

describe("anonymiser", () => {
  const secrets = collectSecrets({
    username: "ben",
    hostname: "DESKTOP-ABC",
    homedir: "C:\\Users\\ben",
    cwd: "C:\\Users\\ben\\game",
  });

  it("drops short names and sorts longest first", () => {
    expect(collectSecrets({ username: "pc", hostname: "host1" })).toEqual(["host1"]);
    expect(secrets[0]?.length).toBeGreaterThanOrEqual(secrets[secrets.length - 1]?.length ?? 0);
  });

  it("redacts paths, host and user as whole tokens only", () => {
    const s = scrubString("ben at DESKTOP-ABC ran C:\\Users\\ben\\game\\x.js and /home/ben/app bench", secrets);
    expect(s).not.toMatch(/DESKTOP-ABC|\\Users|home\/ben/);
    expect(s).toContain("bench");
    expect(s).toContain("<redacted>");
  });

  it("scrubs deeply and leaves numbers alone", () => {
    const out = scrubDeep({ a: ["C:\\Users\\ben\\x", 3], b: { c: "DESKTOP-ABC" } }, secrets);
    expect(JSON.stringify(out)).not.toMatch(/ben|DESKTOP/);
    expect(out.a[1]).toBe(3);
  });

  it("findLeaks catches what scrub missed", () => {
    expect(findLeaks('{"x":"hello ben"}', secrets)).not.toHaveLength(0);
    expect(findLeaks('{"x":"C:\\\\Users\\\\q"}', [])).toContain("drive path");
    expect(findLeaks(JSON.stringify(scrubDeep({ x: "ben C:\\Users\\ben\\a" }, secrets)), secrets)).toEqual([]);
  });

  it("anonymous ids are random 12-hex and the report validates", () => {
    expect(newAnonymousId()).toMatch(/^[0-9a-f]{12}$/);
    expect(newAnonymousId()).not.toBe(newAnonymousId());
    expect(validateReport(report())).toEqual([]);
    expect(validateReport({ kind: "x" })).not.toHaveLength(0);
  });
});

describe("schema and summary", () => {
  it("detects software rasterisers", () => {
    expect(isSoftwareRenderer("Google SwiftShader")).toBe(true);
    expect(isSoftwareRenderer("llvmpipe (LLVM 15)")).toBe(true);
    expect(isSoftwareRenderer("NVIDIA GeForce RTX 4060 Laptop GPU")).toBe(false);
  });

  it("markdown carries machine, adapter and cell numbers", () => {
    const md = renderDeviceMarkdown(report());
    expect(md).toContain("Timestamp queries: available");
    expect(md).toContain("| bench | webgpu | medium |");
    expect(md).toContain("preset medium");
  });

  it("plan covers both backends x three presets per scene and fits the time budget", () => {
    expect(matrixPlan(true)).toHaveLength(12);
    expect(matrixPlan(false)).toHaveLength(6);
    expect(estimateSeconds({ warmupS: 4, captureS: 10, includeLook: true })).toBeLessThan(5 * 60);
  });
});

describe("verdict", () => {
  it("passes Tier B Medium on a matching adapter, not provisional", () => {
    const row = computeVerdict(report()).find((r) => r.id === "B-medium" && r.scene === "bench");
    expect(row?.status).toBe("PASS");
    expect(row?.provisional).toBe(false);
  });

  it("is provisional when the adapter is not the tier definition", () => {
    const r = report({ description: "NVIDIA GeForce RTX 4090", vendor: "nvidia" });
    const row = computeVerdict(r).find((x) => x.id === "B-medium");
    expect(row?.provisional).toBe(true);
    expect(row?.detail).toContain("not the tier definition");
    expect(formatVerdict(computeVerdict(r))).toContain("(provisional)");
  });

  it("fails on p95, draws or measured GPU, with the numbers", () => {
    const slow = report({ cells: [cell({ frameMs: { p50: 30, p95: 40, p99: 50 } })] });
    expect(computeVerdict(slow).find((r) => r.id === "B-medium")?.status).toBe("FAIL");
    const draws = report({ cells: [cell({ draws: 400 })] });
    expect(computeVerdict(draws).find((r) => r.id === "B-medium")?.detail).toContain("draws");
    const gpu = report({ cells: [cell({ gpuMs: { p50: 20, p95: 30 } })] });
    const row = computeVerdict(gpu).find((r) => r.id === "B-medium");
    expect(row?.status).toBe("FAIL");
    expect(row?.numbers).toContain("GPU p95 30.0 / 28 ms (measured)");
  });

  it("allows vsync quantisation on the 16.7 ms Tier A row", () => {
    const high = cell({ presetRequested: "high", frameMs: { p50: 16.7, p95: 17.0, p99: 17.5 }, fps: 60 });
    const r = computeVerdict(report({ cells: [high], description: "NVIDIA RTX 4060 Laptop GPU", vendor: "nvidia" }));
    const row = r.find((x) => x.id === "A-high");
    expect(row?.status).toBe("PASS");
    expect(row?.provisional).toBe(false);
  });

  it("reports NO DATA for missing, failed or fallback cells and INVALID on software", () => {
    const none = computeVerdict(report({ cells: [cell({ status: "failed", frameMs: null, fps: null })] }));
    expect(none.every((r) => r.status === "NO DATA")).toBe(true);
    const fb = computeVerdict(report({ cells: [cell({ backendActual: "webgl2" })] }));
    expect(fb.find((r) => r.id === "B-medium")?.status).toBe("NO DATA");
    const sw = computeVerdict(report({ software: true }));
    expect(sw.find((r) => r.id === "B-medium")?.status).toBe("INVALID");
  });
});
