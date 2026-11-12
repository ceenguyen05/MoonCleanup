# @moon-cleanup/balance-sim

**Path:** `tools/balance-sim` - **Owner role:** `game-designer`

## Purpose

A pacing simulator: runs simulated players through the economy using the real `packages/sim` rules and `packages/game-data` tables and
produces **time-to-unlock curves** and income charts so tuning is evidence-based. Output goes to `tools/balance-sim/out/` (git-ignored).

## What Fable will build here

`src/models/` (player behavior models: casual, optimizer, co-op group) and `src/reports/` (CSV/JSON/markdown curves), plus a `src/run.ts`
entry that accepts a table override for what-if runs.

## Key contracts consumed

`@moon-cleanup/shared` (balance schemas, units), `@moon-cleanup/game-data` (tables), `@moon-cleanup/sim` (economy rules).

## Commands

```
pnpm --filter @moon-cleanup/balance-sim balance   # placeholder -> tsx src/run.ts
pnpm --filter @moon-cleanup/balance-sim test
```
