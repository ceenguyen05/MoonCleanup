// @contract config/production.schema v1
// @consumers packages/game-data (data/production.json), packages/sim (machines), apps/client (machine UI),
//   tools/balance-sim
//
// `production.json`: the 2 machines (Bead Kiln, Tile Sinterer) with recipes, one grade each in the baseline, and the
// minimum power fraction (progression-and-economy.md section 21). Grades II-III are optional section 24.

import { z } from "zod";
import {
  FracSchema,
  GameDataSchemaVersionSchema,
  LmAmountSchema,
  NonNegativeNumberSchema,
  PositiveNumberSchema,
  uniqueIdArray,
} from "./common.schema";
import { PieceIdSchema } from "./build-pieces.schema";
import { MaterialIdSchema } from "./economy.schema";

/** Grades per machine in the baseline (reference mode). */
export const BASELINE_MACHINE_GRADES = 1;

export const MaterialAmountSchema = z.strictObject({ materialId: MaterialIdSchema, kg: PositiveNumberSchema });

export const MachineGradeSchema = z.strictObject({
  throughputKgph: PositiveNumberSchema,
  upgradeCostLm: LmAmountSchema,
  powerKw: NonNegativeNumberSchema,
});

export const MachineSchema = z.strictObject({
  id: PieceIdSchema,
  priceLm: LmAmountSchema,
  recipe: z.strictObject({
    in: z.array(MaterialAmountSchema).min(1),
    out: z.array(MaterialAmountSchema).min(1),
  }),
  grades: z.array(MachineGradeSchema).length(BASELINE_MACHINE_GRADES),
});
export type MachineDef = z.infer<typeof MachineSchema>;

export const ProductionSchema = z.strictObject({
  schemaVersion: GameDataSchemaVersionSchema,
  machines: uniqueIdArray(MachineSchema).min(1),
  minPowerFrac: FracSchema,
});
export type ProductionTable = z.infer<typeof ProductionSchema>;
