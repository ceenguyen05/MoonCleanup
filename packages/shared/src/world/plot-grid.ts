// @contract world/plot-grid v1.1
// @consumers packages/world (implements PlotGrid and the golden hashes, M1-W1), packages/sim, packages/protocol (PlotId
//   and chunk id widths), apps/client/src/terrain, apps/server/src/world, tools/terrain-bake (golden hash manifest)
//
// v1.1 (additive, contracts bump 1 of M1): `PLOT_GRID_GOLDEN_HASHES.grid` and `.pointToPlot` now carry the digests
// recorded by packages/world (M1-W1-T01; Node 26.13.1, identical in Chromium); `.ledger` stays null until the ledger
// vectors exist. Consumers: packages/world golden lane may compare against these constants instead of its manifest.
//
// Plot grid parameters, chunk and display ids, the PlotGrid interface and the golden-hash slots. Specification:
// docs/architecture/world-and-dust-simulation.md sections 1, 2.1 to 2.7 and 2.9; naming-bible.md (plot display id).
//
// Changes from v0 (placeholder): `PlotState` moved to ./dust (still exported from the barrel under the same name);
// `PlotGrid` gained `params`, `neighborCount`, `centerDirection`, `localIndexOf`, `plotAtChunkLocal`, `isPentagon`,
// `frame`, `toPlotLocal`, `fromPlotLocal`; `plotAt` takes an optional previous-plot hint (section 2.6 fast path);
// `neighbors` returns a `PlotIdView`. v0 had no implementation and no consumer, so nothing breaks.
//
// Grid family (section 2.2/2.3): GP(m,0) = dual of the recursive icosphere, 10 diamonds of m x m lattice points plus
// 2 poles. PlotId = diamond * m^2 + i * m + j; north pole = 10 m^2; south pole = 10 m^2 + 1. Chunks are 16 x 16
// plots: ChunkId = diamond * (m/16)^2 + (i >> 4) * (m/16) + (j >> 4); the poles form the last chunk
// (id 10 (m/16)^2 = 640 for Standard). Local index = (i & 15) * 16 + (j & 15), poles 0 = north, 1 = south.
// Player-facing id: "Plot {chunkId}-{localIndex}" (PLOT_DISPLAY_ID_PATTERN).
//
// Neighbour order (section 2.5): counter-clockwise around the outward normal, starting with the neighbour whose
// direction is closest to the plot's local east axis; slot 5 of a pentagon is NO_NEIGHBOR. Determinism rule
// (section 1): grid generation, point -> plot, tangent frames and plot-local conversion use only + - * / sqrt,
// comparisons and floor/round/min/max/abs (no sin, cos, atan, exp, pow).

import { z } from "zod";
import type { PlotId } from "../ids";
import type { Metres } from "../units";

// ---- Grid parameters ------------------------------------------------------------------------------------------------

/** Grid frequency of the Standard moon, GP(128,0). */
export const STANDARD_GRID_M = 128;

/** Plot count of a grid of frequency m: 10 * m^2 + 2 (12 of them pentagons). */
export const STANDARD_PLOT_COUNT = 10 * STANDARD_GRID_M * STANDARD_GRID_M + 2;

/** Moon radius in metres. */
export const STANDARD_MOON_RADIUS_M = 2000;

/** Plots per chunk edge; a chunk holds 16 x 16 plots. */
export const CHUNK_EDGE_PLOTS = 16;

/** Plots per full chunk (16 x 16). */
export const PLOTS_PER_CHUNK = CHUNK_EDGE_PLOTS * CHUNK_EDGE_PLOTS;

/** Chunks 0 .. 639 hold 256 plots each; chunk 640 holds the two poles (Standard). */
export const POLE_CHUNK_ID = 640;

/** Number of chunk ids, 0 .. 640 (Standard). */
export const CHUNK_COUNT = POLE_CHUNK_ID + 1;

/** Number of diamonds of the icosahedral grid. */
export const DIAMOND_COUNT = 10;

/** Number of pentagonal plots (the 12 icosahedron vertices), at every grid frequency. */
export const PENTAGON_COUNT = 12;

/** Neighbour slots per plot; a pentagon has 5 neighbours and its slot 5 is NO_NEIGHBOR. */
export const PLOT_NEIGHBOR_SLOTS = 6;

/** Value of an empty neighbour slot in the `Int32Array(plotCount * 6)` neighbour table (pentagons, slot 5). */
export const NO_NEIGHBOR = -1;

/** Directed neighbour entries of the Standard grid: 163,830 * 6 + 12 * 5 (section 2.1). */
export const STANDARD_NEIGHBOR_ENTRIES = 983_040;

/** Plot frame (tile and ledger footprint): a square of this edge in the plot tangent plane (section 0). */
export const PLOT_FRAME_EDGE_M: Metres = 25.6;

/** Half of the plot frame edge. The bake fails if the largest hexagon corner radius exceeds 12.3 m (section 2.8). */
export const PLOT_FRAME_HALF_M: Metres = 12.8;

