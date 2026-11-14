// @contract config/movement.schema v1.2
// @consumers packages/game-data (data/movement.json), packages/sim (player motion), tools/balance-sim
//
// `movement.json`: on-foot speeds, jump and Hop Pack numbers, night penalty (progression-and-economy.md section 21).
//
// v1.1 (additive): optional `carryUnits`.
// v1.2 (breaking for data): `carryUnits` is required.

import { z } from "zod";
import { FracSchema, GameDataSchemaVersionSchema, PositiveCountSchema, PositiveNumberSchema } from "./common.schema";

export const MovementSchema = z.strictObject({
  schemaVersion: GameDataSchemaVersionSchema,
  walkMps: PositiveNumberSchema,
  lopeMps: PositiveNumberSchema,
  sweepWalkMps: PositiveNumberSchema,
  jumpApexM: PositiveNumberSchema,
  hopBurstMps: PositiveNumberSchema,
  hopRechargeS: PositiveNumberSchema,
  nightPenaltyFrac: FracSchema,
  lampPenaltyReliefFrac: FracSchema,
  /** Pucks or stacks a player carries in hand (section 3). Required since v1.2. */
  carryUnits: PositiveCountSchema,
});
export type MovementTable = z.infer<typeof MovementSchema>;
