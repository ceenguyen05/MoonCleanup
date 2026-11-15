// `__mcLook.info().dustAtlas`: layout numbers derived from the atlas layout, counters copied as they are.

import { QUALITY_PRESETS } from "@moon-cleanup/shared";
import { describe, expect, it } from "vitest";
import { readDustAtlasInfo, type DustAtlasStatsSource } from "./atlas-info";
import { DUST_TILE_PRESETS } from "./tile-atlas";

function source(
  preset: keyof typeof DUST_TILE_PRESETS,
  counters: Partial<DustAtlasStatsSource> = {},
): DustAtlasStatsSource {
  const { slotPx, cols, rows } = DUST_TILE_PRESETS[preset];
  return {
    layout: { slotPx, cols, rows },
    slots: cols * rows,
    tilesResident: 0,
    rebuildBacklog: 0,
    rebuilds: 0,
    evictions: 0,
    strokesReplayed: 0,
    tileStrokeDraws: 0,
    liveOverflows: 0,
    fCpuMs: 0,
    maxCpuMs: 0,
    ...counters,
  };
}

describe("readDustAtlasInfo", () => {
  it("reports the texture size, slot count and texel size of each atlas preset, matching the quality table", () => {
    for (const preset of ["low", "medium", "high"] as const) {
      const info = readDustAtlasInfo(source(preset), preset);
      const table = QUALITY_PRESETS[preset].dust.atlas;
      expect(info.preset).toBe(preset);
      expect([info.widthPx, info.heightPx]).toEqual([table.widthPx, table.heightPx]);
      expect(info.slotPx).toBe(table.slotPx);
      expect(info.slots).toBe(table.slots);
      expect(info.texelCm).toBeCloseTo(table.texelCm, 9);
    }
  });

  it("copies the live counters", () => {
    const info = readDustAtlasInfo(
      source("low", {
        tilesResident: 37,
        rebuildBacklog: 2,
        rebuilds: 41,
        evictions: 4,
        strokesReplayed: 3975,
        tileStrokeDraws: 5120,
        liveOverflows: 1,
        fCpuMs: 0.31,
        maxCpuMs: 0.74,
      }),
      "low",
    );
    expect(info).toMatchObject({
      tilesResident: 37,
      rebuildBacklog: 2,
      rebuilds: 41,
      evictions: 4,
      strokesReplayed: 3975,
      tileStrokeDraws: 5120,
      liveOverflows: 1,
      cpuMsLast: 0.31,
      cpuMsMax: 0.74,
    });
  });
});
