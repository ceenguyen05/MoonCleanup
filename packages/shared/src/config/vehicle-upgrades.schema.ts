// @contract config/vehicle-upgrades.schema v1
// @consumers packages/game-data (data/vehicle-upgrades.json), packages/sim, apps/client (Motor Pool), tools/balance-sim
//
// `vehicle-upgrades.json`: 7 lines, 16 levels; each level costs a multiple of the vehicle's price
// (progression-and-economy.md section 21). Reference mode: no `refit` block (optional section 24).

import { z } from "zod";
import {
  EffectSchema,
  GameDataSchemaVersionSchema,
  NonNegativeNumberSchema,
  prefixedId,
  uniqueIdArray,
} from "./common.schema";

export const VehicleUpgradeLineIdSchema = prefixedId("vehicle_upgrade");

export const VehicleUpgradeLevelSchema = z.strictObject({
  costMultOfVehiclePrice: NonNegativeNumberSchema,
  effects: z.array(EffectSchema),
});

export const VehicleUpgradeLineSchema = z.strictObject({
  id: VehicleUpgradeLineIdSchema,
  levels: z.array(VehicleUpgradeLevelSchema).min(1),
});
export type VehicleUpgradeLineDef = z.infer<typeof VehicleUpgradeLineSchema>;

export const VehicleUpgradesSchema = z.strictObject({
  schemaVersion: GameDataSchemaVersionSchema,
  lines: uniqueIdArray(VehicleUpgradeLineSchema).min(1),
});
export type VehicleUpgradesTable = z.infer<typeof VehicleUpgradesSchema>;
