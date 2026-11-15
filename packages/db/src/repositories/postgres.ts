// PostgreSQL MoonRepository (drizzle). Works with any drizzle pg driver: postgres.js in production, PGlite in tests.
//
// Conventions: every multi-step operation is one transaction; rows that decide a race are locked FOR UPDATE; time comes
// from the DATABASE clock (`select now()`, data-model.md section 1) unless a test injects `clock`. Queries never touch
// contract_saves.blob. No string-built SQL: identifiers and values go through drizzle's operators and bound parameters.

import { and, asc, desc, eq, isNull, lt, ne, or, sql } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { uuidv7 } from "../ids.ts";
import * as schema from "../schema/index.ts";
import {
  contractDustChunks,
  contractMembers,
  contractSaves,
  contracts,
  identities,
  players,
  profiles,
  refreshTokens,
} from "../schema/index.ts";
import { decideRotation, type TokenRowView } from "./rotation.ts";
import { fromSignedCrc, pickOlderSlot, pickOlderVersion, toSignedCrc } from "./save-rules.ts";
import {
  REFRESH_RETENTION_DAYS,
  TOUCH_INTERVAL_S,
  type ContractRoleName,
  type ContractView,
  type CreateContractInput,
  type CreateContractResult,
  type CommitSoloCheckpointInput,
  type CommitSoloCheckpointResult,
  type CreateGuestInput,
  type DustChunkRow,
  type HexDigest,
  type JoinByCodeResult,
  type ListMembersResult,
  type MembershipView,
  type MoonRepository,
  type PatchContractInput,
  type PatchContractResult,
  type PlaytimeLedger,
  type Profile,
  type ProfilePatch,
  type ProfilePatchResult,
  type RecoverInput,
  type RotateInviteResult,
  type RotateRefreshInput,
  type RotateResult,
  type SaveHeadView,
  type SaveOriginKindName,
  type SaveSlotName,
  type SaveSlotRow,
  type ShiftTypeName,
} from "./types.ts";

/** Any drizzle PostgreSQL database over our schema (postgres.js, PGlite). */
export type PgDb = PgDatabase<PgQueryResultHKT, typeof schema>;
type Tx = Parameters<Parameters<PgDb["transaction"]>[0]>[0];
type Executor = PgDb | Tx;

export interface PostgresRepositoryOptions {
  /** Test seam only. Production omits it, so the database clock decides every time-based rule. */
  readonly clock?: () => Date;
}

const DAY_MS = 86_400_000;
const PG_UNIQUE_VIOLATION = "23505";

/** Name of the violated unique constraint, looking through drizzle's error wrapper. */
function uniqueViolation(error: unknown): string | undefined {
  let current: unknown = error;
  for (let depth = 0; depth < 4 && typeof current === "object" && current !== null; depth += 1) {
    const e = current as { code?: unknown; constraint_name?: unknown; constraint?: unknown; cause?: unknown };
    if (e.code === PG_UNIQUE_VIOLATION) {
      const name = e.constraint_name ?? e.constraint;
      return typeof name === "string" ? name : "";
    }
    current = e.cause;
  }
  return undefined;
}

/** Thrown inside a transaction to roll it back and surface a typed result. */
class RollbackWith extends Error {
  readonly result: CommitSoloCheckpointResult;
  constructor(result: CommitSoloCheckpointResult) {
    super("rollback");
    this.result = result;
  }
}

const asBytes = (value: Uint8Array): Buffer => Buffer.from(value.buffer, value.byteOffset, value.byteLength);

const toSignedSeed = (decimal: string): bigint => BigInt.asIntN(64, BigInt(decimal));
const fromSignedSeed = (value: bigint): string => BigInt.asUintN(64, value).toString();

const viewColumns = {
  id: contracts.id,
  ownerPlayerId: contracts.ownerPlayerId,
  name: contracts.name,
  shiftType: contracts.shiftType,
  maxPlayers: contracts.maxPlayers,
  status: contracts.status,
  gridM: contracts.gridM,
  plotCount: contracts.plotCount,
  seed: contracts.seed,
  inviteCode: contracts.inviteCode,
  shinePolished: contracts.shinePolished,
  walletLumens: contracts.walletLumens,
  playtimeS: contracts.playtimeS,
  lastPlayedAt: contracts.lastPlayedAt,
  createdAt: contracts.createdAt,
};

interface ViewRow {
  id: string;
  ownerPlayerId: string;
  name: string;
  shiftType: string;
  maxPlayers: number;
  status: string;
  gridM: number;
  plotCount: number;
  seed: bigint;
  inviteCode: string | null;
  shinePolished: number;
  walletLumens: number;
  playtimeS: number;
  lastPlayedAt: Date | null;
  createdAt: Date;
}

