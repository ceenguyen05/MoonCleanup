// @contract config/traits.schema v1.1
// @consumers packages/game-data (data/traits.json), packages/sim (tool behaviour), tools/balance-sim
//
// `traits.json`: one behaviour trait per cleaning tool with free numeric/boolean params (progression-and-economy.md
// section 21: Detailing, Flick, Sure Footing, Lane Lock, Charge, Twin Pass).
//
// v1.1 (additive): `CHARGE_TRAIT_ID` / `CHARGE_FINISH_STAMP_PARAM` (the bundle checks the param against
// `plot-bonus.chargeFinishMult`).

import { z } from "zod";
import { GameDataSchemaVersionSchema, ParamsSchema, prefixedId, uniqueIdArray } from "./common.schema";

export const TraitIdSchema = prefixedId("trait");

/** The Charge trait. It must exist, and its `finishStampMult` param equals `plot-bonus.chargeFinishMult`. */
export const CHARGE_TRAIT_ID = "trait.charge";
/** Param of `CHARGE_TRAIT_ID` holding the Stamp multiplier for a Charge finish. */
export const CHARGE_FINISH_STAMP_PARAM = "finishStampMult";

export const TraitSchema = z.strictObject({ id: TraitIdSchema, params: ParamsSchema });
export type TraitDef = z.infer<typeof TraitSchema>;

export const TraitsSchema = z.strictObject({
  schemaVersion: GameDataSchemaVersionSchema,
  traits: uniqueIdArray(TraitSchema).min(1),
});
export type TraitsTable = z.infer<typeof TraitsSchema>;
