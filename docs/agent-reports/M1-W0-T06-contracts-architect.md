# M1-W0-T06 — Local-first Solo contracts (contracts-architect)

Task / status: done (in-review) / 2026-11-14 / contracts-architect / Sonnet 5.5
Done: `RoomHost` surface + `roomHost` service key; sync vocabulary + normative conflict prompt rule; `save.*` events; `saveSync` UI slice with two request actions; tests. Header generation fields, MCCK package, SoloCheckpoint DTOs, `clientContractId`, four error codes and constants already existed from T01/T02 and were NOT redefined.
Next: lead updates module-boundaries section 2 rows and wave briefs; T05 and the owners below consume.
Evidence (Node 26.13.1, repo root): `tsc -p packages/shared` exit 0; `tsc -p packages/game-data` exit 0; `eslint packages/shared` clean; `prettier --check packages/shared` clean; `vitest run --root packages/shared` 31 files / 445 tests pass. Read-only consumer tsc: apps/server, packages/{protocol,sim,world,db}, tools/bots clean; apps/client has only the pre-existing `render/tier.ts:129` (QualitySettings new groups, T03 follow-up, not mine). No new client errors from this change.

## Added (packages/shared/src)
- `client/room-host.ts` v1 (new): `ROOM_HOST_KINDS`, `ROOM_HOST_STATES`, `ROOM_HOST_CLOSE_REASONS`, `LOCAL_CHECKPOINT_REASONS`, `RoomHostFrame` (pooled buffer + `release()`), `LocalCheckpointMetaSchema` / `LocalCheckpointMeta`, `LocalRoomHost`, `RemoteRoomHost`, `RoomHost`, `RoomHostService`. Imports `ShiftStateView`, `ControlIntent`, `RoomSimEvent`, `SimInputCommand`, `Unsubscribe` from existing files (the sketch's duplicate `ShiftStateView` was not redefined). No DOM/Worker/Colyseus types.
- `client/module.ts` v1: `ServiceTypes.roomHost: RoomHostService`, `SERVICE_KEYS` +`"roomHost"` (additive). `client/index.ts` barrel exports room-host.
- `save/sync-rules.ts` v1 (new, barrel updated): `SAVE_SYNC_STATES`, `SAVE_CONFLICT_CHOICES`, `SAVE_RESTORE_SOURCES`, `SAVE_UPLOAD_FAILURE_KINDS`, `SAVE_STORAGE_WARNINGS` (+ zod enums and types). The file header holds the **normative conflict prompt rule** (6 rules: fast-forward by `baseGeneration`; strict descendant wins silently; divergence sets `saveSync.conflict` with no default choice; `keep_local` / `use_server` mechanics with losing copy to the 7-day backup slot before applying; Open to friends needs an accepted upload; offline is not a conflict).
- `events/save.ts` v1 (new, barrel + catalog v1.1): 9 client-side events `save.checkpointed`, `save.queued`, `save.synced` (= "uploaded"), `save.upload_failed`, `save.conflict`, `save.resolved`, `save.restored`, `save.backup_stored`, `save.storage_warning`; `SaveEventMap`, `SAVE_EVENT_NAMES`; all carry `contractId` + `atMs` (no sim tick). `EventMap` now extends `SaveEventMap`; `EVENT_NAMES` includes them.
- `ui/slices.ts` v1.1 / `ui/store.ts` v1.1: `UiSaveSyncState` (state, localGeneration, serverGeneration, lastSyncedAtMs, pendingSinceMs, conflict {local, server}, backupAvailable, backupExpiresAtMs, error, storageWarning, request), `UiSaveSyncRequest`; slice `saveSync` in `UiState`, `UI_SLICE_NAMES` (26 now), `INITIAL_UI_STATE`; auto `saveSync.set`; special actions `saveSync.resolveConflict {choice}` and `saveSync.restoreBackup`.
- Tests: new `client/room-host.test.ts`, `save/sync-rules.test.ts`, `events/save.test.ts`; extended `ui/store.test.ts`, `client/module.test.ts` (10 keys), `events/gameplay.test.ts` (EVENT_NAMES count includes save events).

## Decisions flagged [R] (differ from or extend the M0 proposal)
1. `LocalRoomHost` gained `suspend(): Promise<LocalCheckpointMeta>` (writes the `handoff` checkpoint, then stops; state `suspended`) so the `suspended` state has an owner; `resume()` leaves both `paused` and `suspended`. `checkpoint()` takes `LocalCheckpointReason`.
2. `RemoteRoomHost.rttMs` is `number | null` (no PONG yet) and it has `shiftType`.
3. `roomHost` is a **facade** (`RoomHostService { current, onChange }`), not the host itself, because the registry rejects re-registration and the host changes (Open to friends, Return to solo, Clock Out).
4. Conflict resolution is a **request-in-slice** design: the store sets `saveSync.request` (only valid in `conflict` / with a backup), and the net module acts and clears it. UI never calls the network. `resolveConflict` has no default by type (`"keep_local" | "use_server"`).
5. Event named `save.synced` (proposal) = brief's "uploaded"; additional events `queued`, `upload_failed`, `resolved`, `backup_stored`, `storage_warning`.
6. Rule 4 order: the losing copy is backed up BEFORE the choice is applied; if the backup/download fails the choice is not applied.

## All-services-registered check
`apps/client/src/app/boot.ts` checks `REQUIRED_SERVICES` (a hand-listed subset in `app/services.ts`), not `SERVICE_KEYS`, so the new `roomHost` key does NOT break boot. No apps/client file edited. T05 should add `"roomHost"` to `REQUIRED_SERVICES` once sim-host (M1-W3-T08) registers it, and narrow `ClientServices` if needed.

## Consumers that must change (next waves)
- `apps/client/src/app` (T05, M1-W3 integrator): `REQUIRED_SERVICES` + `roomHost`; create the `RoomHostService` facade; `ui-store.ts` flush must implement `saveSync.set`, `saveSync.resolveConflict` (apply only when `state === "conflict"`), `saveSync.restoreBackup` (only when `backupAvailable`); `INITIAL_UI_STATE` has 26 slices.
- `apps/client/src/sim-host` (M1-W3-T08): implement `LocalRoomHost` (`checkpoint`, `pause`, `suspend`, `resume`, `close`), emit `save.checkpointed/restored/backup_stored/storage_warning`, pooled `RoomHostFrame`.
- `apps/client/src/net` (M1-W5-T07/T08): `RemoteRoomHost`; the sync module implements the prompt rule from `save/sync-rules.ts`, writes the `saveSync` slice, emits `save.queued/synced/upload_failed/conflict/resolved/restored`, consumes `saveSync.request`.
- `apps/client/src/{gameplay,terrain,ui,debug}`: read `roomHost.current`, re-bind in `onChange`; ui renders the sync indicator and the "Which copy?" modal from `saveSync.conflict` (use `modal` id `confirm`/`destructive` or a new surface; text ids are the ui writer's).
- `apps/server/src/api` + persistence: implement the server half of rules 1 and 4 (fast-forward on `baseGeneration`; `overwrite: true` needs `generation` > newest and `> parentGeneration`, else 422 `generation_not_increasing`).
- Debug event log: `EVENT_NAMES` grew by 9.
- Lead: module-boundaries section 2 rows (client/room-host v1, client/module v1, save/sync-rules v1, events/save v1 + catalog v1.1, ui/slices + store v1.1).

## Notes
- No `PROTOCOL_VERSION` / `SAVE_FORMAT_VERSION` change (all additive; client-only types).
- `SOLO_BACKUP_RETENTION_DAYS` stays in `api/rest`; `save/sync-rules` only references it in comments (avoids a save -> api import cycle).
- Header format rule enforced by `index.test.ts`: line 1 `@contract name vN[.M]`, line 2 `@consumers`; version notes go after the consumers block.
