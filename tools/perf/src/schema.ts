// Shapes shared by the capture runner, summary and budget report. `PerfSnapshot` repeats, structurally, what
// apps/client/src/debug/snapshot.ts exports through `window.__mcStats()` (apps and tools never import each other).

export interface WindowSummary {
  readonly samples: number;
  readonly avg: number;
  readonly min: number;
  readonly max: number;
  readonly p50: number;
  readonly p95: number;
  readonly p99: number;
}

export interface PerfSnapshot {
  readonly schema: 1;
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
  readonly frameMs: WindowSummary;
  readonly fps: number;
  readonly cpuMs: Readonly<Record<string, WindowSummary>>;
  readonly cpuTotalMs: WindowSummary;
  readonly gpu: {
    readonly source: "timestamp-query" | "timer-query-webgl2" | "none";
    readonly measured: boolean;
    readonly renderMs: WindowSummary;
    readonly computeMs: WindowSummary;
    readonly perPass: "unavailable";
  };
  readonly render: {
    readonly drawCalls: number;
    readonly triangles: number;
    readonly geometries: number;
    readonly textures: number;
    readonly gpuMemoryBytes: number;
    readonly texturesBytes: number;
    readonly pipelinesAfterWarmup: number | null;
    readonly framesRendered: number;
    readonly lossCount: number;
  };
  readonly memory: { readonly jsHeapBytes: number | null };
  readonly net: { readonly rttMs: number | null; readonly conn: string | null };
  readonly frames: number;
}

export type HardwareTierLetter = "A" | "B" | "C";

/** Machine description stated in every result so numbers are not misread. */
export interface MachineInfo {
  readonly cpu: string;
  readonly cores: number;
  readonly ramGb: number;
  readonly os: string;
  readonly gpu: string;
  readonly browser: string;
  readonly adapterFlag: string;
  readonly nodeVersion: string;
}

/** Metrics of one capture run (60 s after warm-up). Frame stats are over every frame of the run; the others are medians of the HUD windows. */
export interface RunMetrics {
  readonly frameMsP50: number;
  readonly frameMsP95: number;
  readonly frameMsP99: number;
  readonly fps: number;
  readonly frames: number;
  readonly cpuTotalMsP50: number;
  readonly cpuTotalMsP95: number;
  readonly cpuStepMsP95: Readonly<Record<string, number>>;
  /** null when GPU timing was unavailable: never an estimate presented as a measurement. */
  readonly gpuRenderMsP50: number | null;
  readonly gpuRenderMsP95: number | null;
  readonly drawCalls: number;
  readonly triangles: number;
  readonly gpuMemoryBytes: number;
  readonly jsHeapBytes: number | null;
  readonly pipelinesAfterWarmup: number | null;
  readonly lossCount: number;
}

export interface Aggregate {
  readonly median: number;
  readonly min: number;
  readonly max: number;
  readonly runs: number;
}

export interface CaptureResult {
  readonly kind: "client-capture";
  readonly createdAt: string;
  readonly milestone: string;
  readonly scene: string;
  readonly seed: string;
  readonly cameraPath: string;
  readonly tier: HardwareTierLetter;
  readonly preset: string;
  readonly backend: string;
  readonly warmupS: number;
  readonly captureS: number;
  readonly machine: MachineInfo;
  /** `true` unless the machine is a real device of the named tier (the only available laptop is an Intel UHD 620). */
  readonly provisional: boolean;
  readonly gpuTimingSource: PerfSnapshot["gpu"]["source"];
  readonly runs: readonly RunMetrics[];
  readonly aggregate: Readonly<Record<string, Aggregate | null>>;
  readonly lastSnapshot: PerfSnapshot;
}

/** Subset of the room stats line / bot-test report the budget report reads. */
export interface ServerReport {
  readonly tick?: { readonly p50Ms: number; readonly p95Ms: number; readonly maxMs: number };
  readonly eventLoopDelayP99Ms?: number;
  readonly bytesOutPerClientPerSec?: number;
  readonly maxStallMs?: number;
}

export interface DownloadSizes {
  /** Gzipped bytes of all JS in dist. */
  readonly jsGzipBytes: number;
  /** Gzipped bytes of everything in dist (first-load upper bound: the whole static output). */
  readonly totalGzipBytes: number;
  readonly files: number;
}
