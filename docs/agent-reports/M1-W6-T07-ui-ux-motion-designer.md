# M1-W6-T07 Save-conflict prompt, sync indicator, backup restore (ui-ux-motion-designer)

Status: implemented (UI only, `apps/client/src/ui/**`); needs app-side wiring items below and a visual capture pass.

## What was built
- `ui/save/SaveConflictPrompt.tsx` (+css): "Which copy?" modal, two copy cards (saved-at, device, playtime, Shine %, wallet), explicit
  `Keep this device` / `Use the server copy` buttons, NO default (focus starts on the heading, nothing preselected, no timeout, "Newer"
  tag is information only). "Decide later" (also Esc / pad Back) hides it without any request; backup-safety note (7 days).
  Busy state, failure line (from `saveSync.error`), 20 s unanswered-choice timeout frees the buttons. Focus returns to the opener.
- `ui/save/SyncIndicator.tsx` (+css): HUD chip bottom-left, display only (no focus, pointer-transparent). One glyph shape per state
  (drive / cloud-check / cloud-up / cloud-off / swap / warning), text always shown; offline and local_only are quiet (aria-live off),
  only conflict/error use the attention tone. Never a blocking screen.
- `ui/save/SaveSettings.tsx` (+css): Settings "Save and sync" section: status sentence, last-synced / waiting-since age, error and
  storage-warning text, "Choose a copy" (reopens a postponed prompt), backup slot with expiry and two-step Restore (focus lands on the
  safe "Keep current progress" button; `Restore now` dispatches `saveSync.restoreBackup`).
- `ui/save/save-sync-model.ts` (pure model), `use-now.ts`, `SyncGlyph.tsx`; strings in `STRINGS.saveSync` (strings.ts).
- Wiring inside ui: `UiRoot` mounts the prompt, `Hud` mounts the chip, `SettingsPanel` adds the section, `ui-local` gets
  `savePromptDismissed` (+setter), `UiModule.navigate` routes pad D-pad/A/B to the prompt first (B = Decide later),
  `dev/preview.ts` gets `?save=conflict|synced|pending|uploading|offline|local_only|error|backup` (add `uihud=1&menu=settings`,
  `&savefail=1`, `&savedevice=`), with a fake request consumer.

## Port shape found (no new port needed)
The app side already exists: `UiSaveSyncState` slice and actions `saveSync.set | saveSync.resolveConflict | saveSync.restoreBackup`
(`packages/shared/src/ui/{slices,store}.ts`), reducer in `app/ui-reducer.ts`, `app/save-sync-wiring.ts` `bindSaveSyncRequests`
(consumes `saveSync.request`) and `boot.ts` ~716-740 (`sink` -> `saveSync.set`). The UI uses these store actions directly (same
"through the store" style as other slices); `UiIntentPort` is unchanged.

## App-side wiring brief (not mine to edit)
1. Gameplay suspension: the prompt sets `menus.modal = { id: "confirm", props: { kind: "save_conflict" } }` while visible and clears
   it when hidden. `app/menu-writer.ts` ~340 uses `menuOpen = menus.open !== null` for `input.setSuspended`; change to
   `menus.open !== null || menus.modal !== null` so WASD/tool input is suspended under the prompt (also pad nav: menu-writer ~358
   calls `ui.navigate` only when `menuOpen`; use the same condition so the D-pad reaches the prompt).
2. Writers must populate the slice: `conflict` non-null iff `state==="conflict"`; `backupAvailable/backupExpiresAtMs` after a choice
   (the Settings restore row depends on them); `error` for failures; `pendingSinceMs`; `lastSyncedAtMs`. On a failed
   resolve (download failed) keep `state:"conflict"` and set `error` so the prompt shows "That did not go through".
3. `shine.total` must be set (HUD writer) for the Shine % row; otherwise it shows "N plots polished".
4. Optionally dispatch `saveSync.set {state:"local_only"}` is the default; nothing else needed for Solo (no network wait).

## Evidence
- `vitest run src/ui`: 10 files / 125 tests passed (new `ui/save/save.test.tsx`: 20 tests: model, SSR markup for prompt/indicator/
  Settings, no-default prompt order, conflict flow through the real store, Decide-later UI-local, source rules, Tab-wrap).
- client `tsc`: no errors in `src/ui`; 4 pre-existing errors in `src/visuals/lighting/sun-rig.ts` (`uniform`, `smoothstep` undefined,
  another writer's file in progress).
- eslint (touched ui files + `src/ui/save`): clean. prettier `--check` on touched files: clean.

## Not done / next steps
1. DPR screenshots (1, 1.25, 1.5, 2, 3) and VT-M1-24/25 captures: use `/src/ui/dev/preview.html?uihud=1&save=conflict` (and
   `&menu=settings&save=backup`, `&save=offline`). Not captured: no browser pass this session.
2. No DOM test environment exists in `apps/client` (no jsdom/happy-dom; Vitest browser mode is not configured for it), so keyboard
   focus is covered by the pure `wrapTab`, markup order and source rules, not by simulated key events. A real focus/Escape test
   needs browser mode or an e2e (Playwright) spec: conflict -> Tab trap -> Esc -> chip says "Choose a copy in Settings" -> Settings
   reopen -> choose.
3. Apply the wiring brief above (menu-writer suspension; slice writers).
4. Review: `code-reviewer`, `visual-qa-reviewer` lenses per the card. Docs: no fonts/icons added (Lucide icons only), so no
   ASSET_LICENSES row.