const toView = (row: ViewRow, role: string): ContractView => ({
  id: row.id,
  ownerPlayerId: row.ownerPlayerId,
  name: row.name,
  shiftType: row.shiftType as ShiftTypeName,
  maxPlayers: row.maxPlayers,
  status: row.status as ContractView["status"],
  gridM: row.gridM,
  plotCount: row.plotCount,
  seed: fromSignedSeed(row.seed),
  inviteCode: row.inviteCode,
  shinePolished: row.shinePolished,
  walletLumens: row.walletLumens,
  playtimeS: row.playtimeS,
  lastPlayedAt: row.lastPlayedAt,
  createdAt: row.createdAt,
  role: role as ContractRoleName,
});

const toTokenView = (row: typeof refreshTokens.$inferSelect): TokenRowView => ({
  id: row.id,
  familyId: row.familyId,
  playerId: row.playerId,
  expiresAt: row.expiresAt,
  replacedBy: row.replacedBy,
  replacedAt: row.replacedAt,
  revokedAt: row.revokedAt,
});

export function createPostgresRepository(db: PgDb, options: PostgresRepositoryOptions = {}): MoonRepository {
  const clock = options.clock;

  /** The database clock (or the injected test clock), read once per operation. */
  const now = async (executor: Executor): Promise<Date> => {
    if (clock !== undefined) return clock();
    const [row] = await executor
      .select({ ms: sql<number>`floor(extract(epoch from now()) * 1000)::float8` })
      .from(sql`(select 1) as clock_row`);
    return new Date(Number(row?.ms ?? Date.now()));
  };

  const mapProfile = (row: typeof profiles.$inferSelect, isGuest: boolean): Profile => ({
    playerId: row.playerId,
    displayName: row.displayName,
    isGuest,
    tenureLevel: row.tenureLevel,
    tenurePoints: row.tenurePoints,
    commendations: row.commendations,
    lifetimeLumens: row.lifetimeLumens,
    lifetimePlotsPolished: row.lifetimePlotsPolished,
    cosmeticsOwned: row.cosmeticsOwned,
    equippedCosmetics: row.equippedCosmetics,
    version: row.version,
  });

  const revokeFamily = async (tx: Executor, familyId: string, reason: string, at: Date): Promise<void> => {
    await tx
      .update(refreshTokens)
      .set({ revokedAt: at, revokeReason: reason })
      .where(and(eq(refreshTokens.familyId, familyId), isNull(refreshTokens.revokedAt)));
  };

  const insertToken = async (
    tx: Executor,
    playerId: string,
    familyId: string,
    token: { id: string; hash: HexDigest; expiresAt: Date },
    at: Date,
  ): Promise<void> => {
    await tx.insert(refreshTokens).values({
      id: token.id,
      playerId,
      familyId,
      tokenHash: token.hash,
      createdAt: at,
      expiresAt: token.expiresAt,
    });
  };

  const ownedCountOf = async (executor: Executor, playerId: string): Promise<number> => {
    const [row] = await executor
      .select({ n: sql<number>`count(*)::int` })
      .from(contracts)
      .where(and(eq(contracts.ownerPlayerId, playerId), ne(contracts.status, "deleted")));
    return row?.n ?? 0;
  };

  const memberRow = async (executor: Executor, contractId: string, playerId: string) => {
    const [row] = await executor
      .select({ role: contractMembers.role, status: contractMembers.status })
      .from(contractMembers)
      .where(and(eq(contractMembers.contractId, contractId), eq(contractMembers.playerId, playerId)));
    return row;
  };

  return {
    // ---- accounts ------------------------------------------------------------------------------------------------
    async createGuest(input: CreateGuestInput): Promise<void> {
      await db.transaction(async (tx) => {
        const at = await now(tx);
        await tx.insert(players).values({ id: input.playerId, isGuest: true, createdAt: at, lastSeenAt: at });
        await tx.insert(profiles).values({ playerId: input.playerId, displayName: input.displayName, updatedAt: at });
        await tx.insert(identities).values({
          id: uuidv7(at.getTime()),
          playerId: input.playerId,
          provider: "recovery_code",
          subject: input.recoveryHash,
          createdAt: at,
        });
        await insertToken(tx, input.playerId, input.token.familyId, input.token, at);
      });
    },

    rotateRefreshToken(input: RotateRefreshInput): Promise<RotateResult> {
      return db.transaction(async (tx): Promise<RotateResult> => {
        const at = await now(tx);
        const [presented] = await tx
          .select()
          .from(refreshTokens)
          .where(eq(refreshTokens.tokenHash, input.presentedHash))
          .for("update");
        if (presented === undefined) return { kind: "invalid" };
        let successor: typeof refreshTokens.$inferSelect | undefined;
        if (presented.replacedBy !== null) {
          [successor] = await tx
            .select()
            .from(refreshTokens)
            .where(eq(refreshTokens.id, presented.replacedBy))
            .for("update");
        }
        const decision = decideRotation(
          toTokenView(presented),
          successor === undefined ? undefined : toTokenView(successor),
          at,
        );
        switch (decision.action) {
          case "invalid":
            return { kind: "invalid" };
          case "rotate":
            await insertToken(tx, presented.playerId, presented.familyId, input.next, at);
            await tx
              .update(refreshTokens)
              .set({ replacedBy: input.next.id, replacedAt: at, lastUsedAt: at })
              .where(eq(refreshTokens.id, presented.id));
            return { kind: "rotated", playerId: presented.playerId };
          case "reissue":
            await tx
              .update(refreshTokens)
              .set({ revokedAt: at, revokeReason: "superseded" })
              .where(eq(refreshTokens.id, decision.successorId));
            await insertToken(tx, presented.playerId, presented.familyId, input.next, at);
            // replaced_at keeps its original value: retries cannot extend the grace window.
            await tx
              .update(refreshTokens)
              .set({ replacedBy: input.next.id, lastUsedAt: at })
              .where(eq(refreshTokens.id, presented.id));
            return { kind: "rotated", playerId: presented.playerId };
          case "superseded":
            return { kind: "superseded", playerId: presented.playerId };
          case "reuse":
            await revokeFamily(tx, presented.familyId, "reuse_detected", at);
            return { kind: "reuse_detected", playerId: presented.playerId };
        }
      });
    },

    async revokeFamilyByHash(tokenHash) {
      return db.transaction(async (tx) => {
        const at = await now(tx);
        const [token] = await tx.select().from(refreshTokens).where(eq(refreshTokens.tokenHash, tokenHash));
        if (token === undefined) return null;
        await revokeFamily(tx, token.familyId, "logout", at);
        return { playerId: token.playerId };
      });
    },

    recover(input: RecoverInput) {
      return db.transaction(async (tx) => {
        const at = await now(tx);
        const [identity] = await tx
          .select()
          .from(identities)
          .where(and(eq(identities.provider, "recovery_code"), eq(identities.subject, input.codeHash)))
          .for("update");
        if (identity === undefined) return null;
        await tx
          .update(refreshTokens)
          .set({ revokedAt: at, revokeReason: "recovered" })
          .where(and(eq(refreshTokens.playerId, identity.playerId), isNull(refreshTokens.revokedAt)));
        await tx
          .update(identities)
          .set({ subject: input.newCodeHash, lastUsedAt: at })
          .where(eq(identities.id, identity.id));
        await insertToken(tx, identity.playerId, input.token.familyId, input.token, at);
        const [profile] = await tx
          .select({ displayName: profiles.displayName })
          .from(profiles)
          .where(eq(profiles.playerId, identity.playerId));
        return { playerId: identity.playerId, displayName: profile?.displayName ?? "" };
      });
    },

    async getProfile(playerId) {
      const [row] = await db
        .select({ profile: profiles, isGuest: players.isGuest })
        .from(profiles)
        .innerJoin(players, eq(players.id, profiles.playerId))
        .where(eq(profiles.playerId, playerId));
      return row === undefined ? null : mapProfile(row.profile, row.isGuest);
    },

    async updateProfile(playerId, patch: ProfilePatch): Promise<ProfilePatchResult> {
      const at = await now(db);
      const [updated] = await db
        .update(profiles)
        .set({
          ...(patch.displayName !== undefined ? { displayName: patch.displayName } : {}),
          ...(patch.equippedCosmetics !== undefined ? { equippedCosmetics: { ...patch.equippedCosmetics } } : {}),
          version: sql`${profiles.version} + 1`,
          updatedAt: at,
        })
        .where(and(eq(profiles.playerId, playerId), eq(profiles.version, patch.expectedVersion)))
        .returning();
      if (updated === undefined) {
        const [exists] = await db
          .select({ id: profiles.playerId })
          .from(profiles)
          .where(eq(profiles.playerId, playerId));
        return exists === undefined ? { kind: "not_found" } : { kind: "version_conflict" };
      }
      const [guest] = await db.select({ isGuest: players.isGuest }).from(players).where(eq(players.id, playerId));
      return { kind: "updated", profile: mapProfile(updated, guest?.isGuest ?? true) };
    },

    async touchPlayer(playerId) {
      const at = await now(db);
      await db
        .update(players)
        .set({ lastSeenAt: at })
        .where(and(eq(players.id, playerId), lt(players.lastSeenAt, new Date(at.getTime() - TOUCH_INTERVAL_S * 1000))));
    },

    async purgeRefreshTokens() {
      const at = await now(db);
      const cutoff = new Date(at.getTime() - REFRESH_RETENTION_DAYS * DAY_MS);
      const removed = await db
        .delete(refreshTokens)
        .where(
          or(
            lt(refreshTokens.expiresAt, at),
            lt(refreshTokens.revokedAt, cutoff),
            lt(refreshTokens.replacedAt, cutoff),
          ),
        )
        .returning({ id: refreshTokens.id });
      return removed.length;
    },

    // ---- contracts -----------------------------------------------------------------------------------------------
    async createContract(input: CreateContractInput): Promise<CreateContractResult> {
      const attempt = (): Promise<CreateContractResult> =>
        db.transaction(async (tx): Promise<CreateContractResult> => {
          const at = await now(tx);
          const [existing] = await tx.select(viewColumns).from(contracts).where(eq(contracts.id, input.id));
          if (existing !== undefined) {
            return existing.ownerPlayerId === input.ownerPlayerId
              ? { kind: "existing", contract: toView(existing, "holder") }
              : { kind: "id_taken" };
          }
          // Serialise concurrent creates of one player so the quota check cannot be raced.
          await tx.select({ id: players.id }).from(players).where(eq(players.id, input.ownerPlayerId)).for("update");
          if ((await ownedCountOf(tx, input.ownerPlayerId)) >= input.ownedQuota) return { kind: "quota_exceeded" };
          const [created] = await tx
            .insert(contracts)
            .values({
              id: input.id,
              ownerPlayerId: input.ownerPlayerId,
              name: input.name,
              shiftType: input.shiftType,
              maxPlayers: input.maxPlayers,
              gridM: input.gridM,
              plotCount: input.plotCount,
              seed: toSignedSeed(input.seed),
              inviteCode: input.inviteCode,
              inviteCodeRotatedAt: input.inviteCode === null ? null : at,
              createdAt: at,
              lastPlayedAt: at,
            })
            .returning(viewColumns);
          await tx.insert(contractMembers).values({
            contractId: input.id,
            playerId: input.ownerPlayerId,
            role: "holder",
            joinedAt: at,
            lastSeenAt: at,
          });
          return created === undefined
            ? { kind: "id_taken" }
            : { kind: "created", contract: toView(created, "holder") };
        });

      try {
        return await attempt();
      } catch (error) {
        const constraint = uniqueViolation(error);
        if (constraint === "contracts_invite_code_uq") return { kind: "invite_code_taken" };
        // Two concurrent registrations of one client id: the loser re-reads the winner's row (idempotent / id_taken).
        if (constraint === "contracts_pkey") return attempt();
        throw error;
      }
    },

    async listContracts(playerId) {
      const rows = await db
        .select({ ...viewColumns, memberRole: contractMembers.role })
        .from(contractMembers)
        .innerJoin(contracts, eq(contracts.id, contractMembers.contractId))
        .where(
          and(
            eq(contractMembers.playerId, playerId),
            eq(contractMembers.status, "active"),
            ne(contracts.status, "deleted"),
          ),
        )
        .orderBy(desc(contractMembers.lastSeenAt), desc(contracts.createdAt))
        .limit(64);
      return { contracts: rows.map((r) => toView(r, r.memberRole)), ownedCount: await ownedCountOf(db, playerId) };
    },

    async getContract(contractId, playerId) {
      const [row] = await db
        .select({ ...viewColumns, memberRole: contractMembers.role })
        .from(contractMembers)
        .innerJoin(contracts, eq(contracts.id, contractMembers.contractId))
        .where(
          and(
            eq(contractMembers.contractId, contractId),
            eq(contractMembers.playerId, playerId),
            eq(contractMembers.status, "active"),
            ne(contracts.status, "deleted"),
          ),
        );
      return row === undefined ? null : toView(row, row.memberRole);
    },

    async getMembership(contractId, playerId): Promise<MembershipView | null> {
      const [row] = await db
        .select({
          role: contractMembers.role,
          status: contractMembers.status,
          shiftType: contracts.shiftType,
          maxPlayers: contracts.maxPlayers,
          contractStatus: contracts.status,
        })
        .from(contractMembers)
        .innerJoin(contracts, eq(contracts.id, contractMembers.contractId))
        .where(and(eq(contractMembers.contractId, contractId), eq(contractMembers.playerId, playerId)));
      if (row === undefined) return null;
      return {
        contractId,
        role: row.role as ContractRoleName,
        status: row.status as MembershipView["status"],
        shiftType: row.shiftType as ShiftTypeName,
        maxPlayers: row.maxPlayers,
        contractStatus: row.contractStatus as MembershipView["contractStatus"],
      };
    },

    async patchContract(input: PatchContractInput): Promise<PatchContractResult> {
      try {
        return await db.transaction(async (tx): Promise<PatchContractResult> => {
          const at = await now(tx);
          const [contract] = await tx
            .select(viewColumns)
            .from(contracts)
            .where(eq(contracts.id, input.contractId))
            .for("update");
          const member = contract === undefined ? undefined : await memberRow(tx, input.contractId, input.playerId);
          if (contract === undefined || contract.status === "deleted" || member?.status !== "active") {
            return { kind: "not_found" };
          }
          if (member.role !== "holder") return { kind: "forbidden" };

          const set: Partial<typeof contracts.$inferInsert> = {};
          if (input.name !== undefined) set.name = input.name;
          if (input.shiftType === "private" && contract.shiftType === "solo") {
            set.shiftType = "private";
            set.maxPlayers = input.privateMaxPlayers;
            const code = contract.inviteCode ?? input.inviteCode ?? null;
            set.inviteCode = code;
            if (code !== null && code !== contract.inviteCode) set.inviteCodeRotatedAt = at;
          } else if (input.shiftType === "solo" && contract.shiftType !== "solo") {
            set.shiftType = "solo";
            set.maxPlayers = 1;
            set.inviteCode = null;
          }
          if (Object.keys(set).length === 0) return { kind: "updated", contract: toView(contract, member.role) };
          const [updated] = await tx
            .update(contracts)
            .set(set)
            .where(eq(contracts.id, input.contractId))
            .returning(viewColumns);
          return updated === undefined
            ? { kind: "not_found" }
            : { kind: "updated", contract: toView(updated, member.role) };
        });
      } catch (error) {
        if (uniqueViolation(error) === "contracts_invite_code_uq") return { kind: "invite_code_taken" };
        throw error;
      }
    },

    joinByInviteCode(input): Promise<JoinByCodeResult> {
      return db.transaction(async (tx): Promise<JoinByCodeResult> => {
        const at = await now(tx);
        const [contract] = await tx
          .select(viewColumns)
          .from(contracts)
          .where(eq(contracts.inviteCode, input.code))
          .for("update");
        if (contract === undefined || contract.status === "deleted" || contract.shiftType !== "private") {
          return { kind: "not_found" };
        }
        const existing = await memberRow(tx, contract.id, input.playerId);
        if (existing !== undefined) {
          return existing.status === "banned"
            ? { kind: "not_found" }
            : { kind: "already_member", contract: toView(contract, existing.role) };
        }
        const [count] = await tx
          .select({ n: sql<number>`count(*)::int` })
          .from(contractMembers)
          .where(eq(contractMembers.contractId, contract.id));
        if ((count?.n ?? 0) >= Math.min(input.maxMembers, contract.maxPlayers)) return { kind: "full" };
        await tx.insert(contractMembers).values({
          contractId: contract.id,
          playerId: input.playerId,
          role: "staff",
          joinedAt: at,
          lastSeenAt: at,
        });
        return { kind: "joined", contract: toView(contract, "staff") };
      });
    },

    async rotateInviteCode(input): Promise<RotateInviteResult> {
      try {
        return await db.transaction(async (tx): Promise<RotateInviteResult> => {
          const at = await now(tx);
          const [contract] = await tx
            .select({ id: contracts.id, status: contracts.status, shiftType: contracts.shiftType })
            .from(contracts)
            .where(eq(contracts.id, input.contractId))
            .for("update");
          const member = contract === undefined ? undefined : await memberRow(tx, input.contractId, input.playerId);
          if (contract === undefined || contract.status === "deleted" || member?.status !== "active") {
            return { kind: "not_found" };
          }
          if (member.role !== "holder") return { kind: "forbidden" };
          if (contract.shiftType !== "private") return { kind: "not_private" };
          await tx
            .update(contracts)
            .set({ inviteCode: input.newCode, inviteCodeRotatedAt: at })
            .where(eq(contracts.id, input.contractId));
          return { kind: "rotated", inviteCode: input.newCode };
        });
      } catch (error) {
        if (uniqueViolation(error) === "contracts_invite_code_uq") return { kind: "invite_code_taken" };
        throw error;
      }
    },

    async listMembers(contractId, requesterId): Promise<ListMembersResult> {
      const [contract] = await db
        .select({ status: contracts.status })
        .from(contracts)
        .where(eq(contracts.id, contractId));
      const requester = contract === undefined ? undefined : await memberRow(db, contractId, requesterId);
      if (contract === undefined || contract.status === "deleted" || requester?.status !== "active") {
        return { kind: "not_found" };
      }
      const rows = await db
        .select({
          playerId: contractMembers.playerId,
          displayName: profiles.displayName,
          role: contractMembers.role,
          status: contractMembers.status,
        })
        .from(contractMembers)
        .innerJoin(profiles, eq(profiles.playerId, contractMembers.playerId))
        .where(eq(contractMembers.contractId, contractId))
        .orderBy(
          desc(sql`(${contractMembers.role} = 'holder')`),
          asc(contractMembers.joinedAt),
          asc(contractMembers.playerId),
        )
        .limit(64);
      return {
        kind: "ok",
        members: rows.map((r) => ({
          playerId: r.playerId,
          displayName: r.displayName,
          role: r.role as ContractRoleName,
          status: r.status as "active" | "banned",
        })),
      };
    },

    // ---- saves (data-model.md 3.7, 3.7b, 3.7c) -------------------------------------------------------------------
    async getPlaytimeLedger(playerId): Promise<PlaytimeLedger | null> {
      const [player] = await db.select({ createdAt: players.createdAt }).from(players).where(eq(players.id, playerId));
      if (player === undefined) return null;
      // Served by contracts_owner_player_id_idx; at most the 3-Contract quota plus deleted rows.
      const [total] = await db
        .select({ n: sql<number>`coalesce(sum(${contracts.playtimeS}), 0)::float8` })
        .from(contracts)
        .where(eq(contracts.ownerPlayerId, playerId));
      return { accountCreatedAt: player.createdAt, contractsPlaytimeS: Number(total?.n ?? 0) };
    },

    async getSaveHead(contractId): Promise<SaveHeadView | null> {
      const [slot] = await db
        .select({
          saveSeq: contractSaves.saveSeq,
          parentSeq: contractSaves.parentSeq,
          originKind: contractSaves.originKind,
          savedAt: contractSaves.savedAt,
          savedBy: contractSaves.savedBy,
          simTick: contractSaves.simTick,
          saveFormatVersion: contractSaves.saveFormatVersion,
          gameDataVersion: contractSaves.gameDataVersion,
        })
        .from(contractSaves)
        .where(eq(contractSaves.contractId, contractId))
        .orderBy(desc(contractSaves.saveSeq))
        .limit(1);
      if (slot === undefined) return null;
      const [mirror] = await db
        .select({
          playtimeS: contracts.playtimeS,
          shinePolished: contracts.shinePolished,
          walletLumens: contracts.walletLumens,
        })
        .from(contracts)
        .where(eq(contracts.id, contractId));
      return {
        generation: slot.saveSeq,
        parentGeneration: slot.parentSeq,
        originKind: slot.originKind as SaveOriginKindName,
        savedAt: slot.savedAt,
        savedBy: slot.savedBy,
        simTick: slot.simTick,
        saveFormatVersion: slot.saveFormatVersion,
        gameDataVersion: slot.gameDataVersion,
        playtimeS: mirror?.playtimeS ?? 0,
        shinePolished: mirror?.shinePolished ?? 0,
        walletLumens: mirror?.walletLumens ?? 0,
      };
    },

    async loadSaveRows(contractId) {
      const slotRows = await db.select().from(contractSaves).where(eq(contractSaves.contractId, contractId));
      const chunkRows = await db
        .select()
        .from(contractDustChunks)
        .where(eq(contractDustChunks.contractId, contractId))
        .orderBy(asc(contractDustChunks.chunkId), asc(contractDustChunks.ver));
      const slots: SaveSlotRow[] = slotRows.map((r) => ({
        slot: r.slot as SaveSlotName,
        saveFormatVersion: r.saveFormatVersion,
        gameDataVersion: r.gameDataVersion,
        codec: r.codec,
        rawSize: r.rawSize,
        blobSize: r.blobSize,
        checksum: fromSignedCrc(r.checksum),
        blob: r.blob,
        saveSeq: r.saveSeq,
        parentSeq: r.parentSeq,
        originKind: r.originKind as SaveOriginKindName,
        simTick: r.simTick,
        savedAt: r.savedAt,
        savedBy: r.savedBy,
      }));
      const chunks: DustChunkRow[] = chunkRows.map((r) => ({
        chunkId: r.chunkId,
        ver: r.ver === 1 ? 1 : 0,
        saveSeq: r.saveSeq,
        codec: r.codec,
        rawSize: r.rawSize,
        blobSize: r.blobSize,
        checksum: fromSignedCrc(r.checksum),
        blob: r.blob,
      }));
      return { slots, chunks };
    },

    async commitSoloCheckpoint(input: CommitSoloCheckpointInput): Promise<CommitSoloCheckpointResult> {
      try {
        return await db.transaction(async (tx): Promise<CommitSoloCheckpointResult> => {
          const at = await now(tx);
          const [contract] = await tx
            .select({
              status: contracts.status,
              shiftType: contracts.shiftType,
              leaseExpiresAt: contracts.leaseExpiresAt,
              playtimeS: contracts.playtimeS,
              shinePolished: contracts.shinePolished,
              walletLumens: contracts.walletLumens,
            })
            .from(contracts)
            .where(eq(contracts.id, input.contractId))
            .for("update");
          const member = contract === undefined ? undefined : await memberRow(tx, input.contractId, input.playerId);
          if (contract === undefined || contract.status === "deleted" || member?.status !== "active") {
            return { kind: "not_found" };
          }
          if (member.role !== "holder") return { kind: "not_holder" };
          if (contract.shiftType !== "solo") return { kind: "not_solo" };
          if (contract.leaseExpiresAt !== null && contract.leaseExpiresAt.getTime() > at.getTime()) {
            return { kind: "busy" };
          }

          const slots = await tx
            .select({
              slot: contractSaves.slot,
              saveSeq: contractSaves.saveSeq,
              parentSeq: contractSaves.parentSeq,
              originKind: contractSaves.originKind,
              savedAt: contractSaves.savedAt,
              savedBy: contractSaves.savedBy,
              simTick: contractSaves.simTick,
              saveFormatVersion: contractSaves.saveFormatVersion,
              gameDataVersion: contractSaves.gameDataVersion,
            })
            .from(contractSaves)
            .where(eq(contractSaves.contractId, input.contractId));
          const newest = slots.reduce<(typeof slots)[number] | undefined>(
            (best, row) => (best === undefined || row.saveSeq > best.saveSeq ? row : best),
            undefined,
          );
          const newestSeq = newest?.saveSeq ?? 0;

          // Idempotent replay: the same device re-sent the checkpoint whose acknowledgement was lost.
          if (
            newest !== undefined &&
            newest.saveSeq === input.generation &&
            newest.parentSeq === input.parentGeneration &&
            newest.savedBy === `solo:${input.deviceId}`
          ) {
            return {
              kind: "accepted",
              generation: newest.saveSeq,
              savedAt: newest.savedAt,
              storedBytes: 0,
              replayed: true,
            };
          }
          if (!input.overwrite && newestSeq !== input.baseGeneration) {
            const server: SaveHeadView | null =
              newest === undefined
                ? null
                : {
                    generation: newest.saveSeq,
                    parentGeneration: newest.parentSeq,
                    originKind: newest.originKind as SaveOriginKindName,
                    savedAt: newest.savedAt,
                    savedBy: newest.savedBy,
                    simTick: newest.simTick,
                    saveFormatVersion: newest.saveFormatVersion,
                    gameDataVersion: newest.gameDataVersion,
                    playtimeS: contract.playtimeS,
                    shinePolished: contract.shinePolished,
                    walletLumens: contract.walletLumens,
                  };
            return { kind: "conflict", server };
          }
          if (input.generation <= newestSeq || input.generation <= input.parentGeneration) {
            return { kind: "generation_not_increasing", serverGeneration: newestSeq };
          }
          if (newest !== undefined) {
            const waitMs = input.minIntervalS * 1000 - (at.getTime() - newest.savedAt.getTime());
            if (waitMs > 0) return { kind: "too_soon", retryAfterS: Math.max(1, Math.ceil(waitMs / 1000)) };
          }

          // Header: overwrite the OLDER slot only, guarded by a compare-and-set on that slot's save_seq.
          const target = pickOlderSlot(slots.map((s) => ({ slot: s.slot as SaveSlotName, saveSeq: s.saveSeq })));
          const slotValues = {
            saveFormatVersion: input.saveFormatVersion,
            gameDataVersion: input.gameDataVersion,
            codec: input.header.codec,
            rawSize: input.header.rawSize,
            blobSize: input.header.blob.byteLength,
            checksum: toSignedCrc(input.header.checksum),
            blob: asBytes(input.header.blob),
            saveSeq: input.generation,
            parentSeq: input.parentGeneration,
            originKind: "solo",
            simTick: input.simTick,
            savedAt: at,
            savedBy: `solo:${input.deviceId}`,
          };
          const written =
            target.expectedSeq === null
              ? await tx
                  .insert(contractSaves)
                  .values({ contractId: input.contractId, slot: target.slot, ...slotValues })
                  .onConflictDoNothing()
                  .returning({ slot: contractSaves.slot })
              : await tx
                  .update(contractSaves)
                  .set(slotValues)
                  .where(
                    and(
                      eq(contractSaves.contractId, input.contractId),
                      eq(contractSaves.slot, target.slot),
                      eq(contractSaves.saveSeq, target.expectedSeq),
                    ),
                  )
                  .returning({ slot: contractSaves.slot });
          if (written.length === 0) throw new RollbackWith({ kind: "conflict", server: null });

          // Chunks: each into its older version (an overwrite is a full snapshot: every other chunk row is dropped first).
          if (input.overwrite) {
            await tx.delete(contractDustChunks).where(eq(contractDustChunks.contractId, input.contractId));
          }
          if (input.chunks.length > 0) {
            const existing = input.overwrite
              ? []
              : await tx
                  .select({
                    chunkId: contractDustChunks.chunkId,
                    ver: contractDustChunks.ver,
                    saveSeq: contractDustChunks.saveSeq,
                  })
                  .from(contractDustChunks)
                  .where(eq(contractDustChunks.contractId, input.contractId));
            const byChunk = new Map<number, { ver: 0 | 1; saveSeq: number }[]>();
            for (const row of existing) {
              const list = byChunk.get(row.chunkId) ?? [];
              list.push({ ver: row.ver === 1 ? 1 : 0, saveSeq: row.saveSeq });
              byChunk.set(row.chunkId, list);
            }
            await tx
              .insert(contractDustChunks)
              .values(
                input.chunks.map((c) => ({
                  contractId: input.contractId,
                  chunkId: c.chunkId,
                  ver: pickOlderVersion(byChunk.get(c.chunkId) ?? []),
                  saveSeq: input.generation,
                  codec: c.codec,
                  rawSize: c.rawSize,
                  blobSize: c.blob.byteLength,
                  checksum: toSignedCrc(c.checksum),
                  blob: asBytes(c.blob),
                  savedAt: at,
                })),
              )
              .onConflictDoUpdate({
                target: [contractDustChunks.contractId, contractDustChunks.chunkId, contractDustChunks.ver],
                set: {
                  saveSeq: sql`excluded.save_seq`,
                  codec: sql`excluded.codec`,
                  rawSize: sql`excluded.raw_size`,
                  blobSize: sql`excluded.blob_size`,
                  checksum: sql`excluded.checksum`,
                  blob: sql`excluded.blob`,
                  savedAt: sql`excluded.saved_at`,
                },
              });
          }

          const [headerBytes] = await tx
            .select({ n: sql<number>`coalesce(sum(${contractSaves.blobSize}), 0)::int` })
            .from(contractSaves)
            .where(eq(contractSaves.contractId, input.contractId));
          const [chunkBytes] = await tx
            .select({ n: sql<number>`coalesce(sum(${contractDustChunks.blobSize}), 0)::int` })
            .from(contractDustChunks)
            .where(eq(contractDustChunks.contractId, input.contractId));
          const storedBytes = (headerBytes?.n ?? 0) + (chunkBytes?.n ?? 0);
          if (storedBytes > input.hardCapBytes) throw new RollbackWith({ kind: "over_cap", storedBytes });

          await tx
            .update(contracts)
            .set({
              lastPlayedAt: at,
              shinePolished: input.shinePolished,
              walletLumens: input.walletLumens,
              playtimeS: input.playtimeS,
              storedBytes,
              gameDataVersion: input.gameDataVersion,
            })
            .where(eq(contracts.id, input.contractId));
          if (input.profileCredit.tenurePoints > 0 || input.profileCredit.commendations > 0) {
            await tx
              .update(profiles)
              .set({
                tenurePoints: sql`${profiles.tenurePoints} + ${input.profileCredit.tenurePoints}`,
                commendations: sql`${profiles.commendations} + ${input.profileCredit.commendations}`,
                version: sql`${profiles.version} + 1`,
                updatedAt: at,
              })
              .where(eq(profiles.playerId, input.playerId));
          }
          return { kind: "accepted", generation: input.generation, savedAt: at, storedBytes, replayed: false };
        });
      } catch (error) {
        if (error instanceof RollbackWith) return error.result;
        throw error;
      }
    },
  };
}
