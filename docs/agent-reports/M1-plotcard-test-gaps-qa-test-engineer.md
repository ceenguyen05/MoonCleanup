# M1 Plot Card test gaps (qa-test-engineer)
Status: done.
- Added apps/client/src/ui/hud/plot-label-parity.test.ts: plotLabel vs IcoPlotGrid chunkOf/localIndexOf on ~2000 seeded ids, edges, both poles, one per diamond. Passes; prettier/eslint/tsc clean.
- Settings `settings-plot-card-mode` row: already asserted in ui/menus/controls.test.tsx (render + hold selection); no gap.
- input-settings.test.ts, plotcard-parcels-clear.test.ts: assertions meaningful (migration, corrupt, hold restore, clear/readopt). Minor: migration test does not assert unrelated user rebinds survive. Not vacuous.
- boot.ts nearSource: closure variable set only via ReadoutLink callback; ParcelFeed reads it lazily, so it follows host changes. No dedicated test (boot is not unit-reachable); ReadoutLink behaviour covered elsewhere. Residual risk: online host must call the link callback with its OnlineReadouts source; I did not verify end-to-end. Not read in full: plot-card-input.test.ts, online-readouts.test.ts (skimmed header only).
- No real defects found.
