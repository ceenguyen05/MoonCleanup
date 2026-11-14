// PostgreSQL MoonRepository (drizzle). Works with any drizzle pg driver: postgres.js in production, PGlite in tests.
//
// Conventions: every multi-step operation is one transaction; rows that decide a race are locked FOR UPDATE; time comes
// from the DATABASE clock (`select now()`, data-model.md section 1) unless a test injects `clock`. Queries never touch
// contract_saves.blob. No string-built SQL: identifiers and values go through drizzle's operators and bound parameters.

import { and, asc, desc, eq, isNull, lt, ne, or, sql } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { uuidv7 } from "../ids.ts";
import * as schema from "../schema/index.ts";
import { contractMembers, contracts, identities, players, profiles, refreshTokens } from "../schema/index.ts";
import { decideRotation, type TokenRowView } from "./rotation.ts";
import {
  REFRESH_RETENTION_DAYS,
  TOUCH_INTERVAL_S,
  type ContractRoleName,
  type ContractView,
  type CreateContractInput,
  type CreateContractResult,
  type CreateGuestInput,
  type HexDigest,
  type JoinByCodeResult,
  type ListMembersResult,
  type MembershipView,
  type MoonRepository,
  type PatchContractInput,
  type PatchContractResult,
  type Profile,
  type ProfilePatch,
  type ProfilePatchResult,
  type RecoverInput,
  type RotateInviteResult,
  type RotateRefreshInput,
  type RotateResult,
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
  };
}
