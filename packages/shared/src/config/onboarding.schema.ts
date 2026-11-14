// @contract config/onboarding.schema v1
// @consumers packages/game-data (data/onboarding.json), apps/client (Induction/Probation checklists), apps/server
//   (step rewards), tools/balance-sim (scripted opening)
//
// `onboarding.json`: Induction steps and Probation suggestions (progression-and-economy.md section 21). Steps are
// suggestions only; they never gate a purchase or feature (reference mode). No `tenureXp` (optional section 24).

import { z } from "zod";
import {
  GameDataIdSchema,
  GameDataSchemaVersionSchema,
  LmAmountSchema,
  TokenSchema,
  prefixedId,
  uniqueIdArray,
} from "./common.schema";

export const OnboardingStepIdSchema = prefixedId("onboarding");

export const InductionStepSchema = z.strictObject({
  id: OnboardingStepIdSchema,
  /** Event/condition token that completes the step. */
  trigger: TokenSchema,
  rewardLm: LmAmountSchema,
});
export type InductionStepDef = z.infer<typeof InductionStepSchema>;

export const ProbationStepSchema = z.strictObject({
  id: OnboardingStepIdSchema,
  trigger: TokenSchema,
  /** Item the step suggests buying or using (any game-data id); a hint, never a gate. */
  suggestsId: GameDataIdSchema.optional(),
});
export type ProbationStepDef = z.infer<typeof ProbationStepSchema>;

export const OnboardingSchema = z
  .strictObject({
    schemaVersion: GameDataSchemaVersionSchema,
    /** In step order. */
    induction: uniqueIdArray(InductionStepSchema).min(1),
    /** In step order. */
    probation: uniqueIdArray(ProbationStepSchema),
  })
  .superRefine((table, ctx) => {
    const induction = new Set(table.induction.map((s) => s.id));
    table.probation.forEach((step, index) => {
      if (induction.has(step.id)) {
        ctx.addIssue({ code: "custom", message: `id "${step.id}" also used by induction`, path: ["probation", index] });
      }
    });
  });
export type OnboardingTable = z.infer<typeof OnboardingSchema>;
