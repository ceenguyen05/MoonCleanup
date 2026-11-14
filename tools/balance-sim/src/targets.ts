// Evaluates `pacing-targets.json` rows of policy `mvp` against nominal sim runs. Rows of other policies (`efficient`,
// the full v1.0 game) need the v1.0 simulator and are reported as SKIPPED, never as passes.
import type { GameData } from "@moon-cleanup/game-data";
import { runMvp, type RunResult, type SimOptions } from "./sim";

/** pacing-targets.json `milestone` token to the sim's milestone key (time metrics). */
export const MILESTONE_KEYS: Readonly<Record<string, string>> = {
  first_stamp: "first_stamp",
  first_tool_upgrade: "first_tool_upgrade",
  first_dust_cell: "first_dust_cell",
  first_vehicle: "first_vehicle",
  first_roost: "first_roost",
};

export type Verdict = "PASS" | "PASS_EDGE" | "FAIL" | "SKIPPED";

export interface TargetResult {
  readonly id: string;
  readonly milestone: string;
  readonly players: number;
  readonly policy: string;
  readonly metric: string;
  readonly unit: string;
  readonly min: number;
  readonly max: number;
  readonly toleranceFrac: number;
  /** Measured value in the row's unit; undefined when SKIPPED or the milestone never happened. */
  readonly value: number | undefined;
  readonly verdict: Verdict;
  readonly note: string;
}

const UNIT_S: Readonly<Record<string, number>> = { min: 60, h: 3600 };

export function runKey(players: number, attendanceFrac: number): string {
  return `${players}p@${attendanceFrac}`;
}

/** One nominal efficient run per distinct (players, attendance) pair used by the mvp rows. */
export function runNominal(data: GameData, extra: Partial<SimOptions> = {}): Map<string, RunResult> {
  const runs = new Map<string, RunResult>();
  for (const row of data["pacing-targets"].targets) {
    if (row.policy !== "mvp") continue;
    const key = runKey(row.players, row.attendanceFrac);
    if (runs.has(key)) continue;
    runs.set(key, runMvp({ players: row.players, attendanceFrac: row.attendanceFrac, data, horizonH: 12, ...extra }));
  }
  return runs;
}

export function evaluateTargets(data: GameData, runs: ReadonlyMap<string, RunResult>): TargetResult[] {
  return data["pacing-targets"].targets.map((row): TargetResult => {
    const base = {
      id: row.id,
      milestone: row.milestone,
      players: row.players,
      policy: row.policy,
      metric: row.metric,
      unit: row.unit,
      min: row.min,
      max: row.max,
      toleranceFrac: row.toleranceFrac,
    };
    if (row.policy !== "mvp") {
      return { ...base, value: undefined, verdict: "SKIPPED", note: `policy ${row.policy} needs the v1.0 simulator` };
    }
    const run = runs.get(runKey(row.players, row.attendanceFrac));
    const unitS = UNIT_S[row.unit];
    if (!run || unitS === undefined) {
      return { ...base, value: undefined, verdict: "FAIL", note: `no run or unknown unit ${row.unit}` };
    }
    let seconds: number | undefined;
    if (row.metric === "time") {
      const key = MILESTONE_KEYS[row.milestone];
      if (key === undefined) {
        return { ...base, value: undefined, verdict: "FAIL", note: `no sim milestone for ${row.milestone}` };
      }
      seconds = run.milestonesS[key];
    } else if (row.metric === "gapMedian") seconds = run.gapMedianS;
    else if (row.metric === "gapMax") seconds = run.gapMaxS;
    else return { ...base, value: undefined, verdict: "FAIL", note: `metric ${row.metric} not modelled` };
    if (seconds === undefined) {
      return { ...base, value: undefined, verdict: "FAIL", note: "milestone never reached inside the horizon" };
    }
    const value = seconds / unitS;
    const inBand = value >= row.min && value <= row.max;
    const inTolerance = value >= row.min * (1 - row.toleranceFrac) && value <= row.max * (1 + row.toleranceFrac);
    const verdict: Verdict = inBand ? "PASS" : inTolerance ? "PASS_EDGE" : "FAIL";
    const note = inBand ? "" : inTolerance ? "outside the band, inside toleranceFrac" : "outside band and tolerance";
    return { ...base, value, verdict, note };
  });
}
