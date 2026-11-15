// Node benchmark of the sliced dust restore (M1 restore-slice defect, docs/agent-reports/M1-restore-slices): how long
// the slices of a `DustRestoreJob` are on the real clock and where the time goes, per step kind. The target ledger is
// built like the Solo worker's (1,024 slots up front, stroke logs on, 1,024 slots of headroom). Not part of the test
// suites. From the repo root with Node 26 (TSX = node_modules/.pnpm/tsx@4.23.15/node_modules/tsx/dist/cli.mjs):
//
//   node $TSX packages/world/bench/restore-bench.ts save  <file> [plots]     write the chunk payloads of a played moon
//   node $TSX packages/world/bench/restore-bench.ts cold  <file> [budgetMs]  ONE sliced restore in a fresh process: the
//                                                                            restore code has never run (a booting
//                                                                            worker, a first main-thread restore)
//   node $TSX packages/world/bench/restore-bench.ts steps <file>             one step per call: first-call (cold) and
//                                                                            settled cost per step kind
//   node $TSX packages/world/bench/restore-bench.ts warm  <file> [runs] [budgetMs]   repeated sliced restores
//
// `save` and the measuring modes are separate processes on purpose: generating the moon in the same process would
// optimise the ownership-mask code before the restore is timed.
// MC_BENCH_PRIORITY=high raises the process priority: on a machine that is busy with other work the slices are then
// cut short less often by the scheduler, which is the only way to tell the job's own work from time it did not get.
import { readFileSync, writeFileSync } from "node:fs";
import { constants, cpus, setPriority } from "node:os";
import { PlotState } from "@moon-cleanup/shared";
import { DUST_RESTORE_SLICE_BUDGET_MS, DustRestoreJob, encodeDustChunks, fnv1a32 } from "../src/index";
import { makeLedger, mixedAttributes, Sink, strokeAt } from "../test/support/dust";

/** As apps/client sim-host SOLO_LEDGER_HEADROOM_SLOTS. */
const HOST_SLOTS = 1024;
const STEP_NAMES = ["prepare", "scan", "reset x64", "open", "mask x8 rows", "texels", "check + hash", "log + state"];
const now = (): number => performance.now();

function quantile(sorted: Float64Array, q: number): number {
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]!;
}

function save(file: string, plots: number): void {
  // `plots` touched plots, each with a full saved log (34 strokes written, 32 kept by the save).
  const source = makeLedger({ attributes: mixedAttributes(), initialLedgerSlots: 4096 });
  const sink = new Sink();
  let touched = 0;
  for (let p = 20_000; touched < plots; p++) {
    if (source.state[p] === PlotState.Empty) continue;
    for (let n = 0; n < 34; n++) {
      source.applyStroke(
        strokeAt(p, -3000 + n * 150, -2000 + n * 100, -1500 + n * 150, -2000 + n * 100, 45, 128, n % 6),
        sink,
      );
    }
    touched++;
  }
  const payloads = encodeDustChunks(source, 0, false).map((c) => c.payload);
  const parts: Uint8Array[] = [];
  const head = new DataView(new ArrayBuffer(8));
  head.setUint32(0, payloads.length, true);
  head.setUint32(4, source.worldHash(), true);
  parts.push(new Uint8Array(head.buffer));
  let bytes = 0;
  for (const p of payloads) {
    const len = new DataView(new ArrayBuffer(4));
    len.setUint32(0, p.length, true);
    parts.push(new Uint8Array(len.buffer), p);
    bytes += p.length;
  }
  writeFileSync(file, Buffer.concat(parts));
  console.log(`saved ${source.ledgerCount} ledgers in ${payloads.length} chunks, ${bytes} B raw`);
}

function load(file: string): { payloads: Uint8Array[]; hash: number } {
  const buf = readFileSync(file);
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const n = view.getUint32(0, true);
  const payloads: Uint8Array[] = [];
  let o = 8;
  for (let i = 0; i < n; i++) {
    const len = view.getUint32(o, true);
    o += 4;
    payloads.push(new Uint8Array(buf.subarray(o, o + len)));
    o += len;
  }
  return { payloads, hash: view.getUint32(4, true) };
}

function target(): ReturnType<typeof makeLedger> {
  return makeLedger({ attributes: mixedAttributes(), initialLedgerSlots: HOST_SLOTS });
}

