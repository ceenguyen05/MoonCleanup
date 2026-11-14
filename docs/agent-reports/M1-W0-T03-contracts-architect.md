# M1-W0-T03 — contracts-architect

Status: done for the card scope; room-host / save-sync deferred to M1-W0-T06 (not cleanly separable). 2026-11-13.

## Delivered (packages/shared/src)
- `render/quality.ts` v1: every remaining row of rendering-pipeline §14.1 (lights, terrain LOD/detail, texturePoolMb, dust atlas/ring/residency/rebuilds/strokeDirection/footprints/berm/sparkle, particles, sky, budgets, distances, ui). Refinements: atlas slots x slot area = atlas area; slot edge x texel = 25.6 m (`DUST_TILE_FRAME_M`); ring side = size x texel (±0.5 m). Test table extended to every leaf.
- `events/gameplay.ts` v1 (new) + `catalog.ts` v1: 29 sim events (`SimEventMap`, `SIM_EVENT_NAMES`, all carry `tick`) and 9 presentation events (`PresentationEventMap`). `review.reached` kept but parked (`PARKED_EVENT_NAMES`), because reference mode parks Reviews.
- `ui/slices.ts` (new) + `ui/store.ts` v1: 25 slices (HUD, wallet, shine, compass, holster/Cells, suit, vehicle, checklist, nextReq, interaction, roster, plotCard, assay, achievements, desk, board, motorPool, equipment, dot, notices, menus, settings, input, plus session/profile/shift), `<slice>.set` actions, 10 special actions, limits. "docket" = `checklist` (Induction) + `nextReq`; Docket/Probation are parked (ui-screens §11).
- `audio/cues.ts` v1: 63 cues, typed params per cue (`AudioCueParamMap`), bus/channel/priority/voices/cooldown/range table, `AUDIO_EVENT_CUES`, mix and voice limits. `AudioCueId` is now a literal union (was Brand<string>); nobody used v0.
- `config/mvp-scope.schema.ts` v1 (new): `MvpScopeSchema` + `MVP_SCOPE` (4 tools, 10 board nodes, Cell III, Holster L1 / Lamp L1, Trundle, Sandpiper, Roost cap 3, 3 achievements, 6 Near Parcels, 900 m fence). Config barrel v1.1.
- Tests: `events/gameplay.test.ts`, `audio/cues.test.ts`, `ui/store.test.ts`, `config/mvp-scope.schema.test.ts`, extended `render/quality.test.ts`; edited `catalog.test.ts` (EVENT_NAMES prefix) and `placeholders.test.ts` (audio line).

## Config schema coverage vs the card (no new table schemas needed)
All 23 baseline tables already have schemas and JSON. Card item -> table: tools+traits -> tools, traits; Dust Cells -> dust-cells; terrain classes, dust levels, day/night -> world (`terrainClasses`, `dustLevel`, `dayLengthS`, `daylightFrac`, `contractStartSunPhase`) + movement (night penalty); prices -> tools/economy/build-pieces/vehicles; Promotions nodes -> promotions-board; suit gear -> suit-gear; vehicles+lines -> vehicles, vehicle-upgrades; achievements; onboarding steps; cargo placements -> collectibles (`strayCargo` counts; positions are the world bake). **Reviews: no schema by design**: REFERENCE_TARGET/progression §21 park `performance-reviews.json` (§24.1). Adding it is additive if the owner pulls Reviews in.
Not in world.json: Pilot Fence radius 900 m (now `MVP_SCOPE.pilotFenceRadiusM`).

## Evidence (Node 22.20, repo-root binaries)
- `vitest run --root packages/shared`: 23 files / 361 tests pass. `vitest run --root packages/game-data`: 41 pass.
- `tsc -p packages/game-data`: clean. `eslint packages/shared packages/game-data`: clean. `prettier --check`: clean.
- `tsc -p packages/shared`: only 3 errors, all in T01 test files (`structuredClone` not in lib ES2024): `save/checkpoint-package.test.ts:138`, `save/dust-chunk.test.ts:155`, `world/stroke.test.ts:77`. Not mine.
- MVP_SCOPE ids verified against game-data JSON with a temporary test (all ids exist, gear levels >= 1, `mvpRoostCap` 3, Cell levels 3, 8 induction steps, `railshotEveryKg` 2000); temp file deleted. Unverified: apps/client typecheck against the new `UiState` / `QualitySettings` / `EventMap` (T05).

## Barrels
Root `index.ts` already re-exports all 13 folders; no change needed. T01's `world/index.ts` (plot-grid, dust, stroke, vectors) and `save/index.ts` (format, vectors, dust-chunk, dust-chunk-vectors, checkpoint-package, checkpoint-vectors) already list their files. No outstanding barrel work.

## Consumers that must change (T05 / later waves)
- `apps/client/src/app/ui-store.ts`: flush only handles `session.set`; implement the other `<slice>.set` and 10 special actions with the limits in `ui/slices.ts`. `INITIAL_UI_STATE` now has 25 slices (spread keeps it compiling).
- `apps/client/src/render` (tier.ts, quality-service, look-knobs, bench): `QualitySettings` has new required groups; code that builds a whole settings literal must add them (spread of `QUALITY_PRESETS[id]` is fine). Terrain/dust engineers read `dust.atlas`, `dust.ring`, `dust.residencyRadiusM`.
- `packages/sim` / T02: build `RoomSimEvent` from `SimEventMap`; `SimEventBase.tick` is required. T02 may replace `RoomSimEvent` in `sim/room-sim.ts`.
- `apps/client/src/audio`: implement `AUDIO_CUE_DEFS`, `AUDIO_EVENT_CUES`, buses; audio-pack manifest has one entry per `AUDIO_CUE_IDS`.
- `apps/client/src/ui`: read slices; text catalog needs the `textId` / `labelId` ids used by notices, DOT, checklist, interaction.
- `packages/game-data`: add a test that every id in `MVP_SCOPE` exists in the bundle (I verified once, by temp test).
- `tools/balance-sim` (policy `mvp`), `apps/server/src/sim`, `tools/bots`: use `MVP_SCOPE`.
- Docs (lead): module-boundaries §2 table rows for events, ui, audio, render, config versions.

## Deferred to M1-W0-T06 (exact next steps)
`client/room-host.ts` (ADR-0031 §1) needs T02's `ControlIntent`, `ShiftType`, `ShiftState` and an expanded `SimInputCommand`, so it is not separable now. Then add the `roomHost` service key (breaking for the composition root's assert-all-registered), `saveSync` UI slice with `resolveSaveConflict` / `restoreBackup` actions and `save.checkpointed/synced/conflict/restored` events (needs `SoloCheckpointSummary` from `api/rest`).

## Notes
- `ui/slices.ts` imports `PlotState` from `world` (T01). Keep that export.
- Dust mass is grams in events (WDS §4.6), kg in UI slices; the writer converts.
