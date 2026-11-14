// @contract config/pacing-targets.schema v1.2
// @consumers packages/game-data (data/pacing-targets.json), tools/balance-sim (asserts every row), CI balance check
//
// `pacing-targets.json`: pacing rows the balance-sim must keep green (progression-and-economy.md sections 18, 21).
//
// v1.1 (additive): optional `milestone` per row.
// v1.2 (breaking for data): `milestone` is required on every row.

import { z } from "zod";
import { FracSchema, GameDataSchemaVersionSchema, TokenSchema, prefixedId, uniqueIdArray } from "./common.schema";
import { MAX_PLAYERS_PER_ROOM } from "../sim/room-sim";

export const PacingTargetIdSchema = prefixedId("pacing");

export const PACING_METRICS = ["time", "gapMax", "gapMedian", "share"] as const;
export type PacingMetric = (typeof PACING_METRICS)[number];

export const PacingTargetSchema = z
  .strictObject({
    id: PacingTargetIdSchema,
    /**
     * Section 18.1 milestone the row measures (`first_stamp`, `first_roost`, `purchase_gap`); several rows (player
     * counts, MVP variants) may share one. Balance-sim groups rows by it. Required since v1.2.
     */
    milestone: TokenSchema,
    players: z.int().min(1).max(MAX_PLAYERS_PER_ROOM),
    attendanceFrac: FracSchema.refine((f) => f > 0, { message: "attendanceFrac must be above 0" }),
    /** Balance-sim policy token (`reference`, `scripted_opening`, ...). */
    policy: TokenSchema,
    metric: z.enum(PACING_METRICS),
    min: z.number(),
    max: z.number(),
    /** Unit of `min`/`max` (`h`, `min`, `frac`). */
    unit: TokenSchema,
    toleranceFrac: FracSchema,
  })
  .superRefine((row, ctx) => {
    if (row.min > row.max) ctx.addIssue({ code: "custom", message: "min must not exceed max", path: ["min"] });
  });
export type PacingTargetDef = z.infer<typeof PacingTargetSchema>;

export const PacingTargetsSchema = z.strictObject({
  schemaVersion: GameDataSchemaVersionSchema,
  targets: uniqueIdArray(PacingTargetSchema),
});
export type PacingTargetsTable = z.infer<typeof PacingTargetsSchema>;
