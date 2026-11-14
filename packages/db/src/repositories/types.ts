// The persistence interface of accounts, profiles and Contracts (M1-W4-T05). Two implementations satisfy it and run the
// SAME behavioural suite (contract-suite.ts): the PostgreSQL repository (postgres.ts, drizzle) and the in-memory one
// (memory.ts, PERSISTENCE_DRIVER=memory, local development only).
//
// Rules: domain types only (never a database row type); secrets are digests (lower-case hex of HMAC-SHA256 under the
// pepper), the raw refresh token and recovery code never reach this layer; every multi-step operation is atomic.

/** Lower-case hex digest (64 characters = 32 bytes) of an HMAC-SHA256. */
export type HexDigest = string;

export type ShiftTypeName = "solo" | "private" | "open";
export type ContractRoleName = "holder" | "supervisor" | "staff" | "temp";

// ---- Accounts and refresh tokens ---------------------------------------------------------------------------------

export interface NewRefreshToken {
  readonly id: string;
  readonly hash: HexDigest;
  readonly expiresAt: Date;
}

export interface CreateGuestInput {
  readonly playerId: string;
  readonly displayName: string;
  /** HMAC of the one-time recovery code (identity subject). */
  readonly recoveryHash: HexDigest;
  readonly token: NewRefreshToken & { readonly familyId: string };
}

/** Outcome of presenting a refresh token (security.md section 3, including the 60 s rotation grace window). */
export type RotateResult =
  /** Normal rotation, or a grace-window retry where the unused successor was revoked and replaced. */
  | { readonly kind: "rotated"; readonly playerId: string }
  /** The presented token was replaced seconds ago and its successor was already used: 409, nothing revoked. */
  | { readonly kind: "superseded"; readonly playerId: string }
  /** A replaced token was presented outside the grace window: the whole family was revoked (theft signal). */
  | { readonly kind: "reuse_detected"; readonly playerId: string }
  /** Unknown, expired or revoked token. */
  | { readonly kind: "invalid" };

export interface RotateRefreshInput {
  readonly presentedHash: HexDigest;
  /** The successor to store when rotation succeeds (unused otherwise). */
  readonly next: NewRefreshToken;
}

export interface RecoverInput {
  readonly codeHash: HexDigest;
  /** Identity subject of the replacement recovery code. */
  readonly newCodeHash: HexDigest;
  readonly token: NewRefreshToken & { readonly familyId: string };
}

export interface Profile {
  readonly playerId: string;
  readonly displayName: string;
  readonly isGuest: boolean;
  readonly tenureLevel: number;
  readonly tenurePoints: number;
  readonly commendations: number;
  readonly lifetimeLumens: number;
  readonly lifetimePlotsPolished: number;
  readonly cosmeticsOwned: readonly string[];
  readonly equippedCosmetics: Readonly<Record<string, string>>;
  readonly version: number;
}

export interface ProfilePatch {
  readonly displayName?: string;
  readonly equippedCosmetics?: Readonly<Record<string, string>>;
  /** Must equal the stored version (optimistic concurrency). */
  readonly expectedVersion: number;
}

export type ProfilePatchResult =
  | { readonly kind: "updated"; readonly profile: Profile }
  | { readonly kind: "version_conflict" }
  | { readonly kind: "not_found" };

export interface AccountRepository {
  /** One transaction: player, profile, recovery-code identity and the first refresh token. */
  createGuest(input: CreateGuestInput): Promise<void>;
  rotateRefreshToken(input: RotateRefreshInput): Promise<RotateResult>;
  /** Logout: revokes the family of the presented token. `null` when the token is unknown. */
  revokeFamilyByHash(tokenHash: HexDigest): Promise<{ readonly playerId: string } | null>;
  /**
   * Recovery: verifies the code digest, revokes every token family of the player, swaps the recovery identity to the
   * replacement code and stores the first token of a new family. `null` when no identity matches.
   */
  recover(input: RecoverInput): Promise<{ readonly playerId: string; readonly displayName: string } | null>;
  getProfile(playerId: string): Promise<Profile | null>;
  updateProfile(playerId: string, patch: ProfilePatch): Promise<ProfilePatchResult>;
  /** Bumps `last_seen_at` at most once per hour per player (no write churn). */
  touchPlayer(playerId: string): Promise<void>;
  /** Deletes refresh tokens that expired, or were revoked or replaced more than 7 days ago. Returns rows removed. */
  purgeRefreshTokens(): Promise<number>;
}

// ---- Contracts ---------------------------------------------------------------------------------------------------

