# M1-W6-T07 Save-conflict prompt app wiring (wiring-integrator)

Status: wiring items 1, 2 and 3 done in `apps/client/src/app/**`; focused tests, client tsc, eslint and prettier green. No screenshots taken.

## Wiring changes (app/ only)
1. `app/menu-writer.ts` `UiFrameBridge.pump`: `menuOpen = menus.open !== null || menus.modal !== null`. It now drives `input.setSuspended`, the Plot Card close and the pad navigation routing, so WASD/tool input is suspended and the D-pad/A/B reach `ui.navigate` while the save-conflict modal (`menus.modal`, confirm/save_conflict) shows.
2. `app/save-sync-wiring.ts`:
   - `bindSaveSyncRequests` now takes `Pick<SaveSync, "resolveConflict" | "restoreBackup">` (was `handleRequest`) so it sees the `ResolveResult`. It still clears the request once, by identity.
   - On `failed` it dispatches the new `requestFailurePatch`. A held conflict keeps `state: "conflict"` and sets `error`. The error kind is the controller's own failure kind, else `server_error` for download/upload, else `rejected` for local/install/copy failures.
   - A thrown request calls `onProblem` and also sets `error`. `no_backup` clears `backupAvailable` and `backupExpiresAtMs`.
   - The controller's `sink` (boot.ts ~735, unchanged) already publishes `backupAvailable`, `backupExpiresAtMs`, `pendingSinceMs`, `lastSyncedAtMs` and `error` on every state change (`sync/save-sync.ts` `publish` ~309). `stateOf` already returns `conflict` while a conflict is held. The new code only covers the failure paths that return without publishing (install/local/corrupt).
3. `app/hud-writer.ts` `writeShift`: `shine.total` is only taken from `shift.plotCount` when it is finite and > 0; otherwise the last known total is kept (the slice starts at 163,842) and `pct` is computed against it. Before this a 0 total would have made the prompt fall back to "N plots polished".

## Tests added
- `menu-writer.test.ts`: a modal alone suspends input and routes pad `down` then `back` to the UI. Closing it resumes. With neither a menu nor a modal the pad is not routed.
- `save-sync-wiring.test.ts`:
  - Real `createSaveSync` plus `FakeServer` writing the app UI store. A conflict fills `state`, `conflict` and `pendingSinceMs`.
  - A resolve with the server offline keeps `state: "conflict"` and sets `error: {offline}`, with `request` cleared. The retry then gives `synced`, `backupAvailable: true`, `backupExpiresAtMs > now`, `error: null`, `pendingSinceMs: null`.
  - `requestFailurePatch` unit cases (install, download, thrown, restore without a conflict).
  - A thrown request is reported and surfaced; `no_backup` clears the backup flag.
  - The existing request hand-off test was updated to the new `sync` shape.
- `hud-writer.test.ts`: `shine.total` stays a real count across snapshots with `plotCount` 200, 0 and NaN (pct 25, 50, 10).

## Evidence
- `vitest run src/app --testTimeout=30000`: 19 files / 128 tests passed (49.5 s).
- Earlier run of `src/app src/ui` at the default 5 s timeout: 28 of 29 files and 252 of 253 tests passed. The one failure was `readout-writer.test.ts` "MoonRoomSim satisfies SimReadoutSource", a 5 s timeout under 29 parallel workers. It passed alone (7/7) and in the 30 s-timeout rerun. This is load-related and unrelated to my changes. A final `src/ui` rerun after the last edits was not done; the touched `app/` files are not imported by `ui/`.
- client `tsc --noEmit -p .`: no output (0 errors; the lighting `sun-rig.ts` errors are no longer present).
- eslint on the 6 touched files: clean. prettier `--check` on them: clean.

## Not done / next steps
1. Screenshots NOT taken (VT-M1-24/25): no dev server was started, so there is nothing to stop. Next: run the client dev server and capture `/src/ui/dev/preview.html?uihud=1&save=conflict` at DPR 1 and 2, plus `&menu=settings&save=backup`. The preview's fake request consumer is a stand-in; the real conflict flow is covered by the controller test above.
2. UI copy proposal for the ui owner (not mine): `STRINGS.saveSync.errorKinds` has no wording for a local-store or install failure. They currently map to `rejected` ("The server did not accept this copy"), which is inaccurate. Suggest an extra error kind or a UI string for local failures. This needs a shared contract change (`SAVE_UPLOAD_FAILURE_KINDS` in `packages/shared/src/save/sync-rules.ts`), so it goes to contracts-architect.
3. The `readout-writer` timeout under full parallel load is a flaky 5 s limit and belongs to its owner.
4. Another agent edits `online-room.ts` / `remote-room-host` and `ui/online`. I did not touch them. Its `plotCount: grid.count` already feeds the same HUD path.
