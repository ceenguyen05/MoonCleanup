// Verdict step: compares a device report with the tier rows of docs/architecture/performance-budgets.md section 1
// (limits copied from budgets.ts / that document). REPORTS pass/fail with the numbers and never decides:
// performance-reviewer issues the verdict. A row is provisional unless the adapter matches the tier definition.

import type { DeviceCell, DeviceReport } from "./report";

export type RowStatus = "PASS" | "FAIL" | "NO DATA" | "INVALID";

export interface TierRowDef {
  readonly id: string;
  readonly label: string;
  readonly backend: "webgpu" | "webgl2";
  readonly preset: "low" | "medium" | "high";
  /** Frame interval p95 limit (ms), FPS floor, draw and triangle ceilings, GPU p95 (ms) when measured. */
  readonly frameP95Ms: number;
  readonly fpsFloor: number;
  readonly draws: number;
  readonly tris: number;
  readonly gpuP95Ms: number;
  /** What the adapter must look like for the row to be non-provisional. */
  readonly definition: string;
  readonly matches: (vendor: string, description: string) => boolean;
}

const text = (vendor: string, description: string): string => `${vendor} ${description}`;

/** performance-budgets.md section 1 (tier table), section 3 (GPU p95) and section 4 (draws, triangles). */
export const TIER_ROWS: readonly TierRowDef[] = [
  {
    id: "A-high",
    label: "Tier A, High, WebGPU",
    backend: "webgpu",
    preset: "high",
    frameP95Ms: 16.7,
    fpsFloor: 60,
    draws: 600,
    tris: 4_000_000,
    gpuP95Ms: 14,
    definition: "RTX 4050/4060/5050/5060 Laptop",
    matches: (v, d) => /rtx\s*(4050|4060|5050|5060)/i.test(text(v, d)),
  },
  {
    id: "B-medium",
    label: "Tier B, Medium, WebGPU",
    backend: "webgpu",
    preset: "medium",
    frameP95Ms: 33.3,
    fpsFloor: 30,
    draws: 350,
    tris: 1_500_000,
    gpuP95Ms: 28,
    definition: "Intel Iris Xe 96EU, Intel Arc 140V, AMD Radeon 780M",
    matches: (v, d) => /iris.*xe|arc.*140v|780m/i.test(text(v, d)),
  },
  {
    id: "C-low-webgpu",
    label: "iGPU floor, Low, WebGPU",
    backend: "webgpu",
    preset: "low",
    frameP95Ms: 33.3,
    fpsFloor: 30,
    draws: 350,
    tris: 1_000_000,
    gpuP95Ms: 28,
    definition: "any integrated Intel / AMD GPU",
    matches: isIntegrated,
  },
  {
    id: "C-low-webgl2",
    label: "iGPU floor, Low, WebGL2 (Tier C)",
    backend: "webgl2",
    preset: "low",
    frameP95Ms: 33.3,
    fpsFloor: 30,
    draws: 350,
    tris: 1_000_000,
    gpuP95Ms: 28,
    definition: "any integrated Intel / AMD GPU",
    matches: isIntegrated,
  },
];

function isIntegrated(vendor: string, description: string): boolean {
  const t = text(vendor, description);
  if (/rtx|gtx|geforce|radeon\s*rx|arc\s*[ab]\d{3}/i.test(t)) return false;
  return /uhd|iris|intel|780m|760m|890m|vega|radeon.*graphics|radeon\(tm\)\s*graphics/i.test(t);
}

/** Rounding slack for display-refresh quantisation of rAF intervals (a 60 Hz panel reads 16.6-16.8 ms). */
export const VSYNC_TOLERANCE_MS = 0.5;

export interface VerdictRow {
  readonly id: string;
  readonly label: string;
  readonly scene: string;
  readonly status: RowStatus;
  /** True unless the adapter matches the tier definition (or the row has no data). */
  readonly provisional: boolean;
  readonly detail: string;
  readonly numbers: string;
}

const num = (n: number | null | undefined, d = 1): string => (n == null ? "n/a" : n.toFixed(d));

