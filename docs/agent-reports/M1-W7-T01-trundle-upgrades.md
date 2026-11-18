# M1-W7-T01 Trundle + Motor Pool + all 7 vehicle upgrade lines (gameplay-systems-engineer)

Status: in-review (sim + prediction done; module wiring handed to the integrator) / 2026-11-17 /
gameplay-systems-engineer / Opus 5.5. No git, no browser. Builds on
`M1-W7-T01-trundle-kinematics-gameplay-systems-engineer.md` (Trundle kinematics, Motor Pool, upgrade stat plumbing
already existed) and `M1-W7-vehicle-feel-swap.md`.

## Done
- shared `config/vehicle-feel.schema.ts`: new required field `tipS` (hopper tip seconds before Fast Tip); schema test
  table updated.
- game-data: `vehicle-feel.ts` Trundle `tipS: 2.0` (provisional; game-designer confirms); `vehicle-upgrades.json`
  Fast Tip levels add `vehicleUnloadTimeMult` 0.6 / 0.3 next to the balance stat `vehicleTripTimeMult`; test added.
- sim `vehicles/tuning.ts`: stat `unloadTimeMult`, `VehicleHandling.tipTicks`, `VehicleStats.tipTicks`.
- sim `vehicles/vehicle.ts`: `tipTicksLeft` (hashed only while tipping); lights key works only with Running Lamps;
  a vehicle with Running Lamps spawns with lights on; `vehicleNightRelief` (max of lit Running Lamps and driver Crown
  Lamp relief); `fillVehicleIntent` (shared by room + client prediction, includes Wide Mouth cycle);
  `copyVehicleState` (prediction history).
- sim `vehicles/intake.ts`: optional `driverRelief` arg. `room-vehicles.ts`: lines default to ALL lines in
  `vehicle-upgrades.json` (`offeredLineIds` optional); `driverRelief` per actor; Fast Tip tip timer at the Dump Plate
  (`stepTip`: sells when the tip completes, moving off cancels, dust kept); readout gains lights / hasLamps /
  lockAvailable / tip01 / intakeLevel.

- sim `room/moon-room-sim.ts` (minimal): default sells every line; `stepDriver` writes the driver's Crown Lamp relief.
  `motor-pool.ts` `buyUpgrade`: first Running Lamps level switches the lights on.
- Client: `gameplay/vehicles/trundle-predictor.ts` (new, `TrundlePredictor` + `PredictedVehiclePose`): same
  `stepVehicle`/`fillVehicleIntent`/tuning as the worker; reconciles from the Self vehicle block (exact) or, today,
  from the avatar-only Self (handle + 10-bit yaw; snaps pose only beyond 2 cm / 2 yaw steps); replay <= 16, 80 ms
  offset decay, one-tick velocity extrapolation in `sample`. `vehicle-intent.ts` now delegates to the sim mapping
  (fixes the missing Wide Mouth cycle). `vehicle-drive.ts` `updatePredicted`.

## Evidence (Node 26, this file state)
- sim tsc clean; sim vitest 15 files / 208 tests pass (one test bug fixed afterwards, rerun room-vehicles + goldens
  19/19). GOLDEN_REPLAY unchanged (stateHash 1076468633 / strokeHash 4164540033); vehicle goldens 60938090 and
  1063261705 also unchanged (no re-baseline needed).
- New sim tests: all 7 lines sold at game-data prices to max level; `[]` sells none; Fast Tip tip 40 / 24 / 12 ticks;
  driving off mid-tip cancels and keeps the dust; lights need Running Lamps; buying them lights up; Afterburner x1.45;
  Throttle Lock holds; readout pills; relief = max(lit lamps, driver Crown Lamp).
- Final: sim full vitest 15 files / 208 pass after prettier; eslint + prettier clean on all touched files.
- game-data vitest 64/64; shared config vitest 109/109; shared + game-data tsc clean; client tsc clean.
- Client `src/gameplay/vehicles` 16/16 incl. `trundle-predictor.test.ts` (real MoonRoomSim): avatar-only Selfs 2 ticks
  late track < 2 cm; vehicle-block Selfs 3 ticks late < 5 mm; Gear Ratio III speeds match; sample extrapolation.

- `gameplay/vehicles/seated-trundle.ts` (new, `SeatedTrundle`): event / ShiftState / input / Self glue + handle
  feet; test 1/1 (client vehicles now 17/17, client tsc clean).

## Not wired (brief limited me to gameplay/vehicles; `gameplay/module.ts` is outside it)
Integrator, in `apps/client/src/gameplay/module.ts`:
1. field `readonly seated = new SeatedTrundle()`; in `loadPredictor`/`createPredictor` also
   `this.seated.attach(new TrundlePredictor(cfg, sim.resolveVehicleTuning(gameData, cfg), ground, this.now))`.
2. `predictFn` also calls `this.seated.predict(cmd)`; `reconcileFn` also `this.seated.reconcile(self, ack)`.
3. host `onEvent`: `this.seated.onEvent(e)` next to `setDriving`; `onShiftState`: `this.seated.onShiftState(state)`;
   `bindHost`: `this.seated.reset()`.
4. `update`: while `drive.isActive && seated.sample(clock)`, use `seated.feet` as the rig feet and call
   `drive.updatePredicted(seated.pose, input.yawRad, input.pitchRad, clock)` instead of `drive.update(...)`.
Until then the seated view stays the interpolated FRAME (one tick behind), as before.

## Requests (other owners)
- sim-host owner (`sim-frame-encoder.ts`): fill the Self vehicle block while seated (`moveState =
  FRAME_SELF_DRIVER_MOVE_STATE`, vp*, packQuat of the snapshot orientation, linear velocity, steer code8, gear, boost,
  lights). Without it the predictor uses the avatar-only path (tested < 2 cm).
- visuals/animation: hopper tip from `VehicleReadout.tip01` (`MoonRoomSim.vehicleReadout`), lights from `v.lights`.
- UI HUD-15: readout fields `lights`, `hasLamps`, `lockAvailable`, `intakeLevel`.
- game-designer: confirm `tipS` 2.0 s; docs: scope-tiers already notes the owner decision.

## Limits
- Not run: `pnpm verify`, server tests (server drives MoonRoomSim; default now sells 7 lines), browser drive feel.
- Unload is all-at-once when the tip completes (no progressive pour); Motor Pool return still unloads instantly.
- Running Lamps relief now needs the lights on (vehicle spawns lit with the upgrade; first purchase lights it).
- Placed Dump Plates / Dust Vault, Skiff/Carryall/Bulldust/Behemoth: still not modelled (M2).