/** Dust chunk id, 0 .. 640 (Standard). 10 bits on the wire (`dust.check`, WDS section 5.1). */
export type ChunkId = number;

/** The grid-dependent numbers of one GP(m,0) variant. `gridM` and `radiusM` are fields of the save header. */
export interface PlotGridParams {
  /** Grid frequency m (diamond side in lattice points). Standard 128, Moonlet 64. */
  readonly gridM: number;
  /** Moon radius in metres. */
  readonly radiusM: Metres;
  /** 10 * m^2 + 2. */
  readonly plotCount: number;
  /** plotCount - 12. */
  readonly hexagonCount: number;
  /** Always 12. */
  readonly pentagonCount: number;
  /** 10 * (m / 16)^2 + 1. */
  readonly chunkCount: number;
  /** Id of the chunk that holds the two poles (chunkCount - 1). */
  readonly poleChunkId: ChunkId;
  /** PlotId of the north pole (10 m^2). */
  readonly northPolePlotId: number;
  /** PlotId of the south pole (10 m^2 + 1). */
  readonly southPolePlotId: number;
}

/** GP(128,0): 163,842 plots, R = 2,000 m, 641 chunks (WDS section 0). */
export const STANDARD_GRID_PARAMS: PlotGridParams = {
  gridM: 128,
  radiusM: 2000,
  plotCount: 163_842,
  hexagonCount: 163_830,
  pentagonCount: 12,
  chunkCount: 641,
  poleChunkId: 640,
  northPolePlotId: 163_840,
  southPolePlotId: 163_841,
};

/** GP(64,0) Moonlet option: 40,962 plots, R = 1,000 m, 161 chunks (WDS section 2.9). Not shipped in M1. */
export const MOONLET_GRID_PARAMS: PlotGridParams = {
  gridM: 64,
  radiusM: 1000,
  plotCount: 40_962,
  hexagonCount: 40_950,
  pentagonCount: 12,
  chunkCount: 161,
  poleChunkId: 160,
  northPolePlotId: 40_960,
  southPolePlotId: 40_961,
};

/** Schema of `PlotGridParams`: the derived fields must agree with `gridM` (a multiple of 16). */
export const PlotGridParamsSchema = z
  .object({
    gridM: z.int().min(16).max(0xffff),
    radiusM: z.int().min(1).max(0xffff),
    plotCount: z.int().min(1),
    hexagonCount: z.int().min(1),
    pentagonCount: z.literal(PENTAGON_COUNT),
    chunkCount: z.int().min(2),
    poleChunkId: z.int().min(1),
    northPolePlotId: z.int().min(1),
    southPolePlotId: z.int().min(1),
  })
  .superRefine((p, ctx) => {
    const m2 = p.gridM * p.gridM;
    const chunksPerDiamond = (p.gridM / CHUNK_EDGE_PLOTS) ** 2;
    const issue = (path: string, message: string): void => {
      ctx.addIssue({ code: "custom", path: [path], message });
    };
    if (p.gridM % CHUNK_EDGE_PLOTS !== 0) issue("gridM", "gridM must be a multiple of 16");
    if (p.plotCount !== 10 * m2 + 2) issue("plotCount", "plotCount must equal 10 * gridM^2 + 2");
    if (p.hexagonCount !== p.plotCount - PENTAGON_COUNT) issue("hexagonCount", "hexagonCount must be plotCount - 12");
    if (p.chunkCount !== 10 * chunksPerDiamond + 1) issue("chunkCount", "chunkCount must be 10 * (gridM/16)^2 + 1");
    if (p.poleChunkId !== p.chunkCount - 1) issue("poleChunkId", "poleChunkId must be chunkCount - 1");
    if (p.northPolePlotId !== 10 * m2) issue("northPolePlotId", "northPolePlotId must be 10 * gridM^2");
    if (p.southPolePlotId !== 10 * m2 + 1) issue("southPolePlotId", "southPolePlotId must be 10 * gridM^2 + 1");
  });

/** Player-facing plot id, "Plot 41-207" (naming bible). Groups: chunk id, local index. */
export const PLOT_DISPLAY_ID_PATTERN = /^Plot (\d{1,3})-(\d{1,3})$/;

/** Decoded player-facing plot id. */
export interface PlotDisplayId {
  readonly chunkId: ChunkId;
  /** 0 .. 255 (poles: 0 = north, 1 = south). */
  readonly localIndex: number;
}

// ---- Golden hashes (slot) ------------------------------------------------------------------------------------------------

/** Lower-case hex of a SHA-256 digest. */
export const Sha256HexSchema = z.string().regex(/^[0-9a-f]{64}$/);

