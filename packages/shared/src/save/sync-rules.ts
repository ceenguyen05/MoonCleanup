// @contract save/sync-rules v1
// @consumers apps/client/src/net (save sync: uploads, conflict detection, restore), apps/client/src/sim-host (local
//   checkpoints, backup slot), apps/client/src/ui (sync indicator, "Which copy?" prompt), apps/client/src/app,
//   apps/server/src/api (409 SAVE_CONFLICT decision); this package's ui/slices and events/save
//
// Save-sync vocabulary and the NORMATIVE conflict prompt rule of ADR-0031 (data-model.md section 3.7c). Constants and
// zod schemas only: the decision itself is a few comparisons that the client sync module and the server route each
// implement against the text below, and both are tested against it.
//
// ---- Generations -------------------------------------------------------------------------------------------------
// Every checkpoint carries `generation` and `parentGeneration` (save/format SaveHeader; generation > parentGeneration).
// A host writes `generation = newest + 1` on top of the copy it holds. The server keeps ONE newest generation per
// Contract. A client keeps `baseGeneration` = the last server generation this device saw (from an accepted upload, a
// head response or a download); 0 for a Contract the server has never seen.
//
// ---- Conflict prompt rule (normative) ----------------------------------------------------------------------------
// 1. Fast-forward. The server accepts an upload only if the Contract's newest server generation equals the upload's
//    `baseGeneration`. Otherwise it answers 409 `SAVE_CONFLICT` with `server` (the newest summary) and writes nothing.
//    An upload with `overwrite: true` skips this test (rule 4) but still needs `generation` greater than the newest
//    server generation and `generation > parentGeneration`; otherwise 422 `CHECKPOINT_REJECTED`
//    (`generation_not_increasing`).
// 2. A copy that strictly descends from the other wins silently, and nothing is shown:
//    - local descends from server (`baseGeneration === server.generation`): upload local (rule 1 accepts it);
//    - server descends from local (`server.generation > baseGeneration` AND this device wrote nothing since
//      `baseGeneration`, i.e. its newest local generation equals `baseGeneration` and no checkpoint is pending):
//      download the server copy and load it.
// 3. A real divergence (`server.generation !== baseGeneration` AND this device wrote after `baseGeneration`, or the
//    server answered 409 to a normal upload) sets `saveSync.state = "conflict"` and `saveSync.conflict = { local, server }`.
//    The prompt "Which copy?" shows, for each copy: playtime, Shine %, wallet, saved-at and device label. There is NO
//    default choice and no timeout: nothing is overwritten until the player picks. Uploads pause while in conflict;
//    local checkpoints continue (they only extend the local copy, which the prompt re-reads).
// 4. The two choices (SAVE_CONFLICT_CHOICES):
//    - `keep_local` ("Keep this device"): re-upload the newest local checkpoint with `overwrite: true`,
//      `baseGeneration` = the server generation, `generation` = max(local, server) + 1 and the local
//      `parentGeneration`. BEFORE uploading, the server copy is downloaded into the backup slot (if that download
//      fails the choice is not applied and the prompt stays).
//    - `use_server` ("Use the server copy"): the local copy goes to the backup slot, then the server copy is downloaded
//      (save/checkpoint-package pages) and loaded, and `baseGeneration` = its generation.
//    So in both cases the LOSING copy is in the local backup slot (IndexedDB, one slot per Contract) for
//    SOLO_BACKUP_RETENTION_DAYS (7) days. `saveSync.backupAvailable` is true while that slot holds a copy;
//    `restoreBackup` loads it as a NEW generation (max(local, server) + 1) on top of the current state, then rule 3
//    applies again if that diverges from the server.
// 5. Open to friends requires an ACCEPTED upload (no overwrite, no conflict): a conflict at that moment blocks the
//    handoff and shows the same prompt.
// 6. Offline or server asleep is not a conflict: state `offline`, checkpoints queue locally (latest per Contract only),
//    and the first successful head or upload decides between rules 1 to 3.
//
// Adding a state, choice or reason is not breaking; renaming or removing one is.

import { z } from "zod";

/**
 * What the sync indicator and the prompt show. `local_only`: no server copy yet (new Solo Contract, guest not
 * registered, or the player has not synced). `synced`: newest local generation is the server's. `pending`: local is
 * ahead and an upload is queued. `uploading`: request in flight. `offline`: server unreachable or asleep, queue held.
 * `conflict`: rule 3 of the prompt rule. `error`: the server rejected the upload or storage failed; `saveSync.error`
 * says why and uploads retry only on the next checkpoint or an explicit sync.
 */
export const SAVE_SYNC_STATES = [
  "local_only",
  "synced",
  "pending",
  "uploading",
  "offline",
  "conflict",
  "error",
] as const;
export const SaveSyncStateSchema = z.enum(SAVE_SYNC_STATES);
export type SaveSyncState = (typeof SAVE_SYNC_STATES)[number];

/** The two answers of the "Which copy?" prompt. There is no third, default or "later" value. */
export const SAVE_CONFLICT_CHOICES = ["keep_local", "use_server"] as const;
export const SaveConflictChoiceSchema = z.enum(SAVE_CONFLICT_CHOICES);
export type SaveConflictChoice = (typeof SAVE_CONFLICT_CHOICES)[number];

/** Where a restored state came from. `local`: newest local checkpoint (crash reboot, page reload). */
export const SAVE_RESTORE_SOURCES = ["local", "server", "backup"] as const;
export const SaveRestoreSourceSchema = z.enum(SAVE_RESTORE_SOURCES);
export type SaveRestoreSource = (typeof SAVE_RESTORE_SOURCES)[number];

/** Why an upload did not complete (`save.upload_failed`; `rejected` carries a CheckpointRejectReason). */
export const SAVE_UPLOAD_FAILURE_KINDS = [
  "offline",
  "rate_limited",
  "rejected",
  "version_unsupported",
  "too_large",
  "server_error",
] as const;
export const SaveUploadFailureKindSchema = z.enum(SAVE_UPLOAD_FAILURE_KINDS);
export type SaveUploadFailureKind = (typeof SAVE_UPLOAD_FAILURE_KINDS)[number];

/** Local storage problems the UI warns about (ADR-0031 "Storage eviction"). */
export const SAVE_STORAGE_WARNINGS = ["quota", "persist_denied", "unavailable"] as const;
export const SaveStorageWarningSchema = z.enum(SAVE_STORAGE_WARNINGS);
export type SaveStorageWarning = (typeof SAVE_STORAGE_WARNINGS)[number];
