import { mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type {
  ApproachId,
  Bar,
  HardwareTier,
  MetricResult,
  MetricStatus,
  QualityPreset,
  RenderBackend,
  ScenarioId,
  ScenarioResult,
} from "./types";
import { RESULT_SCHEMA_VERSION } from "./types";

const bar = (op: Bar["op"], limit: number, source: string): Bar => ({ op, limit, source });

/** Pass bars of world-and-dust-simulation section 10 (what P2 must meet), keyed by metric name. */
export const BARS = {
  "s1.dustGpuMs.p95.tierA": bar("<=", 0.5, "WDS 10 S1 tier A"),
  "s1.dustGpuMs.p95.tierB": bar("<=", 1.0, "WDS 10 S1 tier B"),
  "s1.edgeWidthPx.2m": bar("<=", 2, "WDS 10 S1"),
  "s2.maxFrameOverTarget": bar("<=", 2, "WDS 10 S2 (no frame > 2x target from tile work)"),
  "s3.orbitIdentificationPct": bar(">=", 80, "WDS 10 S3"),
  "s4.eventLoopLagP99Ms": bar("<=", 20, "WDS 10 S4"),
  "s4.bytesPerSecPerClient.max": bar("<=", 1200, "WDS 10 S4 (1.2 KB/s per client)"),
  "s4.hashMatchPct": bar(">=", 100, "WDS 10 S4"),
  "s5.serverCpuPctOfBudget": bar("<=", 10, "WDS 10 S5 (10 % of 0.1 CPU)"),
  "s5.rssMb": bar("<=", 300, "WDS 10 S5"),
  "s6.lostSeconds": bar("<=", 30, "WDS 10 S6"),
  "s6.restoredHashConsistent": bar("==", 1, "WDS 10 S6 (consistent wallet/dust)"),
  "s7.blockingBytes": bar("<=", 150_000, "WDS 10 S7"),
  "s7.playableMs": bar("<=", 3000, "WDS 10 S7"),
} as const satisfies Record<string, Bar>;

export type BarKey = keyof typeof BARS;

export function evaluate(b: Bar, value: number): "PASS" | "FAIL" {
  const ok = b.op === "<=" ? value <= b.limit : b.op === ">=" ? value >= b.limit : value === b.limit;
  return ok ? "PASS" : "FAIL";
}

/** Metric with a pass bar. `value === null` means the prototype could not measure it: NOT_RUN, never PASS. */
export function barMetric(name: BarKey, value: number | null, unit: string, note?: string): MetricResult {
  const b = BARS[name];
  const status: MetricStatus = value === null ? "NOT_RUN" : evaluate(b, value);
  return { name, value, unit, bar: b, status, ...(note ? { note } : {}) };
}

/** Metric without a bar (context numbers). */
export function infoMetric(name: string, value: number | null, unit: string, note?: string): MetricResult {
  return { name, value, unit, bar: null, status: value === null ? "NOT_RUN" : "INFO", ...(note ? { note } : {}) };
}

export function worstStatus(metrics: readonly MetricResult[]): MetricStatus {
  if (metrics.some((m) => m.status === "FAIL")) return "FAIL";
  if (metrics.some((m) => m.status === "NOT_RUN" && m.bar)) return "NOT_RUN";
  if (metrics.some((m) => m.status === "PASS")) return "PASS";
  return metrics.some((m) => m.status === "NOT_RUN") ? "NOT_RUN" : "INFO";
}

export interface ResultInput {
  readonly approach: ApproachId;
  readonly scenario: ScenarioId;
  readonly seed: number;
  readonly dryRun: boolean;
  readonly tier: HardwareTier;
  readonly quality: QualityPreset;
  readonly backend: RenderBackend;
  readonly simSeconds: number;
  readonly metrics: readonly MetricResult[];
  readonly extra?: Readonly<Record<string, number>>;
  readonly notes?: readonly string[];
  /** Set when the machine has no GPU capture (dry run, or measurements blocked). */
  readonly gpu?: string;
}

export function buildResult(i: ResultInput): ScenarioResult {
  return {
    schemaVersion: RESULT_SCHEMA_VERSION,
    approach: i.approach,
    scenario: i.scenario,
    seed: i.seed,
    dryRun: i.dryRun,
    tier: i.tier,
    quality: i.quality,
    backend: i.backend,
    status: i.dryRun ? "INFO" : worstStatus(i.metrics),
    simSeconds: i.simSeconds,
    metrics: i.metrics,
    extra: i.extra ?? {},
    notes: i.notes ?? [],
    env: {
      node: process.version,
      platform: `${process.platform}-${process.arch}`,
      cpu: os.cpus()[0]?.model ?? "unknown",
      gpu: i.gpu ?? "not captured",
    },
  };
}

const STATUS_KEYS: ReadonlySet<string> = new Set(["PASS", "FAIL", "NOT_RUN", "INFO"]);

/** Runtime check of a result file (used by tests and by the summary step). Returns problems, empty when valid. */
export function validateResult(r: unknown): string[] {
  const problems: string[] = [];
  if (typeof r !== "object" || r === null) return ["not an object"];
  const o = r as Record<string, unknown>;
  if (o.schemaVersion !== RESULT_SCHEMA_VERSION) problems.push("schemaVersion");
  for (const k of ["approach", "scenario", "tier", "quality", "backend", "status"]) {
    if (typeof o[k] !== "string") problems.push(k);
  }
  if (typeof o.status === "string" && !STATUS_KEYS.has(o.status)) problems.push("status value");
  if (typeof o.seed !== "number") problems.push("seed");
  if (typeof o.dryRun !== "boolean") problems.push("dryRun");
  if (!Array.isArray(o.metrics)) problems.push("metrics");
  else {
    for (const m of o.metrics as unknown[]) {
      const mm = m as Record<string, unknown>;
      if (typeof mm.name !== "string" || typeof mm.unit !== "string" || !STATUS_KEYS.has(String(mm.status))) {
        problems.push(`metric ${String(mm.name)}`);
      }
      if (mm.value !== null && typeof mm.value !== "number") problems.push(`metric value ${String(mm.name)}`);
    }
  }
  return problems;
}

export function resultsDir(root: string, approach: ApproachId): string {
  return path.join(root, approach);
}

/** Writes <dir>/<scenario>.json. Directory is created. Returns the file path. */
export function writeResult(dir: string, r: ScenarioResult): string {
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${r.scenario}.json`);
  writeFileSync(file, `${JSON.stringify(r, null, 2)}\n`);
  return file;
}

/** Short Markdown table that performance-reviewer and visual-qa-reviewer can quote. */
export function renderSummary(results: readonly ScenarioResult[]): string {
  const first = results[0];
  const lines: string[] = [
    `# Dust contest results: ${first?.approach ?? "?"}`,
    "",
    first?.dryRun ? "DRY RUN (stub or CPU only): plumbing check, not a contest score." : "Measured run.",
    "",
    "| Scenario | Metric | Value | Bar | Status |",
    "| --- | --- | --- | --- | --- |",
  ];
  for (const r of results) {
    for (const m of r.metrics) {
      const b = m.bar ? `${m.bar.op} ${m.bar.limit}` : "-";
      const v = m.value === null ? "n/a" : `${m.value} ${m.unit}`;
      lines.push(`| ${r.scenario} | ${m.name} | ${v} | ${b} | ${m.status}${m.note ? ` (${m.note})` : ""} |`);
    }
  }
  return `${lines.join("\n")}\n`;
}

/** Rendering-pipeline section 19 / art-direction 2.3 clean-strip readability at noon: ratio >= 1.45 and delta >= 50. */
export function readability(cleanLuma: number, dirtyLuma: number): { ratio: number; delta: number; pass: boolean } {
  const ratio = dirtyLuma > 0 ? cleanLuma / dirtyLuma : Infinity;
  const delta = cleanLuma - dirtyLuma;
  return { ratio, delta, pass: ratio >= 1.45 && delta >= 50 };
}

export function writeSummary(dir: string, results: readonly ScenarioResult[]): string {
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "SUMMARY.md");
  writeFileSync(file, renderSummary(results));
  return file;
}
