// In-memory MoonRepository (PERSISTENCE_DRIVER=memory, ENV_NAME=local only; env validation refuses it elsewhere).
// Nothing survives a restart. It implements the same interface and passes the same behavioural suite as the PostgreSQL
// repository, so local development and the Postgres path behave alike. Single-threaded JavaScript makes every method
// atomic, which stands in for the transactions and row locks of postgres.ts.

import { decideRotation, type TokenRowView } from "./rotation.ts";
import { pickOlderSlot, pickOlderVersion } from "./save-rules.ts";
import {
  REFRESH_RETENTION_DAYS,
  TOUCH_INTERVAL_S,
  type ContractRoleName,
  type ContractView,
  type CommitSoloCheckpointInput,
  type CommitSoloCheckpointResult,
  type CreateContractInput,
  type CreateContractResult,
  type CreateGuestInput,
  type DustChunkRow,
  type HexDigest,
  type JoinByCodeResult,
  type ListMembersResult,
  type MembershipView,
  type MemberView,
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
  type SaveSlotName,
  type SaveSlotRow,
} from "./types.ts";

export interface MemoryRepositoryOptions {
  /** Test seam; defaults to the wall clock. */
  readonly clock?: () => Date;
  /**
   * Test seam standing in for the room lease of M1-W5-T01: Contract id -> lease expiry. A Contract whose entry is in the
   * future is "held by a live room" and refuses solo checkpoint writes.
   */
  readonly leaseExpiry?: ReadonlyMap<string, Date>;
}

interface PlayerRec {
  id: string;
  isGuest: boolean;
  createdAt: Date;
  lastSeenAt: Date;
}
interface ProfileRec {
  playerId: string;
  displayName: string;
  tenureLevel: number;
  tenurePoints: number;
  commendations: number;
  lifetimeLumens: number;
  lifetimePlotsPolished: number;
  cosmeticsOwned: string[];
  equippedCosmetics: Record<string, string>;
  version: number;
}
interface IdentityRec {
  playerId: string;
  subject: HexDigest;
}
interface TokenRec {
  id: string;
  playerId: string;
  familyId: string;
  hash: HexDigest;
  expiresAt: Date;
  replacedBy: string | null;
  replacedAt: Date | null;
  revokedAt: Date | null;
  revokeReason: string | null;
}
interface ContractRec {
  id: string;
  ownerPlayerId: string;
  name: string;
  shiftType: "solo" | "private" | "open";
  maxPlayers: number;
  status: "active" | "fulfilled" | "deleted";
  gridM: number;
  plotCount: number;
  seed: string;
  inviteCode: string | null;
  shinePolished: number;
  walletLumens: number;
  playtimeS: number;
  lastPlayedAt: Date;
  createdAt: Date;
  storedBytes: number;
}
interface MemberRec {
  contractId: string;
  playerId: string;
  role: ContractRoleName;
  status: "active" | "banned";
  lastSeenAt: Date;
  seq: number;
}

const DAY_MS = 86_400_000;