function judge(def: TierRowDef, c: DeviceCell): { status: RowStatus; detail: string; numbers: string } {
  const p95 = c.frameMs?.p95 ?? null;
  const fails: string[] = [];
  const checks: string[] = [];
  if (p95 === null || c.fps === null) return { status: "NO DATA", detail: "cell has no numbers", numbers: "" };
  const lim = def.frameP95Ms + VSYNC_TOLERANCE_MS;
  checks.push(`p95 ${num(p95)} / ${def.frameP95Ms} ms (margin ${num(def.frameP95Ms - p95)})`);
  if (p95 > lim) fails.push("frame p95");
  checks.push(`${num(c.fps)} / ${def.fpsFloor} FPS`);
  if (c.fps < def.fpsFloor - 1) fails.push("fps");
  if (c.draws !== null) {
    checks.push(`draws ${c.draws} / ${def.draws}`);
    if (c.draws > def.draws) fails.push("draws");
  }
  if (c.tris !== null) {
    checks.push(`tris ${(c.tris / 1e6).toFixed(2)} M / ${(def.tris / 1e6).toFixed(2)} M`);
    if (c.tris > def.tris) fails.push("tris");
  }
  if (c.gpuMs !== null) {
    checks.push(`GPU p95 ${num(c.gpuMs.p95)} / ${def.gpuP95Ms} ms (measured)`);
    if (c.gpuMs.p95 > def.gpuP95Ms) fails.push("gpu p95");
  } else checks.push("GPU p95 n/a");
  return {
    status: fails.length === 0 ? "PASS" : "FAIL",
    detail: fails.length === 0 ? "" : `exceeds: ${fails.join(", ")}`,
    numbers: checks.join("; "),
  };
}

/** One row per tier definition per scene found in the report. */
export function computeVerdict(report: DeviceReport): VerdictRow[] {
  const rows: VerdictRow[] = [];
  const adapter = report.gpu.webgpu.adapter;
  const vendor = adapter?.vendor ?? "";
  const description = [adapter?.description, adapter?.device, report.gpu.rendererString].filter(Boolean).join(" ");
  const scenes = [...new Set(report.cells.map((c) => c.scene))];
  for (const def of TIER_ROWS) {
    const matches = def.matches(vendor, description);
    for (const scene of scenes) {
      const cell = report.cells.find(
        (c) =>
          c.scene === scene &&
          c.backendRequested === def.backend &&
          c.presetRequested === def.preset &&
          c.status === "ok",
      );
      const base = { id: def.id, label: def.label, scene };
      if (cell === undefined) {
        rows.push({ ...base, status: "NO DATA", provisional: true, detail: "cell not captured", numbers: "" });
        continue;
      }
      if (report.gpu.softwareRenderer) {
        rows.push({
          ...base,
          status: "INVALID",
          provisional: true,
          detail: "software rasteriser (SwiftShader/llvmpipe): numbers say nothing about a real GPU",
          numbers: "",
        });
        continue;
      }
      if (cell.backendActual !== null && !cell.backendActual.startsWith(def.backend)) {
        rows.push({
          ...base,
          status: "NO DATA",
          provisional: true,
          detail: `asked for ${def.backend} but the game ran ${cell.backendActual}`,
          numbers: "",
        });
        continue;
      }
      const j = judge(def, cell);
      rows.push({
        ...base,
        status: j.status,
        provisional: !matches,
        detail:
          j.detail +
          (matches
            ? ""
            : `${j.detail === "" ? "" : "; "}adapter "${description || "unknown"}" is not the tier definition (${def.definition})`),
        numbers: j.numbers,
      });
    }
  }
  return rows;
}

export function formatVerdict(rows: readonly VerdictRow[]): string {
  const lines = [
    "| Row | Scene | Result | Numbers | Note |",
    "| --- | --- | --- | --- | --- |",
    ...rows.map(
      (r) =>
        `| ${r.label} | ${r.scene} | ${r.status}${r.status === "PASS" || r.status === "FAIL" ? (r.provisional ? " (provisional)" : "") : ""} | ${r.numbers} | ${r.detail} |`,
    ),
  ];
  const provisional = rows.some((r) => (r.status === "PASS" || r.status === "FAIL") && r.provisional);
  return [
    ...lines,
    "",
    `Report only; performance-reviewer issues the verdict.${provisional ? " Rows marked provisional ran on an adapter that is not the tier definition: a FAIL on faster hardware is real evidence against the tier, a PASS is only an upper bound for the tier device." : ""} Frame p95 allows ${VSYNC_TOLERANCE_MS} ms of display-refresh quantisation.`,
  ].join("\n");
}
