// @contract config/moderation.schema v1.1
// @consumers packages/game-data (data/moderation.json), apps/server (room rules, idle close), apps/client (prompts)
//
// v1.1: `loanerKit` gains `walletFrac`, `capLm`, `windowS` (required; `GAME_DATA_SCHEMA_VERSION` stays 1, game-data supplies them).
// `moderation.json`: break/idle timers, admission, temporary vote-kick, cleanup orders, service calls and loaner kits
// (progression-and-economy.md section 21). Reference mode: per-client `idleCloseS` replaces the Effort-based
// `roomCloseNoEffortS`; `tempVoteKick` has no Tenure term (that ships only with the optional section 24 meta).

import { z } from "zod";
import { GameDataSchemaVersionSchema, ParamsSchema, PositiveCountSchema, PositiveNumberSchema } from "./common.schema";

export const ModerationSchema = z.strictObject({
  schemaVersion: GameDataSchemaVersionSchema,
  onBreakAfterS: PositiveNumberSchema,
  tempRemoveOnBreakS: PositiveNumberSchema,
  idleCloseS: PositiveNumberSchema,
  openShiftAdmitRequiresLeadOnlineS: PositiveNumberSchema,
  tempVoteKick: z.strictObject({ minVotes: PositiveCountSchema }),
  /** Cleanup-order tuning; section 21 leaves the fields open (numbers or booleans). */
  cleanupOrder: ParamsSchema,
  serviceCall: z.strictObject({ durationS: PositiveNumberSchema, maxPerDay: PositiveCountSchema }),
  /**
   * Loaner Kit: a Temp's own spending is capped at min(`walletFrac` of the wallet, `capLm`) per `windowS` seconds
   * (spec: 2 %, 25,000 LM, 600 s). `walletFrac` is in (0, 1].
   */
  loanerKit: z.strictObject({
    maxVehiclesOut: PositiveCountSchema,
    walletFrac: z.number().gt(0).max(1),
    capLm: PositiveCountSchema,
    windowS: PositiveNumberSchema,
  }),
});
export type ModerationTable = z.infer<typeof ModerationSchema>;
