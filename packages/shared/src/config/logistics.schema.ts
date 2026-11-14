// @contract config/logistics.schema v1.2
// @consumers packages/game-data (data/logistics.json), packages/sim (rails, gates, pucks), apps/server (payouts),
//   tools/balance-sim
//
// `logistics.json`: Glide Rail physics, pucks/stacks/Bales, logistics pieces, Receiving Gate, Field Gate, Assay
// Counter, Railshot cadence and Bale acceptors (progression-and-economy.md section 21). No `remoteAssay` (optional
// section 24).
//
// Who accepts Bales: the Receiving Gate (not a build piece, never listed in `baleAcceptors`) accepts Bales when
// `gate.baleChuteFaces > 0`; build pieces accept Bales when listed in `baleAcceptors`. The Field Gate
// (`FIELD_GATE_PIECE_ID`) must be listed in `baleAcceptors` exactly when `fieldGate.baleChuteFaces` is above 0.
//
// v1.1 (additive): optional `fieldGate.baleChuteFaces` and `assayCounter.pourS`; `FIELD_GATE_PIECE_ID`; the Bale
// acceptor rule above.
// v1.2 (breaking for data, no protocol/save impact): `fieldGate.baleChuteFaces` and `assayCounter.pourS` are required.

import { z } from "zod";
import {
  CountSchema,
  GameDataIdSchema,
  GameDataSchemaVersionSchema,
  LmAmountSchema,
  NonNegativeNumberSchema,
  ParamsSchema,
  PositiveCountSchema,
  PositiveNumberSchema,
  uniqueIdArray,
  uniqueStringArray,
} from "./common.schema";
import { PieceIdSchema } from "./build-pieces.schema";

/** Build piece of a Field Gate; its build-pieces `priceLm` equals `fieldGate.priceLm` (checked by the bundle). */
export const FIELD_GATE_PIECE_ID = "piece.field_gate";

export const LogisticsPieceSchema = z.strictObject({
  id: PieceIdSchema,
  priceLm: LmAmountSchema,
  params: ParamsSchema.optional(),
});
export type LogisticsPieceDef = z.infer<typeof LogisticsPieceSchema>;

export const LogisticsSchema = z
  .strictObject({
    schemaVersion: GameDataSchemaVersionSchema,
    rail: z.strictObject({
      speedMps: PositiveNumberSchema,
      spacingM: PositiveNumberSchema,
      unitsPerS: PositiveNumberSchema,
    }),
    puckKg: PositiveNumberSchema,
    stackMaxKg: PositiveNumberSchema,
    stackReleaseS: NonNegativeNumberSchema,
    baleKg: PositiveNumberSchema,
    pieces: uniqueIdArray(LogisticsPieceSchema),
    /** Receiving Gate: rail inputs and Bale Chute faces (it accepts Bales when `baleChuteFaces > 0`). */
    gate: z.strictObject({ railInputs: PositiveCountSchema, baleChuteFaces: CountSchema }),
    fieldGate: z.strictObject({
      priceLm: LmAmountSchema,
      railInputs: PositiveCountSchema,
      railshotKg: PositiveNumberSchema,
      /** Bale Chute faces of a Field Gate (section 10). Required since v1.2. */
      baleChuteFaces: CountSchema,
    }),
    assayCounter: z.strictObject({
      pourSlots: PositiveCountSchema,
      /** Base pour time at an Assay Counter or Puck Former, seconds (section 22.2). Required since v1.2. */
      pourS: PositiveNumberSchema,
    }),
    railshotEveryKg: PositiveNumberSchema,
    /**
     * Build pieces that accept Bales (Field Gate, Bead Kiln, Tile Sinterer); checked against build-pieces. The
     * Receiving Gate is not listed: its acceptance comes from `gate.baleChuteFaces`.
     */
    baleAcceptors: uniqueStringArray(GameDataIdSchema),
  })
  .superRefine((table, ctx) => {
    if (table.stackMaxKg < table.puckKg) {
      ctx.addIssue({ code: "custom", message: "stackMaxKg must be at least puckKg", path: ["stackMaxKg"] });
    }
    if (table.fieldGate.baleChuteFaces > 0 !== table.baleAcceptors.includes(FIELD_GATE_PIECE_ID)) {
      ctx.addIssue({
        code: "custom",
        message: `"${FIELD_GATE_PIECE_ID}" must be in baleAcceptors exactly when fieldGate.baleChuteFaces > 0`,
        path: ["fieldGate", "baleChuteFaces"],
      });
    }
  });
export type LogisticsTable = z.infer<typeof LogisticsSchema>;
