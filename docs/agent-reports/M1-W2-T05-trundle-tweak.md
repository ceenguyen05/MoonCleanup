# M1-W2-T05 Trundle price tweak (game-designer)

Date 2026-11-14. Status: **done**. No git mutations.

## Change
Trundle `priceLm` 1,800 -> 2,100 (balance-review option "for margin"). Rationale: Trundle hauls pay in 1,000 LM lumps, so Roost #1 purchase times are quantised. 2,000 cleared the 1.5 h floor by 0.004 h; 1,900 was non-monotonic; 2,100 gives a safe 1.54 h and keeps the Trundle in band (1.16 h, ratio to Motor Pool + Trundle opening unchanged in structure). Roost base (4,500) untouched.

## Files edited
- `packages/game-data/data/vehicles.json`: `vehicle.trundle.priceLm` 2100 (only game-data place; build-pieces/power `2800` hits are unrelated Night Cell/other pieces).
- `tools/balance-sim/src/sim.test.ts`: Repeat Requisition test now `2100 * (1 + frac * 3)` (was hard-coded 1800).
- `docs/design/progression-and-economy.md`: vehicle table price 2,100; Motor Pool opening 3,100 plus a retune note; max-out Trundle 13,230 (6.30 x 2,100); the v2 hand-derivation line (step 5) annotated as history with a pointer to the sim.

## Verification (fnm Node 26.13.1)
- `balance:assert`: exit 0, all 9 MVP rows PASS, v1.0 rows SKIPPED (unchanged).
- `balance -- --runs 200 --seed 7`: deterministic; report at `tools/balance-sim/out/report.md`.
- game-data: vitest 55/55, tsc, eslint, prettier all exit 0. balance-sim: vitest 17/17, tsc, eslint, prettier exit 0. Economy doc prettier clean.

## New pacing rows (nominal efficient; Monte Carlo P10/P50/P90, 200 runs, seed 7)
| Row | Band | Solo | 4p | 6p |
| --- | --- | --- | --- | --- |
| First Stamp | 5-8 min (solo) / 1.5-4 (4p) | 5.50 min PASS | 2.17 PASS | 1.83 |
| Squeegee | 5-10 / 2-6 | 6.13 PASS | 3.40 PASS | - |
| First Cell | 7-12 min | 8.87 PASS | 4.7 | - |
| Trundle | 1-1.5 h / 0.3-0.8 | **1.16 h** PASS (MC 1.12/1.20/1.36) | **0.52 h** PASS (0.50/0.57/0.67) | 0.49 h (MC 0.47/0.52/0.61) |
| First Roost | 1.5-2 h / 0.4-1 | **1.54 h** PASS, no longer edge (MC 1.43/1.56/1.85) | **0.65 h** PASS (0.62/0.69/0.81) | 0.60 h (MC 0.57/0.65/0.76) |

All MVP items: solo 4.91 h (was 4.84), 4p 3.05 h. Purchase gap median 3.1 min solo, max 46.1 min solo / 48.7 min 4p (unchanged in kind; see review finding b). 6p is not a nominal pacing-targets row (CLI nominal runs are 1p/4p only); 6p figures came from a throwaway `runMvp`/`monteCarlo` script (deleted).

## Open issues for balance-reviewer / lead
- Stale Trundle 1,800 outside my allowed paths, not changed: `docs/design/ui-screens-and-flows.md:1376` (SCR-12 acceptance "Trundle purchasable at 1,800 LM") and `docs/design/scope-tiers.md:54` (Trundle 1,800 LM row, hand-derived 1.1 h; sim now says 1.16 h). Lead to assign a doc update (scope-tiers is game-designer-owned; I can do it on request).
- `packages/shared/src/config/bundle.schema.test.ts:227` uses 1800 as an independent fixture, not the real table; no change needed.
- Finding (b) from the review (4-6p content exhaustion after about 2.5 h; M2 sinks needed) and the three unsimulated exploit hunts remain open and are unaffected.
- Proposal: add a 6p nominal row to pacing-targets (needs a schema/archetype check; schemas are not mine).
