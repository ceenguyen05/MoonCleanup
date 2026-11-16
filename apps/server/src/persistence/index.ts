// Public barrel of apps/server/src/persistence (M1-W5-T01, backend-data-engineer): room dust durability, the Contract
// lease, the database outage policy, persisted egress and the SIGTERM room checkpoint. The memory and SQL
// implementations of `RoomSaveRepository` / `UsageRepository` live in packages/db (one shared conformance suite).

export {
  SHUTDOWN_CHECKPOINT_DEADLINE_MS,
  checkpointRooms,
  type CheckpointableRoom,
  type RoomCheckpointReport,
} from "./checkpoint-rooms";
export {
  ContractUnavailableError,
  RoomSaveCorruptError,
  type AcquireLeaseResult,
  type ArchiveRoomSaveResult,
  type ContractUnavailableReason,
  type LeaseOwner,
  type RenewLeaseResult,
  type RoomCheckpointInput,
  type RoomCheckpointResult,
  type RoomChunk,
  type RoomSaveRepository,
  type RoomSnapshot,
  type UsageRepository,
} from "./ports";
export { LEASE_TTL_MS, MemoryRoomSaveRepository, type MemoryRoomRepositoryOptions } from "./memory-room-repository";
export {
  STORAGE_SAVE_TIMEOUT_MS,
  STORAGE_WAKE_TIMEOUT_MS,
  StorageLink,
  StorageTimeoutError,
  type StorageLinkOptions,
  type StorageLinkState,
} from "./storage-link";
export {
  DurableShiftDustStore,
  LEASE_RENEW_INTERVAL_MS,
  type DurableShiftDustStoreOptions,
  type DurableStoreLogger,
} from "./durable-dust-store";
export { USAGE_FLUSH_INTERVAL_MS, UsagePersister, dayKeyUtc, type UsagePersisterOptions } from "./usage-persister";
export { isRoomSaveRepository, isUsageRepository } from "./guards";