export function createMemoryRepository(options: MemoryRepositoryOptions = {}): MoonRepository {
  const clock = options.clock ?? (() => new Date());
  const players = new Map<string, PlayerRec>();
  const profiles = new Map<string, ProfileRec>();
  const identities = new Map<HexDigest, IdentityRec>(); // recovery_code subject -> identity
  const tokens = new Map<string, TokenRec>(); // by id
  const tokenByHash = new Map<HexDigest, string>();
  const contracts = new Map<string, ContractRec>();
  const contractByCode = new Map<string, string>();
  const members: MemberRec[] = [];
  let memberSeq = 0;
  const saveSlots = new Map<string, Map<SaveSlotName, SaveSlotRow>>(); // contract id -> slot -> row
  const saveChunks = new Map<string, Map<string, DustChunkRow>>(); // contract id -> "chunkId:ver" -> row
  const copyBytes = (bytes: Uint8Array): Uint8Array => Uint8Array.from(bytes);

  const toProfile = (p: ProfileRec): Profile => ({
    playerId: p.playerId,
    displayName: p.displayName,
    isGuest: players.get(p.playerId)?.isGuest ?? true,
    tenureLevel: p.tenureLevel,
    tenurePoints: p.tenurePoints,
    commendations: p.commendations,
    lifetimeLumens: p.lifetimeLumens,
    lifetimePlotsPolished: p.lifetimePlotsPolished,
    cosmeticsOwned: [...p.cosmeticsOwned],
    equippedCosmetics: { ...p.equippedCosmetics },
    version: p.version,
  });

  const view = (c: ContractRec, role: ContractRoleName): ContractView => ({
    id: c.id,
    ownerPlayerId: c.ownerPlayerId,
    name: c.name,
    shiftType: c.shiftType,
    maxPlayers: c.maxPlayers,
    status: c.status,
    gridM: c.gridM,
    plotCount: c.plotCount,
    seed: c.seed,
    inviteCode: c.inviteCode,
    shinePolished: c.shinePolished,
    walletLumens: c.walletLumens,
    playtimeS: c.playtimeS,
    lastPlayedAt: c.lastPlayedAt,
    createdAt: c.createdAt,
    role,
  });

  const newestSlot = (slots: ReadonlyMap<SaveSlotName, SaveSlotRow> | undefined): SaveSlotRow | undefined => {
    let best: SaveSlotRow | undefined;
    for (const row of slots?.values() ?? []) if (best === undefined || row.saveSeq > best.saveSeq) best = row;
    return best;
  };

  const headOf = (row: SaveSlotRow, c: ContractRec): SaveHeadView => ({
    generation: row.saveSeq,
    parentGeneration: row.parentSeq,
    originKind: row.originKind,
    savedAt: row.savedAt,
    savedBy: row.savedBy,
    simTick: row.simTick,
    saveFormatVersion: row.saveFormatVersion,
    gameDataVersion: row.gameDataVersion,
    playtimeS: c.playtimeS,
    shinePolished: c.shinePolished,
    walletLumens: c.walletLumens,
  });

  const findMember = (contractId: string, playerId: string): MemberRec | undefined =>
    members.find((m) => m.contractId === contractId && m.playerId === playerId);

  const rowView = (t: TokenRec): TokenRowView => ({
    id: t.id,
    familyId: t.familyId,
    playerId: t.playerId,
    expiresAt: t.expiresAt,
    replacedBy: t.replacedBy,
    replacedAt: t.replacedAt,
    revokedAt: t.revokedAt,
  });

  const addToken = (playerId: string, familyId: string, token: { id: string; hash: HexDigest; expiresAt: Date }) => {
    const rec: TokenRec = {
      id: token.id,
      playerId,
      familyId,
      hash: token.hash,
      expiresAt: token.expiresAt,
      replacedBy: null,
      replacedAt: null,
      revokedAt: null,
      revokeReason: null,
    };
    tokens.set(rec.id, rec);
    tokenByHash.set(rec.hash, rec.id);
  };

  const revokeFamily = (familyId: string, reason: string, now: Date): void => {
    for (const t of tokens.values()) {
      if (t.familyId === familyId && t.revokedAt === null) {
        t.revokedAt = now;
        t.revokeReason = reason;
      }
    }
  };

  const ownedCount = (playerId: string): number => {
    let n = 0;
    for (const c of contracts.values()) if (c.ownerPlayerId === playerId && c.status !== "deleted") n += 1;
    return n;
  };

  return {
    // ---- accounts ------------------------------------------------------------------------------------------------
    createGuest(input: CreateGuestInput): Promise<void> {
      const now = clock();
      if (players.has(input.playerId) || identities.has(input.recoveryHash) || tokenByHash.has(input.token.hash)) {
        return Promise.reject(new Error("unique violation"));
      }
      players.set(input.playerId, { id: input.playerId, isGuest: true, createdAt: now, lastSeenAt: now });
      profiles.set(input.playerId, {
        playerId: input.playerId,
        displayName: input.displayName,
        tenureLevel: 0,
        tenurePoints: 0,
        commendations: 0,
        lifetimeLumens: 0,
        lifetimePlotsPolished: 0,
        cosmeticsOwned: [],
        equippedCosmetics: {},
        version: 0,
      });
      identities.set(input.recoveryHash, { playerId: input.playerId, subject: input.recoveryHash });
      addToken(input.playerId, input.token.familyId, input.token);
      return Promise.resolve();
    },

    rotateRefreshToken(input: RotateRefreshInput): Promise<RotateResult> {
      const now = clock();
      const presentedId = tokenByHash.get(input.presentedHash);
      const presented = presentedId === undefined ? undefined : tokens.get(presentedId);
      const successor =
        presented?.replacedBy === null || presented?.replacedBy === undefined
          ? undefined
          : tokens.get(presented.replacedBy);
      const decision = decideRotation(
        presented === undefined ? undefined : rowView(presented),
        successor === undefined ? undefined : rowView(successor),
        now,
      );
      if (presented === undefined) return Promise.resolve({ kind: "invalid" });
      switch (decision.action) {
        case "invalid":
          return Promise.resolve({ kind: "invalid" });
        case "rotate": {
          addToken(presented.playerId, presented.familyId, input.next);
          presented.replacedBy = input.next.id;
          presented.replacedAt = now;
          return Promise.resolve({ kind: "rotated", playerId: presented.playerId });
        }
        case "reissue": {
          const unused = tokens.get(decision.successorId);
          if (unused !== undefined) {
            unused.revokedAt = now;
            unused.revokeReason = "superseded";
          }
          addToken(presented.playerId, presented.familyId, input.next);
          presented.replacedBy = input.next.id;
          return Promise.resolve({ kind: "rotated", playerId: presented.playerId });
        }
        case "superseded":
          return Promise.resolve({ kind: "superseded", playerId: presented.playerId });
        case "reuse":
          revokeFamily(presented.familyId, "reuse_detected", now);
          return Promise.resolve({ kind: "reuse_detected", playerId: presented.playerId });
      }
    },

    revokeFamilyByHash(tokenHash) {
      const id = tokenByHash.get(tokenHash);
      const token = id === undefined ? undefined : tokens.get(id);
      if (token === undefined) return Promise.resolve(null);
      revokeFamily(token.familyId, "logout", clock());
      return Promise.resolve({ playerId: token.playerId });
    },

    recover(input: RecoverInput) {
      const identity = identities.get(input.codeHash);
      if (identity === undefined) return Promise.resolve(null);
      const now = clock();
      for (const t of tokens.values()) {
        if (t.playerId === identity.playerId && t.revokedAt === null) {
          t.revokedAt = now;
          t.revokeReason = "recovered";
        }
      }
      identities.delete(input.codeHash);
      identity.subject = input.newCodeHash;
      identities.set(input.newCodeHash, identity);
      addToken(identity.playerId, input.token.familyId, input.token);
      const profile = profiles.get(identity.playerId);
      return Promise.resolve({ playerId: identity.playerId, displayName: profile?.displayName ?? "" });
    },

    getProfile(playerId) {
      const p = profiles.get(playerId);
      return Promise.resolve(p === undefined ? null : toProfile(p));
    },

    updateProfile(playerId, patch: ProfilePatch): Promise<ProfilePatchResult> {
      const p = profiles.get(playerId);
      if (p === undefined) return Promise.resolve({ kind: "not_found" });
      if (p.version !== patch.expectedVersion) return Promise.resolve({ kind: "version_conflict" });
      if (patch.displayName !== undefined) p.displayName = patch.displayName;
      if (patch.equippedCosmetics !== undefined) p.equippedCosmetics = { ...patch.equippedCosmetics };
      p.version += 1;
      return Promise.resolve({ kind: "updated", profile: toProfile(p) });
    },

    touchPlayer(playerId) {
      const p = players.get(playerId);
      const now = clock();
      if (p !== undefined && now.getTime() - p.lastSeenAt.getTime() >= TOUCH_INTERVAL_S * 1000) p.lastSeenAt = now;
      return Promise.resolve();
    },

    purgeRefreshTokens() {
      const cutoff = clock().getTime() - REFRESH_RETENTION_DAYS * DAY_MS;
      const now = clock().getTime();
      let removed = 0;
      for (const [id, t] of tokens) {
        const expired = t.expiresAt.getTime() <= now;
        const oldRevoked = t.revokedAt !== null && t.revokedAt.getTime() < cutoff;
        const oldReplaced = t.replacedAt !== null && t.replacedAt.getTime() < cutoff;
        if (expired || oldRevoked || oldReplaced) {
          tokens.delete(id);
          tokenByHash.delete(t.hash);
          removed += 1;
        }
      }
      return Promise.resolve(removed);
    },

    // ---- contracts -----------------------------------------------------------------------------------------------
    createContract(input: CreateContractInput): Promise<CreateContractResult> {
      const now = clock();
      const existing = contracts.get(input.id);
      if (existing !== undefined) {
        if (existing.ownerPlayerId !== input.ownerPlayerId) return Promise.resolve({ kind: "id_taken" });
        return Promise.resolve({ kind: "existing", contract: view(existing, "holder") });
      }
      if (ownedCount(input.ownerPlayerId) >= input.ownedQuota) return Promise.resolve({ kind: "quota_exceeded" });
      if (input.inviteCode !== null && contractByCode.has(input.inviteCode)) {
        return Promise.resolve({ kind: "invite_code_taken" });
      }
      const rec: ContractRec = {
        id: input.id,
        ownerPlayerId: input.ownerPlayerId,
        name: input.name,
        shiftType: input.shiftType,
        maxPlayers: input.maxPlayers,
        status: "active",
        gridM: input.gridM,
        plotCount: input.plotCount,
        seed: input.seed,
        inviteCode: input.inviteCode,
        shinePolished: 0,
        walletLumens: 0,
        playtimeS: 0,
        lastPlayedAt: now,
        createdAt: now,
        storedBytes: 0,
      };
      contracts.set(rec.id, rec);
      if (rec.inviteCode !== null) contractByCode.set(rec.inviteCode, rec.id);
      members.push({
        contractId: rec.id,
        playerId: input.ownerPlayerId,
        role: "holder",
        status: "active",
        lastSeenAt: now,
        seq: (memberSeq += 1),
      });
      return Promise.resolve({ kind: "created", contract: view(rec, "holder") });
    },

    listContracts(playerId) {
      const mine = members
        .filter((m) => m.playerId === playerId && m.status === "active")
        .sort((a, b) => b.lastSeenAt.getTime() - a.lastSeenAt.getTime() || b.seq - a.seq);
      const list: ContractView[] = [];
      for (const m of mine) {
        const c = contracts.get(m.contractId);
        if (c !== undefined && c.status !== "deleted" && list.length < 64) list.push(view(c, m.role));
      }
      return Promise.resolve({ contracts: list, ownedCount: ownedCount(playerId) });
    },

    getContract(contractId, playerId) {
      const m = findMember(contractId, playerId);
      const c = contracts.get(contractId);
      if (m === undefined || m.status !== "active" || c === undefined || c.status === "deleted") {
        return Promise.resolve(null);
      }
      return Promise.resolve(view(c, m.role));
    },

    getMembership(contractId, playerId): Promise<MembershipView | null> {
      const m = findMember(contractId, playerId);
      const c = contracts.get(contractId);
      if (m === undefined || c === undefined) return Promise.resolve(null);
      return Promise.resolve({
        contractId,
        role: m.role,
        status: m.status,
        shiftType: c.shiftType,
        maxPlayers: c.maxPlayers,
        contractStatus: c.status,
      });
    },

    patchContract(input: PatchContractInput): Promise<PatchContractResult> {
      const c = contracts.get(input.contractId);
      const m = findMember(input.contractId, input.playerId);
      if (c === undefined || c.status === "deleted" || m === undefined || m.status !== "active") {
        return Promise.resolve({ kind: "not_found" });
      }
      if (m.role !== "holder") return Promise.resolve({ kind: "forbidden" });
      let newCode: string | null | undefined;
      if (input.shiftType === "private" && c.shiftType === "solo") {
        newCode = c.inviteCode ?? input.inviteCode ?? null;
        if (newCode !== null && newCode !== c.inviteCode && contractByCode.has(newCode)) {
          return Promise.resolve({ kind: "invite_code_taken" });
        }
      }
      if (input.name !== undefined) c.name = input.name;
      if (input.shiftType === "private" && c.shiftType === "solo") {
        c.shiftType = "private";
        c.maxPlayers = input.privateMaxPlayers;
        c.inviteCode = newCode ?? null;
        if (c.inviteCode !== null) contractByCode.set(c.inviteCode, c.id);
      } else if (input.shiftType === "solo" && c.shiftType !== "solo") {
        if (c.inviteCode !== null) contractByCode.delete(c.inviteCode);
        c.shiftType = "solo";
        c.maxPlayers = 1;
        c.inviteCode = null;
      }
      return Promise.resolve({ kind: "updated", contract: view(c, m.role) });
    },

    joinByInviteCode(input): Promise<JoinByCodeResult> {
      const id = contractByCode.get(input.code);
      const c = id === undefined ? undefined : contracts.get(id);
      if (c === undefined || c.status === "deleted" || c.shiftType !== "private") {
        return Promise.resolve({ kind: "not_found" });
      }
      const existing = findMember(c.id, input.playerId);
      if (existing !== undefined) {
        if (existing.status === "banned") return Promise.resolve({ kind: "not_found" });
        return Promise.resolve({ kind: "already_member", contract: view(c, existing.role) });
      }
      if (members.filter((m) => m.contractId === c.id).length >= Math.min(input.maxMembers, c.maxPlayers)) {
        return Promise.resolve({ kind: "full" });
      }
      members.push({
        contractId: c.id,
        playerId: input.playerId,
        role: "staff",
        status: "active",
        lastSeenAt: clock(),
        seq: (memberSeq += 1),
      });
      return Promise.resolve({ kind: "joined", contract: view(c, "staff") });
    },

    rotateInviteCode(input): Promise<RotateInviteResult> {
      const c = contracts.get(input.contractId);
      const m = findMember(input.contractId, input.playerId);
      if (c === undefined || c.status === "deleted" || m === undefined || m.status !== "active") {
        return Promise.resolve({ kind: "not_found" });
      }
      if (m.role !== "holder") return Promise.resolve({ kind: "forbidden" });
      if (c.shiftType !== "private") return Promise.resolve({ kind: "not_private" });
      if (contractByCode.has(input.newCode)) return Promise.resolve({ kind: "invite_code_taken" });
      if (c.inviteCode !== null) contractByCode.delete(c.inviteCode);
      c.inviteCode = input.newCode;
      contractByCode.set(input.newCode, c.id);
      return Promise.resolve({ kind: "rotated", inviteCode: input.newCode });
    },

    listMembers(contractId, requesterId): Promise<ListMembersResult> {
      const requester = findMember(contractId, requesterId);
      const c = contracts.get(contractId);
      if (requester === undefined || requester.status !== "active" || c === undefined || c.status === "deleted") {
        return Promise.resolve({ kind: "not_found" });
      }
      const list: MemberView[] = members
        .filter((m) => m.contractId === contractId)
        .sort((a, b) => Number(b.role === "holder") - Number(a.role === "holder") || a.seq - b.seq)
        .map((m) => ({
          playerId: m.playerId,
          displayName: profiles.get(m.playerId)?.displayName ?? "",
          role: m.role,
          status: m.status,
        }));
      return Promise.resolve({ kind: "ok", members: list });
    },

    // ---- saves (same rules as postgres.ts) -----------------------------------------------------------------------
    getSaveHead(contractId): Promise<SaveHeadView | null> {
      const slots = saveSlots.get(contractId);
      const c = contracts.get(contractId);
      const newest = newestSlot(slots);
      if (newest === undefined || c === undefined) return Promise.resolve(null);
      return Promise.resolve(headOf(newest, c));
    },

    getPlaytimeLedger(playerId): Promise<PlaytimeLedger | null> {
      const player = players.get(playerId);
      if (player === undefined) return Promise.resolve(null);
      let contractsPlaytimeS = 0;
      for (const c of contracts.values()) if (c.ownerPlayerId === playerId) contractsPlaytimeS += c.playtimeS;
      return Promise.resolve({ accountCreatedAt: player.createdAt, contractsPlaytimeS });
    },

    loadSaveRows(contractId) {
      const slots = [...(saveSlots.get(contractId)?.values() ?? [])].map((r) => ({
        ...r,
        blob: copyBytes(r.blob),
      }));
      const chunks = [...(saveChunks.get(contractId)?.values() ?? [])]
        .sort((a, b) => a.chunkId - b.chunkId || a.ver - b.ver)
        .map((r) => ({ ...r, blob: copyBytes(r.blob) }));
      return Promise.resolve({ slots, chunks });
    },

    commitSoloCheckpoint(input: CommitSoloCheckpointInput): Promise<CommitSoloCheckpointResult> {
      const at = clock();
      const c = contracts.get(input.contractId);
      const member = c === undefined ? undefined : findMember(input.contractId, input.playerId);
      if (c === undefined || c.status === "deleted" || member?.status !== "active") {
        return Promise.resolve({ kind: "not_found" });
      }
      if (member.role !== "holder") return Promise.resolve({ kind: "not_holder" });
      if (c.shiftType !== "solo") return Promise.resolve({ kind: "not_solo" });
      const lease = options.leaseExpiry?.get(input.contractId);
      if (lease !== undefined && lease.getTime() > at.getTime()) return Promise.resolve({ kind: "busy" });

      const slots = saveSlots.get(input.contractId) ?? new Map<SaveSlotName, SaveSlotRow>();
      const newest = newestSlot(slots);
      const newestSeq = newest?.saveSeq ?? 0;
      if (
        newest !== undefined &&
        newest.saveSeq === input.generation &&
        newest.parentSeq === input.parentGeneration &&
        newest.savedBy === `solo:${input.deviceId}`
      ) {
        return Promise.resolve({
          kind: "accepted",
          generation: newest.saveSeq,
          savedAt: newest.savedAt,
          storedBytes: 0,
          replayed: true,
        });
      }
      if (!input.overwrite && newestSeq !== input.baseGeneration) {
        return Promise.resolve({ kind: "conflict", server: newest === undefined ? null : headOf(newest, c) });
      }
      if (input.generation <= newestSeq || input.generation <= input.parentGeneration) {
        return Promise.resolve({ kind: "generation_not_increasing", serverGeneration: newestSeq });
      }
      if (newest !== undefined) {
        const waitMs = input.minIntervalS * 1000 - (at.getTime() - newest.savedAt.getTime());
        if (waitMs > 0)
          return Promise.resolve({ kind: "too_soon", retryAfterS: Math.max(1, Math.ceil(waitMs / 1000)) });
      }

      // Stage everything, check the cap, then commit (nothing is applied on a refusal).
      const target = pickOlderSlot([...slots.values()].map((s) => ({ slot: s.slot, saveSeq: s.saveSeq })));
      const chunkMap = new Map(input.overwrite ? [] : (saveChunks.get(input.contractId) ?? new Map()));
      const writes: DustChunkRow[] = input.chunks.map((chunk) => {
        const existing = [...chunkMap.values()].filter((r) => r.chunkId === chunk.chunkId);
        const ver = pickOlderVersion(existing.map((r) => ({ ver: r.ver, saveSeq: r.saveSeq })));
        return {
          chunkId: chunk.chunkId,
          ver,
          saveSeq: input.generation,
          codec: chunk.codec,
          rawSize: chunk.rawSize,
          blobSize: chunk.blob.byteLength,
          checksum: chunk.checksum,
          blob: copyBytes(chunk.blob),
        };
      });
      for (const row of writes) chunkMap.set(`${row.chunkId}:${row.ver}`, row);
      const slotRow: SaveSlotRow = {
        slot: target.slot,
        saveFormatVersion: input.saveFormatVersion,
        gameDataVersion: input.gameDataVersion,
        codec: input.header.codec,
        rawSize: input.header.rawSize,
        blobSize: input.header.blob.byteLength,
        checksum: input.header.checksum,
        blob: copyBytes(input.header.blob),
        saveSeq: input.generation,
        parentSeq: input.parentGeneration,
        originKind: "solo",
        simTick: input.simTick,
        savedAt: at,
        savedBy: `solo:${input.deviceId}`,
      };
      const otherSlots = [...slots.values()].filter((s) => s.slot !== target.slot);
      const storedBytes =
        [slotRow, ...otherSlots].reduce((sum, r) => sum + r.blobSize, 0) +
        [...chunkMap.values()].reduce((sum, r) => sum + r.blobSize, 0);
      if (storedBytes > input.hardCapBytes) return Promise.resolve({ kind: "over_cap", storedBytes });

      slots.set(target.slot, slotRow);
      saveSlots.set(input.contractId, slots);
      saveChunks.set(input.contractId, chunkMap);
      c.lastPlayedAt = at;
      c.shinePolished = input.shinePolished;
      c.walletLumens = input.walletLumens;
      c.playtimeS = input.playtimeS;
      c.storedBytes = storedBytes;
      const profile = profiles.get(input.playerId);
      if (profile !== undefined && (input.profileCredit.tenurePoints > 0 || input.profileCredit.commendations > 0)) {
        profile.tenurePoints += input.profileCredit.tenurePoints;
        profile.commendations += input.profileCredit.commendations;
        profile.version += 1;
      }
      return Promise.resolve({
        kind: "accepted",
        generation: input.generation,
        savedAt: at,
        storedBytes,
        replayed: false,
      });
    },
  };
}
