# M1-W7-T01 Trundle integration (integrator)

Status: done (wiring + encoder block + tests); audio addendum returned to owners / 2026-11-17 / integrator / Opus 5.5. No git, no browser/GPU, no servers.

## Wired (steps 1 + 2 done and tested)
1. `apps/client/src/gameplay/module.ts`: `readonly seated = new SeatedTrundle()`; lazy chunk builds
   `resolveVehicleTuning(gameData, cfg)` and attaches a `TrundlePredictor` (same cfg / ground / clock as the Solo
   predictor); new option `vehicleTuning` for the `simConfig` constructor path; `predictFn` / `reconcileFn` feed both
   predictors; local host events -> `seated.onEvent`, ShiftState -> `seated.onShiftState` (local only), `bindHost` ->
   `seated.reset()`; `update` uses `seated.feet` + `drive.updatePredicted(seated.pose, ...)` while seated and the
   prediction is ready, else the old FRAME path. Snapshot gains `vehiclePrediction`.
2. `apps/client/src/sim-host/sim-frame-encoder.ts`: Self vehicle block while the self slot drives
   (`moveState = FRAME_SELF_DRIVER_MOVE_STATE`, chassis pos, packed 15-bit orientation, linear velocity, steer8, gear,
   boost, lights; angular 0). Allocation-free local `quatFromAxes`. The FRAME is still written only below
   `FRAME_MAX_BYTES`; the 40-byte trailer at `FRAME_TRAILER_OFFSET` is untouched.

## Evidence (Node 26, this file state)
- client tsc clean (an earlier run showed 3 transient errors in `packages/sim/src/room/moon-room-sim.ts` from another
  agent's in-flight edit; gone on rerun). eslint clean, prettier applied on the 4 touched files.
- New `sim-host/sim-frame-encoder.test.ts` 1/1: real MoonRoomSim drives a Trundle; decoded block = sim vehicle within
  1/2048 m position, 1/256 m/s velocity, forward/up axes to 1e-3, steer/gear/boost/lights; on foot = no block; bytes
  past `FRAME_TRAILER_OFFSET` untouched by the encoder.
- New `gameplay/seated-wiring.test.ts` 1/1: fake local host = real sim + real encoder, frames one module frame late;
  seat via KeyT/KeyE, drive KeyW 90 frames: `seated.ready`, exactReconciles > 20, maxCorrection < 5 cm,
  `drive.vehiclePose` == `seated.pose` (updatePredicted path), predicted chassis within ~1 tick of the sim; host
  change drops seat + prediction.
- client vitest `src/gameplay src/sim-host src/app`: 39 files / 296 tests pass.

- sim `test/golden` 1 file / 2 tests pass (GOLDEN_REPLAY unchanged; sim not edited by me).

## Not done yet
- (done) Server tests with the default room selling all 7 lines: `apps/server` vitest 35 files / 385 tests pass, no
  fallout, no server edits needed.
- `pnpm verify`: not run (one final run belongs to the lead's integrated state).

## Audio addendum (W7-T05: `avatar.stepped`, `vehicle.motion`, `placement`) - not added; does not fit cleanly
- No bridge carries RoomHost sim events (`vehicle.entered`, `dust.collected`, ...) onto `ctx.events`
  (rg: no `host.onEvent` -> `events.emit` in apps/client/src). AudioRouter.onMotion
  (apps/client/src/audio/event-router.ts:452-459) only updates the drive loop after `vehicle.entered` on the bus, so a
  gameplay-only `vehicle.motion` would only half work. The bridge must be a module registered in `app/boot.ts`
  (terrain agent owns it this wave). Proposal: `app/sim-event-bridge.ts` forwarding host events to the bus, plus a
  `vehicle.motion` emitter at <= 10 Hz from `GameplayModule.seated` (speed/topSpeed, hopper/capacity, intake work).
- `avatar.stepped` needs footfall timing and the plot surface under the boot: the animation owner (foot contacts in
  `app/solo-avatar.ts` / animator) is the right emitter, not gameplay.
- `placement` is listener-relative for OTHER actors: belongs where remote actors are presented
  (`app/remote-avatars.ts` / net), not in gameplay/module.ts.

## Files touched
- apps/client/src/gameplay/module.ts
- apps/client/src/sim-host/sim-frame-encoder.ts
- apps/client/src/sim-host/sim-frame-encoder.test.ts (new)
- apps/client/src/gameplay/seated-wiring.test.ts (new)
