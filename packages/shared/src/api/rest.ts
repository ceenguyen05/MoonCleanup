// @contract api/rest v0.3.0
// @consumers apps/server/src/api (health and readiness handlers), apps/server/src/net (mounts HttpRouteDef[] on
//   the transport; admission refusals), apps/client/src/net (wake probe parses HealthResponse), tools/bots
//
// v0.3.0 (additive, contracts bump 1 of M1): `API_ERROR_CODES` gains `VERSION_CONFLICT` (409, stale `PATCH /v1/me`
// `version`; replaces the interim `409 BAD_REQUEST`); new `GetContractResponseSchema` (`ContractSummary` plus the
// Holder-only `inviteCode`) is the body of `GET /v1/contracts/:id` (and may be of `PATCH`). `ContractSummarySchema`
// is unchanged and still parses the new body (unknown keys are stripped). Consumers: apps/server/src/api/{accounts,
// contracts}.ts (answer 409 VERSION_CONFLICT; add `inviteCode` for the Holder of a Private Shift on GET),
// apps/client/src/net (profile retry on VERSION_CONFLICT: refetch `/v1/me`, reapply, resend).
//
// v0.1 (additive, contract wave v1.1): `ReadyResponseSchema` gains optional `schema` and `dbState` (`DB_STATES`),
// which the server's `/readyz` already sends.
// v0.1.1: `ENV_NAMES` drops `staging` (ADR-0029: one production service, main only). Consumers: apps/server/src/ops
// (`ENV_NAME` parse), apps/server/src/api (`HealthResponse.env`); no consumer sent `staging`.
// v0.1.2 (additive): `API_ERROR_CODES` gains `AT_CAPACITY` (503 admission refusal, REST face of close 4105). Consumer:
// apps/server/src/net/admission.ts moves off `ROOM_FULL` + `message: "at_capacity:*"`; `ROOM_FULL` stays valid.
//
// REST DTOs and the transport-neutral route definition. Specification: docs/architecture/system-overview.md
// section 2.1 (route table), data-model.md section 5.1 (storage states), security.md section 3, environments.md
// section 9 (ENV_NAME values), the M0-W0-T01 task card.
//
// - zod schemas describe JSON bodies; the server validates every request body with them and the client validates
//   responses it acts on. Unknown keys are stripped, so a server may add fields without breaking older clients.
// - HttpRouteDef lets API handlers be written and tested without importing Colyseus, uWebSockets or Node types.
//   apps/server/src/net adapts it to the real transport (M0-W1-T04).
// - v0 covered the M0 routes (`/healthz`, `/readyz`) and the shared error body. v0.2.0 (M1-W0-T02, additive) adds the
//   `/v1` DTOs: guest create / refresh / recover / logout, profile, Contracts (list, create, patch, join, join-code,
//   invite rotate, members), the solo checkpoint upload / head / download DTOs of ADR-0031 (`CHECKPOINT_REJECT_REASONS`
//   lives here, not in save/), `API_ROUTES`, `API_ERROR_STATUS` and four new error codes (`SAVE_CONFLICT`,
//   `CHECKPOINT_REJECTED`, `SAVE_VERSION_UNSUPPORTED`, `PAYLOAD_TOO_LARGE`) plus `QUOTA_EXCEEDED`. Consumers:
//   apps/server/src/api + persistence (routes, validation), apps/client/src/net (auth, contracts, save sync).

import { z } from "zod";
import { BuildIdSchema, ProtocolVersionSchema } from "../protocol";
import { ContractIdSchema, PlayerIdSchema } from "../ids";
import { ContractRoleSchema, MAX_PLAYERS_PER_ROOM, MvpShiftTypeSchema, ShiftTypeSchema } from "../sim";
import {
  BakeHashSchema,
  CHECKPOINT_MAX_PARTS,
  CHECKPOINT_PART_MAX_BYTES,
  CHECKPOINT_SESSION_MAX_BYTES,
  SAVE_ORIGIN_KINDS,
} from "../save";

