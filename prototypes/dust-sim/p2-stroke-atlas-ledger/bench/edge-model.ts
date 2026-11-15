// Edge width of the P2 dust model at the harness edge bookmarks (2 m, 10 m, 50 m). A CPU MODEL, NOT A GPU CAPTURE and
// not a contest score: it samples the CPU reference tile atlas (bilinear, as a filtered GPU fetch would), applies the
// WDS 7.7 presence mask and thinning, projects the ground line across the reference strip's west edge onto a
// 1920 x 1080, vFOV 60 screen, box-filters to pixels and measures the 10-90 % rise with the harness's own function.
// The detail ring is not built in P2; its rows are a 1-D model of a ring texel raster (same edge rule, 3.5 / 2.5 cm).
//   cd tools/bots && node --import tsx ../../prototypes/dust-sim/p2-stroke-atlas-ledger/bench/edge-model.ts
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CAPTURE_VIEW } from "../../harness/src/capture-scene";
import { riseWidth10to90 } from "../../harness/src/image-compare";
import { HARNESS_SEED, sceneSetupStrokes, sitePoint } from "../../harness/src/scene";
import { createGrid } from "../grid";
import { P2Server } from "../src/core/server";
import { buildTables, DUST_LEVEL_BY_CLASS, type GridLike } from "../src/core/tables";
import { TILE_PRESETS, TileAtlasRef } from "../src/core/tiles";
import { IDENTITY_CODEC } from "../src/core/util";

const here = path.dirname(fileURLToPath(import.meta.url));
const grid = createGrid();
const t = buildTables(grid as unknown as GridLike, HARNESS_SEED);
const EDGE_E = -1.2; // west edge of the strip, metres east of the site
const NORTH = 20;
const EYE_M = 1.7;
const TAU = 0.08;
const W = 0.04;

type Sampler = (eastM: number) => number;

/** The reference strip through server + client + tiles. `depth16` null = as the harness sends it (Bristle Broom 32). */
function tileSampler(quality: "medium" | "high", depth16: number | null): { sample: Sampler; strength: number } {
  const s = new P2Server(t, {
    simTickHz: 20,
    cadence: "frame",
    residencyM: TILE_PRESETS[quality].residencyM,
    dustCellCapacityG: 0,
    codec: IDENTITY_CODEC,
    now: () => 0,
  });
  s.join(0, null);
  const link = s.linkOf(0)!;
  const tiles = new TileAtlasRef(t, link.client.view, link.client.log, link.client.set, {
    ...TILE_PRESETS[quality],
    now: () => 0,
  });
  link.client.tiles = tiles;
  const mid = sitePoint(0, NORTH);
  const pos = new Float64Array([mid[0], mid[1], mid[2]]);
  s.setPosition(0, pos);
  s.advance(2);
  for (const r of sceneSetupStrokes(grid)) s.submit(0, depth16 === null ? r : { ...r, depth16 });
  s.advance(4);
  do tiles.frame(pos);
  while (tiles.rebuildBacklog > 0);
  if (s.clientHash(0) !== s.serverHash()) throw new Error("edge model: client diverged");
  const out = { u: 0, v: 0 };
  const px = tiles.px;
  const at = (slot: number, x: number, y: number): number => {
    const cx = x < 0 ? 0 : x > px - 1 ? px - 1 : x;
    const cy = y < 0 ? 0 : y > px - 1 ? px - 1 : y;
    return tiles.data[(slot * px * px + cy * px + cx) * 4]! / 255;
  };
  const sample: Sampler = (eastM) => {
    const p = sitePoint(eastM, NORTH);
    const d = { x: p[0], y: p[1], z: p[2] } as never;
    const plot = grid.plotAt(d) as number;
    const slot = tiles.slotOfPlot[plot]!;
    if (slot < 0) return 1;
    grid.toPlotLocal(plot as never, d, out);
    const fx = (out.u + 12_800) / tiles.texelMm - 0.5;
    const fy = (out.v + 12_800) / tiles.texelMm - 0.5;
    const ix = Math.floor(fx);
    const iy = Math.floor(fy);
    const tx = fx - ix;
    const ty = fy - iy;
    return (
      (at(slot, ix, iy) * (1 - tx) + at(slot, ix + 1, iy) * tx) * (1 - ty) +
      (at(slot, ix, iy + 1) * (1 - tx) + at(slot, ix + 1, iy + 1) * tx) * ty
    );
  };
  const edge = sitePoint(EDGE_E + 0.6, NORTH);
  const plot = grid.plotAt({ x: edge[0], y: edge[1], z: edge[2] } as never) as number;
  const level = DUST_LEVEL_BY_CLASS[t.classOf[plot]!] ?? 5;
  const d16 = depth16 ?? 32;
  return { sample, strength: d16 >= 16 * level ? 1 : d16 / (16 * level) };
}

