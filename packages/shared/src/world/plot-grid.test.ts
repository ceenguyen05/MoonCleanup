import { describe, expect, expectTypeOf, it } from "vitest";
import type { PlotId } from "../ids";
import {
  CHUNK_COUNT,
  CHUNK_EDGE_PLOTS,
  DIAMOND_COUNT,
  MOONLET_GRID_PARAMS,
  PENTAGON_COUNT,
  PLOT_DISPLAY_ID_PATTERN,
  PLOT_FRAME_EDGE_M,
  PLOT_FRAME_HALF_M,
  PLOT_GRID_GOLDEN_HASHES,
  PLOT_NEIGHBOR_SLOTS,
  PLOTS_PER_CHUNK,
  PlotGridGoldenHashesSchema,
  PlotGridParamsSchema,
  POLE_CHUNK_ID,
  STANDARD_GRID_M,
  STANDARD_GRID_PARAMS,
  STANDARD_MOON_RADIUS_M,
  STANDARD_NEIGHBOR_ENTRIES,
  STANDARD_PLOT_COUNT,
  Sha256HexSchema,
  type PlotGrid,
  type PlotIdView,
} from "./plot-grid";

describe("GP(m,0) parameters", () => {
  it("Standard matches WDS section 0 and 2.1 (163,842 plots, 641 chunks)", () => {
    expect(STANDARD_GRID_PARAMS.gridM).toBe(STANDARD_GRID_M);
    expect(STANDARD_GRID_PARAMS.radiusM).toBe(STANDARD_MOON_RADIUS_M);
    expect(STANDARD_GRID_PARAMS.plotCount).toBe(STANDARD_PLOT_COUNT);
    expect(STANDARD_PLOT_COUNT).toBe(10 * 4 ** 7 + 2);
    expect(STANDARD_GRID_PARAMS.hexagonCount + PENTAGON_COUNT).toBe(STANDARD_PLOT_COUNT);
    expect(STANDARD_GRID_PARAMS.hexagonCount * PLOT_NEIGHBOR_SLOTS + PENTAGON_COUNT * 5).toBe(
      STANDARD_NEIGHBOR_ENTRIES,
    );
    expect(STANDARD_GRID_PARAMS.chunkCount).toBe(CHUNK_COUNT);
    expect(STANDARD_GRID_PARAMS.poleChunkId).toBe(POLE_CHUNK_ID);
    expect(POLE_CHUNK_ID * PLOTS_PER_CHUNK + 2).toBe(STANDARD_PLOT_COUNT);
    expect(DIAMOND_COUNT * STANDARD_GRID_M * STANDARD_GRID_M).toBe(STANDARD_GRID_PARAMS.northPolePlotId);
    expect(STANDARD_GRID_PARAMS.southPolePlotId).toBe(STANDARD_GRID_PARAMS.northPolePlotId + 1);
    // Euler: V - E + F = 2 with E = 30 * 4^7 and F = 20 * 4^7.
    expect(STANDARD_PLOT_COUNT - 30 * 4 ** 7 + 20 * 4 ** 7).toBe(2);
  });

  it("Moonlet matches WDS section 2.9 (40,962 plots, 161 chunks)", () => {
    expect(MOONLET_GRID_PARAMS.plotCount).toBe(10 * 4 ** 6 + 2);
    expect(MOONLET_GRID_PARAMS.chunkCount).toBe(10 * 4 * 4 + 1);
    expect(MOONLET_GRID_PARAMS.northPolePlotId).toBe(40_960);
  });

  it("both parameter sets satisfy the schema", () => {
    expect(PlotGridParamsSchema.parse(STANDARD_GRID_PARAMS)).toEqual(STANDARD_GRID_PARAMS);
    expect(PlotGridParamsSchema.parse(JSON.parse(JSON.stringify(MOONLET_GRID_PARAMS)))).toEqual(MOONLET_GRID_PARAMS);
  });

  it("rejects inconsistent parameters", () => {
    const bad: unknown[] = [
      { ...STANDARD_GRID_PARAMS, plotCount: 163_841 },
      { ...STANDARD_GRID_PARAMS, hexagonCount: 163_831 },
      { ...STANDARD_GRID_PARAMS, chunkCount: 640 },
      { ...STANDARD_GRID_PARAMS, poleChunkId: 639 },
      { ...STANDARD_GRID_PARAMS, northPolePlotId: 163_841 },
      { ...STANDARD_GRID_PARAMS, southPolePlotId: 163_840 },
      { ...STANDARD_GRID_PARAMS, pentagonCount: 11 },
      { ...STANDARD_GRID_PARAMS, gridM: 100, plotCount: 100_002, hexagonCount: 99_990 },
      {},
    ];
    for (const value of bad) expect(PlotGridParamsSchema.safeParse(value).success, JSON.stringify(value)).toBe(false);
  });

  it("frame geometry: 25.6 m frame, 32 texels of 0.8 m", () => {
    expect(PLOT_FRAME_EDGE_M).toBe(25.6);
    expect(PLOT_FRAME_HALF_M * 2).toBe(PLOT_FRAME_EDGE_M);
    expect(CHUNK_EDGE_PLOTS).toBe(16);
  });
});

