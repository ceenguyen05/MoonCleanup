// Golden determinism cases of packages/world (WDS section 1 "Golden hash"), shared by the Node lane
// (*.golden.test.ts) and the browser lane (*.browser.test.ts, Chromium / Firefox / WebKit) so both run identical code.
// A mismatch in any engine is a determinism defect, never a reason to re-record.
//
// Recorded on Node 26.13.1 (2026-11-14). The Standard `grid` and `pointToPlot` digests are the values for
// shared/world/plot-grid PLOT_GRID_GOLDEN_HASHES (contracts minor bump by contracts-architect).

import { MOONLET_GRID_PARAMS, STANDARD_GRID_PARAMS, type PlotGridParams } from "@moon-cleanup/shared";
import {
  computeGridGoldenDigests,
  createPlotGrid,
  GroundHeight,
  mulberry32,
  type GridGoldenDigests,
  type IcoPlotGrid,
} from "../../src/index";
import { goldenSamples, loadFixtureCube } from "../support/fixtures";

export const GOLDEN_STANDARD: GridGoldenDigests = {
  grid: "eecb088b1eff1f24ed2aa8c29b1d1c5dc5d4f3b43716525be777b46be665c6c5",
  pointToPlot: "ace8f2e5a2974429a00c41457dbc6cba4e779832d6183df484b2e6c35868298a",
  neighbors: "fa6a5f17db89f796e1f5dcc6bb15f214a3ba88e9730b5d809af4cd16f28fc14f",
};

export const GOLDEN_MOONLET: GridGoldenDigests = {
  grid: "173e8cdc5c15af76a727daa2d63390bb460bb4065cd200408591a0ef185d215e",
  pointToPlot: "237d41560be7de074fbffbe0be27dd27ccc4e0712b4b9ecbb51b791a41e8b608",
  neighbors: "d17b4e306aa148915da724d0477a8fb27b10e329b5d45e6a98ab924717954813",
};

const grids = new Map<number, IcoPlotGrid>();

/** Builds (once per lane) and returns the grid of `params`. */
export function gridFor(params: PlotGridParams): IcoPlotGrid {
  let g = grids.get(params.gridM);
  if (!g) {
    g = createPlotGrid(params);
    grids.set(params.gridM, g);
  }
  return g;
}

export function standardDigests(): GridGoldenDigests {
  return computeGridGoldenDigests(gridFor(STANDARD_GRID_PARAMS));
}

export function moonletDigests(): GridGoldenDigests {
  return computeGridGoldenDigests(gridFor(MOONLET_GRID_PARAMS));
}

/** Largest |H_base - bake reference| over the 38 fixture golden samples (tolerance 0.02 m). */
export function fixtureHeightMaxError(): number {
  const cube = loadFixtureCube();
  let worst = 0;
  for (const s of goldenSamples.samples) {
    const h = cube.sampleXYZ(s.dir[0] ?? 0, s.dir[1] ?? 0, s.dir[2] ?? 0);
    worst = Math.max(worst, Math.abs(h - s.heightM));
  }
  return worst;
}

/** Tolerance of the engine-agreement height case (atan/tan may differ in the last bit between engines). */
export const HEIGHT_ENGINE_TOLERANCE_M = 1e-6;

/** H = H_base + H_detail (default detail, R = 2,000 m) on the fixture cube at 32 seeded near-surface points. */
export function seededGroundHeights(): number[] {
  const ground = new GroundHeight(loadFixtureCube(), { radiusM: 2000 });
  const rnd = mulberry32(0x48454947); // "HEIG"
  const out: number[] = [];
  while (out.length < 32) {
    const x = rnd() / 2147483648 - 1;
    const y = rnd() / 2147483648 - 1;
    const z = rnd() / 2147483648 - 1;
    const r2 = x * x + y * y + z * z;
    if (r2 <= 1e-6 || r2 > 1) continue;
    const len = Math.sqrt(r2);
    out.push(ground.heightAtXYZ(x / len, y / len, z / len));
  }
  return out;
}

/** Recorded on Node 26.13.1 from `seededGroundHeights()`. */
export const GOLDEN_GROUND_HEIGHTS: readonly number[] = [
  -8.35052652298595, -2.9950111165851894, 2.243431438436137, 11.988886674278993, -3.12497738821075, -9.906539998733301,
  -0.8417745999636417, 27.13325198761008, -4.158721868552228, -5.589787406398959, 15.098016463094154, -5.73307372905474,
  21.673347060859424, 4.748418639753212, 3.563969525422375, -17.944359399860335, -5.264571588162642, 3.406284637729237,
  -10.190873744977223, 13.255227900516795, 26.638094556878812, 27.603304678998246, -3.1120970804689962,
  -3.478076762801352, -12.787834490660336, -14.156960287618798, -16.22603208987029, -15.173834134985134,
  8.961936429686524, -8.06058122936765, -3.145388147664648, -9.333181109226164,
];
