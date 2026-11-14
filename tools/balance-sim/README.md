# @moon-cleanup/balance-sim

**Path:** `tools/balance-sim` - **Owner role:** `game-designer`

## Purpose

A pacing simulator: runs simulated players through the economy using the real `packages/sim` rules and `packages/game-data` tables and
produces **time-to-unlock curves** and income charts so tuning is evidence-based. Output goes to `tools/balance-sim/out/` (git-ignored).

## v0 (M1-W2-T05)

Policy `mvp` only (MVP_SCOPE content: no Puck Former, rails or Assembly Gun; Motor Pool pre-built; Roost cap 3). Pure TS, seeded, no DOM.
`src/sim.ts` (2 s fixed-step rate model of the sweep/carry/pour cycle, Trundle haul cycle and Sandpipers), `catalog.ts` (items from MVP_SCOPE + tables),
`model.ts` (model constants, printed in every report), `targets.ts` (evaluates `pacing-targets.json` rows with policy `mvp`; other policies are SKIPPED),
`monte-carlo.ts` (seeded P10/P50/P90), `report.ts`, `cli.ts`. Archetypes: `efficient` (scripted opening then greedy score) and `casual` (skill 0.7, list order).
Verdicts: PASS (inside the band), PASS_EDGE (outside the band, inside `toleranceFrac`), FAIL (outside both; `--assert` exits 1). v1.0 rows (`efficient`) need the full simulator (M2).

## Key contracts consumed

`@moon-cleanup/shared` (balance schemas, units), `@moon-cleanup/game-data` (tables), `@moon-cleanup/sim` (economy rules).

## Commands

```
pnpm --filter @moon-cleanup/balance-sim balance                         # nominal runs, writes out/report.md|json|csv
pnpm --filter @moon-cleanup/balance-sim balance -- --runs 200 --seed 7  # adds Monte Carlo P10/P50/P90
pnpm --filter @moon-cleanup/balance-sim balance:assert                  # exit 1 on any FAIL row
pnpm --filter @moon-cleanup/balance-sim test
```