// ---- Transport-neutral routes -------------------------------------------------------------------------------------

/** HTTP methods the API uses. */
export const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;
export type HttpMethod = (typeof HTTP_METHODS)[number];

/** An incoming request as the transport adapter hands it to a handler. */
export interface HttpRequest {
  readonly method: HttpMethod;
  /** Request path without the query string, for example `/v1/contracts/0190.../join`. */
  readonly path: string;
  /** Values of the `:name` segments of the route path. */
  readonly params: Readonly<Record<string, string>>;
  /** Query parameters; a repeated key keeps its first value. */
  readonly query: Readonly<Record<string, string>>;
  /** Request headers with lower-case names. */
  readonly headers: Readonly<Record<string, string>>;
  /** The JSON-parsed body, `undefined` when there is none. Handlers validate it with a zod schema. */
  readonly body: unknown;
  /** Client address as resolved by the adapter (proxy headers applied per security.md section 4). */
  readonly remoteAddress: string;
}

/** What a handler returns. The adapter serialises `body` as JSON and adds CORS and security headers. */
export interface HttpResponse {
  /** HTTP status code. */
  readonly status: number;
  /** JSON-serialisable body; omitted for an empty response. */
  readonly body?: unknown;
  /** Extra response headers (lower-case names). */
  readonly headers?: Readonly<Record<string, string>>;
}

/** One route. `path` uses `:name` segments, for example `/v1/contracts/:id/join`. */
export interface HttpRouteDef {
  readonly method: HttpMethod;
  readonly path: string;
  handle(request: HttpRequest): HttpResponse | Promise<HttpResponse>;
}

// ---- Shared enums -------------------------------------------------------------------------------------------------

/** Values of `ENV_NAME` (environments.md section 9). */
export const ENV_NAMES = ["local", "production"] as const;
export const EnvNameSchema = z.enum(ENV_NAMES);
export type EnvName = z.infer<typeof EnvNameSchema>;

/**
 * Storage state of the database against its 1 GB limit (data-model.md section 4 thresholds): `ok` below 700 MB,
 * `warn` above 700 MB, `full` above 800 MB (new Contracts refused with 507 STORAGE_FULL), `emergency` above 900 MB
 * (emergency compaction). Existing Contracts keep playing and saving in every state.
 */
export const STORAGE_STATES = ["ok", "warn", "full", "emergency"] as const;
export const StorageStateSchema = z.enum(STORAGE_STATES);
export type StorageState = z.infer<typeof StorageStateSchema>;

/**
 * Detailed database probe result reported by `/readyz`: `up`, `powered-off` (free-tier database asleep or paused),
 * `not-configured` (no `DATABASE_URL`, local memory mode) or `error` (probe failed). `db` is `up` only for `up`.
 */
export const DB_STATES = ["up", "powered-off", "not-configured", "error"] as const;
export const DbStateSchema = z.enum(DB_STATES);
export type DbState = z.infer<typeof DbStateSchema>;

// ---- GET /healthz -------------------------------------------------------------------------------------------------

/**
 * Liveness answer of `GET /healthz` (public, CORS `*`, no DB access). The client's wake probe treats any response
 * that does not parse with this schema as "the host is still waking" (system-overview.md section 3).
 */
export const HealthResponseSchema = z.object({
  ok: z.literal(true),
  /** Service name, for telling our JSON apart from a host's placeholder page. */
  service: z.string().min(1).max(64),
  env: EnvNameSchema,
  /** The server's build identifier (`BUILD_VERSION`). */
  build: BuildIdSchema,
  /** The server's PROTOCOL_VERSION; the client compares it before Clock In (netcode.md section 13). */
  protocolVersion: ProtocolVersionSchema,
  /** Seconds since the server process started. */
  uptimeS: z.number().min(0),
});
export type HealthResponse = z.infer<typeof HealthResponseSchema>;

