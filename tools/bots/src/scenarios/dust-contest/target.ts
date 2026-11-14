// Structural view of a dust prototype that the contest bot scenarios drive. The canonical adapter interface lives in
// prototypes/dust-sim/harness/src/types.ts (DustPrototypeAdapter extends this; the harness asserts it at compile time).
// Defined here, not imported, because tools/bots must not import prototype code.
import type { PlotGrid, RobotPlotIntent, StrokeRecord } from "@moon-cleanup/shared";

/** The part of PlotGrid the stroke generators use. The harness passes the packages/world grid, or its stub grid. */
export type ContestGrid = Pick<PlotGrid, "params" | "plotAt" | "centerDirection" | "frame" | "toPlotLocal">;

export type StrokeVerdict = { readonly ok: true } | { readonly ok: false; readonly reason: string };

export interface PersistResult {
  readonly tick: number;
  readonly hash: number;
}

export interface RestoreResult {
  /** Tick of the durable state the server came back with. */
  readonly tick: number;
  readonly hash: number;
  /** Wall ms from restart request to serving. */
  readonly restoreMs: number;
}

export interface DustContestTarget {
  readonly simTickHz: number;
  joinClient(clientId: number): void | Promise<void>;
  leaveClient(clientId: number): void | Promise<void>;
  submitStroke(clientId: number, stroke: StrokeRecord): StrokeVerdict;
  /** Robot work intent (S5). Returns the intent wire bytes charged to the target. */
  submitRobotIntent(intent: RobotPlotIntent): number;
  /** Advance the simulation by whole ticks and flush echoes to clients. */
  advance(ticks: number): void | Promise<void>;
  /** Server ledger hash over all plots (fnv1a-32 chunk-hash mix of dust.ts). */
  serverHash(): number;
  /** The client's own view hash after all echoes; must equal serverHash when quiescent. */
  clientHash(clientId: number): number;
  /** Cumulative server-to-client bytes for this client since join. */
  clientBytesSent(clientId: number): number;
  /** S6: make state durable (PostgreSQL write in a real prototype). */
  persist?(): PersistResult | Promise<PersistResult>;
  /** S6: kill the server process state. */
  crash?(): void | Promise<void>;
  /** S6: bring the server back from durable state. */
  restore?(): RestoreResult | Promise<RestoreResult>;
  /** Optional server-side probes. */
  eventLoopLagP99Ms?(): number;
  serverCpuMs?(): number;
  rssMb?(): number;
}
