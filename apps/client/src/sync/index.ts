// Public barrel of apps/client/src/sync (M1-W5-T08, netcode-engineer): background sync of Solo checkpoints to the server.
// The composition root builds it once per session:
//   const meta = await openSyncMetaStore("auto", "moon-cleanup-sync", onUnavailable);
//   const sync = createSaveSync({ api: createSaveApi({ baseUrl, auth }), store, install, meta, events, sink, summary, gameDataVersion });
//   await sync.clockIn(contractId, { registration, maxWaitMs: hasLocalCopy ? 3000 : Infinity });
// and wires `save.checkpointed` (emitted by sim-host) plus the UI `saveSync.request` to it. See the report for the
// hook points the sim-host and app must provide (`LocalInstallPort`, `SaveSummaryProvider`).
export { backoffDelayMs } from "./backoff";
export {
  createSaveSync,
  decideHead,
  tickSummaryProvider,
  type ClockInResult,
  type FlushResult,
  type HeadDecision,
  type LocalInstallPort,
  type ResolveResult,
  type SaveSummaryInput,
  type SaveSummaryProvider,
  type SaveSync,
  type SaveSyncOptions,
} from "./save-sync";
export {
  classifyFailure,
  createSaveApi,
  type ApiOutcome,
  type RegisterResult,
  type SaveApi,
  type SaveApiOptions,
  type SyncFailure,
  type TokenSource,
  type UploadResult,
} from "./save-api";
export {
  createConnectivity,
  createInteractionGate,
  type Connectivity,
  type InteractionGate,
  type InteractionGateOptions,
} from "./gate";
export {
  IdbSyncMetaStore,
  MemorySyncMetaStore,
  emptyMeta,
  openSyncMetaStore,
  type BackupRecord,
  type ContractSyncMeta,
  type PendingCheckpoint,
  type SyncMetaStore,
} from "./meta-store";
export {
  assembleCopy,
  copyToStoreShapes,
  readLocalCopy,
  type CheckpointCopy,
  type CopyFailure,
  type InstallDust,
  type LocalStoreReader,
  type StoredCheckpointLike,
  type StoredDustChunkLike,
} from "./copy";
export { decodeMcck, encodeMcck, mcckTrailerCrc, packPages, type McckChunk, type McckPackage } from "./mcck";
export { INFLATE_CAP_BYTES, UPLOAD_PACKAGE_MAX_BYTES } from "./limits";