// ---- GET /readyz --------------------------------------------------------------------------------------------------

/** Readiness answer of `GET /readyz` (public, CORS allowlist). Status 200 when `ready`, otherwise 503. */
export const ReadyResponseSchema = z.object({
  /** `db` up, not draining and admitting. */
  ready: z.boolean(),
  /** Database reachability. `down` makes the client show "Contract records offline". */
  db: z.enum(["up", "down"]),
  /** SIGTERM received; no new joins (netcode.md section 9.3). */
  draining: z.boolean(),
  /** Live rooms on this instance. */
  rooms: z.int().min(0),
  /** Room ceiling of this instance (`MAX_ROOMS`). */
  maxRooms: z.int().min(0),
  /** Admission control accepts a new room (netcode.md section 15). */
  admitting: z.boolean(),
  storage: StorageStateSchema,
  /** Active Postgres schema name, `null` when no database is configured. Optional: older servers omit it. */
  schema: z.string().min(1).max(63).nullable().optional(),
  /** Detailed database probe result behind `db`. Optional: older servers omit it. */
  dbState: DbStateSchema.optional(),
});
export type ReadyResponse = z.infer<typeof ReadyResponseSchema>;

// ---- Error body ---------------------------------------------------------------------------------------------------

/** Machine-readable error codes named by the architecture docs (system-overview.md, security.md, netcode.md). */
export const API_ERROR_CODES = [
  "BAD_REQUEST",
  "UNAUTHORIZED",
  "FORBIDDEN",
  "NOT_FOUND",
  "RATE_LIMITED",
  "CONTRACT_BUSY",
  "RETRY_LATER",
  "ROOM_FULL",
  "STORAGE_FULL",
  "TOKEN_SUPERSEDED",
  "INTERNAL",
  /** 503 + `retry-after`: instance at `MAX_ROOMS` or `MAX_CLIENTS` (netcode.md section 15); `message` names which. */
  "AT_CAPACITY",
  /** 409: the server holds a newer or diverged save; body is `SaveConflictBody` (ADR-0031). */
  "SAVE_CONFLICT",
  /** 422: a checkpoint upload failed verification; body is `CheckpointRejectedBody` with a `reason`. */
  "CHECKPOINT_REJECTED",
  /** 409: the upload's `saveFormatVersion` is newer than the server's. */
  "SAVE_VERSION_UNSUPPORTED",
  /** 413: body larger than the route's limit. */
  "PAYLOAD_TOO_LARGE",
  /** 409: the Contract quota (3 owned) is used up. */
  "QUOTA_EXCEEDED",
  /** 409: optimistic-concurrency token stale (`PATCH /v1/me` `version`); the client refetches and retries. */
  "VERSION_CONFLICT",
] as const;
export const ApiErrorCodeSchema = z.enum(API_ERROR_CODES);
export type ApiErrorCode = z.infer<typeof ApiErrorCodeSchema>;

/** Body of every non-2xx JSON response. `message` is for logs and developers, never shown to players verbatim. */
export const ApiErrorBodySchema = z.object({
  error: ApiErrorCodeSchema,
  message: z.string().max(200).optional(),
});
export type ApiErrorBody = z.infer<typeof ApiErrorBodySchema>;

// ==== v0.2.0 (M1-W0-T02): account, profile, Contract, join and solo checkpoint DTOs =================================

const U16 = z.int().min(0).max(0xffff);
const U32 = z.int().min(0).max(0xffff_ffff);
const IsoInstant = z.iso.datetime();

