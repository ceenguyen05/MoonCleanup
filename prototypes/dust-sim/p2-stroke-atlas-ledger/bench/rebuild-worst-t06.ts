// T06: worst-case CPU cost of ONE tile rebuild (WDS 7.4, corrected form) when the stroke logs of the plot and its
// six neighbours are full (256 strokes each, the cap). S2 never fills the logs, so its rebuild times are not the
// worst case. Warm numbers (the first rebuilds of a process are several times slower: cold JIT).
//   cd tools/bots && node --import tsx ../../prototypes/dust-sim/p2-stroke-atlas-ledger/bench/rebuild-worst-t06.ts [recDir]
// With recDir: also writes one GPU recording per series (100 frames, each = one rebuild's log replay as draws plus
// the rebuilt tile upload) for gpu/run-gpu.mjs. Timing only: the per-cell residual step has no GPU twin, no compare.
import { performance } from "node:perf_hooks";
import { createGrid } from "../grid";
import { P2Client } from "../src/core/client";
import { InterestScratch } from "../src/core/interest";
import { buildTables, type GridLike } from "../src/core/tables";
import { TILE_PRESETS, TileAtlasRef } from "../src/core/tiles";
import { IDENTITY_CODEC, applyLogged, dirOf } from "../src/core/util";
import { SITE_PLOT, mulberry32 } from "../test/support";
import { GpuRecorder } from "../gpu/recorder";

const recDir = process.argv[2] ?? "";

const t = buildTables(createGrid() as unknown as GridLike, 20261114);

function series(
  name: string,
  quality: "medium" | "high",
  widthCm: number,
  lenMm: number,
  perPlot: number,
  recName = "",
): void {
  const scratch = new InterestScratch(t.count);
  const c = new P2Client(0, t, scratch, 140, 160, 2, IDENTITY_CODEC);
  const d = new Float64Array(3);
  dirOf(t, SITE_PLOT, 0, 0, d);
  c.scan(d);
  const rnd = mulberry32(7);
  // Fill the logs: strokes anchored in the site plot and in each neighbour, spread over the frame, depth16 1 so no
  // plot reaches Polished (a Polished plot drops its log).
  for (let ci = -1; ci < 6; ci++) {
    const q = ci < 0 ? SITE_PLOT : t.neighbors[SITE_PLOT * 6 + ci]!;
    if (q < 0) continue;
    for (let k = 0; k < perPlot; k++) {
      const u = Math.floor(rnd() * 16_000) - 8_000;
      const v = Math.floor(rnd() * 16_000) - 8_000;
      applyLogged(c.view, c.log, q, u, v, u + lenMm, v, widthCm, 1, 1, 0);
    }
  }
  const tiles = new TileAtlasRef(t, c.view, c.log, c.set, { ...TILE_PRESETS[quality], now: () => performance.now() });
  c.tiles = tiles;
  tiles.frame(d);
  while (tiles.rebuildBacklog > 0) tiles.frame(d);
  const ms: number[] = [];
  let work = 0;
  for (let i = 0; i < 260; i++) {
    tiles.onLedger(SITE_PLOT);
    tiles.frame(d);
    if (i >= 60) {
      ms.push(tiles.fRebuildMs);
      work = tiles.fRebuildWork;
    }
  }
  if (recDir !== "" && recName !== "") {
    const rec = new GpuRecorder();
    tiles.recorder = rec;
    tiles.recordRebuildDraws = true;
    for (let i = 0; i < 100; i++) {
      tiles.onLedger(SITE_PLOT);
      tiles.frame(d);
      rec.endFrame(tiles.fCpuMs);
    }
    rec.save(`${recDir}/${recName}`, tiles, recName, { noCompare: true, quality, widthCm, perPlot });
    tiles.recorder = null;
  }
  ms.sort((a, b) => a - b);
  const q = (p: number): string => ms[Math.min(ms.length - 1, Math.floor(ms.length * p))]!.toFixed(2);
  console.log(
    `| ${name} | ${quality} ${tiles.px}^2 | ${c.log.count(SITE_PLOT)} | ${work} | ${q(0.5)} | ${q(0.95)} | ${q(1)} | ${((Number(q(0.5)) * 1e6) / work).toFixed(0)} |`,
  );
}

console.log("| logs | tile | strokes in the plot's log | work units | ms p50 | ms p95 | ms max | ns per unit |");
console.log("| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |");
series("7 logs x 64, hand tool 60 cm x 0.3 m", "medium", 60, 300, 64);
series("7 logs full (256), hand tool 60 cm x 0.3 m", "medium", 60, 300, 256, "rebuild-hand-medium");
series("7 logs full (256), Bulldust 300 cm x 2 m", "medium", 300, 2000, 256, "rebuild-bulldust-medium");
series("7 logs full (256), hand tool 60 cm x 0.3 m", "high", 60, 300, 256, "rebuild-hand-high");
series("7 logs full (256), Bulldust 300 cm x 2 m", "high", 300, 2000, 256, "rebuild-bulldust-high");
