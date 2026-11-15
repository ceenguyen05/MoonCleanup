// T06: prints the GPU lane results (one JSON per run, written by run-gpu.mjs) as a markdown table.
//   node prototypes/dust-sim/p2-stroke-atlas-ledger/gpu/summarize.mjs <outDir>
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const dir = path.resolve(process.argv[2]);
const f = (v, d = 3) => (v === null || v === undefined ? "-" : Number(v).toFixed(d));
const rows = [];
for (const file of readdirSync(dir).filter((n) => n.endsWith(".json") && n.includes("."))) {
  if (file === "adapter.json" || file === "console-errors.json") continue;
  const r = JSON.parse(readFileSync(path.join(dir, file), "utf8"));
  if (r.failed) {
    rows.push(`| ${file.replace(".json", "")} | FAILED: ${r.failed.slice(0, 120)} |`);
    continue;
  }
  const g = r.gpuPassMs;
  const j = r.jsEncodeMs;
  const c = r.compare;
  rows.push(
    `| ${r.recording} | ${r.path} | ${r.pace} | ${r.passes} of ${r.framesReplayed} | ${f(r.instancesPerPass.mean, 1)} / ${r.instancesPerPass.max} | ` +
      `${g ? `${f(g.p50)} / ${f(g.p95)} / ${f(g.p99)} / ${f(g.max)}` : "no timestamp-query"} | ${f(r.gpuPassMsPerFrameAllFrames, 4)} | ` +
      `${f(j.p50)} / ${f(j.p95)} / ${f(j.p99)} / ${f(j.max)} | ${f(r.jsEncodeMsPerFrameAllFrames, 4)} | ` +
      `${c ? `${c.texelsDiffering} of ${c.texels} (${f(c.pctDiffering, 3)} %), max ${Math.max(...c.maxAbsDiffRGBA)}` : "not compared"} | ` +
      `${r.uploads} | ${r.rafIntervalMs ? `${f(r.rafIntervalMs.p50, 1)} / ${f(r.rafIntervalMs.p95, 1)}` : "-"} | ${r.machineLoadPct} | ${r.errors.length} |`,
  );
}
console.log(
  "| recording | path | pace | passes of frames | instances per pass mean / max | GPU pass ms p50 / p95 / p99 / max | GPU ms per frame, all frames | JS encode ms p50 / p95 / p99 / max | JS ms per frame, all frames | bytes differing from tiles.ts | tile uploads | rAF interval ms p50 / p95 | machine load % | GPU errors |",
);
console.log("| --- | --- | --- | --- | --- | --- | ---: | --- | ---: | --- | ---: | --- | ---: | ---: |");
for (const r of rows.sort()) console.log(r);
