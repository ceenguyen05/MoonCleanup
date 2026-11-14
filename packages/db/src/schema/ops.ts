// Ops tables (data-model.md section 3.12). Tables are declared WITHOUT a schema qualifier on purpose: the target
// Postgres schema (`DB_SCHEMA`: prod | staging) is selected at runtime through the connection `search_path`, so one
// generated SQL migration applies unchanged to whichever schema is configured (ADR-0029).

import { bigint, date, integer, jsonb, pgTable, smallint, timestamp } from "drizzle-orm/pg-core";

/**
 * One row per UTC day of server usage that survives restarts: month-to-date egress, instance-hours, admission
 * refusals and DB size. Upserted every 10 minutes and on shutdown. Retention 400 days (daily job, M1).
 *
 * Index note: the primary key on `day` serves both the upsert and the retention delete (`day < cutoff`); no
 * secondary index is justified for roughly 400 rows.
 *
 * `bigint` columns use mode "number": the largest value (5 GB of egress per month) is far below 2^53.
 */
export const opsUsageDaily = pgTable("ops_usage_daily", {
  day: date("day", { mode: "string" }).primaryKey(),
  bytesOut: bigint("bytes_out", { mode: "number" }).notNull().default(0),
  bytesIn: bigint("bytes_in", { mode: "number" }).notNull().default(0),
  /** Hosted test-window bot runs (counted against the same 5 GB, performance-budgets section 6.2). */
  botBytesOut: bigint("bot_bytes_out", { mode: "number" }).notNull().default(0),
  /** Process uptime in seconds, summed over boots (maps to Render instance-hours). */
  instanceSeconds: bigint("instance_seconds", { mode: "number" }).notNull().default(0),
  roomSeconds: bigint("room_seconds", { mode: "number" }).notNull().default(0),
  playerSeconds: bigint("player_seconds", { mode: "number" }).notNull().default(0),
  peakClients: smallint("peak_clients").notNull().default(0),
  peakRooms: smallint("peak_rooms").notNull().default(0),
  roomsRefused: integer("rooms_refused").notNull().default(0),
  boots: smallint("boots").notNull().default(0),
  dbBytes: bigint("db_bytes", { mode: "number" }).notNull().default(0),
  savesBytes: bigint("saves_bytes", { mode: "number" }).notNull().default(0),
  contractsByTier: jsonb("contracts_by_tier").$type<Record<string, number>>().notNull().default({}),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type OpsUsageDailyRow = typeof opsUsageDaily.$inferSelect;
