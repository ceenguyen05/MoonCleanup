// @contract config/caps.schema v1
// @consumers packages/game-data (data/caps.json), packages/sim, apps/server (entity budgets), apps/client (limit UI),
//   tools/balance-sim
//
// `caps.json` (was `permits.json`): technical entity caps within the perf-owned hard caps (progression-and-economy.md
// section 21). Reference mode: visible technical limits only; no `byReview` unlock schedule (optional section 24).

import { z } from "zod";
import { CountSchema, GameDataSchemaVersionSchema, PositiveCountSchema } from "./common.schema";

/** Perf-budget hard caps (locked; owned by the perf budget, not by balance). */
export const HARD_CAP_ROBOTS = 48;
export const HARD_CAP_MACHINES = 14;

export const CapsSchema = z
  .strictObject({
    schemaVersion: GameDataSchemaVersionSchema,
    caps: z.strictObject({ roost: CountSchema, albatross: CountSchema, machines: CountSchema }),
    hardCaps: z.strictObject({
      robots: PositiveCountSchema.max(HARD_CAP_ROBOTS),
      machines: PositiveCountSchema.max(HARD_CAP_MACHINES),
    }),
    /** Roost cap while only the MVP robot slice ships. */
    mvpRoostCap: CountSchema,
  })
  .superRefine((table, ctx) => {
    if (table.caps.roost + table.caps.albatross > table.hardCaps.robots) {
      ctx.addIssue({ code: "custom", message: "caps.roost + caps.albatross exceed hardCaps.robots", path: ["caps"] });
    }
    if (table.caps.machines > table.hardCaps.machines) {
      ctx.addIssue({ code: "custom", message: "caps.machines exceeds hardCaps.machines", path: ["caps", "machines"] });
    }
    if (table.mvpRoostCap > table.caps.roost) {
      ctx.addIssue({ code: "custom", message: "mvpRoostCap exceeds caps.roost", path: ["mvpRoostCap"] });
    }
  });
export type CapsTable = z.infer<typeof CapsSchema>;
