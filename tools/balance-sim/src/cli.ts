// balance-sim CLI. Usage:
//   pnpm --filter @moon-cleanup/balance-sim balance -- [--runs N] [--seed S] [--players 1,2,4] [--assert] [--out DIR]
// Writes report.md, report.json, curves-<N>p.csv and purchases-<N>p.csv to `out/` (git-ignored). `--assert` exits 1 when any
// mvp pacing row is FAIL (outside its band and toleranceFrac); rows outside the strict band but inside the tolerance warn.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadGameData } from "@moon-cleanup/game-data";
import { MODEL_CONSTANTS } from "./model";
import { monteCarlo, type MonteCarloResult } from "./monte-carlo";
import { curvesCsv, purchasesCsv, toJson, toMarkdown, type Report } from "./report";
import type { RunResult } from "./sim";
import { evaluateTargets, runKey, runNominal } from "./targets";

interface Args {
  runs: number;
  seed: number;
  players: number[] | undefined;
  assert: boolean;
  out: string;
}

function parseArgs(argv: readonly string[]): Args {
  const here = dirname(fileURLToPath(import.meta.url));
  const args: Args = { runs: 1, seed: 1, players: undefined, assert: false, out: resolve(here, "..", "out") };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    const next = (): string => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`${a} needs a value`);
      return v;
    };
    if (a === "--runs") args.runs = Number(next());
    else if (a === "--seed") args.seed = Number(next());
    else if (a === "--players") args.players = next().split(",").map(Number);
    else if (a === "--assert") args.assert = true;
    else if (a === "--out") args.out = resolve(next());
    else if (a === "--") continue;
    else throw new Error(`unknown argument ${a}`);
  }
  if (!Number.isInteger(args.runs) || args.runs < 1) throw new Error("--runs must be a positive integer");
  if (!Number.isFinite(args.seed)) throw new Error("--seed must be a number");
  return args;
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const data = loadGameData();
  const nominal = runNominal(data);
  const targets = evaluateTargets(data, nominal);
  const monte: Record<string, MonteCarloResult> = {};
  if (args.runs > 1) {
    const wanted = new Set(args.players ?? [...nominal.values()].map((r) => r.options.players));
    for (const [key, run] of nominal) {
      if (!wanted.has(run.options.players)) continue;
      monte[key] = monteCarlo(
        { players: run.options.players, attendanceFrac: run.options.attendanceFrac, data },
        args.runs,
        args.seed,
      );
    }
  }
  const runs: Record<string, RunResult> = Object.fromEntries(nominal);
  const report: Report = {
    policy: "mvp",
    seed: args.seed,
    constants: MODEL_CONSTANTS,
    targets,
    runs,
    monteCarlo: monte,
  };
  mkdirSync(args.out, { recursive: true });
  writeFileSync(join(args.out, "report.md"), toMarkdown(report));
  writeFileSync(join(args.out, "report.json"), toJson(report));
  for (const run of nominal.values()) {
    const n = runKey(run.options.players, run.options.attendanceFrac);
    writeFileSync(join(args.out, `curves-${n}.csv`), curvesCsv(run));
    writeFileSync(join(args.out, `purchases-${n}.csv`), purchasesCsv(run));
  }
  for (const t of targets) {
    const v = t.value === undefined ? "-" : t.value.toFixed(2);
    console.log(
      `${t.verdict.padEnd(9)} ${t.id.padEnd(40)} ${v.padStart(7)} ${t.unit} (band ${t.min}-${t.max}) ${t.note}`,
    );
  }
  const failed = targets.filter((t) => t.verdict === "FAIL");
  console.log(`report: ${join(args.out, "report.md")}`);
  if (failed.length > 0) {
    console.error(`balance-sim: ${failed.length} pacing row(s) FAIL: ${failed.map((t) => t.id).join(", ")}`);
    if (args.assert) process.exit(1);
  }
}

main();
