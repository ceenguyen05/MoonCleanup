# M1-W7 vehicle-feel swap (gameplay-systems-engineer)

Status: in-review / 2026-11-17 / gameplay-systems-engineer / Opus 5.5

**Done**
- Sim: `packages/sim/src/vehicles/handling.ts` no longer holds numbers. `VEHICLE_HANDLING` is now the game-data `VEHICLE_FEEL` object (same frozen reference; kept as an alias so existing imports work), `VehicleHandlingDef = VehicleFeelDef`. `resolveVehicleTuning(data, cfg, feel = VEHICLE_HANDLING)` takes an optional feel table (tests / balance-sim). Read once at config time; hot path unchanged (still `kind.handling.def`), no new allocation.
- Client: the only client consumer of handling data is `VehicleDriveView` (rebuilds the Trundle pose from the FRAME avatar on the handle; there is no seated Trundle motion predictor: `SoloPredictor.setSeated` stops walking prediction and the view uses the interpolated worker FRAME). It now reads `VEHICLE_FEEL` from game-data (injectable constructor arg), falls back to the Trundle row instead of a literal `0.9`, and exposes a read-only `vehiclePose`.
- Remaining literals in `vehicle.ts` (0.05 / 0.1 m/s gear thresholds, series constants) are logic epsilons, not feel; schema has no field for them (contracts-architect if wanted).

**Goldens: UNCHANGED.** Values in `VEHICLE_FEEL` are identical to the old table. `replay.golden.test.ts` passes with recorded hashes (`GOLDEN_REPLAY` stateHash 1076468633, strokeHash 4164540033). Nothing re-recorded.

**Files**
- `packages/sim/src/vehicles/handling.ts`, `packages/sim/src/vehicles/tuning.ts`
- `packages/sim/test/unit/vehicle-feel.test.ts` (new, 5 tests)
- `apps/client/src/gameplay/vehicles/vehicle-drive.ts`
- `apps/client/src/gameplay/vehicles/vehicle-feel-match.test.ts` (new, 4 tests)
- `packages/game-data/src/vehicle-feel*` unchanged.

**Evidence** (Node 26 via `fnm exec --using=26`, Windows, this file state)
- `packages/sim` full vitest: 15 files / 203 tests pass (incl. goldens, alloc test) after the tolerance fix in the new test.
- `packages/game-data` `vehicle-feel.test.ts`: 3/3.
- `apps/client` `src/gameplay/vehicles`: 11/11. Match test, 90 ticks of real `MoonRoomSim` driving (top 3.89 m/s, turns, boost): rebuilt chassis vs authoritative vehicle, tangential error max 0.018 mm with exact yaw, 2.73 mm with the 10-bit FRAME yaw code; +0.3 m wrong handle offset misses by > 0.25 m; two sims same inputs = identical `hashVehicle` every tick.
- `tsc` sim clean; eslint + prettier clean on all changed files. Client `tsc` errors only in another agent's `src/visuals/characters/blockout/__scratch/dump.test.ts` (not mine).
- `apps/client src/gameplay` run: `solo-prediction.test.ts` 2 tests timed out at 5 s (dust-scene mirror / PlotFrameMapper; files untouched, machine load); re-run alone: 9/9 pass.

**Not run**: `pnpm verify`, server tests (`resolveVehicleTuning` signature is backward compatible), browser drive feel.

**Review should look at**: the `VEHICLE_HANDLING` alias (keep or delete later), default-param injection in `resolveVehicleTuning`, that game-data's module-load zod parse is fine in the worker/server bundle, the match-test tolerances (1 mm / 1 cm), and whether a real seated Trundle predictor is wanted (none exists today; presentation uses interpolated FRAMEs).

Next: lead decides whether to add a seated Trundle predictor.

Commit suggestion: `refactor(sim): read Trundle handling from game-data VEHICLE_FEEL; client drive view uses same table`
