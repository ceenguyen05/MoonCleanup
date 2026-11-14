// @contract config/plot-bonus.schema v1
// @consumers packages/game-data (data/plot-bonus.json), packages/sim, apps/server (Inspector's Stamp payouts),
//   apps/client (celebrations), tools/balance-sim
//
// `plot-bonus.json`: Inspector's Stamp payout, Stamp Premium levels, Charge finish multiplier, credit rule and Shine
// milestones (celebrations only, never gates) (progression-and-economy.md section 21). No `closingBonusMult`
// (optional section 24).

import { z } from "zod";
import { FracSchema, GameDataSchemaVersionSchema, LmAmountSchema, MultSchema, TokenSchema } from "./common.schema";

export const PlotBonusSchema = z
  .strictObject({
    schemaVersion: GameDataSchemaVersionSchema,
    stampBaseLm: LmAmountSchema,
    /** Stamp Premium node levels I, II. */
    stampPremiumMult: z.tuple([MultSchema, MultSchema]),
    chargeFinishMult: MultSchema,
    /** Rule token naming who is credited for a Stamp; interpreted by the sim. */
    creditRule: TokenSchema,
    /** Shine fractions that trigger a celebration; strictly increasing. Never purchase gates. */
    shineMilestonesFrac: z.array(FracSchema),
  })
  .superRefine((table, ctx) => {
    table.shineMilestonesFrac.forEach((frac, index) => {
      const previous = table.shineMilestonesFrac[index - 1];
      if (previous !== undefined && frac <= previous) {
        ctx.addIssue({
          code: "custom",
          message: "shineMilestonesFrac must be strictly increasing",
          path: ["shineMilestonesFrac", index],
        });
      }
    });
  });
export type PlotBonusTable = z.infer<typeof PlotBonusSchema>;
