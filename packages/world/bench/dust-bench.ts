// Node benchmark of the dust ledger (M1-W3-T01): stroke cost per tool (bar: p99 <= 0.2 ms), heap allocation per
// stroke through the port (multi-window probe with a floor row), checkpoint encode / restore cost in milliseconds and
// the worst slice of the budgeted restore job. Not part of the test suites; run from the repo root with Node 26:
//   node node_modules/.pnpm/tsx@4.23.15/node_modules/tsx/dist/cli.mjs packages/world/bench/dust-bench.ts
import { getHeapStatistics } from "node:v8";
import { cpus, loadavg } from "node:os";
import { PlotState, type PlotId } from "@moon-cleanup/shared";
import { DustChunkEncoder, DustRestoreJob, encodeDustChunks, LoggedStroke, restoreDustChunks } from "../src/index";
import {
  makeLedger,
  mixedAttributes,
  seededStrokes,
  SEED,
  Sink,
  SITE_PLOT,
  standardGrid,
  strokeAt,
  TOOLS,
  type Stroke,
} from "../test/support/dust";

function allocated(): number {
  return getHeapStatistics().total_allocated_bytes;
}

function quantile(sorted: Float64Array, q: number): number {
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]!;
}

console.log(`node ${process.version}, ${cpus()[0]?.model ?? "?"}, loadavg ${loadavg().join("/")}`);
const grid = standardGrid();

// ---- 1. stroke cost per tool ----------------------------------------------------------------------------------------
console.log("\n| tool (width cm, depth16) | strokes | mean us | p50 us | p99 us | max us | lattice points / stroke |");
console.log("| --- | ---: | ---: | ---: | ---: | ---: | ---: |");
const names = [
  "T1",
  "T2",
  "T3",
  "T4",
  "T5",
  "T6",
  "Detailing",
  "Charge",
  "Trundle",
  "Skiff",
  "Bulldust",
  "Behemoth",
  "robot 80",
  "robot 140",
];
let worstP99 = 0;
for (let t = 0; t < TOOLS.length; t++) {
  const all = seededStrokes(60_000, SEED + t, 60_000, 6).filter((s) => s.toolCode === t);
  const strokes = all.slice(0, 4000);
  const ledger = makeLedger({ attributes: mixedAttributes(), initialLedgerSlots: 256 });
  const sink = new Sink();
  for (let w = 0; w < 3; w++) for (const s of strokes) ledger.applyStroke(s, sink); // warm-up
  ledger.reset();
  const before = ledger.counters.latticePoints;
  const times = new Float64Array(strokes.length);
  for (let k = 0; k < strokes.length; k++) {
    const t0 = performance.now();
    ledger.applyStroke(strokes[k]!, sink);
    times[k] = (performance.now() - t0) * 1000;
  }
  let sum = 0;
  for (const x of times) sum += x;
  times.sort();
  const p99 = quantile(times, 0.99);
  worstP99 = Math.max(worstP99, p99);
  console.log(
    `| ${names[t]} (${TOOLS[t]![0]}, ${TOOLS[t]![1]}) | ${strokes.length} | ${(sum / strokes.length).toFixed(1)} | ${quantile(times, 0.5).toFixed(1)} | ${p99.toFixed(1)} | ${times[times.length - 1]!.toFixed(1)} | ${((ledger.counters.latticePoints - before) / strokes.length).toFixed(0)} |`,
  );
}
console.log(`worst p99 over tools: ${worstP99.toFixed(1)} us (bar 200 us)`);

