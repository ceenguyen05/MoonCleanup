// @contract config/traits.schema v1.2
// @consumers packages/game-data (data/traits.json), packages/sim (tool behaviour), tools/balance-sim
//
// `traits.json`: one behaviour trait per cleaning tool with free numeric/boolean params (progression-and-economy.md
// section 21: Detailing, Flick, Sure Footing, Lane Lock, Charge, Twin Pass).
//
// v1.1 (additive): `CHARGE_TRAIT_ID` / `CHARGE_FINISH_STAMP_PARAM` (the bundle checks the param against
// `plot-bonus.chargeFinishMult`).
// v1.2 (breaking for data, no protocol/save impact): the Detailing disc size is `params.diameterM` (was `radiusM` in
// economy section 21). Decision 2026-11-14 (contracts-architect, M1-W3-T03 follow-up): the disc is 0.5 m in DIAMETER,
// per WDS section 4.4 ("0.5 m-diameter disc op", whose >= 31 % straggler-coverage figure assumes that size), the stroke
// contract (`widthCm` = disc diameter), game-feel section 3.1 / economy section 8 ("0.5 m disc / circle") and the
// one-knee hand scrub in animation-spec. Section 21's `{radiusM: 0.5}` was a key slip; the ambiguous `radiusM` is now
// rejected on Detailing so the two readings cannot coexist. The disc is already 3.3x the Desk Duster's 0.15 m width.

import { z } from "zod";
import { GameDataSchemaVersionSchema, ParamsSchema, prefixedId, uniqueIdArray } from "./common.schema";
import { STROKE_WIDTH_CM_MAX } from "../world/stroke";

export const TraitIdSchema = prefixedId("trait");

/** The Charge trait. It must exist, and its `finishStampMult` param equals `plot-bonus.chargeFinishMult`. */
export const CHARGE_TRAIT_ID = "trait.charge";
/** Param of `CHARGE_TRAIT_ID` holding the Stamp multiplier for a Charge finish. */
export const CHARGE_FINISH_STAMP_PARAM = "finishStampMult";

/** The Detailing trait (Desk Duster RMB disc op, WDS section 4.4). */
export const DETAILING_TRAIT_ID = "trait.detailing";
/**
 * Param of `DETAILING_TRAIT_ID`: disc DIAMETER in metres (v1.2). The sim emits a zero-length stroke with
 * `widthCm = round(diameterM x 100)`, so it must be at least 0.01 m and at most `STROKE_WIDTH_CM_MAX` cm.
 */
export const DETAILING_DIAMETER_PARAM = "diameterM";
/** Retired, ambiguous Detailing param (economy section 21 draft); rejected on `DETAILING_TRAIT_ID`. */
export const DETAILING_RETIRED_RADIUS_PARAM = "radiusM";

export const TraitSchema = z.strictObject({ id: TraitIdSchema, params: ParamsSchema });
export type TraitDef = z.infer<typeof TraitSchema>;

export const TraitsSchema = z
  .strictObject({
    schemaVersion: GameDataSchemaVersionSchema,
    traits: uniqueIdArray(TraitSchema).min(1),
  })
  .superRefine((table, ctx) => {
    table.traits.forEach((trait, index) => {
      if (trait.id !== DETAILING_TRAIT_ID) return;
      const path = ["traits", index, "params"];
      if (DETAILING_RETIRED_RADIUS_PARAM in trait.params) {
        ctx.addIssue({
          code: "custom",
          message: `Detailing uses "${DETAILING_DIAMETER_PARAM}" (disc diameter), not "${DETAILING_RETIRED_RADIUS_PARAM}"`,
          path: [...path, DETAILING_RETIRED_RADIUS_PARAM],
        });
      }
      const diameter = trait.params[DETAILING_DIAMETER_PARAM];
      const widthCm = typeof diameter === "number" ? Math.round(diameter * 100) : 0;
      if (widthCm < 1 || widthCm > STROKE_WIDTH_CM_MAX) {
        ctx.addIssue({
          code: "custom",
          message: `Detailing needs a numeric "${DETAILING_DIAMETER_PARAM}" between 0.01 and ${STROKE_WIDTH_CM_MAX / 100} m`,
          path: [...path, DETAILING_DIAMETER_PARAM],
        });
      }
    });
  });
export type TraitsTable = z.infer<typeof TraitsSchema>;
