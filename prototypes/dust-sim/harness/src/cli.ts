// Harness CLI.
//   run   --adapter <path|stub> --approach <id> [--scenarios S1,S4] [--tier A|B|floor] [--quality ..] [--backend ..]
//         [--max-sim-seconds N] [--fps N] [--realtime] [--results <dir>]
//   pairs --a-name P1 --a-dir <dir> --b-name P2 --b-dir <dir> --out <dir>
//   bookmarks               prints the scene bookmarks as JSON
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { generatePairs } from "./ab-pairs";
import { createStubGrid } from "./geometry";
import { runScenarios } from "./run";
import { makeBookmarks } from "./scene";
import { createStubAdapter } from "./stub-adapter";
import type { ApproachId, DustPrototypeAdapter, HardwareTier, QualityPreset, RenderBackend, ScenarioId } from "./types";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_RESULTS = path.resolve(HERE, "../../results");
const ALL: ScenarioId[] = ["S1", "S2", "S3", "S4", "S5", "S6", "S7", "S8"];

function args(argv: readonly string[]): Map<string, string> {
  const m = new Map<string, string>();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] ?? "";
    if (!a.startsWith("--")) continue;
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) m.set(a.slice(2), "true");
    else {
      m.set(a.slice(2), next);
      i++;
    }
  }
  return m;
}

async function loadAdapter(spec: string): Promise<DustPrototypeAdapter> {
  if (spec === "stub") return createStubAdapter();
  const mod = (await import(pathToFileURL(path.resolve(spec)).href)) as { createAdapter?: () => DustPrototypeAdapter };
  if (!mod.createAdapter) throw new Error(`${spec} does not export createAdapter()`);
  return mod.createAdapter();
}

async function main(): Promise<void> {
  const [cmd, ...rest] = process.argv.slice(2);
  const a = args(rest);
  if (cmd === "bookmarks") {
    console.log(JSON.stringify(makeBookmarks(), null, 2));
    return;
  }
  if (cmd === "pairs") {
    const need = (k: string): string => {
      const v = a.get(k);
      if (!v) throw new Error(`missing --${k}`);
      return v;
    };
    const r = generatePairs({
      nameA: need("a-name"),
      dirA: path.resolve(need("a-dir")),
      nameB: need("b-name"),
      dirB: path.resolve(need("b-dir")),
      outDir: path.resolve(need("out")),
    });
    console.log(`pairs=${r.pairs} skipped=${r.skipped.length} sheet=${r.sheetPath} key=${r.keyPath}`);
    return;
  }
  if (cmd === "run") {
    const adapter = await loadAdapter(a.get("adapter") ?? "stub");
    // The stub grid is the dry-run grid; real runs pass --grid <module exporting createGrid()> (packages/world lands in M1-W1).
    let grid = createStubGrid();
    const gridSpec = a.get("grid");
    if (gridSpec) {
      const mod = (await import(pathToFileURL(path.resolve(gridSpec)).href)) as { createGrid?: () => typeof grid };
      if (!mod.createGrid) throw new Error(`${gridSpec} does not export createGrid()`);
      grid = mod.createGrid();
    }
    const scenarios = (a.get("scenarios") ?? ALL.join(",")).split(",") as ScenarioId[];
    const maxSim = Number(a.get("max-sim-seconds") ?? 0);
    const results = await runScenarios({
      adapter,
      grid,
      resultsRoot: path.resolve(a.get("results") ?? DEFAULT_RESULTS),
      scenarios,
      tier: (a.get("tier") ?? "B") as HardwareTier,
      quality: (a.get("quality") ?? "medium") as QualityPreset,
      backend: (a.get("backend") ?? "webgpu") as RenderBackend,
      maxSimSeconds: maxSim,
      fps: Number(a.get("fps") ?? 60),
      realtime: a.has("realtime"),
    });
    for (const r of results) {
      console.log(`${r.scenario} ${r.status} metrics=${r.metrics.length} approach=${r.approach as ApproachId}`);
    }
    return;
  }
  console.error("usage: cli.ts run|pairs|bookmarks (see README.md)");
  process.exitCode = 2;
}

await main();