/** HTTP status of each error code (system-overview.md, security.md, netcode.md). `ROOM_FULL` 409 is a v0.2 choice [R]. */
export const API_ERROR_STATUS = {
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  RATE_LIMITED: 429,
  CONTRACT_BUSY: 409,
  RETRY_LATER: 503,
  ROOM_FULL: 409,
  STORAGE_FULL: 507,
  TOKEN_SUPERSEDED: 409,
  INTERNAL: 500,
  AT_CAPACITY: 503,
  SAVE_CONFLICT: 409,
  CHECKPOINT_REJECTED: 422,
  SAVE_VERSION_UNSUPPORTED: 409,
  PAYLOAD_TOO_LARGE: 413,
  QUOTA_EXCEEDED: 409,
  VERSION_CONFLICT: 409,
} as const satisfies Record<ApiErrorCode, number>;

// ---- Route table ---------------------------------------------------------------------------------------------------

/** Every `/v1` route of the MVP (system-overview.md section 2.1, security.md section 3, data-model.md section 3.7c). */
export const API_ROUTES = {
  guestCreate: { method: "POST", path: "/v1/auth/guest" },
  authRefresh: { method: "POST", path: "/v1/auth/refresh" },
  authRecover: { method: "POST", path: "/v1/auth/recover" },
  authLogout: { method: "POST", path: "/v1/auth/logout" },
  profileGet: { method: "GET", path: "/v1/me" },
  profilePatch: { method: "PATCH", path: "/v1/me" },
  contractsList: { method: "GET", path: "/v1/contracts" },
  contractsCreate: { method: "POST", path: "/v1/contracts" },
  contractGet: { method: "GET", path: "/v1/contracts/:id" },
  contractPatch: { method: "PATCH", path: "/v1/contracts/:id" },
  contractJoin: { method: "POST", path: "/v1/contracts/:id/join" },
  contractJoinByCode: { method: "POST", path: "/v1/contracts/join-code" },
  contractInviteRotate: { method: "POST", path: "/v1/contracts/:id/invite-code" },
  contractMembers: { method: "GET", path: "/v1/contracts/:id/members" },
  checkpointUpload: { method: "POST", path: "/v1/contracts/:id/solo-checkpoints" },
  checkpointPart: { method: "PUT", path: "/v1/contracts/:id/solo-checkpoints/:uploadId/parts/:n" },
  checkpointCommit: { method: "POST", path: "/v1/contracts/:id/solo-checkpoints/:uploadId/commit" },
  saveHead: { method: "GET", path: "/v1/contracts/:id/save/head" },
  saveDownload: { method: "GET", path: "/v1/contracts/:id/save" },
} as const satisfies Record<string, { method: HttpMethod; path: string }>;

// ---- Display and Contract names ---------------------------------------------------------------------------------

/** Display name (security.md section 6): NFC, 3 to 20 chars, letters digits space `-` `_` `.`, no edge spaces. */
export const DisplayNameSchema = z
  .string()
  .min(3)
  .max(20)
  .regex(/^[\p{L}\p{N} _.-]+$/u)
  .refine((name) => name === name.normalize("NFC") && name === name.trim(), {
    message: "must be NFC-normalised without leading or trailing spaces",
  });

/** Reserved display names the server rejects case-insensitively; the profanity list is server data (security.md). */
export const RESERVED_DISPLAY_NAMES = ["DOT", "Brightside", "admin", "moderator", "staff"] as const;

/** Contract name: 3 to 32 chars, same character rules as display names. */
export const ContractNameSchema = z
  .string()
  .min(3)
  .max(32)
  .regex(/^[\p{L}\p{N} _.-]+$/u)
  .refine((name) => name === name.normalize("NFC") && name === name.trim(), {
    message: "must be NFC-normalised without leading or trailing spaces",
  });

/** Contracts owned per player (GDD: hold up to 3). */
export const CONTRACT_QUOTA_PER_PLAYER = 3;

/** Invite code: 8 characters Crockford base32 (data-model.md section 3.5). Case-insensitive on input. */
export const InviteCodeSchema = z.string().regex(/^[0-9A-HJKMNP-TV-Za-hjkmnp-tv-z]{8}$/);

