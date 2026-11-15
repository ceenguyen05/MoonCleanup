// T06 GPU lane: records the tile draw stream one client sees while N cleaners (itself included) work the same
// 25 m site, 60 fps frames over a 20 Hz sim. The harness S4 has no viewer, so this is the "many cleaners" GPU load.
//   cd tools/bots && node --import tsx ../../prototypes/dust-sim/p2-stroke-atlas-ledger/gpu/record-cluster.ts <outDir> [cleaners=6] [seconds=60] [quality=medium] [cadence=frame]
// Cleaner mix (by slot): 60 cm broom at 3 m/s, 120 cm broom at 3 m/s, 15 cm Desk Duster at 3 m/s, 300 cm x 1 m/tick
// vehicle intake (20 m/s), repeating. Lanes sweep back and forth across the site plot's frame.
import { performance } from "node:perf_hooks";
import { createGrid } from "../grid";
import { P2Server, type StrokeLike } from "../src/core/server";
import { buildTables, type GridLike } from "../src/core/tables";
import { TILE_PRESETS, TileAtlasRef } from "../src/core/tiles";
import { IDENTITY_CODEC, dirOf } from "../src/core/util";
import { SITE_PLOT } from "../test/support";
import { GpuRecorder } from "./recorder";

const outDir = process.argv[2] ?? "";
if (outDir === "") throw new Error("usage: record-cluster.ts <outDir> [cleaners] [seconds] [quality] [cadence]");
const cleaners = Number(process.argv[3] ?? 6);
const seconds = Number(process.argv[4] ?? 60);
const quality = (process.argv[5] ?? "medium") as keyof typeof TILE_PRESETS;
const cadence = (process.argv[6] ?? "frame") as "frame" | "tick";

const t = buildTables(createGrid() as unknown as GridLike, 20261114);
const s = new P2Server(t, {
  simTickHz: 20,
  cadence,
  residencyM: TILE_PRESETS[quality].residencyM,
  dustCellCapacityG: 0,
  codec: IDENTITY_CODEC,
  now: () => performance.now(),
});
for (let i = 0; i < cleaners; i++) s.join(i, null);
const TOOLS = [
  { widthCm: 60, depth16: 16, stepMm: 150 },
  { widthCm: 120, depth16: 32, stepMm: 150 },
  { widthCm: 15, depth16: 80, stepMm: 150 },
  { widthCm: 300, depth16: 48, stepMm: 1000 },
] as const;
const site = new Float64Array(3);
dirOf(t, SITE_PLOT, 0, 0, site);
s.setPosition(0, site);

const viewer = s.linkOf(0)!.client;
const tiles = new TileAtlasRef(t, viewer.view, viewer.log, viewer.set, {
  ...TILE_PRESETS[quality],
  now: () => performance.now(),
});
viewer.tiles = tiles;
const rec = new GpuRecorder();
tiles.recorder = rec;

const stroke: StrokeLike = {
  anchor: SITE_PLOT,
  startUMm: 0,
  startVMm: 0,
  endUMm: 0,
  endVMm: 0,
  widthCm: 0,
  depth16: 0,
  toolCode: 1,
  tick: 0,
  actorSlot: 0,
  inputSeq: 0,
};
const mutable = stroke as { -readonly [K in keyof StrokeLike]: StrokeLike[K] };
const ticks = seconds * 20;
let submitted = 0;
let rejected = 0;
for (let k = 0; k < ticks; k++) {
  for (let b = 0; b < cleaners; b++) {
    const tool = TOOLS[b % TOOLS.length]!;
    const span = 20_000;
    const perLane = Math.floor(span / tool.stepMm);
    const laneNo = Math.floor(k / perLane) + b * 5;
    const lane = (laneNo % 40) * 500 - 10_000;
    const dir = Math.floor(k / perLane) % 2 === 0 ? 1 : -1;
    const along = (k % perLane) * tool.stepMm - span / 2;
    mutable.startUMm = dir * along;
    mutable.startVMm = lane;
    mutable.endUMm = dir * (along + tool.stepMm);
    mutable.endVMm = lane;
    mutable.widthCm = tool.widthCm;
    mutable.depth16 = tool.depth16;
    mutable.toolCode = 1 + (b % TOOLS.length);
    mutable.tick = k + 1;
    mutable.actorSlot = b;
    mutable.inputSeq = (k + 1) & 0xffff;
    submitted++;
    if (s.submit(b, stroke) !== 0) rejected++;
  }
  s.advance(1);
  for (let f = 0; f < 3; f++) {
    tiles.frame(site);
    rec.endFrame(tiles.fCpuMs);
  }
}
const match = s.clientHash(0) === s.serverHash();
rec.save(outDir, tiles, `cluster-${cleaners}-${quality}-${cadence}`, {
  cleaners,
  seconds,
  quality,
  cadence,
  submitted,
  rejected,
  strokesApplied: s.strokesApplied,
  hashMatch: match,
  tilesResident: tiles.tilesResident,
  polished: s.view.polishedAllN,
});
console.log(
  JSON.stringify({
    out: outDir,
    cleaners,
    frames: rec.frame,
    draws: rec.draws,
    clears: rec.clears,
    rebuilt: rec.rebuilt,
    tiles: tiles.tilesResident,
    hashMatch: match,
    rejected,
  }),
);
