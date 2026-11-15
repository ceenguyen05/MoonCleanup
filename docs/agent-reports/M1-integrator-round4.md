# M1 integrator round 4: Holster-gating goldens, prediction check, whole-tree typecheck

Status: **done (one typecheck error returned to its owner)** / 2026-11-15 / integrator / Opus 5.5. No git, no servers left running.

## 1. Client golden constants
`apps/client/src/sim-host/browser/sim-host.worker-lane.ts` now uses the M1-W6-T02 values:
- GOLDEN_REPLAY: stateHash 1076468633, strokeHash 4164540033, strokes 4023, grams 55784.
- World ledger: stateHash 1838396500, strokeHash 4164540033, strokes 4023, grams 66455, dustHash 2469925789, ledgers 24.

No other client, server or tool file hard-codes the old hashes; the only remaining mentions are changelog comments in `packages/sim/test/golden/cases.ts`.
The old values are still listed in `docs/STATUS.md:15`, which is the lead's to update.

Evidence: the browser worker lane (`vitest run --config src/sim-host/browser/vitest.browser.config.ts`, Chromium) passed **5/5**.

## 2. Client prediction under Holster gating
- **Predictor code: no change.** Both `gameplay/avatar/solo-predictor.ts` and `net/predictor.ts` read the equipped tool only through `setTool()`. That value comes from authoritative state: `gameplay/module.ts:334` and `app/online-room.ts:318`.
- The predictors never switch tools locally, so auto-equip reaches them with the next shift state.
- Allocation per predicted step is unchanged.
- **New focused test** in `apps/client/src/gameplay/solo-authority.test.ts` ("Holster gating ..."). It runs against a real MoonRoomSim:
  - Buying the Squeegee equips it on the purchase tick.
  - With one slot, `select_tool` slot 1 is a no-op.
  - Prediction is exact before the purchase and exact again after the swap window.
- **Known limit (existing, documented in the `net/predictor.ts` header).** Equipping starts the sim's holster swap timer (`holsterSwapTicks`), which the predictors do not model.
  - Measured: corrections of 1.3–5.8 cm for about 6 ticks after a purchase (seen in a debug print during development; the test asserts < 0.1 m inside the window and < 1e-9 m after it).
  - To make it exact, the worker frame would have to carry `swapTicks`, and the predictor would have to gate `canWork` on it. This is a possible follow-up for sim-host and gameplay. It is cosmetic, and only happens on a purchase.

Evidence: `vitest run src/gameplay src/net src/sim-host` ran twice. Run 1: **125 passed, 1 skipped**. Run 2: 124 passed, 1 failed. The failure was `net/dust-offload.test.ts` "every push stays under 1 ms", a timing bound that fails under parallel load and is unrelated to these edits; it passed in run 1. `eslint` on both edited files: clean.

## 3. Whole-tree typecheck (`turbo run typecheck --continue`)
**16/17 packages clean.** One error, in a file I do not own:
- `tools/balance-sim/src/v3-mix.ts:17`: TS2352. `TOOLS.slice(0, 6) as readonly (readonly [number, number])[]`, but `TOOLS` rows are `[number, number, boolean]`.
  - Owner: gameplay-systems-engineer (M1-W6-T02 pass 4).
  - Fix: map to pairs (`TOOLS.slice(0, 6).map(([a, b]) => [a, b] as const)`) or widen the target type. Do not cast through `unknown`.

## Files
- `apps/client/src/sim-host/browser/sim-host.worker-lane.ts` (golden constants)
- `apps/client/src/gameplay/solo-authority.test.ts` (new Holster-gating test)

## Next
- gameplay-systems-engineer: fix `v3-mix.ts:17`.
- Lead: update the golden values in STATUS.
- Optional: sim-host and gameplay predict the swap timer.
- Then run one final `pnpm verify`.