/**
 * The three golden SHA-256 digests of WDS section 1 ("Golden hash"). `null` means "not yet recorded".
 *   grid         quantised grid: all plot centres rounded to 1 micrometre, in PlotId order
 *   pointToPlot  1,000 seeded point -> plot answers
 *   ledger       the ledger operations of the V1 vectors (WDS section 4.5b)
 * The values are produced by packages/world / tools/terrain-bake and are identical in Node 26, Chromium, Firefox and
 * WebKit (CI four-engine job). The slot shipped empty in v1.0; v1.1 records `grid` and `pointToPlot` from
 * packages/world (byte layouts in packages/world/src/grid/golden.ts: pointToPlot = 1,000 points, mulberry32 seed
 * 0x4d4f4f4e). `ledger` stays `null` until the ledger operations of the V1 vectors have a recorded digest.
 */
export interface PlotGridGoldenHashes {
  readonly grid: string | null;
  readonly pointToPlot: string | null;
  readonly ledger: string | null;
}

/** Golden-hash slots of the Standard grid (see PlotGridGoldenHashes). */
export const PLOT_GRID_GOLDEN_HASHES: PlotGridGoldenHashes = {
  grid: "eecb088b1eff1f24ed2aa8c29b1d1c5dc5d4f3b43716525be777b46be665c6c5",
  pointToPlot: "ace8f2e5a2974429a00c41457dbc6cba4e779832d6183df484b2e6c35868298a",
  ledger: null,
};

export const PlotGridGoldenHashesSchema = z.object({
  grid: Sha256HexSchema.nullable(),
  pointToPlot: Sha256HexSchema.nullable(),
  ledger: Sha256HexSchema.nullable(),
});

// ---- Geometry types ---------------------------------------------------------------------------------------------------------

/** Unit direction from the moon centre (x, y, z), length 1. Axes: +Y north pole, +X lat 0 lon 0, -Z 90 E (WDS section 1). */
export interface UnitDirection {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** Writable unit direction, used as an output buffer on hot paths. */
export interface MutableUnitDirection {
  x: number;
  y: number;
  z: number;
}

/** Point on or above the surface in moon-centred metres. */
export interface MoonPoint {
  readonly x: Metres;
  readonly y: Metres;
  readonly z: Metres;
}

/** Tangent frame of a plot (section 2.7): n = centre, e = normalise(Y x n), t = n x e. Poles: e = +X, t = -Z / +Z. */
export interface PlotFrame {
  readonly normal: UnitDirection;
  readonly east: UnitDirection;
  readonly north: UnitDirection;
}

/** Plot-local coordinates in integer millimetres (gnomonic projection onto the tangent plane, section 2.7). */
export interface PlotLocalMm {
  u: number;
  v: number;
}

/** Read-only indexed view of plot ids; the grid may return a view over its neighbour table. */
export interface PlotIdView {
  readonly length: number;
  readonly [index: number]: PlotId;
}

/**
 * The hex plot grid, implemented once by packages/world and shared by client, server and the Solo worker.
 *
 * Hot paths reuse buffers: `neighbors` may return a view that is valid only until the next call on the same grid,
 * `toPlotLocal` and `fromPlotLocal` write into the caller's output object, `frame` returns shared immutable data.
 * Implementations never allocate per call on the sim path.
 */
export interface PlotGrid {
  /** The grid-dependent constants this instance was built for. */
  readonly params: PlotGridParams;
  /** Number of plots (10 * gridM^2 + 2). */
  readonly count: number;
  /**
   * The plot that contains `dir` (unit vector; behaviour for non-unit input is undefined). `hint` is the previous
   * answer of the same moving point and enables the 7-to-13 dot product fast path of section 2.6. Ties go to the
   * lower PlotId.
   */
  plotAt(dir: UnitDirection, hint?: PlotId): PlotId;
  /** Neighbour plots of `id` in the section 2.5 order (5 for a pentagon, 6 otherwise). */
  neighbors(id: PlotId): PlotIdView;
  /** 5 for a pentagon, otherwise 6. */
  neighborCount(id: PlotId): 5 | 6;
  /** Centre of `id` on the reference sphere, in moon-centred metres (radiusM times the unit centre). */
  center(id: PlotId): MoonPoint;
  /** Unit direction of the centre of `id`. */
  centerDirection(id: PlotId): UnitDirection;
  /** Dust chunk that stores `id`. */
  chunkOf(id: PlotId): ChunkId;
  /** Index of `id` inside its chunk, 0 .. 255 (poles 0 and 1). */
  localIndexOf(id: PlotId): number;
  /** Inverse of (`chunkOf`, `localIndexOf`). */
  plotAtChunkLocal(chunkId: ChunkId, localIndex: number): PlotId;
  /** True for the 12 icosahedron vertices. */
  isPentagon(id: PlotId): boolean;
  /** Tangent frame of `id` (derived at load, identical on server and client). */
  frame(id: PlotId): PlotFrame;
  /** Projects `dir` into the frame of `id`; writes millimetres rounded with Math.round into `out`. */
  toPlotLocal(id: PlotId, dir: UnitDirection, out: PlotLocalMm): PlotLocalMm;
  /** Inverse projection: unit direction of plot-local (uMm, vMm) in the frame of `id`, written into `out`. */
  fromPlotLocal(id: PlotId, uMm: number, vMm: number, out: MutableUnitDirection): MutableUnitDirection;
}