/** A Contract as one member sees it. `inviteCode` is only meaningful for the Holder (the API decides what to expose). */
export interface ContractView {
  readonly id: string;
  readonly ownerPlayerId: string;
  readonly name: string;
  readonly shiftType: ShiftTypeName;
  readonly maxPlayers: number;
  readonly status: "active" | "fulfilled" | "deleted";
  readonly gridM: number;
  readonly plotCount: number;
  /** Unsigned 64-bit seed as a decimal string. */
  readonly seed: string;
  readonly inviteCode: string | null;
  readonly shinePolished: number;
  readonly walletLumens: number;
  readonly playtimeS: number;
  readonly lastPlayedAt: Date | null;
  /** The viewing player's role. */
  readonly role: ContractRoleName;
}

export interface CreateContractInput {
  readonly id: string;
  readonly ownerPlayerId: string;
  readonly name: string;
  readonly shiftType: "solo" | "private";
  readonly maxPlayers: number;
  readonly gridM: number;
  readonly plotCount: number;
  /** Unsigned 64-bit seed, decimal string. */
  readonly seed: string;
  readonly inviteCode: string | null;
  /** Owned non-deleted Contracts allowed per player (3). */
  readonly ownedQuota: number;
}

export type CreateContractResult =
  | { readonly kind: "created"; readonly contract: ContractView }
  /** The same `id` was already registered by this owner (idempotent `clientContractId`). */
  | { readonly kind: "existing"; readonly contract: ContractView }
  | { readonly kind: "quota_exceeded" }
  /** The id belongs to another player (client-generated id collision or probing). */
  | { readonly kind: "id_taken" }
  | { readonly kind: "invite_code_taken" };

export interface PatchContractInput {
  readonly contractId: string;
  readonly playerId: string;
  readonly name?: string;
  readonly shiftType?: "solo" | "private";
  /** Fresh invite code, used only when the change makes a code-less Contract private. */
  readonly inviteCode?: string;
  /** Room cap used when switching to private. */
  readonly privateMaxPlayers: number;
}

export type PatchContractResult =
  | { readonly kind: "updated"; readonly contract: ContractView }
  | { readonly kind: "not_found" }
  | { readonly kind: "forbidden" }
  | { readonly kind: "invite_code_taken" };

export type JoinByCodeResult =
  | { readonly kind: "joined"; readonly contract: ContractView }
  | { readonly kind: "already_member"; readonly contract: ContractView }
  /** Unknown code, deleted Contract, or the caller is banned (deliberately indistinguishable). */
  | { readonly kind: "not_found" }
  | { readonly kind: "full" };

export type RotateInviteResult =
  | { readonly kind: "rotated"; readonly inviteCode: string }
  | { readonly kind: "not_found" }
  | { readonly kind: "forbidden" }
  | { readonly kind: "not_private" }
  | { readonly kind: "invite_code_taken" };

export interface MemberView {
  readonly playerId: string;
  readonly displayName: string;
  readonly role: ContractRoleName;
  readonly status: "active" | "banned";
}

export type ListMembersResult =
  { readonly kind: "ok"; readonly members: readonly MemberView[] } | { readonly kind: "not_found" };

/** What a join handler needs to decide a seat (membership, ban, Contract state). */
export interface MembershipView {
  readonly contractId: string;
  readonly role: ContractRoleName;
  readonly status: "active" | "banned";
  readonly shiftType: ShiftTypeName;
  readonly maxPlayers: number;
  readonly contractStatus: "active" | "fulfilled" | "deleted";
}

export interface ContractRepository {
  /** Atomic quota check + insert of the Contract and its Holder membership. */
  createContract(input: CreateContractInput): Promise<CreateContractResult>;
  /** Contracts the player belongs to (owned and joined, not banned, not deleted), most recently played first. */
  listContracts(
    playerId: string,
  ): Promise<{ readonly contracts: readonly ContractView[]; readonly ownedCount: number }>;
  /** `null` unless the player is an active member of a non-deleted Contract. */
  getContract(contractId: string, playerId: string): Promise<ContractView | null>;
  getMembership(contractId: string, playerId: string): Promise<MembershipView | null>;
  patchContract(input: PatchContractInput): Promise<PatchContractResult>;
  joinByInviteCode(input: {
    readonly code: string;
    readonly playerId: string;
    readonly maxMembers: number;
  }): Promise<JoinByCodeResult>;
  rotateInviteCode(input: {
    readonly contractId: string;
    readonly playerId: string;
    readonly newCode: string;
  }): Promise<RotateInviteResult>;
  listMembers(contractId: string, requesterId: string): Promise<ListMembersResult>;
}

/** The whole persistence surface the REST API needs. */
export interface MoonRepository extends AccountRepository, ContractRepository {}

/** Grace window for a retried refresh (security.md section 3). */
export const REFRESH_GRACE_S = 60;
/** Minimum spacing of `last_seen_at` writes per player. */
export const TOUCH_INTERVAL_S = 3600;
/** Retention of rotated or revoked refresh-token rows (data-model.md section 5). */
export const REFRESH_RETENTION_DAYS = 7;
