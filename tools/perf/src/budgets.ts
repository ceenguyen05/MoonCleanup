// Budget comparison: numbers copied from docs/architecture/performance-budgets.md sections 2 to 6 (that document is
// the only pass/fail source; a change there is a change here). This module REPORTS pass/fail with margin and never
// decides: performance-reviewer issues the verdict. A budget with no input is UNVERIFIED, never a silent pass.

import type { CaptureResult, DownloadSizes, HardwareTierLetter, ServerReport } from "./schema";

export type BudgetStatus = "PASS" | "FAIL" | "UNVERIFIED";

export interface BudgetRow {
  readonly id: string;
  readonly label: string;
  /** Doc section the limit comes from. */
  readonly source: string;
  readonly unit: string;
  readonly limit: number;
  /** Measured (median over runs) or null when unavailable. */
  readonly value: number | null;
  readonly status: BudgetStatus;
  /** limit - value; positive means headroom. null when UNVERIFIED. */
  readonly margin: number | null;
  readonly note: string;
}

const MB = 1024 * 1024;
const GB = 1024 * MB;

type PerTier = Readonly<Record<HardwareTierLetter, number>>;

interface ClientBudget {
  readonly id: string;
  readonly label: string;
  readonly source: string;
  readonly unit: string;
  readonly limit: PerTier;
  /** Aggregate key in `CaptureResult.aggregate`. */
  readonly metric: string;
  readonly scale?: number;
  readonly requiresGpuTiming?: boolean;
}

/** Client budgets. CPU lines are main-thread; GPU lines need timestamp or timer queries. */
export const CLIENT_BUDGETS: readonly ClientBudget[] = [
  {
    id: "frame.p95",
    label: "Frame interval (p95)",
    source: "section 1",
    unit: "ms",
    limit: { A: 16.7, B: 33.3, C: 33.3 },
    metric: "frameMsP95",
  },
  {
    id: "cpu.total.p95",
    label: "Main-thread CPU per frame (p95)",
    source: "section 2",
    unit: "ms",
    limit: { A: 8, B: 14, C: 15 },
    metric: "cpuTotalMsP95",
  },
  {
    id: "cpu.render.p95",
    label: "Render submit CPU (p95)",
    source: "section 2",
    unit: "ms",
    limit: { A: 2, B: 3.5, C: 4.5 },
    metric: "cpuStep.render",
  },
  {
    id: "cpu.net.p95",
    label: "Net ingest CPU (p95)",
    source: "section 2",
    unit: "ms",
    limit: { A: 0.5, B: 0.8, C: 0.8 },
    metric: "cpuStep.net",
  },
  {
    id: "cpu.ui.p95",
    label: "UI flush CPU (p95)",
    source: "section 2",
    unit: "ms",
    limit: { A: 0.3, B: 0.6, C: 0.6 },
    metric: "cpuStep.ui",
  },
  {
    id: "gpu.total.p95",
    label: "GPU frame time (p95)",
    source: "section 3",
    unit: "ms",
    limit: { A: 14, B: 28, C: 28 },
    metric: "gpuRenderMsP95",
    requiresGpuTiming: true,
  },
  {
    id: "draws",
    label: "Draw calls per frame",
    source: "section 4",
    unit: "calls",
    limit: { A: 600, B: 350, C: 350 },
    metric: "drawCalls",
  },
  {
    id: "tris",
    label: "Triangles per frame",
    source: "section 4",
    unit: "tris",
    limit: { A: 4_000_000, B: 1_500_000, C: 1_000_000 },
    metric: "triangles",
  },
  {
    id: "pipelines",
    label: "Pipelines created after warm-up",
    source: "section 4",
    unit: "count",
    limit: { A: 0, B: 0, C: 0 },
    metric: "pipelinesAfterWarmup",
  },
  {
    id: "gpumem",
    label: "GPU memory (engine ledger)",
    source: "section 4",
    unit: "MB",
    limit: { A: (3 * GB) / MB, B: (1.25 * GB) / MB, C: GB / MB },
    metric: "gpuMemoryBytes",
    scale: 1 / MB,
  },
  {
    id: "heap",
    label: "JS heap used",
    source: "section 4",
    unit: "MB",
    limit: { A: 400, B: 300, C: 300 },
    metric: "jsHeapBytes",
    scale: 1 / MB,
  },
];

