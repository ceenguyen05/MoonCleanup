// @contract config/robots.schema v1.2
// @consumers packages/game-data (data/robots.json), packages/sim (robots), apps/client (robot UI), tools/balance-sim
//
// `robots.json`: Roost pricing, the 2 local units (Sandpiper, Plover), the global Albatross, Nests and the 9 UI
// states (progression-and-economy.md section 21, naming bible section 8). Reference mode: robots work at their
// calibrated base rate; no on-shift/effort multiplier, no `uptimeAutoFrac`, no `workFront` (optional section 24).
//
// v1.1 (additive): optional `units[].upgradePriceLm` and `albatross.rateM2ps`; `ROOST_PIECE_ID` / `NEST_PIECE_ID`
// (the bundle checks their build-pieces prices against `roost.basePriceLm` / `nest.priceLm`).
// v1.2 (breaking for data): `albatross.rateM2ps` is required; `units[].upgradePriceLm` stays optional.

import { z } from "zod";
import {
  FracSchema,
  GameDataSchemaVersionSchema,
  LmAmountSchema,
  MultSchema,
  NonNegativeNumberSchema,
  PositiveCountSchema,
  PositiveNumberSchema,
  prefixedId,
  uniqueIdArray,
} from "./common.schema";

export const RobotUnitIdSchema = prefixedId("robot");

/** Build piece of a Roost; its build-pieces `priceLm` equals `roost.basePriceLm` (checked by the bundle). */
export const ROOST_PIECE_ID = "piece.roost";
/** Build piece of a Nest; its build-pieces `priceLm` equals `nest.priceLm` (checked by the bundle). */
export const NEST_PIECE_ID = "piece.nest";

/** The 9 robot UI states (naming bible section 8). */
export const ROBOT_STATE_IDS = [
  "foraging",
  "flying",
  "inbound",
  "molting",
  "patch_picked_clean",
  "roost_brimming",
  "crop_full",
  "grounded",
  "resting",
] as const;
export type RobotStateId = (typeof ROBOT_STATE_IDS)[number];

export const RobotUnitSchema = z.strictObject({
  id: RobotUnitIdSchema,
  rateM2ps: PositiveNumberSchema,
  binKg: PositiveNumberSchema,
  storeKg: PositiveNumberSchema,
  /** Plot rings around the Roost the unit cleans. */
  rings: PositiveCountSchema,
  uptimeManualFrac: FracSchema,
  /**
   * Price to upgrade one Roost's unit in place to this unit (Plover: section 9.1). Absent for the unit a Roost
   * starts with (Sandpiper).
   */
  upgradePriceLm: LmAmountSchema.optional(),
});
export type RobotUnitDef = z.infer<typeof RobotUnitSchema>;

export const RobotsSchema = z
  .strictObject({
    schemaVersion: GameDataSchemaVersionSchema,
    roost: z.strictObject({
      basePriceLm: LmAmountSchema,
      priceGrowthMult: MultSchema,
      railAllowanceLm: LmAmountSchema,
      resiteDowntimeS: NonNegativeNumberSchema,
      resiteMaxM: PositiveNumberSchema,
    }),
    units: uniqueIdArray(RobotUnitSchema).min(1),
    albatross: z.strictObject({
      basePriceLm: LmAmountSchema,
      priceGrowthMult: MultSchema,
      baleKg: PositiveNumberSchema,
      uptimeFrac: FracSchema,
      /** Albatross units served by one Nest. */
      nestPerUnits: PositiveCountSchema,
      /** Net Moon-mix area cleaned per second by one Albatross (section 9.1). Required since v1.2. */
      rateM2ps: PositiveNumberSchema,
    }),
    nest: z.strictObject({
      priceLm: LmAmountSchema,
      capacityBales: PositiveCountSchema,
      groupRadiusM: PositiveNumberSchema,
      fullFrac: FracSchema,
    }),
    states: z.array(z.enum(ROBOT_STATE_IDS)),
  })
  .superRefine((robots, ctx) => {
    const states = new Set(robots.states);
    if (states.size !== robots.states.length || states.size !== ROBOT_STATE_IDS.length) {
      ctx.addIssue({ code: "custom", message: "states must list each of the 9 robot states once", path: ["states"] });
    }
  });
export type RobotsTable = z.infer<typeof RobotsSchema>;
