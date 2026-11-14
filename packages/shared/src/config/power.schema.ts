// @contract config/power.schema v1
// @consumers packages/game-data (data/power.json), packages/sim (power grid), tools/balance-sim
//
// `power.json`: solar pieces (Sun Sprig, Sun Fan, Heliostat) and the Night Cell battery, panel model and battery
// efficiency (progression-and-economy.md section 21).

import { z } from "zod";
import {
  ElevationDegSchema,
  FracSchema,
  GameDataSchemaVersionSchema,
  LmAmountSchema,
  NonNegativeNumberSchema,
  uniqueIdArray,
} from "./common.schema";
import { PieceIdSchema } from "./build-pieces.schema";

export const FIXED_PANEL_MODELS = ["sinElevation"] as const;

export const PowerPieceSchema = z.strictObject({
  id: PieceIdSchema,
  priceLm: LmAmountSchema,
  peakKw: NonNegativeNumberSchema,
  radiusM: NonNegativeNumberSchema,
  storageKwh: NonNegativeNumberSchema,
  tracksSun: z.boolean(),
});
export type PowerPieceDef = z.infer<typeof PowerPieceSchema>;

export const PowerSchema = z.strictObject({
  schemaVersion: GameDataSchemaVersionSchema,
  pieces: uniqueIdArray(PowerPieceSchema).min(1),
  fixedPanelModel: z.enum(FIXED_PANEL_MODELS),
  trackerFullAtElevationDeg: ElevationDegSchema,
  batteryRoundTripFrac: FracSchema,
});
export type PowerTable = z.infer<typeof PowerSchema>;
