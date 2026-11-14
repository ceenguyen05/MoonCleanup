// Seeded Monte Carlo (progression-and-economy.md section 22.5): jitters skill (0.7-1.1), crowding and robot uptime (+-10 %)
// and reports P10 / P50 / P90 per milestone. Same seed, same numbers.
import { createRng, uniform } from "./rng";
import { runMvp, type SimOptions } from "./sim";

export interface Percentiles {
  readonly p10: number;
  readonly p50: number;
  readonly p90: number;
  /** Runs that reached the milestone inside the horizon. */
  readonly n: number;
}

export interface MonteCarloResult {
  readonly runs: number;
  readonly seed: number;
  readonly milestones: Readonly<Record<string, Percentiles>>;
}

export const MC_MILESTONES = ["first_stamp", "first_tool_upgrade", "first_dust_cell", "first_vehicle", "first_roost"];

function percentile(sorted: readonly number[], q: number): number {
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  const a = sorted[lo] as number;
  const b = sorted[hi] as number;
  return a + (b - a) * (pos - lo);
}

export function monteCarlo(base: Partial<SimOptions>, runs: number, seed: number): MonteCarloResult {
  const rng = createRng(seed);
  const samples = new Map<string, number[]>(MC_MILESTONES.map((m) => [m, []]));
  for (let i = 0; i < runs; i += 1) {
    const r = runMvp({
      ...base,
      skill: uniform(rng, 0.7, 1.1),
      crowdMult: uniform(rng, 0.9, 1.1),
      uptimeMult: uniform(rng, 0.9, 1.1),
      stopAfter: "first_roost",
      horizonH: 6,
    });
    for (const m of MC_MILESTONES) {
      const t = r.milestonesS[m];
      if (t !== undefined) samples.get(m)?.push(t);
    }
  }
  const milestones: Record<string, Percentiles> = {};
  for (const [m, values] of samples) {
    if (values.length === 0) continue;
    const sorted = [...values].sort((a, b) => a - b);
    milestones[m] = {
      p10: percentile(sorted, 0.1),
      p50: percentile(sorted, 0.5),
      p90: percentile(sorted, 0.9),
      n: sorted.length,
    };
  }
  return { runs, seed, milestones };
}
