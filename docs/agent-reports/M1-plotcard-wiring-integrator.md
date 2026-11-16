# M1 Plot Card wiring (integrator)

Status: done, in review.

Wiring:
1. `apps/client/src/app/input-settings.ts` (new): `applyInputSettings` migrates the stored table with `migrateBindings` and `loadBindingsRev`, re-saves it if it changed, always runs `saveBindingsRev`, and loads the Plot Card mode (toggle default). `choosePlotCardMode` applies and persists the choice.
2. `boot.ts`: calls `applyInputSettings` in place of the old inline bindings load. It passes `plotCardMode` to `UiModule` and the `setPlotCardMode` intent. A failed save is reported to the error boundary. The intent is solo/gameplay only.
3. UI: new `PlotCardActivation` type, `UiIntentPort.setPlotCardMode`, a `plotCardMode` field in the prefs store, and a `UiModuleOptions.plotCardMode` option. Settings > Controls has a segmented "Plot Card: Tap to toggle / Hold to show" row (`settings-plot-card-mode`). Strings are in `ui/strings.ts` (`menus.settings.plotCard*`). `ui/dev/preview.ts` gets a no-op intent.

I did not edit `gameplay/input/bindings.ts`. I consume `migrateBindings` and `BINDINGS_REV` (rev 2, Pad12 tap) as they exist now.

Evidence (Node 22 shell):
- vitest `src/app` + `src/ui/menus`: 20 files, 151 tests pass. This includes the new `app/input-settings.test.ts` (7 tests) and 2 tests in `ui/menus/controls.test.tsx`.
- tsc --noEmit on the client is clean, run after the preview fix.
- eslint is clean on the touched files. prettier is applied to the touched files.
- NOT RUN: pnpm verify, browser checks.

Notes:
- `apps/client/src/app/parcel-feed.ts` (gameplay agent's edit) fails `prettier --check`. I left it alone.
- The "Plot Card" row sits in Controls, but the rebind screen's own pad bind is unchanged.