/** 1-D model of a ring raster: texels of `texelM` with a 1-texel box edge at the strip edge, bilinear between centres. */
function ringSampler(texelM: number, strength: number): Sampler {
  const phase = 0.37 * texelM;
  const texel = (i: number): number => {
    const centre = i * texelM + phase;
    let c = 0.5 + (centre - EDGE_E) / texelM;
    c = c < 0 ? 0 : c > 1 ? 1 : c;
    return 1 - strength * c;
  };
  return (eastM) => {
    const f = (eastM - phase) / texelM;
    const i = Math.floor(f);
    return texel(i) * (1 - (f - i)) + texel(i + 1) * (f - i);
  };
}

/** Dust opacity and presence mask of WDS 7.7 for remaining dust R (fixed half-width, as the P1 reference used). */
function shade(r: number): { opacity: number; mask: number } {
  let m = (r - (TAU - W)) / (2 * W);
  m = m < 0 ? 0 : m > 1 ? 1 : m;
  m = m * m * (3 - 2 * m);
  return { opacity: m * (0.35 + 0.65 * r), mask: m };
}

/** 10-90 % widths in screen pixels at ground distance `distM` (camera west of the edge, looking east and down). */
function widths(sample: Sampler, distM: number): { opacity: number | null; mask: number | null } {
  const camE = EDGE_E - distM;
  const pitch = Math.atan2(EYE_M, distM);
  const focal = CAPTURE_VIEW.heightPx / 2 / Math.tan((CAPTURE_VIEW.vFovDeg * Math.PI) / 360);
  // Screen row (pixels below the view centre) -> ground east coordinate.
  // Rows at or above the horizon see no ground: they map to +Infinity (east of everything).
  const eastOf = (row: number): number => {
    const down = pitch + Math.atan(row / focal);
    return down <= 1e-4 ? Number.POSITIVE_INFINITY : camE + EYE_M / Math.tan(down);
  };
  const SUB = 16;
  const half = 400;
  const op: number[] = [];
  const mk: number[] = [];
  for (let row = -half; row < half; row++) {
    let so = 0;
    let sm = 0;
    for (let k = 0; k < SUB; k++) {
      const east = eastOf(row + (k + 0.5) / SUB);
      const sh = shade(east > 100 ? 1 : sample(east));
      so += sh.opacity;
      sm += sh.mask;
    }
    op.push(so / SUB);
    mk.push(sm / SUB);
  }
  // Crop to +-3 m of ground around the edge (or the whole window when that is smaller) so both plateaus are present.
  const lo = op.findIndex((_, i) => eastOf(i - half) < EDGE_E + 0.55);
  const hi = op.findIndex((_, i) => eastOf(i - half) < EDGE_E - 3);
  const a = lo < 0 ? 0 : lo;
  const b = hi < 0 ? op.length : hi;
  return { opacity: riseWidth10to90(op.slice(a, b)), mask: riseWidth10to90(mk.slice(a, b)) };
}

const report: Record<string, number | null> = {};
const rows: string[] = [];
function measure(name: string, sample: Sampler, strength: number): void {
  const cells: string[] = [];
  for (const d of [2, 10, 50]) {
    const w = widths(sample, d);
    report[`${name}.opacityPx.${d}m`] = w.opacity;
    report[`${name}.maskPx.${d}m`] = w.mask;
    const f = (x: number | null): string => (x === null ? "none" : x.toFixed(1));
    cells.push(`${f(w.opacity)} / ${f(w.mask)}`);
  }
  rows.push(`| ${name} | ${strength.toFixed(2)} | ${cells.join(" | ")} |`);
}

for (const quality of ["medium", "high"] as const) {
  const asSent = tileSampler(quality, null);
  measure(`tile ${quality}, strip as the harness sweeps it`, asSent.sample, asSent.strength);
  const clean = tileSampler(quality, 255);
  measure(`tile ${quality}, strip swept clean`, clean.sample, clean.strength);
}
const sent = tileSampler("medium", null).strength;
measure("ring model 3.5 cm, strip as the harness sweeps it", ringSampler(0.035, sent), sent);
measure("ring model 3.5 cm, strip swept clean", ringSampler(0.035, 1), 1);
measure("ring model 2.5 cm, strip swept clean", ringSampler(0.025, 1), 1);

console.log("| source | pass strength s | 2 m: opacity / mask px | 10 m | 50 m |");
console.log("| --- | ---: | --- | --- | --- |");
for (const r of rows) console.log(r);
const outDir = path.resolve(here, "../results/edge-model");
mkdirSync(outDir, { recursive: true });
writeFileSync(path.join(outDir, "edge-model.json"), `${JSON.stringify(report, null, 2)}\n`);
