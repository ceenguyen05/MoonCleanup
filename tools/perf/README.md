# @moon-cleanup/perf

**Path:** `tools/perf` - **Owner role:** `performance-profiler`

## Purpose

Benchmarks and capture scripts that back `/perf-check` and the per-tier budgets (draw calls <= 600 on Tier A, CPU frame time, GPU time from
timestamp queries, server tick time and bandwidth per room). Includes micro-benchmarks for `sim`, `world` and `protocol` hot paths and
Playwright-driven client captures. Captures land in `tools/perf/captures/` (git-ignored).

## What Fable will build here

`src/bench/` (Vitest bench / tsx micro-benchmarks for codecs, stroke rasterization, sim step) and `src/capture/` (Playwright runs that
read the client perf HUD export from `apps/client/src/debug`). A `src/run.ts` entry.

## Key contracts consumed

`@moon-cleanup/shared` (render quality presets), `protocol`, `sim`, `world` (public barrels only).

## Commands

```
pnpm perf                                 # turbo run perf --filter=@moon-cleanup/perf
pnpm --filter @moon-cleanup/perf test
```

`perf`, `lint`, `typecheck` are echo placeholders until sources land. Playwright browsers must be installed separately
(`pnpm exec playwright install chromium`).
