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

export interface RoomCheckpointInput {
  readonly owner: LeaseOwner;
  readonly simTick: number;
  /** Only the chunks that changed since the previous checkpoint. */
  readonly chunks: readonly RoomChunk[];
  /** Lower-case hex SHA-256 of the world bake (64 chars). Stored in the room header so a restore can refuse another bake. */
  readonly bakeHash?: string;
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
}

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

/** Codec tag of the interim room header blob (the bake hash, 0 or 32 bytes). The MCSV header envelope replaces it. */
export const ROOM_HEADER_CODEC = "room-v0";

export const BAKE_HASH_HEX_RE = /^[0-9a-f]{64}$/;
