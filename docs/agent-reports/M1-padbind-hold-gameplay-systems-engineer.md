M1 Plot Card pad bind + hold option + parcel clear / in-review / 2026-11-15 (rev 2, docs win) / gameplay-systems-engineer / Opus 5.5 medium

Done:
- Pad defaults follow game-feel-and-controls 6.4 b12 and 4.2:
  - **Pad12 (D-pad Up)**: tap toggles the Plot Card, and a hold of `holdThresholdS` (0.30 s, `DEFAULT_HOLD_THRESHOLD_S`) toggles camera 1P/3P. A tap is resolved on release and a hold during `advance`.
  - **Pad9 (Start)**: left unbound, reserved for Pause.
  - lampCycle moves to Pad15 (D-pad Right, per the spec).
  - Interim: seatSwitch moves to Pad8 (View) until Survey Globe exists. Pad13 ballast and Pad14 pickup are unchanged (they also differ from the spec).
  - A menu, blur or press inside a menu never leaves a tap or hold pending. Hold mode adds no allocation.
- Migration: `BINDINGS_REV = 2` and `migrateBindings(stored, storedRev)`. It rewrites Pad8 cameraMode→seatSwitch, Pad12 lampCycle→plotCard and Pad15 seatSwitch→lampCycle as one group. The group applies only if all three entries still have their old defaults and plotCard has no pad binding. It runs once per stored rev (`mc.controls.bindingsRev`).
- Keyboard C toggle/hold setting: `InputState.setPlotCardMode` (default "toggle"), with `plot-card-mode.ts` helpers (`mc.settings.plotCardMode`).
- ParcelFeed calls `clearNearParcels` once when its source goes away.

Next (integrator): wire the boot step (`migrateBindings` + `saveBindingsRev`; `setPlotCardMode(loadPlotCardMode(...) ?? "toggle")`) and add the Settings row. Optionally map Relaxed Timing to `holdThresholdS = 0.5`. Also update `ui/dev/preview.ts` DEFAULT table to the new pad layout.

Files: apps/client/src/gameplay/input/{bindings.ts,input-state.ts,plot-card-mode.ts,plot-card-input.test.ts}, apps/client/src/gameplay/index.ts (exports), apps/client/src/app/parcel-feed.ts.

Evidence (Node 26):
- vitest src/gameplay + src/app + src/ui: 31 files, 256 tests pass.
- packages/sim golden: pass. The sim is untouched and the input wire is unchanged.
- eslint on the changed files: clean.
- tsc: one error, `src/ui/dev/preview.ts:127` is missing `setPlotCardMode` on `UiIntentPort`. It comes from concurrent integrator/UI work, not these files.
- NOT RUN: pnpm verify, browser checks.

Blockers: none for this scope.

Commit suggestion: feat(client): spec D-pad Up Plot Card tap / camera hold, one-time pad-layout migration, Plot Card hold option, clear near parcels on source loss

## Follow-up: M1 batch review findings 1-4 (2026-11-15)
- (1) `clear()` sets `padPlotSuppressed` when a pad button bound to plotCard was down; that button is ignored until seen released (no second camera toggle / stray flip after blur).
- (2) Pad hold timer clamps each frame's dt to `MAX_HOLD_FRAME_DT_S` = 0.1 s, so one hitch cannot turn a tap into a hold.
- (3) Hold mode: a pad tap while C holds the card open closes it and consumes the hold; releasing C no longer reopens it.
- (4) Hold mode: a wheel notch bound to plotCard is one toggle flip (a notch has no duration). 4 tests in plot-card-input.test.ts; vitest gameplay/input 22/22, tsc, eslint, prettier clean (Node 26.13.1).
