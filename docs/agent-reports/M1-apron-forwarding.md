# M1 Apron forwarding (2026-11-17, gameplay-systems-engineer, Sonnet 5.5)

Status: task 1 done; task 2 not implemented (reason below). No git, no servers/browsers.

## Done (task 1)
- `packages/sim/src/room/landing-apron.ts` (new, exported from the sim barrel): pure `landingApronPlots(grid, home, count)`, the old `computeApron` algorithm moved verbatim; `MoonRoomSim.computeApron` calls it (minimal edit; unused `PlotLocalMm` import dropped). Same plots, goldens unchanged.
- Solo: `SimReadoutMessage.apronDirs` (unit dirs, xyz triples; 6 plots = 18 numbers, in the 10 Hz change-only read-out message, not the FRAME; 40-byte trailer untouched). `ReadoutSampler` fills it into the reused message (no per-sample allocation; compared in `same`), `HostReadouts` exposes `apronPlotCount` / `apronPlot(k,out)` so `ReadoutLink` -> `nearSource` -> `ObjectiveMarkers` gets the nearest Apron plot (no boot.ts change needed: the source is the same object).
- Online: `OnlineReadouts` computes the Apron once at construction with `landingApronPlots` (same grid, same `world.landingApron.plotsPerOutpost`, home = normalised outpost 0, as the server); `apronPlotCount`/`apronPlot` read grid `centerDirection` (no allocation). `deps.grid` widened to `PlotGrid` (callers already pass a full grid). Lazy chunk, zero Solo cost.
- PROTOCOL_VERSION untouched (client-internal worker message + client derivation).

## Task 2: Apron dust thinning - NOT done
Spec value: `world.json` `landingApron {plotsPerOutpost 6, coverageFrac 0.2, dustLevel 2}`. The initial dust is per-plot class attributes plus `dustLevelByClass` in `WorldDustLedger` (packages/world/src/dust/ledger.ts), built by `createRoomDustLedger` (`defaultPlotAttributes`: all Highland). A 20 % partial cover has no plot-level representation, and thin plots must be identical in the server ledger, Solo ledger, the client mirror ledger and the baked dust chunks / bakeHash. That is a world/bake-format change (world owner + contracts), and the golden world strokes near home, so applying it in the sim alone would move stateHash/strokeHash. Left unchanged; needs a world-owner decision (per-plot initial coverage in the bake).

## Evidence (Node 22 tool shell, this file state)
- client `tsc -p . --noEmit`: clean. eslint on all touched files (client + sim): clean.
- New `sim-host/readouts.test.ts` (solo: sampler -> structuredClone -> HostReadouts == sim directions, unchanged sample posts nothing) and new case in `app/online-readouts.test.ts` (online Apron == MoonRoomSim's); with objective-markers: 12/12 pass.
- sim `test/golden` + `onboarding-apron` 6/6 pass (GOLDEN_REPLAY unchanged). `src/sim-host` + `readout` run: 47/48; one timeout in `readout-writer.test.ts` (sim construction under load, 9 s vs 5 s), passes alone 7/7.

## Files
packages/sim/src/room/landing-apron.ts (new), packages/sim/src/room/moon-room-sim.ts, packages/sim/src/index.ts, apps/client/src/sim-host/{messages,readouts}.ts, apps/client/src/sim-host/readouts.test.ts (new), apps/client/src/app/online-readouts.ts, apps/client/src/app/online-readouts.test.ts.

Commit suggestion: feat(client): forward Landing Apron plots to objective markers (solo + online)