/** Recovery code: 16 Crockford base32 characters in 4 groups of 4, dashes optional (security.md section 3). */
export const RecoveryCodeSchema = z
  .string()
  .regex(/^[0-9A-HJKMNP-TV-Za-hjkmnp-tv-z]{4}(?:-?[0-9A-HJKMNP-TV-Za-hjkmnp-tv-z]{4}){3}$/);

// ---- Auth ---------------------------------------------------------------------------------------------------------

/** `POST /v1/auth/guest`. */
export const GuestCreateRequestSchema = z.object({ displayName: DisplayNameSchema.optional() });
export type GuestCreateRequest = z.infer<typeof GuestCreateRequestSchema>;

/** Access and refresh tokens (security.md section 3): access JWT 15 min, refresh 256-bit base64url, rotated on use. */
export const TokenPairSchema = z.object({
  accessToken: z.string().min(16).max(2048),
  /** Seconds until `accessToken` expires (900). */
  accessExpiresInS: z.int().min(1).max(3600),
  refreshToken: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
});
export type TokenPair = z.infer<typeof TokenPairSchema>;

/** Response of guest creation: player, tokens and the one-time recovery code (shown once). */
export const GuestCreateResponseSchema = TokenPairSchema.extend({
  playerId: PlayerIdSchema,
  displayName: DisplayNameSchema,
  recoveryCode: RecoveryCodeSchema,
});
export type GuestCreateResponse = z.infer<typeof GuestCreateResponseSchema>;

/** `POST /v1/auth/refresh`: rotates the refresh token. 409 `TOKEN_SUPERSEDED` when another tab won the race. */
export const RefreshRequestSchema = z.object({ refreshToken: z.string().regex(/^[A-Za-z0-9_-]{43}$/) });
export type RefreshRequest = z.infer<typeof RefreshRequestSchema>;
export const RefreshResponseSchema = TokenPairSchema;
export type RefreshResponse = TokenPair;

/** `POST /v1/auth/recover`: new token family and a new recovery code. */
export const RecoverRequestSchema = z.object({ code: RecoveryCodeSchema });
export type RecoverRequest = z.infer<typeof RecoverRequestSchema>;
export const RecoverResponseSchema = GuestCreateResponseSchema;
export type RecoverResponse = GuestCreateResponse;

/** `POST /v1/auth/logout`: revokes the family of the presented refresh token. */
export const LogoutRequestSchema = RefreshRequestSchema;
export type LogoutRequest = RefreshRequest;

// ---- Profile ------------------------------------------------------------------------------------------------------

/** `GET /v1/me` (data-model.md section 3.4). */
export const ProfileSchema = z.object({
  playerId: PlayerIdSchema,
  displayName: DisplayNameSchema,
  isGuest: z.boolean(),
  tenureLevel: U16,
  tenurePoints: z.int().min(0),
  commendations: z.int().min(0),
  lifetimeLumens: z.number().min(0),
  lifetimePlotsPolished: z.int().min(0),
  cosmeticsOwned: z.array(z.string().max(64)).max(256),
  equippedCosmetics: z.record(z.string().max(32), z.string().max(64)),
  /** Optimistic concurrency token for `PATCH /v1/me`. */
  version: z.int().min(0),
});
export type Profile = z.infer<typeof ProfileSchema>;

/** `PATCH /v1/me`: `version` must equal the stored one, else 409 `VERSION_CONFLICT`. */
export const ProfilePatchRequestSchema = z.object({
  displayName: DisplayNameSchema.optional(),
  equippedCosmetics: z.record(z.string().max(32), z.string().max(64)).optional(),
  version: z.int().min(0),
});
export type ProfilePatchRequest = z.infer<typeof ProfilePatchRequestSchema>;

// ---- Contracts ----------------------------------------------------------------------------------------------------