// Typical hand strokes: one 10 Hz interval of head travel (up to 0.6 m), the six hand tools.
{
  const strokes = seededStrokes(40_000, SEED + 77, 40_000, 6, SITE_PLOT, 600)
    .filter((s) => s.toolCode < 6)
    .slice(0, 12_000);
  const ledger = makeLedger({ attributes: mixedAttributes(), initialLedgerSlots: 256 });
  const sink = new Sink();
  for (let w = 0; w < 3; w++) for (const s of strokes) ledger.applyStroke(s, sink);
  ledger.reset();
  const before = ledger.counters.latticePoints;
  const times = new Float64Array(strokes.length);
  for (let k = 0; k < strokes.length; k++) {
    const t0 = performance.now();
    ledger.applyStroke(strokes[k]!, sink);
    times[k] = (performance.now() - t0) * 1000;
  }
  let sum = 0;
  for (const x of times) sum += x;
  times.sort();
  console.log(
    `hand tools T1 .. T6, segments <= 0.6 m: ${strokes.length} strokes, mean ${(sum / strokes.length).toFixed(1)} us, p50 ${quantile(times, 0.5).toFixed(1)}, p99 ${quantile(times, 0.99).toFixed(1)}, max ${times[times.length - 1]!.toFixed(1)}, lattice points / stroke ${((ledger.counters.latticePoints - before) / strokes.length).toFixed(0)}`,
  );
}

// ---- 2. allocation per stroke through the port ----------------------------------------------------------------------
// total_allocated_bytes advances in allocation-buffer steps (about 230 KB here), so a window must be long: 50 rounds
// of 20,000 strokes = 1,000,000 strokes per window puts one step at 0.23 B per stroke. The floor row runs the same
// loop without the ledger.
{
  const strokes: Stroke[] = seededStrokes(20_000, SEED + 99, 40_000, 6);
  const ledger = makeLedger({ attributes: mixedAttributes(), initialLedgerSlots: 256 });
  const sink = new Sink();
  const ROUNDS = 50;
  let removedLastRound = 0;
  let polishedLastRound = 0;
  const run = (): number => {
    let acc = 0;
    let before = 0;
    for (let r = 0; r < ROUNDS; r++) {
      // Start every round from an untouched world, so each round allocates ledgers from the pool, fills logs,
      // crosses the Opened / Polished thresholds and frees ledgers again (reset itself allocates nothing).
      ledger.reset();
      for (let k = 0; k < strokes.length; k++) {
        ledger.applyStroke(strokes[k]!, sink);
        acc += sink.removedUnits;
      }
      removedLastRound = acc - before;
      before = acc;
      polishedLastRound = ledger.polishedTotal;
    }
    return acc;
  };
  const floor = (): number => {
    let acc = 0;
    for (let r = 0; r < ROUNDS; r++) for (let k = 0; k < strokes.length; k++) acc += strokes[k]!.widthCm;
    return acc;
  };
  let keep = run() + floor(); // warm-up: plots touched, code optimised, pools at size
  const growths = ledger.poolGrowths;
  const total = ROUNDS * strokes.length;
  console.log("");
  console.log(`| window (${total} strokes each) | floor B/stroke | applyStroke B/stroke |`);
  console.log("| --- | ---: | ---: |");
  for (let w = 0; w < 3; w++) {
    const a0 = allocated();
    keep += floor();
    const a1 = allocated();
    keep += run();
    const a2 = allocated();
    console.log(`| ${w + 1} | ${((a1 - a0) / total).toFixed(3)} | ${((a2 - a1) / total).toFixed(3)} |`);
  }
  console.log(
    `pool growths during the windows: ${ledger.poolGrowths - growths}; per round: ${removedLastRound} units removed, ${ledger.counters.ledgersAllocated / (4 * ROUNDS)} ledgers allocated, ${polishedLastRound} plots Polished; sink ${keep}`,
  );
}

