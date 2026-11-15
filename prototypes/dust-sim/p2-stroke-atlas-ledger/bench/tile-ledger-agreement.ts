// Does the client's tile atlas (CPU reference) show the same amount of dust as the authoritative ledger?
// VT-M1-34 asks for agreement within +-10 points. For every ledger cell that still holds dust (u_t > 0) of every
// resident tile, the mean R of the cell's tile texels is compared with u_t / u0.
//   cd tools/bots && node --import tsx ../../prototypes/dust-sim/p2-stroke-atlas-ledger/bench/tile-ledger-agreement.ts
import { createStrokeSource, DEFAULT_STROKE_SOURCE } from "../../../../tools/bots/src/scenarios/dust-contest/index";
import { HARNESS_SEED, sitePoint } from "../../harness/src/scene";
import { createGrid } from "../grid";
import { LEDGER_BYTES, LEDGER_EDGE } from "../src/core/dust-view";
import { P2Server } from "../src/core/server";
import { buildTables, DUST_LEVEL_BY_CLASS, type GridLike } from "../src/core/tables";
import { TILE_PRESETS, TileAtlasRef } from "../src/core/tiles";
import { IDENTITY_CODEC } from "../src/core/util";

const grid = createGrid();
const t = buildTables(grid as unknown as GridLike, HARNESS_SEED);
const site = sitePoint(0, 0);
const clusterPlot = grid.plotAt({ x: site[0], y: site[1], z: site[2] } as never) as number;

export interface Agreement {
  readonly cells: number;
  /** Mean of (tile - ledger) in points of 100: negative = the tile shows less dust than the ledger holds. */
  readonly meanSigned: number;
  readonly meanAbs: number;
  readonly worstAbs: number;
  /** Share of cells off by more than 10 points. */
  readonly over10Pct: number;
}

export function agreement(tiles: TileAtlasRef, view: P2Server["view"]): Agreement {
  const cell = tiles.px / LEDGER_EDGE;
  let cells = 0;
  let signed = 0;
  let abs = 0;
  let worst = 0;
  let over = 0;
  for (let slot = 0; slot < tiles.plotOfSlot.length; slot++) {
    const plot = tiles.plotOfSlot[slot]!;
    if (plot < 0) continue;
    const ls = view.slotOf[plot]!;
    if (ls < 0) continue;
    const u0 = 16 * (DUST_LEVEL_BY_CLASS[t.classOf[plot]!] ?? 1);
    const base = slot * tiles.px * tiles.px * 4;
    for (let b = 0; b < LEDGER_EDGE; b++) {
      for (let a = 0; a < LEDGER_EDGE; a++) {
        const u = view.texels[ls * LEDGER_BYTES + b * LEDGER_EDGE + a]!;
        if (u === 0) continue;
        let sum = 0;
        for (let y = 0; y < cell; y++) {
          for (let x = 0; x < cell; x++) sum += tiles.data[base + ((b * cell + y) * tiles.px + a * cell + x) * 4]!;
        }
        const d = (100 * sum) / (cell * cell * 255) - (100 * u) / u0;
        cells++;
        signed += d;
        abs += Math.abs(d);
        if (Math.abs(d) > worst) worst = Math.abs(d);
        if (Math.abs(d) > 10) over++;
      }
    }
  }
  return {
    cells,
    meanSigned: cells ? signed / cells : 0,
    meanAbs: cells ? abs / cells : 0,
    worstAbs: worst,
    over10Pct: cells ? (100 * over) / cells : 0,
  };
}

function run(
  name: string,
  quality: "medium" | "high",
  bots: number,
  seconds: number,
  widthCm: number,
  depth16: number,
): void {
  const s = new P2Server(t, {
    simTickHz: 20,
    cadence: "frame",
    residencyM: TILE_PRESETS[quality].residencyM,
    dustCellCapacityG: 0,
    codec: IDENTITY_CODEC,
    now: () => 0,
  });
  const src = Array.from({ length: bots }, (_, i) =>
    createStrokeSource(grid, {
      ...DEFAULT_STROKE_SOURCE,
      widthCm,
      depth16,
      seed: HARNESS_SEED,
      botIndex: i,
      clusterPlot,
      actorSlot: i,
    }),
  );
  for (let i = 0; i < bots; i++) s.join(i, null);
  const viewer = s.linkOf(0)!;
  const tiles = new TileAtlasRef(t, viewer.client.view, viewer.client.log, viewer.client.set, {
    ...TILE_PRESETS[quality],
    now: () => 0,
  });
  viewer.client.tiles = tiles;
  for (let tick = 1; tick <= seconds * 20; tick++) {
    for (let i = 0; i < bots; i++) s.submit(i, src[i]!(tick));
    s.advance(1);
    if (viewer.hasPos) tiles.frame(viewer.pos);
  }
  const live = agreement(tiles, viewer.client.view);
  // The same world for a late joiner: every tile rebuilt from ledgers + logs.
  s.join(99, viewer.pos.slice());
  const late = s.linkOf(99)!;
  const lateTiles = new TileAtlasRef(t, late.client.view, late.client.log, late.client.set, {
    ...TILE_PRESETS[quality],
    now: () => 0,
  });
  late.client.tiles = lateTiles;
  do lateTiles.frame(late.pos);
  while (lateTiles.rebuildBacklog > 0);
  const joined = agreement(lateTiles, late.client.view);
  const f = (a: Agreement): string =>
    `${a.cells} | ${a.meanSigned.toFixed(1)} | ${a.meanAbs.toFixed(1)} | ${a.worstAbs.toFixed(0)} | ${a.over10Pct.toFixed(1)} %`;
  console.log(`| ${name} | live replay | ${f(live)} |`);
  console.log(`| ${name} | late join (rebuild) | ${f(joined)} |`);
}

console.log(
  "| world | tiles | cells with dust | mean (tile - ledger), points | mean abs | worst | cells off by > 10 points |",
);
console.log("| --- | --- | ---: | ---: | ---: | ---: | ---: |");
run("16 bots, 60 cm depth16 16, 120 s, Medium", "medium", 16, 120, 60, 16);
run("16 bots, 60 cm depth16 16, 120 s, High", "high", 16, 120, 60, 16);
run("4 bots, 120 cm depth16 32, 120 s, Medium", "medium", 4, 120, 120, 32);
run("4 bots, 15 cm depth16 80, 120 s, Medium", "medium", 4, 120, 15, 80);