/** Frame-rate floor: 60 FPS on A, 30 on B and C at the preset's target (budgets section 1 per-tier targets). */
export const FPS_FLOOR: PerTier = { A: 60, B: 30, C: 30 };

function row(
  b: Pick<BudgetRow, "id" | "label" | "source" | "unit" | "limit">,
  value: number | null,
  note = "",
  floor = false,
): BudgetRow {
  if (value === null) return { ...b, value: null, status: "UNVERIFIED", margin: null, note: note || "no input" };
  const margin = floor ? value - b.limit : b.limit - value;
  return { ...b, value, status: margin >= 0 ? "PASS" : "FAIL", margin, note };
}

/** Compares one client capture with the budgets of its tier. */
export function compareClient(result: CaptureResult): BudgetRow[] {
  const tier = result.tier;
  const rows: BudgetRow[] = [];
  const provisional = result.provisional ? "provisional hardware" : "";
  for (const b of CLIENT_BUDGETS) {
    const agg = result.aggregate[b.metric] ?? null;
    const noGpu = b.requiresGpuTiming === true && result.gpuTimingSource === "none";
    const raw = agg === null || noGpu ? null : agg.median * (b.scale ?? 1);
    const note = noGpu ? "CPU only: no GPU timer query on this backend" : provisional;
    rows.push(row({ id: b.id, label: b.label, source: b.source, unit: b.unit, limit: b.limit[tier] }, raw, note));
  }
  const fps = result.aggregate["fps"] ?? null;
  rows.push(
    row(
      { id: "fps", label: "Frame rate (median of runs)", source: "section 1", unit: "FPS", limit: FPS_FLOOR[tier] },
      fps === null ? null : fps.median,
      provisional,
      true,
    ),
  );
  return rows;
}

/** Download budgets (section 5): JS <= 1.5 MB gz; whole first-load group <= 20 MB. */
export function compareDownload(sizes: DownloadSizes): BudgetRow[] {
  return [
    row(
      { id: "dl.js", label: "JS, gzipped", source: "section 5", unit: "MB", limit: 1.5 },
      sizes.jsGzipBytes / MB,
      `${sizes.files} files`,
    ),
    row(
      {
        id: "dl.total",
        label: "dist/ total, gzipped (upper bound of first load)",
        source: "section 5",
        unit: "MB",
        limit: 20,
      },
      sizes.totalGzipBytes / MB,
    ),
  ];
}

/** Server budgets (section 6) from a bot-test / room stats report; 6-player room figures. */
export function compareServer(report: ServerReport | null): BudgetRow[] {
  const none = report === null;
  return [
    row(
      { id: "srv.tick.p95", label: "Room tick p95 (6 players)", source: "section 6", unit: "ms", limit: 3.5 },
      none ? null : (report.tick?.p95Ms ?? null),
    ),
    row(
      { id: "srv.tick.max", label: "Room tick max", source: "section 6", unit: "ms", limit: 8 },
      none ? null : (report.tick?.maxMs ?? null),
    ),
    row(
      { id: "srv.elp99", label: "Event-loop delay p99", source: "section 6", unit: "ms", limit: 20 },
      none ? null : (report.eventLoopDelayP99Ms ?? null),
    ),
    row(
      { id: "srv.stall", label: "Max process stall (GC traced)", source: "section 6", unit: "ms", limit: 50 },
      none ? null : (report.maxStallMs ?? null),
    ),
    row(
      { id: "srv.bw", label: "Bandwidth per client (busy)", source: "section 6", unit: "KB/s", limit: 5 },
      none ? null : report.bytesOutPerClientPerSec === undefined ? null : report.bytesOutPerClientPerSec / 1000,
    ),
  ];
}

export function formatBudgetRows(rows: readonly BudgetRow[]): string {
  const lines = [
    "| Budget | Source | Value | Limit | Margin | Status | Note |",
    "| --- | --- | --- | --- | --- | --- | --- |",
  ];
  for (const r of rows) {
    const fmt = (n: number | null): string => (n === null ? "n/a" : Number(n.toPrecision(4)).toString());
    lines.push(
      `| ${r.label} | ${r.source} | ${fmt(r.value)} ${r.unit} | ${fmt(r.limit)} ${r.unit} | ${fmt(r.margin)} | ${r.status} | ${r.note} |`,
    );
  }
  return lines.join("\n");
}
