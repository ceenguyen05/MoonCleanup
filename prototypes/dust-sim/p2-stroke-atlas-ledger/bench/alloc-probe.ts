// Allocation probe for DustView.applyStroke: bytes allocated per call in steady state, per tool shape.
// v8 total_allocated_bytes advances in allocation-buffer steps (about 256 KB), so a window must hold enough calls to
// resolve the answer: the "empty loop" row is the noise floor of the method for the same window size.
//   node node_modules/.pnpm/tsx@4.23.15/node_modules/tsx/dist/cli.mjs prototypes/dust-sim/p2-stroke-atlas-ledger/bench/alloc-probe.ts
import { getHeapStatistics } from "node:v8";
import { createGrid } from "../grid";
import { DustView } from "../src/core/dust-view";
import { buildTables, type GridLike } from "../src/core/tables";
import { SITE_PLOT } from "../test/support";

const t = buildTables(createGrid() as unknown as GridLike, 20261114);
const allocated = (): number => getHeapStatistics().total_allocated_bytes;
let sink = 0;

function windows(name: string, n: number, fn: (i: number) => void): void {
  for (let i = 0; i < 200_000; i++) fn(i);
  let done = 200_000;
  const parts: string[] = [];
  for (let block = 0; block < 3; block++) {
    const a0 = allocated();
    for (let k = 0; k < n; k++) fn(done + k);
    done += n;
    parts.push(((allocated() - a0) / n).toFixed(3));
  }
  console.log(`| ${name} | ${n} | ${parts.join(" / ")} |`);
}

function series(name: string, widthCm: number, depth16: number, lenMm: number, n: number): void {
  const view = new DustView(t);
  const pitch = Math.max(150, widthCm * 10);
  const lanes = Math.floor(24_000 / pitch);
  windows(name, n, (i) => {
    const lane = (i % lanes) * pitch - 12_000;
    const u = ((i * 131) % 20_000) - 10_000;
    sink += view.applyStroke(SITE_PLOT, u, lane, u + lenMm, lane, widthCm, depth16, i & 7);
  });
}

console.log("| series | calls per window | B/call (3 windows) |");
console.log("| --- | ---: | --- |");
windows("empty loop (noise floor)", 1_000_000, (i) => {
  sink += (i * 131) % 7;
});
series("15 cm, depth16 80, 0.15 m", 15, 80, 150, 1_000_000);
series("15 cm, depth16 1, 0.15 m", 15, 1, 150, 1_000_000);
series("60 cm, depth16 16, 0.30 m", 60, 16, 300, 1_000_000);
series("60 cm, depth16 255, 0.30 m", 60, 255, 300, 1_000_000);
series("300 cm, depth16 48, 2 m", 300, 48, 2000, 300_000);
if (sink < 0) console.log(sink);