describe("display ids", () => {
  it("matches the naming-bible format", () => {
    const m = PLOT_DISPLAY_ID_PATTERN.exec("Plot 41-207");
    expect(m?.[1]).toBe("41");
    expect(m?.[2]).toBe("207");
    expect(PLOT_DISPLAY_ID_PATTERN.test("Plot 640-1")).toBe(true);
    expect(PLOT_DISPLAY_ID_PATTERN.test("plot 41-207")).toBe(false);
    expect(PLOT_DISPLAY_ID_PATTERN.test("Plot 41207")).toBe(false);
  });
});

describe("golden hash slots", () => {
  it("records the packages/world digests (ledger still empty) and parses as nullable SHA-256", () => {
    expect(PLOT_GRID_GOLDEN_HASHES).toEqual({
      grid: "eecb088b1eff1f24ed2aa8c29b1d1c5dc5d4f3b43716525be777b46be665c6c5",
      pointToPlot: "ace8f2e5a2974429a00c41457dbc6cba4e779832d6183df484b2e6c35868298a",
      ledger: null,
    });
    expect(PlotGridGoldenHashesSchema.parse(PLOT_GRID_GOLDEN_HASHES)).toEqual(PLOT_GRID_GOLDEN_HASHES);
    const filled = { grid: "ab".repeat(32), pointToPlot: "01".repeat(32), ledger: "ff".repeat(32) };
    expect(PlotGridGoldenHashesSchema.parse(filled)).toEqual(filled);
    expect(Sha256HexSchema.safeParse("AB".repeat(32)).success).toBe(false);
    expect(Sha256HexSchema.safeParse("ab".repeat(31)).success).toBe(false);
  });
});

describe("PlotGrid interface (type level)", () => {
  it("has the acceptance-criteria surface", () => {
    expectTypeOf<PlotGrid["count"]>().toEqualTypeOf<number>();
    expectTypeOf<PlotGrid["plotAt"]>().returns.toEqualTypeOf<PlotId>();
    expectTypeOf<PlotGrid["neighbors"]>().parameter(0).toEqualTypeOf<PlotId>();
    expectTypeOf<PlotGrid["neighbors"]>().returns.toEqualTypeOf<PlotIdView>();
    expectTypeOf<PlotGrid["center"]>().parameter(0).toEqualTypeOf<PlotId>();
    expectTypeOf<PlotGrid["chunkOf"]>().returns.toEqualTypeOf<number>();
    expectTypeOf<PlotGrid["neighborCount"]>().returns.toEqualTypeOf<5 | 6>();
    // A raw number is not a PlotId.
    expectTypeOf<number>().not.toExtend<PlotId>();
  });
});
