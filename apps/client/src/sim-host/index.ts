// Public barrel of apps/client/src/sim-host (ADR-0031 Solo LocalRoom). Consumers use the RoomHost contract
// (@moon-cleanup/shared client/room-host); the worker message envelopes stay private.
export {
  createLocalRoomHost,
  spawnModuleWorker,
  SimHostLockedError,
  type CreateLocalRoomHostOptions,
} from "./create-local-room-host";
export {
  LocalRoomHostImpl,
  type LocalRoomHostOptions,
  type SimDustState,
  type SimHostStats,
  type SimWorkerLike,
} from "./local-room-host";
export {
  SoloDustView,
  type DustLedgerReadView,
  type DustViewSource,
  type DustViewTarget,
  type SoloDustViewOptions,
  type SoloDustViewStats,
} from "./dust-view";
// Local checkpoint store (read by the checkpoint sync on the main thread; M1-W5-T08).
export {
  IdbCheckpointStore,
  MemoryCheckpointStore,
  isQuotaError,
  openCheckpointStore,
  type CheckpointStore,
  type DustChunkWrite,
  type StoredCheckpoint,
  type StoredDustChunk,
} from "./checkpoint-store";
export type { SimHostWorldConfig, SimHostClockMode, SimHostStoreKind, SimWorkerStats } from "./messages";
export { FrameTimeline, type FrameTimelineSample } from "./frame-timeline";
export { FixedStepClock } from "./fixed-step";
