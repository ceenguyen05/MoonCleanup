# M1 puck feel contract keys (contracts-architect)

Status: done. Behavior and goldens unchanged.

## Changes
- `packages/shared/src/config/tool-feel.schema.ts` v1 -> v1.1 (additive, all keys required): `formPuckHoldS, bandPerStackS, throwMinMps, throwMaxMps, throwChargeS, throwPitchDeg (0<x<90), throwHeightM, puckSkidDecelMps2, pickupRadiusM, puckMergeRadiusM (0 disables), puckDropForwardM`. New rule: `throwMaxMps >= throwMinMps`. `GAME_DATA_SCHEMA_VERSION` stays 1.
- `packages/game-data/data/tool-feel.json`: values equal the old `CARGO_FEEL_SPEC_DEFAULTS` (0.3/4/8/0.8/30/1.2/3/1.5/0.3/0.5) plus `bandPerStackS` 0.15 (game-feel §10.2; presentation only, the sim bands instantly).
- `packages/sim/src/config/sim-config.ts` (the real read site; `cargo/pucks.ts` already reads only `cfg.cargo` and needed no edit): `resolveCargo` now reads the typed `data["tool-feel"]` directly. `CARGO_FEEL_SPEC_DEFAULTS` and its untyped fallback are removed (it had no other users).
- Already in data, unchanged: puck kg, stack max, loose caps, despawn time/value (`dust-cells.json`), `carryUnits` (`movement.json`). Not feel and left in code: `CARRY_SLOTS_PER_ACTOR = 4` (pool sizing); Q tap-vs-throw threshold reuses `formHoldTicks` (moon-room-sim).
- Tests: bundle fixture + new rejection cases (throwMax<throwMin, pitch 90, hold 0, merge<0) in `bundle.schema.test.ts`; exact table in `game-data.test.ts`; `config-driven.test.ts` checks `SimConfig.cargo` mirrors the table and an edited table moves it.

## Evidence
shared 471 passed, game-data 59 passed, sim 123 passed / 1 skipped (incl. goldens, unchanged); `tsc --noEmit` and `eslint .` clean in all three.

## Consumers
- packages/sim: done. tools/balance-sim, apps/client, apps/server: none (use `loadGameData()`). Client presentation may read `bandPerStackS`.
- Any future data override must supply every key (required).

## Next
Optional: add `throwHoldS` if the Q tap/throw threshold should decouple from `formPuckHoldS`.
