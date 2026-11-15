# M1-W3-T01f Continuous passes in code (gameplay-systems-engineer)

Status: done / 2026-11-14 / no git, no design-doc, game-data or production-code changes.

## 1. balance-sim
- `tools/balance-sim/src/model.ts`: new `passesForLevel(level, depth, coverage)` = 1 if L <= D, else max(2, coverage*L/D). `passes(mix, depth, coverage)` now uses it. `sim.ts` passes `k.handCoverage` / `k.vehicleCoverage`. `dust-passes.ts` (diagnostic script) design column uses the same rule.
- `pnpm balance:assert`: all 9 MVP pacing rows PASS (first stamp 5.50 min, tool upgrade 6.13 min, vehicle 1.16 h, Roost 1.54 h, dust cell 8.87 min; 4p vehicle 0.52 -> 0.53 h). Balance-sim vitest 17/17, tsc clean.
- Area rates (width x 0.75 x sweep speed / passes), against doc section 4:
  - Moon mix: T1 0.171 (doc 0.17), T2 0.319 (doc 0.32), T3 0.675, T4 1.125, T5 1.650, T6 2.100. Mix passes 1.45 / 1.45 / 1.10 / 1.10 / 1.00 / 1.10.
  - Outpost mix: T1 0.225, T2 0.420, T3 0.728, T4 1.213, T5 1.650, T6 2.265. Mix passes 1.10 / 1.10 / 1.02 / 1.02 / 1.00 / 1.02 (doc 1.10 at Depth 5-7).
  - Both mixes are within +-20% of the doc (differences under 1%). The model implements the rule exactly, so this is expected.

## 2. V3 test (`packages/world/test/unit/dust-ledger.test.ts`)
- Rewritten to the mix-weighted bar: Moon mix (55/35/10) and outpost mix (90/8/2) passes per hand tool must be within +-20% of the rule. Per-pair counts are only sanity-bounded (>= 0.5 x min(rule,1), <= 2 x rule). New floor-2 test: Crater Floor at Depth 5 must measure 1.75-2.18. The no-overlap lanes test is unchanged. All 34 tests in the file pass, tsc and prettier clean.
- Measured passes (strokes to Polished / strokes per pass), rows Highland, Mare, Crater Floor, columns T1..T6:
  - Highland: 0.86 0.85 0.86 0.85 0.85 0.87
  - Mare: 1.76 1.53 0.86 0.87 0.86 0.87
  - Crater Floor: 1.85 1.82 1.79 1.77 0.86 1.49

## Disagreement to flag (doc vs measurement)
The measured mix passes in this harness are lower than the rule. Moon mix T1 1.27 against 1.445 (ratio 0.88), T2 1.185 against 1.45 (**0.82, close to the 0.80 limit**). Outpost T1 0.87, T2 0.84. The designer's quoted measurements (Moon mix T1 1.49 / T2 1.39) are not reproduced by this metric. The cause is that the harness counts the fractional last pass (Polished fires at 85% removal, so Highland reads 0.86, not 1) while the rule counts whole passes. T2 on Mare (1.53 against rule 2) is the main contributor. The test passes, but T2 Moon mix has about 2 points of headroom. If the measurement metric changes (for example rounding up the last pass), the bar needs a re-check. Per the brief, no data was tuned.

Files: `tools/balance-sim/src/model.ts`, `tools/balance-sim/src/sim.ts`, `tools/balance-sim/src/dust-passes.ts`, `packages/world/test/unit/dust-ledger.test.ts`.
