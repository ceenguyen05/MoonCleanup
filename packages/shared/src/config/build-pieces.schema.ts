// @contract config/build-pieces.schema v1
// @consumers packages/game-data (data/build-pieces.json), packages/sim (placement), apps/client (build menu),
//   tools/balance-sim
//
// `build-pieces.json`: every placeable piece (98), its build-menu tab, price, footprint, snap rule and allowed
// finishes; the 6 surface finishes (progression-and-economy.md section 21). Every placeable structure has one
// `piece.*` id; production, power, logistics and Motor Pool tables add stats under the same id.

import { z } from "zod";
import {
  GameDataSchemaVersionSchema,
  LmAmountSchema,
  NonNegativeNumberSchema,
  PositiveNumberSchema,
  TokenSchema,
  prefixedId,
  uniqueIdArray,
  uniqueStringArray,
} from "./common.schema";

export const PieceIdSchema = prefixedId("piece");
export const FinishIdSchema = prefixedId("finish");

/** Ground rectangle of a piece, in metres. */
export const FootprintSchema = z.strictObject({ widthM: PositiveNumberSchema, depthM: PositiveNumberSchema });

export const BuildPieceSchema = z.strictObject({
  id: PieceIdSchema,
  /** Build-menu tab (`foundations`, `services`, ...). */
  tab: TokenSchema,
  priceLm: LmAmountSchema,
  footprint: FootprintSchema,
  /** Snap rule token (`grid`, `edge`, `rail`, ...); interpreted by the build module. */
  snap: TokenSchema,
  finishes: uniqueStringArray(FinishIdSchema),
});
export type BuildPieceDef = z.infer<typeof BuildPieceSchema>;

export const FinishSchema = z.strictObject({ id: FinishIdSchema });

export const BuildPiecesSchema = z
  .strictObject({
    schemaVersion: GameDataSchemaVersionSchema,
    pieces: uniqueIdArray(BuildPieceSchema).min(1),
    finishes: uniqueIdArray(FinishSchema).min(1),
    noBuildRadiusM: NonNegativeNumberSchema,
    tempBuildTabs: uniqueStringArray(TokenSchema),
  })
  .superRefine((table, ctx) => {
    const finishes = new Set(table.finishes.map((f) => f.id));
    const tabs = new Set(table.pieces.map((p) => p.tab));
    table.pieces.forEach((piece, p) => {
      piece.finishes.forEach((finish, f) => {
        if (!finishes.has(finish)) {
          ctx.addIssue({
            code: "custom",
            message: `unknown finish "${finish}"`,
            path: ["pieces", p, "finishes", f],
          });
        }
      });
    });
    table.tempBuildTabs.forEach((tab, t) => {
      if (!tabs.has(tab)) {
        ctx.addIssue({ code: "custom", message: `no piece uses tab "${tab}"`, path: ["tempBuildTabs", t] });
      }
    });
  });
export type BuildPiecesTable = z.infer<typeof BuildPiecesSchema>;
