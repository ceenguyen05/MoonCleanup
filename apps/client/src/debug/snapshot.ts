// Stats export format (`window.__mcStats()`), consumed by tools/perf. Plain JSON; bump `schema` on a breaking change.
// tools/perf/src/schema.ts repeats the shape structurally (apps never import tools, tools never import apps).

import type { WindowSummary } from "./stats";

export const PERF_SNAPSHOT_SCHEMA = 1 as const;

/** How a GPU number was obtained. Estimates are never shown as measurements. */
export type GpuTimingSource = "timestamp-query" | "timer-query-webgl2" | "none";

export interface PerfSnapshot {
  readonly schema: typeof PERF_SNAPSHOT_SCHEMA;
  /** `performance.now()` at the snapshot, ms. */
  readonly atMs: number;
  readonly env: {
    readonly backend: string;
    readonly tier: string;
    readonly preset: string;
    readonly gpu: string;
    readonly userAgent: string;
    readonly dpr: number;
    readonly renderScale: number;
    readonly canvasCssPx: readonly [number, number];
  };
  /** Wall-clock interval between frames, ms (window of the latest frames). */
  readonly frameMs: WindowSummary;
  readonly fps: number;
  /** Main-thread CPU ms per frame step (`mc:<step>:update` spans), windowed. */
  readonly cpuMs: Readonly<Record<string, WindowSummary>>;
  /** Sum of all steps, windowed. */
  readonly cpuTotalMs: WindowSummary;
  readonly gpu: {
    readonly source: GpuTimingSource;
    /** `true` only when `source` is a real query; `false` means the numbers below are absent (0). */
    readonly measured: boolean;
    /** GPU time of the render call group, ms (three resolves one total, not one per pass). */
    readonly renderMs: WindowSummary;
    readonly computeMs: WindowSummary;
    /** Per-pass breakdown is not exposed by three r187 (see tools/perf/README.md). */
    readonly perPass: "unavailable";
  };
  readonly render: {
    readonly drawCalls: number;
    readonly triangles: number;
    readonly geometries: number;
    readonly textures: number;
    /** three allocation ledger (attributes, textures, uniform buffers, programs), bytes. */
    readonly gpuMemoryBytes: number;
    readonly texturesBytes: number;
    /** Pipelines created after warm-up (budgets section 8 expects 0); null until a source is wired. */
    readonly pipelinesAfterWarmup: number | null;
    readonly framesRendered: number;
    readonly lossCount: number;
  };
  readonly memory: {
    /** `performance.memory.usedJSHeapSize` (Chrome only), bytes; null elsewhere. */
    readonly jsHeapBytes: number | null;
  };
  readonly net: { readonly rttMs: number | null; readonly conn: string | null };
  /** Frames seen by the debug module. */
  readonly frames: number;
}
