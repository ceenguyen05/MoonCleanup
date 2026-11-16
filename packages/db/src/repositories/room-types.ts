// Ports of the room durability layer (M1-W5-T01). Defined here so the memory and the PostgreSQL implementation share one
// contract and one conformance suite (room-suite.ts); apps/server/src/persistence re-exports these types and adds the
// lease/outage policy on top.
//
// Error contract: an operation that cannot reach the database REJECTS (the server's link counts it as an outage). A CAS
// that finds another owner RESOLVES with `busy` / `lost` / `lease_lost`; that is a verdict, never an outage. A save that
// cannot be decoded rejects with `RoomSaveCorruptError` (refuse the room, 4108; the database itself is fine).

/** Identity of the room that owns a Contract lease: CAS key of data-model 3.5 (`lease_instance`, `lease_room_id`). */
export interface LeaseOwner {
  readonly contractId: string;
  /** `<ENV_NAME>:<BUILD_VERSION>:<boot uuid>` */
  readonly instance: string;
  readonly roomId: string;
}

/** One dust chunk of a room checkpoint: the raw chunk payload of WDS section 6 (the repository deflates it). */
export interface RoomChunk {
  readonly chunkId: number;
  readonly payload: Uint8Array;
}

/**
 * The sim's META save section (`MoonRoomSim.captureCheckpoint().meta` and its `metaVersion`), stored opaquely in a
 * "room-v3" header. The server validates it through `MoonRoomSim.restoreCheckpoint` (untrusted input).
 */
export interface RoomSimMeta {
  /** Section version (`SIM_CHECKPOINT_META_VERSION` of the writing build), 1..65535. */
  readonly version: number;
  /** Section bytes, 1..ROOM_SIM_META_MAX_BYTES. */
  readonly bytes: Uint8Array;
}

/** Codec bound on a stored sim META section: the sim's own bound (`SIM_CHECKPOINT_META_MAX_BYTES`, checked in tests). */
export const ROOM_SIM_META_MAX_BYTES = 8192;

/** Shared room state persisted in the room header blob next to the bake hash (interim "room-v3" header). */
export interface RoomHeaderState {
  /** Shared Shift wallet in lumens (finite, in [0, ROOM_WALLET_MAX_LM]). */
  readonly walletLm: number;
  /**
   * Collected Near Parcels, bit k = parcel k (integer 0..255). Undefined only when read from a legacy "room-v1" header,
   * which never stored it (the server then skips that wallet, review B1).
   */
  readonly nearParcelsMask?: number;
  /**
   * The sim META section (tools, suit gear, board levels, Roosts bought; review N1). Only with `nearParcelsMask`.
   * Undefined when read from a "room-v2" or older header.
   */
  readonly simMeta?: RoomSimMeta;
}

/** Codec bound on a stored wallet (review N4): the same cap as the sim checkpoint (checkpoint.ts, MAX_SAFE_INTEGER). */
export const ROOM_WALLET_MAX_LM = Number.MAX_SAFE_INTEGER;

export interface RoomCheckpointInput {
  readonly owner: LeaseOwner;
  readonly simTick: number;
  /** Only the chunks that changed since the previous checkpoint. May be empty (a header-only checkpoint). */
  readonly chunks: readonly RoomChunk[];
  /** Lower-case hex SHA-256 of the world bake (64 chars). Stored in the room header so a restore can refuse another bake. */
  readonly bakeHash?: string;
  /** Room state for the header blob; omitted = the header records none. */
  readonly state?: RoomHeaderState;
}

export type RoomCheckpointResult =
  | { readonly kind: "saved"; readonly generation: number; readonly storedBytes: number }
  /** The lease CAS found another owner: nothing was written (the room must close with 4108). */
  | { readonly kind: "lease_lost" };

/** What a room restores from: the chosen version of every non-pristine chunk (data-model 3.7b load rule). */
export interface RoomSnapshot {
  readonly generation: number;
  readonly simTick: number;
  readonly chunks: readonly RoomChunk[];
  /** `bakeHash` of the checkpoint that wrote the newest header, or `null` when it did not record one. */
  readonly bakeHash: string | null;
  /** Room state of the newest header, or `null` when it recorded none (old "room-v0" header or none passed). */
  readonly state: RoomHeaderState | null;
  /**
   * Codec of the newest header when this build cannot read it (a newer server wrote it, then a rollback): the chunks
   * still load, the header state is dropped. `null` normally. Optional for older implementations; the server logs it.
   */
  readonly ignoredHeaderCodec?: string | null;
}

