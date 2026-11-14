// @contract config/achievements.schema v1
// @consumers packages/game-data (data/achievements.json), apps/server (unlocks), apps/client (achievement UI)
//
// `achievements.json`: id, label, tracked stat, threshold and visibility (progression-and-economy.md section 21).
// No `commendations` or `tenureXp` rewards (optional section 24).

import { z } from "zod";
import {
  GameDataSchemaVersionSchema,
  PositiveNumberSchema,
  StatIdSchema,
  prefixedId,
  uniqueIdArray,
} from "./common.schema";

export const AchievementIdSchema = prefixedId("achievement");

export const AchievementSchema = z.strictObject({
  id: AchievementIdSchema,
  /** Editable label tracked in the naming catalog. */
  displayName: z.string().min(1).max(64),
  stat: StatIdSchema,
  threshold: PositiveNumberSchema,
  hidden: z.boolean(),
});
export type AchievementDef = z.infer<typeof AchievementSchema>;

export const AchievementsSchema = z.strictObject({
  schemaVersion: GameDataSchemaVersionSchema,
  achievements: uniqueIdArray(AchievementSchema),
});
export type AchievementsTable = z.infer<typeof AchievementsSchema>;