// ---- 3. checkpoint encode / restore ---------------------------------------------------------------------------------
{
  // 3,000 touched plots (the "typical contract" of WDS 4.3), each with a full 32-stroke saved log.
  const ledger = makeLedger({ attributes: mixedAttributes(), initialLedgerSlots: 4096 });
  const sink = new Sink();
  let touched = 0;
  for (let p = 20_000; touched < 3000; p++) {
    if (ledger.state[p] === PlotState.Empty) continue;
    for (let n = 0; n < 34; n++) {
      ledger.applyStroke(
        strokeAt(p, -3000 + n * 150, -2000 + n * 100, -1500 + n * 150, -2000 + n * 100, 45, 128, n % 6),
        sink,
      );
    }
    touched++;
  }
  const encoder = new DustChunkEncoder();
  const enc: number[] = [];
  let chunks = encodeDustChunks(ledger, 0, false, encoder);
  for (let r = 0; r < 5; r++) {
    const t0 = performance.now();
    chunks = encodeDustChunks(ledger, 0, false, encoder);
    enc.push(performance.now() - t0);
  }
  let bytes = 0;
  let biggest = 0;
  for (const c of chunks) {
    bytes += c.payload.length;
    biggest = Math.max(biggest, c.payload.length);
  }
  const payloads = chunks.map((c) => c.payload);
  const target = makeLedger({ attributes: mixedAttributes(), initialLedgerSlots: 4096 });
  const res: number[] = [];
  for (let r = 0; r < 6; r++) {
    target.reset();
    const t0 = performance.now();
    restoreDustChunks(target, payloads);
    res.push(performance.now() - t0);
  }
  console.log(
    `\ncheckpoint, ${ledger.ledgerCount} ledgers in ${chunks.length} chunks, ${bytes} B raw (${(bytes / ledger.ledgerCount).toFixed(0)} B/plot, largest chunk ${biggest} B)`,
  );
  console.log(
    `encode all (ms, 5 runs): ${enc.map((x) => x.toFixed(1)).join(" / ")}  -> ${((Math.min(...enc) * 1000) / ledger.ledgerCount).toFixed(1)} us/plot best`,
  );
  console.log(
    `restore all (ms, 6 runs, first is cold): ${res.map((x) => x.toFixed(1)).join(" / ")}  -> ${((Math.min(...res) * 1000) / ledger.ledgerCount).toFixed(1)} us/plot best`,
  );
  console.log(`restored hash equal: ${target.worldHash() === ledger.worldHash()}`);

  // Budgeted job: slices of 2 ms and 1 ms on the real clock.
  for (const budget of [2, 1]) {
    target.reset();
    const job = new DustRestoreJob(target, payloads);
    const slices: number[] = [];
    while (!job.done) {
      const t0 = performance.now();
      job.run(budget, () => performance.now());
      slices.push(performance.now() - t0);
    }
    const sorted = Float64Array.from(slices).sort();
    console.log(
      `sliced restore, budget ${budget} ms: ${slices.length} slices, slice ms p50 ${quantile(sorted, 0.5).toFixed(2)} / p99 ${quantile(sorted, 0.99).toFixed(2)} / max ${sorted[sorted.length - 1]!.toFixed(2)}, units ${job.units}`,
    );
  }

  // Reading the logs a tile rebuild needs: the plot and its 6 neighbours, full rings.
  const full = makeLedger({ initialLedgerSlots: 64 });
  const sites = [SITE_PLOT, ...Array.from(grid.neighbors(SITE_PLOT as PlotId))];
  for (const site of sites) {
    for (let n = 0; n < 256; n++)
      full.applyStroke(strokeAt(site, -3000 + n * 20, n * 10, -1500 + n * 20, n * 10, 60, 16), sink);
  }
  const rec = new LoggedStroke();
  const log = full.log!;
  let acc = 0;
  let strokes = 0;
  const reads: number[] = [];
  for (let r = 0; r < 200; r++) {
    const t0 = performance.now();
    strokes = 0;
    for (const site of sites) {
      const n = log.count(site);
      for (let k = 0; k < n; k++) {
        log.read(site, k, rec);
        acc += rec.endUMm;
        strokes++;
      }
    }
    reads.push(performance.now() - t0);
  }
  const sorted = Float64Array.from(reads).sort();
  console.log(
    `log read for one tile rebuild (7 rings, ${strokes} strokes): p50 ${(quantile(sorted, 0.5) * 1000).toFixed(1)} us / max ${(sorted[sorted.length - 1]! * 1000).toFixed(1)} us (sink ${acc})`,
  );
}
