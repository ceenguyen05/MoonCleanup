// @contract config/collectibles.schema v1
// @consumers packages/game-data (data/collectibles.json), packages/sim, apps/server (rewards), tools/terrain-bake
//   (positions), tools/balance-sim
//
// `collectibles.json`: Stray Cargo rewards by size and the 24 Survey Points (progression-and-economy.md section 21).
// Reference mode: Lumens rewards only; no `coreSamples`, `tenureXp` or `commendations` (optional section 24).

import { z } from "zod";
import { CountSchema, GameDataSchemaVersionSchema, LmAmountSchema, prefixedId, uniqueIdArray } from "./common.schema";

export const SurveyPointIdSchema = prefixedId("survey");

/** Stray Cargo sizes (Near Parcels, Parcels, Crates, Pallets). */
export const STRAY_CARGO_SIZES = ["near_parcel", "parcel", "crate", "pallet"] as const;
export type StrayCargoSize = (typeof STRAY_CARGO_SIZES)[number];

export const StrayCargoSchema = z.strictObject({
  size: z.enum(STRAY_CARGO_SIZES),
  count: CountSchema,
  lm: LmAmountSchema,
});

export const SurveyPointSchema = z.strictObject({
  id: SurveyPointIdSchema,
  /** Real lunar feature the point is placed at (a crater, rille or central peak). */
  featureName: z.string().min(1).max(80),
  lm: LmAmountSchema,
});
export type SurveyPointDef = z.infer<typeof SurveyPointSchema>;

export const CollectiblesSchema = z
  .strictObject({
    schemaVersion: GameDataSchemaVersionSchema,
    strayCargo: z.array(StrayCargoSchema).min(1),
    surveyPoints: uniqueIdArray(SurveyPointSchema),
  })
  .superRefine((table, ctx) => {
    const sizes = new Set<string>();
    table.strayCargo.forEach((cargo, index) => {
      if (sizes.has(cargo.size)) {
        ctx.addIssue({
          code: "custom",
          message: `duplicate size "${cargo.size}"`,
          path: ["strayCargo", index, "size"],
        });
      }
      sizes.add(cargo.size);
    });
  });
export type CollectiblesTable = z.infer<typeof CollectiblesSchema>;
