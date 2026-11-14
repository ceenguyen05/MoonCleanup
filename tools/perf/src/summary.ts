// Run aggregation and the Markdown summary of a capture.

import { formatBudgetRows, type BudgetRow } from "./budgets";
import type { Aggregate, CaptureResult, RunMetrics } from "./schema";
import { aggregate, relativeSpread } from "./stats";

const SCALAR_KEYS = [
  "frameMsP50",
  "frameMsP95",
  "frameMsP99",
  "fps",
  "frames",
  "cpuTotalMsP50",
  "cpuTotalMsP95",
  "gpuRenderMsP50",
  "gpuRenderMsP95",
  "drawCalls",
  "triangles",
  "gpuMemoryBytes",
  "jsHeapBytes",
  "pipelinesAfterWarmup",
  "lossCount",
] as const satisfies readonly (keyof RunMetrics)[];

/** Median and min/max across runs for every metric; `cpuStep.<id>` keys carry the per-step p95s. Null metrics are skipped. */
export function aggregateRuns(runs: readonly RunMetrics[]): Record<string, Aggregate | null> {
  const out: Record<string, Aggregate | null> = {};
  for (const key of SCALAR_KEYS) {
    const values = runs.map((r) => r[key]).filter((v): v is number => v !== null);
    out[key] = values.length === runs.length ? aggregate(values) : null;
  }
  const steps = new Set<string>();
  for (const r of runs) for (const id of Object.keys(r.cpuStepMsP95)) steps.add(id);
  for (const id of steps) out[`cpuStep.${id}`] = aggregate(runs.map((r) => r.cpuStepMsP95[id] ?? 0));
  return out;
}

function cell(a: Aggregate | null | undefined, digits = 2): string {
  if (a === null || a === undefined) return "n/a";
  const f = (n: number): string => n.toFixed(digits);
  return `${f(a.median)} (${f(a.min)} to ${f(a.max)}, spread ${(relativeSpread(a) * 100).toFixed(0)}%)`;
}

export function renderSummary(result: CaptureResult, budgetRows: readonly BudgetRow[]): string {
  const m = result.machine;
  const a = result.aggregate;
  const lines: string[] = [
    `# Perf capture: ${result.scene} / tier ${result.tier} / ${result.preset} / ${result.backend}`,
    "",
    `Created ${result.createdAt}. Milestone ${result.milestone}. **${result.provisional ? "PROVISIONAL" : "Reference"} hardware.**`,
    "",
    "## Machine",
    "",
    `- CPU: ${m.cpu} (${m.cores} threads), RAM ${m.ramGb} GB`,
    `- GPU: ${m.gpu}`,
    `- Browser: ${m.browser}; adapter flag: ${m.adapterFlag}`,
    `- OS: ${m.os}; Node ${m.nodeVersion}`,
    "",
    "## Method",
    "",
    `Seed ${result.seed}; camera path "${result.cameraPath}"; ${result.warmupS} s warm-up discarded, ${result.captureS} s capture; ${result.runs.length} run(s). Values are median over runs (min to max across runs). Frame statistics cover every frame of each run. CPU and GPU lines are medians of the HUD's 240-frame windows (labeled p50/p95 of those windows).`,
    `GPU timing source: **${result.gpuTimingSource}**${result.gpuTimingSource === "none" ? " (CPU only: GPU numbers are absent, not estimated)" : " (measured; per-pass split unavailable in three r187, one render total)"}.`,
    "",
    "## Results",
    "",
    "| Metric | Value |",
    "| --- | --- |",
    `| FPS | ${cell(a["fps"], 1)} |`,
    `| Frame p50 / p95 / p99 (ms) | ${cell(a["frameMsP50"])} / ${cell(a["frameMsP95"])} / ${cell(a["frameMsP99"])} |`,
    `| CPU total p50 / p95 (ms) | ${cell(a["cpuTotalMsP50"])} / ${cell(a["cpuTotalMsP95"])} |`,
    `| GPU render p50 / p95 (ms) | ${cell(a["gpuRenderMsP50"])} / ${cell(a["gpuRenderMsP95"])} |`,
    `| Draw calls | ${cell(a["drawCalls"], 0)} |`,
    `| Triangles | ${cell(a["triangles"], 0)} |`,
    `| GPU memory ledger (bytes) | ${cell(a["gpuMemoryBytes"], 0)} |`,
    `| JS heap (bytes) | ${cell(a["jsHeapBytes"], 0)} |`,
    `| Pipelines after warm-up | ${cell(a["pipelinesAfterWarmup"], 0)} |`,
    `| Device losses | ${cell(a["lossCount"], 0)} |`,
    "",
    "### CPU per step, p95 of windows (ms)",
    "",
    "| Step | p95 |",
    "| --- | --- |",
  ];
  for (const [key, value] of Object.entries(a)) {
    if (key.startsWith("cpuStep.") && value !== null && value.max > 0)
      lines.push(`| ${key.slice(8)} | ${cell(value)} |`);
  }
  lines.push(
    "",
    "## Budget comparison (reports only; performance-reviewer decides)",
    "",
    formatBudgetRows(budgetRows),
    "",
  );
  return lines.join("\n");
}
