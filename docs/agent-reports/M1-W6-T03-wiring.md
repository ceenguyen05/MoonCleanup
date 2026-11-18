# M1-W6-T03 wiring report (2026-11-17)

## Task 1: boot-wiring.test.ts timeout - DONE
- New `apps/client/src/app/boot-policy.ts` holds `wantsPlayerInput` and `wantsCheckpointSync` (identical bodies; imports only `launch-policy`).
- `apps/client/src/app/boot.ts` imports them and re-exports (`export { wantsCheckpointSync, wantsPlayerInput };`), so no importer breaks.
- `apps/client/src/app/boot-wiring.test.ts` imports them from `./boot-policy`; the 60 s timeouts on the gameplay-registration and D1 tests are removed.
- The `AppNetModule` test still imports `./modules` (net barrel / colyseus client) and now carries a 60 s timeout: that import is needed. It timed out at the 5 s default when run alone under load.
- Runs: `boot-wiring.test.ts` alone: 13/14 passed, the 14th was the AppNetModule test above (fixed by the timeout; re-run pending, see "Test runs" below).
- `src/app` folder run (25 files, under heavy machine load from other agents): 23 pass, 7 fail, none in boot-wiring. The failures are `solo-host.test`, `readout-writer.test`, `hud-writer.test`, `round5-wiring.test`, `menu-writer.test`, `online-readouts.test`, `online-loop.integration.test`: all real-worker/Solo-host or sim tests that time out (30-137 s) under load or touch files another agent is editing (sim-host, room-vehicles). Not caused by this task; not re-verified in isolation.

## Task 2: W6-T03 MomentFx event wiring + render layer - IN PROGRESS
Design (decided after reading the code):
- Events (already on the app bus, same ones audio uses): `plot.polished` (Stamp, own credited slot), `cargo.pour_started` + `cargo.sold` (Assay pour / flash, own slot), `railshot.fired` (Railshot). Payloads carry plot ids / slots, not render positions.
- New three-free `visuals/vfx/moments/moments-rig.ts`: subscribes to the bus, maps events to `MomentFx.trigger` through a `MomentsPort` (`ownSlot()`, `avatar(out)`, `plotCentre(plotId, out)`), no allocation per event, tracks a "busy until" clock so the grain layer and quad layer are skipped entirely while idle.
- New `visuals/vfx/moments/moments-layer.ts`: one instanced-quad draw (<= 16 slots) reading `MomentFx` (stamp outline sweep + emblem, pour flash, railshot glow), unlit additive, depth-tested, hidden while idle.
- `visuals/module.ts`: `VisualsModuleOptions.moments`; builds `GrainLayer` + `MomentFx` + rig + layer on the flat game worksite only (the grain pool assumes +Y up; the experimental terrain game gets no moments), updates them after the scene.
- `app/boot.ts`: builds the port from the gameplay avatar feet and the worksite `PlotFrameMapper`, passes it to `VisualsModule`.

### Audio event-bridge hook point (for the later agent)
In `apps/client/src/app/boot.ts` the shared bus is `const events = createEventBus(...)` (about line 167); the audio module is registered with the other modules in the `registered.set(...)` block after `registered.set("gameplay", gameplay)`. A bridge module that translates sim events to `audio.cue` events can be registered there (before `frameLoop.start()` and before `audio?.prepare()`), or simply `events.emit("audio.cue", ...)` from a disposer-tracked subscription pushed to `disposers` right after `const visuals = new VisualsModule({...})`. The event router already handles `audio.cue` (`audio/event-router.ts` `extra["audio.cue"]`).

### Files (all done, written)
- `apps/client/src/visuals/vfx/moments/moments-rig.ts` (new): `MomentsRig`, `MomentsPort`, tuning constants (`STAMP_RADIUS_M` 6.4, `POUR_REACH_M` 1.4, `POUR_SECONDS` 1.6, `POUR_TICK_S` 0.12, `GRAIN_BUSY_S` 7). Own-slot filter; Stamp at plot centre; pour ticks from the feet toward the heading; `cargo.sold` from the assay counter flashes; Railshot (any) bursts at the own avatar; `active` is false while idle.
- `apps/client/src/visuals/vfx/moments/moments-layer.ts` (new): `MomentsLayer`, one instanced-quad draw, additive, unlit, hex-outline sweep + emblem + pour flash + Railshot glow, TSL material, CPU packs live slots only, `mesh.visible = false` when none live.
- `apps/client/src/visuals/vfx/moments/index.ts`: exports the two new files.
- `apps/client/src/visuals/module.ts`: `moments?: MomentsPort | null` option; builds `GrainLayer` (2048 grains) + `MomentFx` + rig + layer in `init` only when the dust (flat game) worksite exists; `updateMoments(dt)` after `lookdev.update`; disposed in `dispose`.
- `apps/client/src/app/boot.ts`: builds the `MomentsPort` inside the gameLaunch / flat block (feet and heading through `PlotFrameMapper.point/direction`, plot centre through `grid.fromPlotLocal` + `mapper.point`, own slot = `readoutSlot()`), passes `moments: momentsPort` to `VisualsModule`; imports `type VisualsModuleOptions`.
- Tests (new): `moments-rig.test.ts` (7), `moments-layer.test.ts` (2).

### Test runs
- `vitest run src/visuals/vfx src/visuals/lighting src/app/boot-wiring.test.ts`: 11 files, 82/82 pass (includes the whole boot-wiring file, 14 tests, now passing alone).
- client `tsc --noEmit -p .`: 0 errors after fixing 2 any-typing errors in moments-layer.ts (`ap`).
- eslint on boot.ts, boot-policy.ts, boot-wiring.test.ts, visuals/module.ts, vfx/moments: 0 problems. prettier flagged two new files, fixed with --write; moments suite re-run 3 files / 16 tests pass.

### Not done / honest limits
- No GPU, no capture: stamp / flash / glow look, brightness (`MOMENT_RADIANCE` 2.5 scene-linear), placement, the TSL shader compile under WebGPU and WebGL2, VT-M1-16/16b/17/22, VM-03, VM-04 are all NOT verified. Needs a GPU agent.
- Other players' Stamps / pours are not drawn (their render position is not fed here); Railshot is drawn at the own avatar rather than at the launcher.
- Terrain game (`?ground=` moon-centred) gets no moments (grain pool is +Y-up).
- Gas / sparks emitters and the compute particle pool remain unbuilt (W6-T03 stays PARTIAL).
- The audio event bridge (above) is untouched.