/** A Contract as listed to one member (data-model.md section 3.5 mirrors; `role` is the caller's role). */
export const ContractSummarySchema = z.object({
  id: ContractIdSchema,
  name: ContractNameSchema,
  shiftType: ShiftTypeSchema,
  role: ContractRoleSchema,
  maxPlayers: z.int().min(1).max(MAX_PLAYERS_PER_ROOM),
  status: z.enum(["active", "fulfilled", "deleted"]),
  gridM: z.int().min(1).max(512),
  plotCount: z.int().min(1),
  shinePolished: z.int().min(0),
  walletLumens: z.number().min(0),
  playtimeS: z.int().min(0),
  lastPlayedAt: IsoInstant.nullable(),
  /** Players connected to the live room, 0 when none. */
  online: z.int().min(0).max(MAX_PLAYERS_PER_ROOM),
});
export type ContractSummary = z.infer<typeof ContractSummarySchema>;

/**
 * `GET /v1/contracts/:id` (member): the summary plus the current invite code. `inviteCode` is present (non-null) only
 * for the Holder of a Private Shift; Staff, Solo Contracts and older servers omit it or send `null`.
 */
export const GetContractResponseSchema = ContractSummarySchema.extend({
  inviteCode: InviteCodeSchema.nullable().optional(),
});
export type GetContractResponse = z.infer<typeof GetContractResponseSchema>;

/** `GET /v1/contracts`: the caller's Contracts (owned and joined) and the owned-quota usage. */
export const ListContractsResponseSchema = z.object({
  contracts: z.array(ContractSummarySchema).max(64),
  ownedCount: z.int().min(0),
  ownedQuota: z.literal(CONTRACT_QUOTA_PER_PLAYER),
});
export type ListContractsResponse = z.infer<typeof ListContractsResponseSchema>;

/** Seed of a Contract: unsigned 64-bit as a decimal string (JSON has no bigint). */
export const ContractSeedSchema = z.string().regex(/^(?:0|[1-9][0-9]{0,19})$/);

/**
 * `POST /v1/contracts`. `clientContractId` (UUIDv7) and `seed` register a Contract that was first created locally
 * (ADR-0031); the call is idempotent by `clientContractId`. 409 `QUOTA_EXCEEDED` beyond 3 owned Contracts.
 */
export const CreateContractRequestSchema = z.object({
  name: ContractNameSchema,
  shiftType: MvpShiftTypeSchema.default("solo"),
  clientContractId: ContractIdSchema.optional(),
  seed: ContractSeedSchema.optional(),
});
export type CreateContractRequest = z.input<typeof CreateContractRequestSchema>;
export const CreateContractResponseSchema = z.object({
  contract: ContractSummarySchema,
  /** Invite code of a Private Shift; `null` for Solo. */
  inviteCode: InviteCodeSchema.nullable(),
});
export type CreateContractResponse = z.infer<typeof CreateContractResponseSchema>;

/** `PATCH /v1/contracts/:id` (Holder): rename or change the shift type (applies to the live room). */
export const ContractPatchRequestSchema = z
  .object({ name: ContractNameSchema.optional(), shiftType: MvpShiftTypeSchema.optional() })
  .refine((body) => body.name !== undefined || body.shiftType !== undefined, { message: "nothing to change" });
export type ContractPatchRequest = z.infer<typeof ContractPatchRequestSchema>;

/** `POST /v1/contracts/join-code`: join a Private Shift as Staff by invite code. */
export const JoinCodeRequestSchema = z.object({ code: InviteCodeSchema });
export type JoinCodeRequest = z.infer<typeof JoinCodeRequestSchema>;
export const JoinCodeResponseSchema = z.object({ contract: ContractSummarySchema });
export type JoinCodeResponse = z.infer<typeof JoinCodeResponseSchema>;

/** `POST /v1/contracts/:id/invite-code` (Holder): rotates the invite code. */
export const InviteRotateResponseSchema = z.object({ inviteCode: InviteCodeSchema });
export type InviteRotateResponse = z.infer<typeof InviteRotateResponseSchema>;

