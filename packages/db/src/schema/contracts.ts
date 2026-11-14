// Contract tables (data-model.md sections 3.5-3.7): contracts, contract_members, contract_saves.
// The lease columns (contracts) and the solo save-generation columns (contract_saves.parent_seq / origin_kind) belong to
// M1-W5-T07 and live in migration 0002; the M1-W4-T05 repositories do not read or write them.

import { sql } from "drizzle-orm";
import {
  bigint,
  char,
  check,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { players } from "./identity.ts";
import { blobBytea } from "./types.ts";

export const contracts = pgTable(
  "contracts",
  {
    id: uuid("id").primaryKey(),
    ownerPlayerId: uuid("owner_player_id")
      .notNull()
      .references(() => players.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    shiftType: text("shift_type").notNull(),
    maxPlayers: smallint("max_players").notNull(),
    gridM: smallint("grid_m").notNull().default(128),
    plotCount: integer("plot_count").notNull().default(163842),
    /** Unsigned 64-bit seed stored as the same bits in a signed bigint (the repository converts). */
    seed: bigint("seed", { mode: "bigint" }).notNull(),
    inviteCode: text("invite_code"),
    inviteCodeRotatedAt: timestamp("invite_code_rotated_at", { withTimezone: true }),
    tempPermissions: jsonb("temp_permissions")
      .$type<{ tempCanBuild: boolean; tempCanSpendShared: boolean; tempCanDriveShared: boolean }>()
      .notNull()
      .default(sql`'{"tempCanBuild":false,"tempCanSpendShared":false,"tempCanDriveShared":false}'::jsonb`),
    status: text("status").notNull().default("active"),
    storageTier: text("storage_tier").notNull().default("full"),
    storedBytes: integer("stored_bytes").notNull().default(0),
    shinePolished: integer("shine_polished").notNull().default(0),
    walletLumens: doublePrecision("wallet_lumens").notNull().default(0),
    gameDataVersion: text("game_data_version").notNull().default(""),
    playtimeS: bigint("playtime_s", { mode: "number" }).notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastPlayedAt: timestamp("last_played_at", { withTimezone: true }).notNull().defaultNow(),
    // ---- M1-W5-T07 (migration 0002): room lease, compare-and-set with the database clock (data-model.md 3.5) ----
    leaseInstance: text("lease_instance"),
    leaseRoomId: text("lease_room_id"),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
  },
  (t) => [
    check("contracts_shift_type_check", sql`${t.shiftType} in ('solo', 'private', 'open')`),
    check(
      "contracts_max_players_check",
      sql`(${t.shiftType} = 'solo' and ${t.maxPlayers} = 1) or (${t.shiftType} <> 'solo' and ${t.maxPlayers} between 2 and 6)`,
    ),
    check("contracts_status_check", sql`${t.status} in ('active', 'fulfilled', 'deleted')`),
    check("contracts_storage_tier_check", sql`${t.storageTier} in ('full', 'compacted_logs', 'compacted_ledgers')`),
    // "My owned Contracts" and the 3-owned quota count.
    index("contracts_owner_player_id_idx").on(t.ownerPlayerId),
    // Join-by-code lookup; partial so Solo Contracts (null code) cost no index entries.
    uniqueIndex("contracts_invite_code_uq")
      .on(t.inviteCode)
      .where(sql`${t.inviteCode} is not null`),
    // Retention and compaction scans (status, then least recently played).
    index("contracts_status_last_played_idx").on(t.status, t.lastPlayedAt),
  ],
);

export const contractMembers = pgTable(
  "contract_members",
  {
    contractId: uuid("contract_id")
      .notNull()
      .references(() => contracts.id, { onDelete: "cascade" }),
    playerId: uuid("player_id")
      .notNull()
      .references(() => players.id, { onDelete: "cascade" }),
    role: text("role").notNull(),
    status: text("status").notNull().default("active"),
    joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    playtimeS: bigint("playtime_s", { mode: "number" }).notNull().default(0),
    bannedAt: timestamp("banned_at", { withTimezone: true }),
    bannedBy: uuid("banned_by").references(() => players.id, { onDelete: "set null" }),
    banReason: text("ban_reason"),
  },
  (t) => [
    primaryKey({ name: "contract_members_pk", columns: [t.contractId, t.playerId] }),
    check("contract_members_role_check", sql`${t.role} in ('holder', 'supervisor', 'staff', 'temp')`),
    check("contract_members_status_check", sql`${t.status} in ('active', 'banned')`),
    check(
      "contract_members_ban_reason_check",
      sql`${t.banReason} is null or ${t.banReason} in ('griefing', 'harassment', 'cheating', 'other')`,
    ),
    // "My Contracts", most recently played first.
    index("contract_members_player_last_seen_idx").on(t.playerId, t.lastSeenAt.desc()),
  ],
);

/** Two alternating header save slots per Contract (data-model.md section 3.7). Never selected by list queries. */
export const contractSaves = pgTable(
  "contract_saves",
  {
    contractId: uuid("contract_id")
      .notNull()
      .references(() => contracts.id, { onDelete: "cascade" }),
    slot: char("slot", { length: 1 }).notNull(),
    saveFormatVersion: smallint("save_format_version").notNull(),
    gameDataVersion: text("game_data_version").notNull(),
    codec: text("codec").notNull(),
    rawSize: integer("raw_size").notNull(),
    blobSize: integer("blob_size").notNull(),
    /** CRC32 of the uncompressed bytes (unsigned 32-bit does not fit integer: stored as the signed 32-bit value). */
    checksum: integer("checksum").notNull(),
    blob: blobBytea("blob").notNull(),
    saveSeq: bigint("save_seq", { mode: "number" }).notNull(),
    simTick: bigint("sim_tick", { mode: "number" }).notNull(),
    savedAt: timestamp("saved_at", { withTimezone: true }).notNull().defaultNow(),
    savedBy: text("saved_by").notNull(),
    // ---- M1-W5-T07 (migration 0002): save generation lineage of ADR-0031 (data-model.md 3.7) ----
    parentSeq: bigint("parent_seq", { mode: "number" }),
    originKind: text("origin_kind").notNull().default("room"),
  },
  (t) => [
    check("contract_saves_origin_kind_check", sql`${t.originKind} in ('room', 'solo')`),
    primaryKey({ name: "contract_saves_pk", columns: [t.contractId, t.slot] }),
    check("contract_saves_slot_check", sql`${t.slot} in ('A', 'B')`),
  ],
);

export type ContractRow = typeof contracts.$inferSelect;
export type ContractMemberRow = typeof contractMembers.$inferSelect;