/** One sliced restore as a host runs it. Returns the slice durations. */
function slicedRestore(payloads: Uint8Array[], hash: number, budget: number, label: string): void {
  const ledger = target();
  const job = new DustRestoreJob(ledger, payloads, undefined, HOST_SLOTS);
  const slices: number[] = [];
  const t0 = now();
  while (!job.done) {
    const s0 = now();
    job.run(budget, now);
    slices.push(now() - s0);
  }
  const total = now() - t0;
  const sorted = Float64Array.from(slices).sort();
  let over = 0;
  for (const s of slices) if (s > budget) over++;
  console.log(
    `| ${label} | ${total.toFixed(1)} | ${slices.length} | ${quantile(sorted, 0.5).toFixed(2)} | ${quantile(sorted, 0.99).toFixed(2)} | ${sorted[sorted.length - 1]!.toFixed(2)} | ${over} | ${job.slowestStepMs.toFixed(3)} | ${slices
      .slice(0, 4)
      .map((s) => s.toFixed(2))
      .join(
        " ",
      )} | ${ledger.poolGrowths} | ${ledger.worldHash() === hash && ledger.slotCapacity >= ledger.ledgerCount + HOST_SLOTS} |`,
  );
}

const SLICE_HEAD =
  "| run | total ms | slices | slice p50 | p99 | max ms | slices over budget | slowest step ms | first 4 slices ms | pool growths | hash and headroom ok |\n| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- | ---: | --- |";

const high = process.env["MC_BENCH_PRIORITY"] === "high";
if (high) setPriority(constants.priority.PRIORITY_HIGH);
const mode = process.argv[2] ?? "";
const file = process.argv[3] ?? "";
if (mode === "save") {
  save(file, Number(process.argv[4] ?? 3000));
} else if (mode === "cold" || mode === "warm") {
  const { payloads, hash } = load(file);
  const runs = mode === "cold" ? 1 : Number(process.argv[4] ?? 5);
  const budget = Number(process.argv[mode === "cold" ? 4 : 5] ?? DUST_RESTORE_SLICE_BUDGET_MS);
  console.log(
    `node ${process.version}, ${cpus()[0]?.model ?? "?"}, budget ${budget} ms, ${payloads.length} chunks${high ? ", high priority" : ""}`,
  );
  console.log(SLICE_HEAD);
  for (let r = 0; r < runs; r++) slicedRestore(payloads, hash, budget, r === 0 ? "1 (cold)" : String(r + 1));
} else if (mode === "steps") {
  const { payloads, hash } = load(file);
  const ledger = target();
  const job = new DustRestoreJob(ledger, payloads, undefined, HOST_SLOTS);
  const peek = job as unknown as { phase: number };
  const times: number[][] = STEP_NAMES.map(() => []);
  let total = 0;
  while (!job.done) {
    const kind = peek.phase;
    const s0 = now();
    job.run(0, now); // exactly one step
    const ms = now() - s0;
    times[kind]!.push(ms);
    total += ms;
  }
  console.log(`node ${process.version}, ${cpus()[0]?.model ?? "?"}; ${job.units} steps, ${total.toFixed(1)} ms`);
  console.log(
    "| step | count | first call (cold) us | largest of calls 2 .. 20 us | settled mean us | p99 us | max us | share of total |",
  );
  console.log("| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |");
  for (let k = 0; k < STEP_NAMES.length; k++) {
    const t = times[k]!;
    if (t.length === 0) continue;
    const settled = Float64Array.from(t.length > 200 ? t.slice(200) : t).sort();
    let sum = 0;
    for (const x of t) sum += x;
    let mean = 0;
    for (const x of settled) mean += x;
    mean /= settled.length;
    console.log(
      `| ${STEP_NAMES[k]} | ${t.length} | ${(t[0]! * 1000).toFixed(0)} | ${(Math.max(0, ...t.slice(1, 20)) * 1000).toFixed(0)} | ${(mean * 1000).toFixed(1)} | ${(quantile(settled, 0.99) * 1000).toFixed(1)} | ${(settled[settled.length - 1]! * 1000).toFixed(0)} | ${((sum / total) * 100).toFixed(1)} % |`,
    );
  }
  // The ledger hash on its own: FNV-1a over the 1,024 stored texels of one record (part of the finish step).
  const probe = payloads[0]!;
  const reps = 20_000;
  let acc = 0;
  const h0 = now();
  for (let i = 0; i < reps; i++) acc ^= fnv1a32(probe, 100 + (i & 63), 1024);
  console.log(
    `ledger hash alone: ${(((now() - h0) / reps) * 1000).toFixed(2)} us per record (sink ${acc}); result ok ${ledger.worldHash() === hash}`,
  );
} else {
  console.log("usage: restore-bench.ts save|cold|steps|warm <file> ... (see the header of this file)");
}
