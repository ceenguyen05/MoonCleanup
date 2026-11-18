# M1-W7-T01 / T02 Trundle (gameplay-systems-engineer) - PARTIAL (turn-limited)

2026-11-18. No git, no pnpm verify, no servers/browsers/Blender started, GPU lock never taken. Node 26 via fnm alias.

## Audit (what each card still needed vs code)

T01 (sim, `packages/sim/src/vehicles/**`): sim side DONE before this session. Raycast-suspension Trundle (`vehicle.ts`),
Motor Pool spawn/return + Repeat Requisition (`motor-pool.ts`), all 7 upgrade lines sold (`tuning.ts`,
`vehicle-upgrades.json`), intake/hopper -> Dump Plate with Fast Tip unloading-only (`intake.ts`, `room-vehicles.ts`),
vehicle camera, predictor, seated wiring, encoder block, audio `vehicle.motion`. Real input exists: T (`seatSwitch`)
calls/returns at the pool, E (`interact`) boards/leaves (`moon-room-sim.ts` ~1316).
- GAP 1 (FIXED): Requisitions Desk listed no vehicle rows, so Solo could not buy the Trundle or any upgrade through
  real UI.
- GAP 2 (partly fixed): a called, parked Trundle had no client-visible pose (FRAME streams only the self driver).
  Now the 10 Hz readout carries it; nothing consumes it yet.
- Not audited/unchanged: Motor Pool "build extra pool" (placed via Assembly Gun, outpost agent's area; default 1 pool
  exists), `vehicle step <= 10 us` (existing vehicles.test best-of-3 timing, not re-run).

T02 (model + VFX): nothing existed. No vehicle mesh is rendered anywhere in the scene.

## Changes (files)
- `apps/client/src/app/menu-writer.ts`: `MenuCatalog.vehicles?`, `catalogItemIds` includes vehicle ids (sim quotes them),
  `deskItems` emits `vehicle` rows (Trundle + 7 lines; lines locked behind the Trundle; level read off the sim quote).
- `apps/client/src/ui/strings.ts`: names + blurbs for `vehicle.trundle` and the 7 `vehicle_upgrade.*`.
- `apps/client/src/sim-host/messages.ts`, `readouts.ts`: `parkedVehicle` (own active, undriven vehicle pose) in the
  readout message, compared in `same`, `HostReadouts.parkedVehicle` getter; allocation-free reuse.
- New `apps/client/src/visuals/vfx/vehicles/`: `drum-spray.ts` (distance-driven ballistic burst on the grain pool),
  `trundle-model.ts` (procedural blockout, published node/bone naming spec in the header), `trundle-presenter.ts`
  (pose -> render basis, drum/wheel spin, spray, own GrainLayer; reusable scratch). tsc clean, eslint run; NOT YET WIRED into boot.
- Tests: `menu-writer.test.ts` "desk vehicle rows" (fail first, now green); `readouts.test.ts` "parked vehicle read-out"
  (green); `drum-spray.test.ts` (3, green).

## Commands / results (apps/client, `node ../../node_modules/vitest/vitest.mjs run ...`)
- `src/app/menu-writer.test.ts`: 7/7. `src/ui src/app/menu-writer.test.ts src/app/boot-wiring.test.ts`: 15 files / 164 pass.
- `src/sim-host/readouts.test.ts`: 3/3. `src/visuals/vfx/vehicles`: 3/3.

## Wiring done (2026-11-18, second pass)
- New `apps/client/src/app/trundle-wiring.ts` (cold chunk): `createTrundleSource` (seated = drive-view chassis +
  `vehicleMotion.workIntensity01`; else `readouts.parkedVehicle`; else none) and `withTrundle` (wraps gameplay: init/update/
  dispose + `TrundlePresenter` on `sceneRoots.world/vfx`).
- `apps/client/src/app/boot.ts`: one surgical edit at the gameplay registration (dynamic import of `./trundle-wiring`,
  falls back to plain gameplay if the chunk fails or no mapper).
- `boot-wiring.test.ts`: new "Trundle presentation" (boot imports the chunk; source selection seated/parked/none); the old
  `registered.set("gameplay", gameplay)` assertion became a regex for the wrapped form.
- Results (apps/client): tsc clean; eslint trundle-wiring clean; `vitest src/app`: 27 files, 185 tests, all pass except
  `readout-writer.test.ts` "MoonRoomSim satisfies SimReadoutSource" which times out at the default 5 s on this loaded machine
  (sim construction ~6 s) and passes 7/7 with `--testTimeout=30000`; I believe pre-existing, not caused by these edits.
- NOT eyeballed: the blockout Trundle has never been rendered; render-frame up/orientation, grain frame (vfx root) and
  drum spray look are unverified.

