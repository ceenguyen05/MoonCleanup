// @contract config/mvp-scope.schema v1
// @consumers packages/sim (which purchases and entities exist in the MVP build), packages/game-data (cross-check test:
//   every id below exists in the loaded bundle), apps/client/src/ui (Requisitions Desk, Ops Console and Motor Pool list
//   only these), apps/server/src/sim, tools/balance-sim (policy `mvp`), tools/bots
//
// The MVP slice of the baseline tables (scope-tiers.md section 1, "Boreal Pilot Area"). The baseline tables in
// packages/game-data hold the full v1.0 content; the MVP build offers only the ids listed here and ignores the rest
// (they exist in the data, they are not for sale). This is a constant, not a data file: it changes with the scope
// tier, not with balance. Stored values are ids and counts only, so a price or effect change in game-data never
// touches it. Verified against the 23 tables on 2026-11-13 (see the M1-W0-T03 report); a game-data test should keep
// that check alive.

import { z } from "zod";
import { CountSchema, PositiveCountSchema, PositiveNumberSchema, prefixedId, uniqueStringArray } from "./common.schema";

export const MvpScopeSchema = z.strictObject({
  /** Hand tools for sale: T1 to T4. Static Rake, Ion Curtain and the Assembly Gun are not in the MVP. */
  toolIds: uniqueStringArray(prefixedId("tool")).min(1),
  /** Promotions Board nodes offered (the hub is implicit): 10 of 23. */
  boardNodeIds: uniqueStringArray(prefixedId("node")).min(1),
  /** Highest Dust Cell level offered for the four Cell lines (levels I to III). */
  dustCellMaxLevel: PositiveCountSchema,
  /** Highest owned level offered per suit-gear line (Holster Rig level 1, Crown Lamp level 1). */
  suitGearMaxLevel: z.record(prefixedId("gear"), PositiveCountSchema),
  /** Vehicles offered: the Trundle only, with no upgrade lines. */
  vehicleIds: uniqueStringArray(prefixedId("vehicle")).min(1),
  /** Robots offered: the Sandpiper (comes with the Roost). */
  robotIds: uniqueStringArray(prefixedId("robot")).min(1),
  /** Roosts the shift may own (matches caps.json `mvpRoostCap`). */
  roostCap: PositiveCountSchema,
  /** Achievements that unlock in the MVP: First Light, Stamped, Shift Work. */
  achievementIds: uniqueStringArray(prefixedId("achievement")).min(1),
  /** Near Parcels placed within 300 m of Outpost Boreal (Induction step 8). */
  nearParcelCount: CountSchema,
  /** Radius of the soft Pilot Fence around Outpost Boreal in metres (about 8,160 plots). */
  pilotFenceRadiusM: PositiveNumberSchema,
});
export type MvpScope = z.infer<typeof MvpScopeSchema>;

/** The MVP scope. Treat as read-only. */
export const MVP_SCOPE = {
  toolIds: ["tool.desk_duster", "tool.crescent_squeegee", "tool.bristle_broom", "tool.lane_broom"],
  boardNodeIds: [
    "node.dust_cell_desk_duster",
    "node.dust_cell_crescent_squeegee",
    "node.dust_cell_bristle_broom",
    "node.dust_cell_lane_broom",
    "node.densifier",
    "node.broad_strokes",
    "node.scour",
    "node.cadence",
    "node.quick_pour",
    "node.rate_review",
  ],
  dustCellMaxLevel: 3,
  suitGearMaxLevel: { "gear.holster_rig": 1, "gear.crown_lamp": 1 },
  vehicleIds: ["vehicle.trundle"],
  robotIds: ["robot.sandpiper"],
  roostCap: 3,
  achievementIds: ["achievement.first_light", "achievement.stamped", "achievement.shift_work"],
  nearParcelCount: 6,
  pilotFenceRadiusM: 900,
} as const satisfies MvpScope;
