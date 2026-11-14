import { createRng } from "../../rng";
import { percentiles, type Percentiles } from "../../stats";
import { createStrokeSource, DEFAULT_STROKE_SOURCE } from "./strokes";
import type { ContestGrid, DustContestTarget } from "./target";

export const CONTEST_SEED = 20261114;

export interface ContestCommon {
  readonly grid: ContestGrid;
  readonly seed: number;
  /** Simulated seconds to run (S4 standard 600, S5 standard 1800); dry runs use less. */
  readonly simSeconds: number;
  /** Plot the bot cluster is centred on (a scene bookmark plot). */
  readonly clusterPlot: number;
  /** When true, sleep so one sim second takes one wall second (needed for real servers; CPU stubs run flat out). */
  readonly realtime?: boolean;
}

export type RejectCounts = Record<string, number>;

export interface HashCheck {
  readonly checks: number;
  readonly matches: number;
  readonly matchPct: number;
}

export const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export function makeBots(common: ContestCommon, count: number, firstSlot = 0) {
  return Array.from({ length: count }, (_, i) => ({
    id: i,
    next: createStrokeSource(common.grid, {
      ...DEFAULT_STROKE_SOURCE,
      seed: common.seed,
      botIndex: i,
      clusterPlot: common.clusterPlot,
      actorSlot: firstSlot + i,
    }),
  }));
}

export function checkHashes(target: DustContestTarget, ids: readonly number[]): { total: number; match: number } {
  const server = target.serverHash();
  let match = 0;
  for (const id of ids) if (target.clientHash(id) === server) match++;
  return { total: ids.length, match };
}

export { createRng, percentiles, type Percentiles };
