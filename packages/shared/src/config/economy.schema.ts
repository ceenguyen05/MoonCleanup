// @contract config/economy.schema v1.2
// @consumers packages/game-data (data/economy.json), packages/sim, apps/server (payouts), tools/balance-sim
//
// `economy.json`: material sale rates, fees, starting wallet, refunds and trick payouts (progression-and-economy.md
// section 21). Reference mode: price depends on material only (no `bulkRateFrac`, no origin penalty).
//
// v1.1 (additive): optional `trickComboMult`.
// v1.2 (breaking for data): `trickComboMult` is required.

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

export const MaterialIdSchema = prefixedId("material");
export const TrickIdSchema = prefixedId("trick");

export const MaterialSchema = z.strictObject({ id: MaterialIdSchema, lmPerKg: NonNegativeNumberSchema });
export type MaterialDef = z.infer<typeof MaterialSchema>;

export const TrickSchema = z.strictObject({ id: TrickIdSchema, lm: LmAmountSchema });
export type TrickDef = z.infer<typeof TrickSchema>;

/** Reclaiming/selling back refunds the price actually paid. */
export const REFUND_RULES = ["paidPrice"] as const;

export const EconomySchema = z
  .strictObject({
    schemaVersion: GameDataSchemaVersionSchema,
    materials: uniqueIdArray(MaterialSchema).min(1),
    stampBaseLm: LmAmountSchema,
    relayFeeLm: LmAmountSchema,
    recallFeeLm: LmAmountSchema,
    repeatRequisitionFrac: FracSchema,
    repeatRequisitionMinTier: PositiveCountSchema,
    standardIssueMaxTier: PositiveCountSchema,
    startWalletLm: LmAmountSchema,
    settle: z.strictObject({ payFrac: FracSchema }),
    refundRule: z.enum(REFUND_RULES),
    tricks: uniqueIdArray(TrickSchema),
    /** Each extra trick landed in the same air multiplies the payout by this (section 2). Required since v1.2. */
    trickComboMult: MultSchema,
    trickCapPerDriverLm: LmAmountSchema,
    trickCapPerShiftLm: LmAmountSchema,
    trickCapWindowS: PositiveNumberSchema,
    trickDriverOnly: z.boolean(),
  })
  .superRefine((economy, ctx) => {
    if (economy.standardIssueMaxTier >= economy.repeatRequisitionMinTier) {
      ctx.addIssue({
        code: "custom",
        message: "standardIssueMaxTier must be below repeatRequisitionMinTier",
        path: ["standardIssueMaxTier"],
      });
    }
    if (economy.trickCapPerDriverLm > economy.trickCapPerShiftLm) {
      ctx.addIssue({
        code: "custom",
        message: "trickCapPerDriverLm must not exceed trickCapPerShiftLm",
        path: ["trickCapPerDriverLm"],
      });
    }
  });
export type EconomyTable = z.infer<typeof EconomySchema>;