/** One member of a Contract (data-model.md section 3.6). MVP roles are `holder` and `staff`. */
export const ContractMemberSchema = z.object({
  playerId: PlayerIdSchema,
  displayName: DisplayNameSchema,
  role: ContractRoleSchema,
  status: z.enum(["active", "banned"]),
  online: z.boolean(),
});
export type ContractMember = z.infer<typeof ContractMemberSchema>;
export const ListMembersResponseSchema = z.object({ members: z.array(ContractMemberSchema).max(64) });
export type ListMembersResponse = z.infer<typeof ListMembersResponseSchema>;

/**
 * Seat reservation as the Colyseus 0.18 server returns it for `consumeSeatReservation`. Opaque to our code: only
 * the fields the client reads are required, the rest passes through.
 */
export const SeatReservationSchema = z.looseObject({
  name: z.string().min(1).max(64),
  sessionId: z.string().min(1).max(64),
  roomId: z.string().min(1).max(64),
  processId: z.string().min(1).max(64),
});
export type SeatReservation = z.infer<typeof SeatReservationSchema>;

/** `POST /v1/contracts/:id/join`: seat reservation plus the 30 s single-use join ticket (security.md section 3). */
export const JoinContractResponseSchema = z.object({
  reservation: SeatReservationSchema,
  joinTicket: z.string().min(16).max(512),
  role: ContractRoleSchema,
});
export type JoinContractResponse = z.infer<typeof JoinContractResponseSchema>;

// ---- Solo checkpoints (ADR-0031, data-model.md section 3.7c) ----------------------------------------------------

/** Solo upload cadence constants (ADR-0031). */
export const SOLO_UPLOAD_MIN_INTERVAL_S = 20;
export const SOLO_UPLOADS_PER_HOUR_MAX = 60;
export const SOLO_UPLOAD_INTERVAL_S = 120;
export const SOLO_LOCAL_CHECKPOINT_INTERVAL_S = 10;
/** The local backup of a copy that lost a conflict stays restorable for this long. */
export const SOLO_BACKUP_RETENTION_DAYS = 7;

/** Why the server refuses a checkpoint upload (422 `CHECKPOINT_REJECTED`, `reason` in the body). */
export const CHECKPOINT_REJECT_REASONS = [
  "bad_crc",
  "bad_envelope",
  "format_too_new",
  "game_data_unknown",
  "bake_mismatch",
  "size_limit",
  "chunk_id_out_of_range",
  "generation_not_increasing",
  "contract_not_solo",
  "not_holder",
] as const;
export const CheckpointRejectReasonSchema = z.enum(CHECKPOINT_REJECT_REASONS);
export type CheckpointRejectReason = (typeof CHECKPOINT_REJECT_REASONS)[number];

/** Body of 422 `CHECKPOINT_REJECTED`. */
export const CheckpointRejectedBodySchema = z.object({
  error: z.literal("CHECKPOINT_REJECTED"),
  reason: CheckpointRejectReasonSchema,
  message: z.string().max(200).optional(),
});
export type CheckpointRejectedBody = z.infer<typeof CheckpointRejectedBodySchema>;

/** Summary of one checkpoint copy (local or server): what the "Which copy?" prompt and the head route show. */
export const SoloCheckpointSummarySchema = z.object({
  generation: z.int().min(0),
  parentGeneration: z.int().min(0),
  originKind: z.enum(SAVE_ORIGIN_KINDS),
  savedAt: IsoInstant,
  simTick: z.int().min(0),
  playtimeS: z.int().min(0),
  shinePolished: z.int().min(0),
  walletLumens: z.number().min(0),
  saveFormatVersion: U16,
  gameDataVersion: z.string().min(1).max(32),
  deviceLabel: z.string().max(40).optional(),
});
export type SoloCheckpointSummary = z.infer<typeof SoloCheckpointSummarySchema>;

