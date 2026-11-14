// @contract config/features.schema v1
// @consumers packages/game-data (data/features.json), packages/sim and apps/server (rules behind `op: "flag"`)
//
// `features.json`: registry of qualitative behaviours referenced by flag effects (progression-and-economy.md
// section 21). Each id names the sim/server rule that implements it.

import { z } from "zod";
import { FeatureIdSchema, GameDataSchemaVersionSchema, uniqueIdArray } from "./common.schema";

/** Baseline feature ids (reference mode). Optional section 24 features are not listed. */
export const BASELINE_FEATURE_IDS = [
  "overflow_former",
  "smooth_handoff_rail_snap",
  "golden_handshake_credit",
  "punch_list",
] as const;

export const FeatureSchema = z.strictObject({
  id: FeatureIdSchema,
  description: z.string().min(1).max(200),
});
export type FeatureDef = z.infer<typeof FeatureSchema>;

export const FeaturesSchema = z.strictObject({
  schemaVersion: GameDataSchemaVersionSchema,
  features: uniqueIdArray(FeatureSchema),
});
export type FeaturesTable = z.infer<typeof FeaturesSchema>;