/** Outcome of `archiveRoomSave`. */
export type ArchiveRoomSaveResult =
  /** The live rows moved to the archive tables (`archiveId`); the Contract now loads as never saved. */
  | { readonly kind: "archived"; readonly archiveId: string; readonly generation: number; readonly chunkRows: number }
  /** The Contract had no saved room rows: nothing to archive. */
  | { readonly kind: "nothing" }
  /** The lease guard found another owner: nothing was moved (the room must close with 4108). */
  | { readonly kind: "lease_lost" };

export type AcquireLeaseResult = "acquired" | "busy";
export type RenewLeaseResult = "renewed" | "lost";

export interface RoomSaveRepository {
  /** Lease compare-and-set with the DATABASE clock (35 s expiry). `busy` -> 409 CONTRACT_BUSY. */
  acquireLease(owner: LeaseOwner): Promise<AcquireLeaseResult>;
  /** Same statement keyed by (instance, room); `lost` when another instance or room holds it now. */
  renewLease(owner: LeaseOwner): Promise<RenewLeaseResult>;
  /** Clears the lease `WHERE lease_room_id = room`; a no-op for a lease someone else holds. */
  releaseLease(owner: LeaseOwner): Promise<void>;
  /** `null` when the Contract was never saved (pristine moon). Rejects with RoomSaveCorruptError when it cannot be decoded. */
  loadRoomSave(contractId: string): Promise<RoomSnapshot | null>;
  /** One transaction: lease guard, header slot, chunk version rows, Contract mirrors. */
  commitRoomCheckpoint(input: RoomCheckpointInput): Promise<RoomCheckpointResult>;
  /**
   * Moves every live save row of the Contract (header slots and dust chunks) into the archive tables, verbatim, in ONE
   * transaction guarded by the same lease check as a checkpoint. Nothing is deleted: the old world stays recoverable
   * under the returned `archiveId`. After it, `loadRoomSave` answers `null` (fresh room). `reason` is a short tag such
   * as `bake_mismatch`.
   */
  archiveRoomSave(owner: LeaseOwner, reason: string): Promise<ArchiveRoomSaveResult>;
}

/** `ops_usage_daily` upsert surface (data-model 3.12); one row per UTC day. */
export interface UsageRepository {
  /** Adds `bytesOut` to the row of `day` (`YYYY-MM-DD`), creating it. Never overwrites with a smaller value. */
  addEgress(day: string, bytesOut: number): Promise<void>;
  /** Sum of `bytes_out` over the days of `month` (`YYYY-MM`). */
  monthEgress(month: string): Promise<number>;
}

/** The save rows exist but cannot be decoded (bad CRC, bad inflate, no valid version of a chunk). */
export class RoomSaveCorruptError extends Error {
  readonly code = "SAVE_CORRUPT";
  constructor(message: string) {
    super(message);
    this.name = "RoomSaveCorruptError";
  }
}

/** Lease lifetime written by acquire and renew (data-model 3.5). */
export const LEASE_TTL_MS = 35_000;

/** Codec tag of the first interim room header blob (the bake hash, 0 or 32 bytes). Read only. */
export const ROOM_HEADER_CODEC_V0 = "room-v0";

/** Codec tag of the second interim header (flags + bake hash + wallet, no parcel mask). Read only. */
export const ROOM_HEADER_CODEC_V1 = "room-v1";

/** Codec tag of the third interim header (flags + bake hash + wallet + Near Parcel mask). Read only. */
export const ROOM_HEADER_CODEC_V2 = "room-v2";

/** Codec tag written now: the v2 fields + the sim META section (room-header.ts). MCSV replaces it. */
export const ROOM_HEADER_CODEC = "room-v3";

export const BAKE_HASH_HEX_RE = /^[0-9a-f]{64}$/;