/** Bounded per-upload profile delta (data-model.md section 3.7c step 7); the server caps it from game-data. */
export const ProfileDeltaSchema = z.object({
  playtimeS: z.int().min(0),
  tenurePoints: z.int().min(0),
  commendations: z.int().min(0),
  achievementIds: z.array(z.string().max(64)).max(32),
});
export type ProfileDelta = z.infer<typeof ProfileDeltaSchema>;

/**
 * Metadata of `POST /v1/contracts/:id/solo-checkpoints` (multipart: this JSON plus the octet-stream MCCK package).
 * One request when the package is at most CHECKPOINT_PART_MAX_BYTES; otherwise `partCount > 1` returns an upload
 * session and the parts follow (`PUT .../parts/:n`, then `POST .../commit`).
 */
export const SoloCheckpointBeginRequestSchema = z.object({
  contractId: ContractIdSchema,
  generation: z.int().min(1),
  parentGeneration: z.int().min(0),
  baseGeneration: z.int().min(0),
  saveFormatVersion: U16,
  gameDataVersion: z.string().min(1).max(32),
  bakeHash: BakeHashSchema,
  totalBytes: z.int().min(1).max(CHECKPOINT_SESSION_MAX_BYTES),
  partCount: z.int().min(1).max(CHECKPOINT_MAX_PARTS),
  packageCrc32: U32,
  summary: SoloCheckpointSummarySchema,
  profileDelta: ProfileDeltaSchema,
  /** Per-browser install id (random, no personal data), `saved_by = solo:<deviceId>`. */
  deviceId: z.uuid(),
  /** Explicit overwrite after the "Keep this device" choice. */
  overwrite: z.boolean().default(false),
});
export type SoloCheckpointBeginRequest = z.input<typeof SoloCheckpointBeginRequestSchema>;

/** Response when `partCount > 1`: the upload session. Sessions live in server memory, TTL `expiresInS`. */
export const SoloCheckpointBeginResponseSchema = z.object({
  uploadId: z.uuid(),
  partMaxBytes: z.int().min(1).max(CHECKPOINT_PART_MAX_BYTES),
  expiresInS: z.int().min(1).max(600),
});
export type SoloCheckpointBeginResponse = z.infer<typeof SoloCheckpointBeginResponseSchema>;

/** Plausibility flags the server may raise on an accepted upload. */
export const SOLO_CHECKPOINT_FLAGS = ["solo_implausible", "profile_delta_capped"] as const;

/** 200 answer of an accepted upload or commit. The client sets `baseGeneration = acceptedGeneration`. */
export const SoloCheckpointAcceptedSchema = z.object({
  acceptedGeneration: z.int().min(1),
  savedAt: IsoInstant,
  flags: z.array(z.enum(SOLO_CHECKPOINT_FLAGS)),
});
export type SoloCheckpointAccepted = z.infer<typeof SoloCheckpointAcceptedSchema>;

/** 409 `SAVE_CONFLICT` body: the server copy's summary (no write happened). */
export const SaveConflictBodySchema = z.object({
  error: z.literal("SAVE_CONFLICT"),
  server: SoloCheckpointSummarySchema,
});
export type SaveConflictBody = z.infer<typeof SaveConflictBodySchema>;

/** `GET /v1/contracts/:id/save/head`: summary of the newest server copy. */
export const SaveHeadResponseSchema = SoloCheckpointSummarySchema;
export type SaveHeadResponse = SoloCheckpointSummary;

/** `GET /v1/contracts/:id/save?page=n`: octet-stream MCCK pages of at most CHECKPOINT_PART_MAX_BYTES. */
export const SAVE_DOWNLOAD_PAGES_HEADER = "x-save-pages";
export const SaveDownloadQuerySchema = z.object({
  page: z.coerce
    .number()
    .int()
    .min(0)
    .max(CHECKPOINT_MAX_PARTS - 1)
    .default(0),
});
export type SaveDownloadQuery = z.input<typeof SaveDownloadQuerySchema>;
