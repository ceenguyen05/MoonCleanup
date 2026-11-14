// @contract config/dust-cells.schema v1
// @consumers packages/game-data (data/dust-cells.json), packages/sim (cells, pucks), apps/client (Requisitions Desk),
//   tools/balance-sim
//
// `dust-cells.json`: per-tool Dust Cell levels I-III, pucks, stacks and loose-puck caps (progression-and-economy.md
// section 21).

import { z } from "zod";
import {
  FracSchema,
  GameDataSchemaVersionSchema,
  LmAmountSchema,
  MultSchema,
  PositiveCountSchema,
  PositiveNumberSchema,
} from "./common.schema";
import { ToolIdSchema } from "./tools.schema";

/** Dust Cell levels I, II, III. */
export const DUST_CELL_LEVEL_COUNT = 3;

export const DustCellsSchema = z
  .strictObject({
    schemaVersion: GameDataSchemaVersionSchema,
    /** Capacity multiplier of `cellBaseKg` for levels I, II, III. */
    levelMult: z.tuple([MultSchema, MultSchema, MultSchema]),
    /** Price of levels I, II, III per cleaning tool id. */
    costsLm: z.record(ToolIdSchema, z.tuple([LmAmountSchema, LmAmountSchema, LmAmountSchema])),
    puckKg: PositiveNumberSchema,
    stackMaxKg: PositiveNumberSchema,
    loosePuckCap: z.strictObject({
      perPlayer: PositiveCountSchema,
      perContract: PositiveCountSchema,
      despawnS: PositiveNumberSchema,
      despawnValueFrac: FracSchema,
    }),
  })
  .superRefine((cells, ctx) => {
    if (cells.stackMaxKg < cells.puckKg) {
      ctx.addIssue({ code: "custom", message: "stackMaxKg must be at least puckKg", path: ["stackMaxKg"] });
    }
    if (cells.loosePuckCap.perPlayer > cells.loosePuckCap.perContract) {
      ctx.addIssue({
        code: "custom",
        message: "loosePuckCap.perPlayer must not exceed perContract",
        path: ["loosePuckCap", "perPlayer"],
      });
    }
  });
export type DustCellsTable = z.infer<typeof DustCellsSchema>;
