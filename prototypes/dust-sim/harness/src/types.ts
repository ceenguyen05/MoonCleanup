// Dust-sim contest harness: the prototype adapter interface and the metric schema.
// Specification: docs/architecture/world-and-dust-simulation.md section 10 (scenarios S1 to S8, pass bars).
import type { DustContestTarget } from "../../../../tools/bots/src/scenarios/dust-contest/index";

export type { ContestGrid } from "../../../../tools/bots/src/scenarios/dust-contest/index";
import type { ContestGrid } from "../../../../tools/bots/src/scenarios/dust-contest/index";

export type ApproachId = "p1-scalar-procedural" | "p2-stroke-atlas-ledger" | "p3-client-paint-minmerge" | "stub";
export type ScenarioId = "S1" | "S2" | "S3" | "S4" | "S5" | "S6" | "S7" | "S8";
export type HardwareTier = "A" | "B" | "floor";
export type QualityPreset = "low" | "medium" | "high";
export type RenderBackend = "webgpu" | "webgl2";

/** Passed to adapter.start(). Everything a prototype needs to be reproducible. */
export interface AdapterStartContext {
  readonly approach: ApproachId;
  readonly seed: number;
  /** packages/world grid (or the harness stub grid in the dry run). */
  readonly grid: ContestGrid;
  readonly simTickHz: number;
  readonly tier: HardwareTier;
  readonly quality: QualityPreset;
  readonly backend: RenderBackend;
  /** Where the adapter may write its own artifacts (results/<approach>/artifacts). */
  readonly outDir: string;
}

/** Moon-centred camera pose in metres. +Y north pole, +X lat 0 lon 0, -Z 90 E (plot-grid.ts axes). */
export interface CameraPose {
  readonly tSec: number;
  readonly position: readonly [number, number, number];
  /** Unit view direction. */
  readonly forward: readonly [number, number, number];
  /** Unit up vector (local surface normal for ground cameras). */
  readonly up: readonly [number, number, number];
  /** Metres above the reference sphere (1.7 for the S1 walker). */
  readonly heightM: number;
  readonly sunElevationDeg: number;
  /** Degrees clockwise from north looking down, in the site frame. */
  readonly sunAzimuthDeg: number;
}

/** What the player is doing at a camera sample; null when not cleaning. */
export interface CleaningState {
  /** Unit direction of the tool head on the reference sphere. */
  readonly headDir: readonly [number, number, number];
  readonly toolCode: number;
  readonly widthCm: number;
  readonly depth16: number;
}

/** One rendered (or simulated) frame as reported by the adapter. Omit what a prototype cannot measure. */
export interface FrameSample {
  /** CPU ms of the dust-related frame work (tile work, replay, uploads). */
  readonly cpuMs: number;
  /** GPU ms of all dust passes this frame (timestamp queries; omit when unavailable). */
  readonly dustGpuMs?: number;
  /** Frame delta ms when timestamps are unavailable. */
  readonly frameDeltaMs?: number;
  readonly replayMs?: number;
  readonly tileUploads?: number;
  readonly tileRebuildMs?: number;
}

export interface LateJoinResult {
  /** Bytes the client must receive before it can play (blocking part). */
  readonly blockingBytes: number;
  readonly streamedBytes: number;
  /** Wall ms from connect to playable. */
  readonly playableMs: number;
  readonly tileRebuildMs: number;
}

/**
 * The prototype adapter: the only surface the harness and the bot scenarios touch. A prototype folder exports
 * `createAdapter(): DustPrototypeAdapter` from `<approach>/harness-adapter.ts`; the harness CLI loads it by path.
 *
 * Extends DustContestTarget (bots side): joinClient, leaveClient, submitStroke, submitRobotIntent, advance, serverHash,
 * clientHash, clientBytesSent, optional persist/crash/restore and server probes. Required semantics:
 *  - Time is simulated: `advance(n)` moves n ticks and delivers every echo, so hashes are comparable right after it.
 *  - `submitStroke` returns `{ ok: false, reason }` for a rejected stroke (reasons: STROKE_REJECT_REASONS of the shared
 *    contract); never throws for a bad stroke.
 *  - Hashes are 32-bit unsigned; serverHash and clientHash use the same mixing, so equality means identical state.
 *  - Strokes arrive in plot-local millimetres with the anchor plot, exactly as the shared StrokeRecord.
 */
export interface DustPrototypeAdapter extends DustContestTarget {
  readonly approach: ApproachId;
  /** True only for the harness stub; its numbers are never scored. */
  readonly isStub: boolean;
  start(ctx: AdapterStartContext): Promise<void>;
  stop(): Promise<void>;
  /**
   * Render-side hook for S1/S2/S3/S8. Called once per camera sample, in order. Headless adapters may only do the CPU
   * part; GPU adapters render and return timestamps.
   */
  view?(pose: CameraPose, cleaning: CleaningState | null): FrameSample;
  /** S1: measured edge width in screen pixels of a clean/dirty boundary at `distanceM`; null when unmeasurable. */
  measureEdgeWidthPx?(distanceM: number): number | null;
  /** S7: join a new client after the world has aged and report the snapshot cost. */
  lateJoin?(clientId: number): LateJoinResult | Promise<LateJoinResult>;
  /** Native-resolution PNG at a bookmark pose. Never downscale. Not called in the CPU dry run. */
  capture?(bookmarkId: string, pose: CameraPose, outPath: string): Promise<void>;
  /** Free-form extra numbers merged into the scenario result under `extra` (bytes of log, atlas occupancy, ...). */
  exportMetrics?(): Record<string, number>;
}

// ---- Metric schema (JSON written to prototypes/dust-sim/results/<approach>/) ----------------------------------------

export const RESULT_SCHEMA_VERSION = 1;

export type Comparator = "<=" | ">=" | "==";

/** A pass bar, e.g. { op: "<=", limit: 20 } for "event-loop lag p99 <= 20 ms". */
export interface Bar {
  readonly op: Comparator;
  readonly limit: number;
  readonly source: string;
}

export type MetricStatus = "PASS" | "FAIL" | "NOT_RUN" | "INFO";

export interface MetricResult {
  /** Stable key, e.g. "tickMs.p99". */
  readonly name: string;
  readonly value: number | null;
  readonly unit: string;
  readonly bar: Bar | null;
  /** PASS/FAIL when a bar applies and value is known; NOT_RUN when it could not be measured; INFO without a bar. */
  readonly status: MetricStatus;
  /** Why NOT_RUN, or any caveat. */
  readonly note?: string;
}

export interface ScenarioResult {
  readonly schemaVersion: typeof RESULT_SCHEMA_VERSION;
  readonly approach: ApproachId;
  readonly scenario: ScenarioId;
  readonly seed: number;
  /** Stub or CPU dry run: numbers are plumbing checks, never contest scores. */
  readonly dryRun: boolean;
  readonly tier: HardwareTier;
  readonly quality: QualityPreset;
  readonly backend: RenderBackend;
  /** Worst metric status; NOT_RUN if any bar metric is unmeasured and none failed. */
  readonly status: MetricStatus;
  readonly simSeconds: number;
  readonly metrics: readonly MetricResult[];
  readonly extra: Readonly<Record<string, number>>;
  readonly notes: readonly string[];
  readonly env: {
    readonly node: string;
    readonly platform: string;
    readonly cpu: string;
    readonly gpu: string;
  };
}
