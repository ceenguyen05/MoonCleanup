# M1 UI: Plot Card label, pad bind, clearNearParcels (ui-ux-motion-designer)

## Done
1. Plot label: `apps/client/src/ui/hud/plot-label.ts` derives the naming-bible form "Plot {chunk}-{local}" (e.g. "Plot 10-17") arithmetically from the plot id (same maths as IcoPlotGrid.chunkOf/localIndexOf, STANDARD_GRID_PARAMS; poles = "{poleChunk}-0/1"). `PlotCard.tsx` replaces a purely numeric store label (readout-writer still sends `String(plotId)`) with it; non-numeric labels pass through. No grid built on the main thread; runs only on plot change.
2. clearNearParcels: `ParcelsStore.clearNearParcels()` + `UiModule.clearNearParcels()`; drops count/mask/bearings, keeps outposts, no-op when empty, no allocation on the no-op path.
3. Pad bind: Plot Card is already rebindable on a pad button via Controls (pad capture + persisted table); test added.

## Blocked / needs another owner
- Default pad bind `Pad9: "plotCard"` in `apps/client/src/gameplay/input/bindings.ts` DEFAULT_BINDINGS was DENIED (outside my paths). Gameplay-input owner should add it. Stored tables from before replace defaults, so existing players need Controls > Reset.
- "Hold" option not done (would need input-state change).
- Feed wiring: `parcel-feed.ts` (app) does not yet call `clearNearParcels` when the source goes away.

## Evidence
vitest `src/ui` + round5-wiring: 9 files / 98 tests pass (new `plotcard-parcels-clear.test.ts`). tsc and eslint on `src/ui/hud`: clean.
NOT RUN: full pnpm verify, DPR screenshots, browser-mode tests.
