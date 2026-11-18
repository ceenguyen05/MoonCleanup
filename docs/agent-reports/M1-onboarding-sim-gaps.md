# M1 onboarding sim gaps (2026-11-17)

Closes "Changes needed" item 2 of M1-W7-T03-T06.md at sim/unit level. No browser/GPU, no git.

## Done
- (a) Landing Apron position: `MoonRoomSim` derives `world.landingApron.plotsPerOutpost` plots of ring 2 around the home outpost pad plot (spaced evenly by angle, `atan2Det`), at construction. Read-outs: `apronPlotCount`, `apronPlot(k, out)` (unit direction), `isApronPlot(id)`. Not hashed.
- (b) `onboarding.step_completed` emitted by the sim once per slot. Step ids/index/total come from `onboarding.json` by trigger token (`firstStroke`, `plotPolished`). Contract: optional `actorSlot?` added to `OnboardingStepCompletedEvent` (shared/events/gameplay.ts); additive, PROTOCOL_VERSION unchanged.
- (c) first-stroke: sent when a hand stroke collects grams from an Apron plot; polish: sent when an Apron plot is Polished with player credit (hand or vehicle path via `drainPlotEvents`). Other plots send nothing.
- Client: `app/onboarding-writer.ts` ignores steps for other slots, and no longer completes first_stroke / polish from raw `dust.collected` / `plot.polished` (that was the any-plot behaviour). `app/objective-markers.ts` + `parcel-feed.ts`: optional `apronPlotCount`/`apronPlot` on the source; marker targets the nearest Apron plot, falls back to home outpost 0 if the source lacks them.
- Tests: new `packages/sim/test/unit/onboarding-apron.test.ts` (4: ring-2 membership, determinism, first-stroke once + slot, no step off-Apron); updated onboarding-writer tests; new objective-markers test. Client run `objective-markers` + `onboarding-writer`: 13/13 pass. Sim suite: 210/212; goldens (state/stroke hash) unchanged, passing, no re-baseline. `tsc -p packages/sim` clean after fix (shared tsc ran in the same chain, no errors printed).

## Limits / needs owner
- **Wiring not done (forbidden path)**: `apps/client/src/sim-host/readouts.ts` (and `messages.ts`, `app/online-readouts.ts` for online) must forward `apronPlotCount`/`apronPlot` (the Solo cache currently copies only outposts), so until then the marker still falls back to outpost 0. One-time array of N unit dirs, like `parcelDirs`.
- Apron dust (20% cover at level 2) is not applied: the ledger still treats every plot as Highland and the test world has no per-plot level, so the Apron plots are in position but not yet thin. That needs the plot-attribute bake / `dustLevelOf` in the room ledger (world/host owner).
- Per-slot "already sent" latch is not hashed or checkpointed; after a restore the step re-sends once (writer is idempotent).
- 2 failures in the full sim run, not touched by this change and not baselined by me: `alloc.test.ts` (toPlotLocal 231 B/tick, grid code in packages/world/shared; acceptStroke 0.8 B/tick) and `vehicles.test.ts` step budget (31.5 us vs 30 us under load, vehicles are out of scope). Both reproduce when run alone.
- Not run: `pnpm verify`, tsc for apps/client, browser.
