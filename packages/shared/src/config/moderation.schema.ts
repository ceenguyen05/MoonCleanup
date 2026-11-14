// @contract config/moderation.schema v1
// @consumers packages/game-data (data/moderation.json), apps/server (room rules, idle close), apps/client (prompts)
//
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
  loanerKit: z.strictObject({ maxVehiclesOut: PositiveCountSchema }),
});
export type ModerationTable = z.infer<typeof ModerationSchema>;
