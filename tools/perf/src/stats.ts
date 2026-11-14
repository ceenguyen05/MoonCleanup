// Statistics for capture runs: nearest-rank percentiles over the full sample set, and median/spread across runs.

import type { Aggregate } from "./schema";

/** Nearest-rank percentile (q in [0, 1]) of unsorted values; 0 for an empty list. Does not mutate the input. */
export function percentile(values: readonly number[], q: number): number {
  if (values.length === 0) return 0;
  const sorted = Float64Array.from(values).sort();
  const rank = Math.max(1, Math.ceil(Math.min(1, Math.max(0, q)) * sorted.length));
  return sorted[rank - 1] ?? 0;
}

export function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = Float64Array.from(values).sort();
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1 ? (sorted[mid] ?? 0) : ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
}

export function aggregate(values: readonly number[]): Aggregate | null {
  if (values.length === 0) return null;
  return { median: median(values), min: Math.min(...values), max: Math.max(...values), runs: values.length };
}

/** Spread of an aggregate as a fraction of its median (0 when the median is 0). */
export function relativeSpread(a: Aggregate): number {
  return a.median === 0 ? 0 : (a.max - a.min) / a.median;
}
