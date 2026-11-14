// @contract events/save v1
// @consumers apps/client/src/sim-host (emits save.checkpointed, save.restored, save.backup_stored, save.storage_warning),
//   apps/client/src/net (save sync: emits save.queued, save.synced, save.upload_failed, save.conflict, save.resolved,
//   save.restored), apps/client/src/ui (listens: sync indicator, toasts, "Which copy?" prompt), apps/client/src/audio
//   and apps/client/src/debug (listen); this package's events/catalog
//
// Local-first Solo save events (ADR-0031). CLIENT-side only: never on the wire, never produced by the RoomSim, so they
// carry wall-clock `atMs` (Date.now()) instead of a sim `tick`. They announce what happened; the durable state of the
// sync lives in the `saveSync` UI slice (ui/slices), written by the net module. The conflict prompt rule is normative
// in save/sync-rules. Listeners must not mutate saves in response (the sync module owns every transition).
//
// `save.synced` is the "uploaded" event: the server accepted a generation (`SoloCheckpointAccepted`).

import type { CheckpointRejectReason, SoloCheckpointSummary } from "../api";
import type { LocalCheckpointReason } from "../client";
import type { ContractId } from "../ids";
import type { SaveConflictChoice, SaveRestoreSource, SaveStorageWarning, SaveUploadFailureKind } from "../save";

/** Fields every save event carries. */
export interface SaveEventBase {
  readonly contractId: ContractId;
  /** `Date.now()` at emit time. */
  readonly atMs: number;
}

/** A local checkpoint was committed to IndexedDB (sim-host). */
export interface SaveCheckpointedEvent extends SaveEventBase {
  readonly generation: number;
  readonly parentGeneration: number;
  readonly simTick: number;
  readonly reason: LocalCheckpointReason;
  /** Compressed bytes stored. */
  readonly bytes: number;
}

/** An upload of `generation` was queued (latest per Contract replaces an older queued one). */
export interface SaveQueuedEvent extends SaveEventBase {
  readonly generation: number;
  /** `atMs` of the oldest unsynced checkpoint, the `saveSync.pendingSinceMs` value. */
  readonly pendingSinceMs: number;
}

/** The server accepted `generation`; the device's `baseGeneration` is now `generation`. */
export interface SaveSyncedEvent extends SaveEventBase {
  readonly generation: number;
  /** Server flags (`solo_implausible`, `profile_delta_capped`); informational only, nothing is shown to the player. */
  readonly flags: readonly string[];
}

/** An upload attempt did not complete. `reason` is set when `kind` is `rejected`. */
export interface SaveUploadFailedEvent extends SaveEventBase {
  readonly generation: number;
  readonly kind: SaveUploadFailureKind;
  readonly reason: CheckpointRejectReason | null;
  /** When the sync module will try again (`Date.now()` scale); `null` when it waits for the next checkpoint. */
  readonly retryAtMs: number | null;
}

/** Local and server copies diverged (prompt rule 3). The "Which copy?" prompt opens from `saveSync.conflict`. */
export interface SaveConflictEvent extends SaveEventBase {
  readonly local: SoloCheckpointSummary;
  readonly server: SoloCheckpointSummary;
}

/** The player answered the prompt and the sync module applied the choice (the restore follows as `save.restored`). */
export interface SaveResolvedEvent extends SaveEventBase {
  readonly choice: SaveConflictChoice;
}

/** A state was loaded into the sim host from `source` (`generation` is the generation now current locally). */
export interface SaveRestoredEvent extends SaveEventBase {
  readonly generation: number;
  readonly source: SaveRestoreSource;
}

/** A losing copy was stored in the local backup slot (7-day retention, SOLO_BACKUP_RETENTION_DAYS). */
export interface SaveBackupStoredEvent extends SaveEventBase {
  readonly generation: number;
  readonly expiresAtMs: number;
}

/** IndexedDB / storage trouble the UI should show (quota exceeded, `storage.persist()` denied, storage unavailable). */
export interface SaveStorageWarningEvent extends SaveEventBase {
  readonly warning: SaveStorageWarning;
}

/** Save events by name. */
export interface SaveEventMap {
  "save.checkpointed": SaveCheckpointedEvent;
  "save.queued": SaveQueuedEvent;
  "save.synced": SaveSyncedEvent;
  "save.upload_failed": SaveUploadFailedEvent;
  "save.conflict": SaveConflictEvent;
  "save.resolved": SaveResolvedEvent;
  "save.restored": SaveRestoredEvent;
  "save.backup_stored": SaveBackupStoredEvent;
  "save.storage_warning": SaveStorageWarningEvent;
}

/** Name of a save event. */
export type SaveEventName = keyof SaveEventMap;

/** Every save event name, for runtime use (debug event log). */
export const SAVE_EVENT_NAMES = [
  "save.checkpointed",
  "save.queued",
  "save.synced",
  "save.upload_failed",
  "save.conflict",
  "save.resolved",
  "save.restored",
  "save.backup_stored",
  "save.storage_warning",
] as const satisfies readonly SaveEventName[];
