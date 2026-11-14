// @contract config/tools.schema v1
// @consumers packages/game-data (data/tools.json), packages/sim (strokes, cells), apps/client (Requisitions Desk),
//   tools/balance-sim
//
// `tools.json`: the 6 hand tools plus the Assembly Gun (progression-and-economy.md section 21, naming bible section 4).
// Purchases are gated by money only (reference mode).

import { z } from "zod";
import {
  CountSchema,
  GameDataSchemaVersionSchema,
  LmAmountSchema,
  NonNegativeNumberSchema,
  prefixedId,
  uniqueIdArray,
} from "./common.schema";
import { TraitIdSchema } from "./traits.schema";

export const ToolIdSchema = prefixedId("tool");

/** Tier of the build tool (Assembly Gun): it does not clean and has no trait. */
export const BUILD_TOOL_TIER = 0;
/** Highest cleaning tool tier (T1 Desk Duster .. T6 Ion Curtain). */
export const MAX_TOOL_TIER = 6;

export const ToolSchema = z
  .strictObject({
    id: ToolIdSchema,
    /** 1..6 for cleaning tools; `BUILD_TOOL_TIER` (0) for the Assembly Gun. */
    tier: z.int().min(BUILD_TOOL_TIER).max(MAX_TOOL_TIER),
    priceLm: LmAmountSchema,
    widthM: NonNegativeNumberSchema,
    depthLevels: CountSchema,
    reachM: NonNegativeNumberSchema,
    strokeS: NonNegativeNumberSchema,
    cellBaseKg: NonNegativeNumberSchema,
    /** Trait id from `traits.json`; null for the build tool. */
    traitId: TraitIdSchema.nullable(),
  })
  .superRefine((tool, ctx) => {
    const cleans = tool.tier !== BUILD_TOOL_TIER;
    if (cleans && (tool.widthM <= 0 || tool.strokeS <= 0 || tool.depthLevels <= 0 || tool.traitId === null)) {
      ctx.addIssue({
        code: "custom",
        message: "a cleaning tool needs widthM, strokeS and depthLevels above 0 and a traitId",
        path: ["tier"],
      });
    }
    if (!cleans && tool.traitId !== null) {
      ctx.addIssue({ code: "custom", message: "the build tool has no trait", path: ["traitId"] });
    }
  });
export type ToolDef = z.infer<typeof ToolSchema>;

export const ToolsSchema = z
  .strictObject({
    schemaVersion: GameDataSchemaVersionSchema,
    tools: uniqueIdArray(ToolSchema).min(1),
  })
  .superRefine((table, ctx) => {
    const tiers = new Set<number>();
    table.tools.forEach((tool, index) => {
      if (tiers.has(tool.tier)) {
        ctx.addIssue({ code: "custom", message: `duplicate tier ${tool.tier}`, path: ["tools", index, "tier"] });
      }
      tiers.add(tool.tier);
    });
  });
export type ToolsTable = z.infer<typeof ToolsSchema>;