## Left
1. Wheel-track hook to `terrain/marks` (not started).
2. Blender GLB via D5 pipeline replacing the blockout, ASSET_LICENSES row, VT-M1-35 turntable (not started).
3. One real-GPU look-check (UHD 620 Medium, off-screen headed Chrome, gpu.lock) - not done, lock never taken.
4. Not run: pnpm verify, server tests, vehicle step timing re-run.

## Third pass
- (1) Boot-wiring cases: HEAD `boot.ts` has 0 occurrences of `trundle-wiring`, so the new boot assertion fails on the old boot.
- (2) Wheel-track hook: `apps/client/src/terrain/marks` does not exist in this tree; vehicle strokes already paint the combed
  striations through the sim ledger / `stroke-mask`. No separate hook written (N/A until a marks module exists).
- Dev/perf-only hook `window.__mcPurchase(itemId)` added to `boot.ts` next to `__mcStations` (perfEnabled only) so the
  look-check can buy the Trundle; wallet raised for the capture by a Playwright route rewriting `startWalletLm` (no source change).
- (4) Look-check script: scratchpad `cap.mjs` (own vite on 5395, headed Chrome off-screen, Medium, dynres off).

## Real-GPU look-check (done, UHD 620, headed Chrome off-screen, WebGPU, Medium, dynres off, own vite on 5395, stopped)
- Flow by real keys: `?perf=1&lm=5000` (existing dev wallet param), `__mcPurchase("vehicle.trundle")` (new dev hook), `T` call,
  `E` board, hold `W` 2.5 s. Script: scratchpad `cap.mjs` / `run.sh`; shots in scratchpad `shots/0..3-*.png`.
- Result: "Requisition approved"; the Trundle appears 2.5 m ahead when called (white body, smoked hopper, tall T-handle with
  yellow bar, dark wheels, yellow lamp/hub bits, correct shadow); after boarding and driving the chase camera follows and a
  lit cleaned trail is left behind. Prediction: predicted 97, exactReconciles 100/100, handleSnaps 0, maxCorrection 0.22 m.
  Frame p50 ~19 ms, GPU render p50 ~15.5 ms, draws 72 vs 32 on foot (the Trundle meshes are un-instanced primitives,
  about +40 draws: should be merged/instanced when the GLB lands), tris +~1-9k.
- Console: only powerPreference and font-preload warnings; no errors.
- Not seen clearly: drum spray grains (DOT tooltip and low camera cover the front; needs a close capture), night lamps.
- First attempts failed only because my wallet patch (route rewrite) did not reach the sim worker; `?lm=` fixed it.

## Still open
- Wheel-track hook: no `terrain/marks` module exists (N/A); striations come from sim strokes.
- Blender GLB / D5 pipeline, ASSET_LICENSES row, VT-M1-35 turntable: NOT done (blockout primitives ship now; draw count
  should be reduced when the GLB replaces them). Drum spray close-up and Trundle night look unverified.

## Fourth pass (draw budget, lamps, second look-check)
- `trundle-model.ts` rewritten: primitives merged into 4 meshes (chassis, lamps, drum, wheels) with baked vertex colours and
  2 materials (was ~14 meshes / 6 materials); wheels share one pivot; only the chassis casts a shadow (that last tweak was
  made after the capture and is NOT re-measured). `trundle-model.test.ts` asserts mesh/material budget and node names.
- Running lamps: `vehicleMotion.lights` added to the readout message (`messages.ts`, `readouts.ts`) and read by
  `trundle-wiring.ts`; lamp lens mesh is visible only while lit. (Lamps bought via `vehicle_upgrade.running_lamps`, toggled
  with L in the capture; lit lenses not clearly visible in the shots.)
- Look-check 2 (UHD 620, Medium, `?perf=1&lm=5000&onboarding=0`): draws on foot 29-32; Trundle called 44; driving 41-42
  (was 72). So about +10-12 draws all in (4 meshes plus their shadow-pass draws, rider, trail), still above the +6 target;
  the chassis-only shadow tweak should shave about 2 more. Triangles 150-161k (on foot about 143-151k). Prediction 135/135
  exact reconciles, 0 handle snaps, max correction 0.34 m. Frame p50 ~19 ms, GPU render p50 ~15 ms. No errors.
- Drum spray grains still NOT seen in the shots (chase camera is behind, spray goes forward under/past the body); needs a
  front or side camera capture. Night lamps not confirmed visually.
- Blender GLB / ASSET_LICENSES / VT-M1-35 turntable: NOT done (the procedural blockout remains the shipped model).
- Wheel-track hook: N/A (no terrain/marks module; vehicle strokes already paint via the sim).
- vite on 5395 stopped; gpu.lock released by my script.
