// @contract config/world.schema v1.1
// @consumers packages/game-data (data/world.json), packages/world, packages/sim, tools/terrain-bake, tools/balance-sim
//
// `world.json`: Moon size, grid, day cycle, terrain classes and dust amounts (progression-and-economy.md section 21).
//
// v1.1 (additive, contracts bump 1 of M1): `sunPath { maxElevationDeg, minElevationDeg }` (decision D1: peak 40 deg,
// trough -20 deg). Optional on input with `WORLD_SUN_PATH_DEFAULT` as the default, so `world.json` files without it
// still parse; the parsed `WorldTable.sunPath` is always present. Consumers: packages/game-data (`sun-path.ts` reads
// it and drops its local constant; may write the field into world.json), apps/client/src/visuals (sun and Earth key
// driven by the path), packages/sim (`daynight.changed` elevation), tools/balance-sim (night windows).

import { z } from "zod";
import {
  CountSchema,
  ElevationDegSchema,
  FracSchema,
  GameDataSchemaVersionSchema,
  MultSchema,
  NonNegativeNumberSchema,
  PositiveCountSchema,
  PositiveNumberSchema,
  prefixedId,
  uniqueIdArray,
} from "./common.schema";

/** Tolerance for "fractions sum to 1" checks. */
export const FRAC_SUM_TOLERANCE = 1e-6;

/** Plot count of a geodesic hex grid of frequency f: 10 f^2 + 2 (163,842 at f = 128). Used by the refinement. */
function plotCountForFrequency(frequency: number): number {
  return 10 * frequency * frequency + 2;
}

export const TerrainIdSchema = prefixedId("terrain");

export const TerrainClassSchema = z.strictObject({
  id: TerrainIdSchema,
  plotShareFrac: FracSchema,
  /** Dust per m^2 in units of `dustKgPerM2PerLevel`. */
  dustLevel: NonNegativeNumberSchema,
});
export type TerrainClass = z.infer<typeof TerrainClassSchema>;

export const TerrainShareSchema = z.strictObject({ terrainId: TerrainIdSchema, frac: FracSchema });

/**
 * Gameplay sun path of a day (decision D1): the sun's elevation sweeps a half-sine between the trough at local
 * midnight and the peak at local noon. The real Boreal sun hugs the horizon; gameplay uses this arc instead so noon
 * shadows keep side light and the night is dark enough to need the Clip Light (= the `night-near` capture preset).
 */
export const SunPathSchema = z
  .strictObject({
    /** Elevation at local noon, degrees above the horizon (1 .. 90). */
    maxElevationDeg: z.number().min(1).max(90),
    /** Elevation at local midnight, degrees (-90 .. -1; negative = below the horizon). */
    minElevationDeg: z.number().min(-90).max(-1),
  })
  .superRefine((path, ctx) => {
    if (path.maxElevationDeg <= path.minElevationDeg) {
      ctx.addIssue({
        code: "custom",
        message: "maxElevationDeg must exceed minElevationDeg",
        path: ["maxElevationDeg"],
      });
    }
  });
export type SunPath = z.infer<typeof SunPathSchema>;

/** D1 sun path: peak 40 deg, trough -20 deg. */
export const WORLD_SUN_PATH_DEFAULT: SunPath = Object.freeze({ maxElevationDeg: 40, minElevationDeg: -20 });

export const WorldSchema = z
  .strictObject({
    schemaVersion: GameDataSchemaVersionSchema,
    moonRadiusM: PositiveNumberSchema,
    gridFrequency: PositiveCountSchema,
    /** Derived check: must equal 10 f^2 + 2. */
    plotCount: PositiveCountSchema,
    gravityMps2: PositiveNumberSchema,
    dayLengthS: PositiveNumberSchema,
    daylightFrac: FracSchema,
    /** Sun phase at contract start, as a fraction of a day. */
    contractStartSunPhase: FracSchema,
    /** Sun elevation extremes of the day (D1). Defaults to `WORLD_SUN_PATH_DEFAULT` when absent. */
    sunPath: SunPathSchema.default(() => ({ ...WORLD_SUN_PATH_DEFAULT })),
    terrainClasses: uniqueIdArray(TerrainClassSchema).min(1),
    dustKgPerM2PerLevel: PositiveNumberSchema,
    openedThresholdFrac: FracSchema,
    polishedThresholdFrac: FracSchema,
    steepSlopeDeg: ElevationDegSchema,
    steepSweepMult: MultSchema,
    /** Terrain mix of plots near an outpost (section 1: within 600 m, 90/8/2). */
    outpostMix: z.strictObject({
      radiusM: PositiveNumberSchema,
      shares: z.array(TerrainShareSchema).min(1),
    }),
    compoundRings: CountSchema,
    landingApron: z.strictObject({
      plotsPerOutpost: PositiveCountSchema,
      coverageFrac: FracSchema,
      dustLevel: NonNegativeNumberSchema,
    }),
  })
  .superRefine((world, ctx) => {
    if (world.plotCount !== plotCountForFrequency(world.gridFrequency)) {
      ctx.addIssue({ code: "custom", message: "plotCount must equal 10 * gridFrequency^2 + 2", path: ["plotCount"] });
    }
    const shareSum = world.terrainClasses.reduce((sum, t) => sum + t.plotShareFrac, 0);
    if (Math.abs(shareSum - 1) > FRAC_SUM_TOLERANCE) {
      ctx.addIssue({ code: "custom", message: "terrainClasses plotShareFrac must sum to 1", path: ["terrainClasses"] });
    }
    const terrainIds = new Set(world.terrainClasses.map((t) => t.id));
    const mixIds = new Set<string>();
    world.outpostMix.shares.forEach((share, index) => {
      if (!terrainIds.has(share.terrainId) || mixIds.has(share.terrainId)) {
        ctx.addIssue({
          code: "custom",
          message: `unknown or repeated terrainId "${share.terrainId}"`,
          path: ["outpostMix", "shares", index, "terrainId"],
        });
      }
      mixIds.add(share.terrainId);
    });
    const mixSum = world.outpostMix.shares.reduce((sum, s) => sum + s.frac, 0);
    if (Math.abs(mixSum - 1) > FRAC_SUM_TOLERANCE) {
      ctx.addIssue({ code: "custom", message: "outpostMix shares must sum to 1", path: ["outpostMix", "shares"] });
    }
  });
export type WorldTable = z.infer<typeof WorldSchema>;
