// @contract config/suit-gear.schema v1
// @consumers packages/game-data (data/suit-gear.json), packages/sim, apps/client (Requisitions Desk), tools/balance-sim
//
// `suit-gear.json`: 5 shift-shared lines (Holster Rig, Hop Pack, Ballast Soles, Crown Lamp, Lowlight Visor), 14
// levels in total (progression-and-economy.md section 21, naming bible section 6). Money-gated only.

import { z } from "zod";
import { CostLevelSchema, GameDataSchemaVersionSchema, prefixedId, uniqueIdArray } from "./common.schema";

export const SuitGearIdSchema = prefixedId("gear");

export const SuitGearLineSchema = z.strictObject({
  id: SuitGearIdSchema,
  levels: z.array(CostLevelSchema).min(1),
});
export type SuitGearLineDef = z.infer<typeof SuitGearLineSchema>;

export const SuitGearSchema = z.strictObject({
  schemaVersion: GameDataSchemaVersionSchema,
  lines: uniqueIdArray(SuitGearLineSchema).min(1),
});
export type SuitGearTable = z.infer<typeof SuitGearSchema>;
