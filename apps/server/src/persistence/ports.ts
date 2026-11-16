// Ports of the room durability layer (M1-W5-T01). The interfaces, the in-memory implementation and the PostgreSQL
// implementation live in packages/db (one conformance suite runs against both, `room-suite.ts`); this module re-exports
// the types and adds the server-side verdict error that maps to REST 409 / 503 and WebSocket close 4108.
//
// Error contract: an operation that cannot reach the database REJECTS (the link counts it as an outage). A CAS that
// finds another owner RESOLVES with `busy` / `lost`; that is a verdict, never an outage. A save that cannot be decoded
// rejects with `RoomSaveCorruptError`, which the store turns into `save_corrupt`.

export {
  RoomSaveCorruptError,
  type AcquireLeaseResult,
  type ArchiveRoomSaveResult,
  type LeaseOwner,
  type RenewLeaseResult,
  type RoomCheckpointInput,
  type RoomCheckpointResult,
  type RoomChunk,
  type RoomSaveRepository,
  type RoomSnapshot,
  type UsageRepository,
} from "@moon-cleanup/db";

/** Why a room could not be created or kept; mapped to REST 409 / 503 by the join preflight and to close 4108. */
export type ContractUnavailableReason = "busy" | "storage_down" | "save_corrupt" | "lease_lost";

export class ContractUnavailableError extends Error {
  readonly reason: ContractUnavailableReason;
  constructor(reason: ContractUnavailableReason, message?: string) {
    super(message ?? `contract unavailable: ${reason}`);
    this.name = "ContractUnavailableError";
    this.reason = reason;
  }
}
