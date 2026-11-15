# M1-W6-T01 — Tools T1–T4 + traits, Dust Cells, Dust Pucks, Plot Card (gameplay-systems-engineer, Opus)

Status: **done in sim (in-review)**. Final state of pass 2:
- `packages/sim`: tsc clean, eslint clean; vitest **126/126** (including alloc and golden tests).
- `apps/client` and `apps/server`: tsc clean.

## Done vs open

| Item | State | Evidence |
|---|---|---|
| T1 Desk Duster + Detailing | done (already existed) | room-sim.test |
| T2 Crescent Squeegee + Flick | done (already existed) | room-sim.test |
| T3 Bristle Broom + Sure Footing (Steep x0.6 rule) | done | `movement/steep.ts` `groundSlopeTan` uses the same probe as stepAvatar, measured before the move. The room multiplies `speedMult` by `tool.steepSweepMult` while sweeping on ground steeper than `world.steepSlopeDeg`, and skips the probe when the multiplier is 1. Test: about 0.6 ratio at 32°, about 1.0 at 20° |
| T4 Lane Broom + Lane Lock | done | the client sends the locked yaw and the `laneLock` bit (game-feel §3.4); the +15% applies to T4 only |
| Dust Cells I–III, Densifier | done | `cellCapGrams(cfg, tool, level, bonus)`. Board `cellLevel.<toolId>` stats and `cellCapacityBonus` now set the actor Cells and are re-applied on restore. Buying them is W6-T02 (board nodes) |
| Full-Cell stop | done | tested |
| Pucks: F tap form / F hold 0.30 s band / Q carry, drop, throw / E pour back | done | `cargo/pucks.ts`: a structure-of-arrays pool with no per-tick allocation, a lunar parabola, skid on landing, no tunnelling (tested). Feel values come from tool-feel schema v1.1 |
| Loose caps 20/200, merge on touch ≤20 kg, 10-min despawn at 50% | done | despawned value builds up in `cargo.pendingGateGrams` until the W6-T02 Gate ledger reads it |
| Pucks in checkpoint | done | new **PUCKS v3** body (`cargo/checkpoint.ts`; v2 is the empty interim body in the shared save vectors). `SimCheckpoint.pucksVersion/pucks` are optional, so old checkpoints still load (with no pucks). Bytes are untrusted: decode, then validate, then commit. A carried unit whose actor has not joined is put down. Tests: save, restore, continue matches the hash of an uninterrupted run; bad version and bad bytes are rejected |
| Plot Card data | done | `MoonRoomSim.plotCard(plotId, PlotCardData)` |
| Deterministic tests | done | `test/unit/tools-cargo.test.ts` (19 tests) |

## Allocation finding (fixed)
`MoveIntent.speedMult` started out as a Smi field. When it later received a fraction (Steep ×0.6), the field's representation changed mid-run, and the re-optimised `stepAvatar` then allocated about 470 B/tick. The fix: `MoveIntent`'s constructor now gives the field the double representation from the start. The alloc test passes.

## For other owners
- **Client (gameplay owner):** `apps/client/src/gameplay/avatar/solo-predictor.ts` must apply the same Steep rule. Call `groundSlopeTan` and multiply `speedMult` by `tool.steepSweepMult`, as `moon-room-sim.ts` stepActor does. Without this, prediction drifts on Steep ground.
- **Hosts (sim-host / server):** store `pucks` in save section `PUCKS` (id 8) with `pucksVersion` and pass both back on restore. Without this, pucks are not saved.

## Goldens / balance
- GOLDEN_REPLAY and GOLDEN_REPLAY_WORLD_LEDGER are **unchanged**: the scripts never press F/Q/E, and the fixture spawn area is not Steep. Nothing was re-recorded. DUST_MODEL_VERSION is untouched.
- **V3:** the packages/world `V3 reachability and design depth` suite passes 9/9 (Moon-mix and outpost-mix passes within ±20%). The suite does not print the ratio, so it could not be re-read this pass. No dust or tool data changed, so the value is unchanged from the last measurement: **0.825 vs the 0.80 limit (pass, thin headroom)**. No retune.
- tools/balance-sim `mvp`: out/report.md has 9 PASS rows and no FAIL or PASS_EDGE rows.
