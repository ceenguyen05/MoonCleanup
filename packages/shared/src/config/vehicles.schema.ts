// @contract config/vehicles.schema v1.1
// @consumers packages/game-data (data/vehicles.json), packages/sim (vehicles), apps/client (Motor Pool),
//   tools/balance-sim
//
// `vehicles.json`: 5 vehicles (Trundle, Skiff, Carryall, Bulldust, Behemoth), Motor Pool parts and vehicles out per
// Motor Pool (progression-and-economy.md section 21). Money-gated; the Motor Pool is an ordinary prerequisite.
//
// v1.1 (additive): optional per-vehicle `flatbed{pucks, stacks, bales}` (Carryall).

import { z } from "zod";
import {
  CountSchema,
  GameDataSchemaVersionSchema,
  LmAmountSchema,
  MultSchema,
  NonNegativeNumberSchema,
  ParamsSchema,
  PositiveCountSchema,
  PositiveNumberSchema,
  prefixedId,
  uniqueIdArray,
  uniqueStringArray,
} from "./common.schema";
import { PieceIdSchema } from "./build-pieces.schema";
import { VehicleUpgradeLineIdSchema } from "./vehicle-upgrades.schema";

export const VehicleIdSchema = prefixedId("vehicle");

/** Open cargo bed capacity (section 8: Carryall 40 pucks, 8 stacks, 2 Bales). */
export const FlatbedSchema = z.strictObject({ pucks: CountSchema, stacks: CountSchema, bales: CountSchema });
export type FlatbedDef = z.infer<typeof FlatbedSchema>;

export const VehicleSchema = z.strictObject({
  id: VehicleIdSchema,
  tier: PositiveCountSchema,
  priceLm: LmAmountSchema,
  /** 0 for the walk-behind Trundle; 8 for the Carryall. */
  seats: CountSchema,
  /** Cleaning width; 0 for the Carryall (transport, no cleaning). */
  widthM: NonNegativeNumberSchema,
  cruiseMps: PositiveNumberSchema,
  boostMult: MultSchema,
  depthLevels: CountSchema,
  payloadKg: NonNegativeNumberSchema,
  puckSlots: CountSchema,
  upgradeLineIds: uniqueStringArray(VehicleUpgradeLineIdSchema),
  /** Cargo bed of a transport vehicle (Carryall); absent for vehicles without one. */
  flatbed: FlatbedSchema.optional(),
});
export type VehicleDef = z.infer<typeof VehicleSchema>;

/** Motor Pool, Dump Plate, Dust Vault: priced pieces with free extra params (e.g. `storeKg`). */
export const MotorPoolPartSchema = z.strictObject({
  id: PieceIdSchema,
  priceLm: LmAmountSchema,
  params: ParamsSchema.optional(),
});
export type MotorPoolPartDef = z.infer<typeof MotorPoolPartSchema>;

export const VehiclesSchema = z
  .strictObject({
    schemaVersion: GameDataSchemaVersionSchema,
    vehicles: uniqueIdArray(VehicleSchema).min(1),
    motorPoolParts: uniqueIdArray(MotorPoolPartSchema).min(1),
    vehiclesOutPerMotorPool: PositiveCountSchema,
  })
  .superRefine((table, ctx) => {
    const tiers = new Set<number>();
    table.vehicles.forEach((vehicle, index) => {
      if (tiers.has(vehicle.tier)) {
        ctx.addIssue({ code: "custom", message: `duplicate tier ${vehicle.tier}`, path: ["vehicles", index, "tier"] });
      }
      tiers.add(vehicle.tier);
    });
  });
export type VehiclesTable = z.infer<typeof VehiclesSchema>;
