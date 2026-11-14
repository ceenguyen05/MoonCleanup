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

## Device report (send-back capture for other machines)

One command measures the real GPU on any machine and writes one small anonymous file pair for the owner to paste or send. It is how
the BLOCKED Tier A / Tier B verdicts (OPEN_QUESTIONS Q21) become measured ones.

Prerequisites (once): Node 26 via nvm/fnm (`.nvmrc`), pnpm, `pnpm install` at the repo root, and `pnpm exec playwright install chromium`
(only needed as the fallback; an installed Google Chrome is preferred so the real GPU driver is used).

```
pnpm --filter @moon-cleanup/perf device-report            # about 4 min, progress printed, includes --verdict
pnpm --filter @moon-cleanup/perf device-report -- --channel msedge --no-look
pnpm --filter @moon-cleanup/perf device-verdict tools/perf/results/device-reports/<id>.json   # re-run the comparison later
```

Flags: `--channel chrome|msedge|chromium` (default `chrome`, falls back to bundled Chromium with a warning), `--warmup 4`,
`--duration 10` (seconds per cell), `--no-look` (skip the S01 look scene), `--headless` (not recommended), `--out <dir>`,
`--only scene:backend:preset,...` (smoke), `--seed`. Keep the browser window visible and the machine otherwise idle while it runs.

What it does: starts the client dev server on a free 127.0.0.1 port, probes WebGPU (adapter vendor/architecture/description, limits,
`timestamp-query`), records which backend/tier/preset the game's own detector picks with no overrides, then runs
`{webgpu, webgl2} x {Low, Medium, High}` at 1920x1080 DPR 1, render scale pinned to each preset's ceiling (`?scale=ceil`; Low 0.75,
Medium 0.85, High 1.0), on `?scene=bench` (terrain=real, source recorded) and `?scene=s01`. Per cell: FPS, frame p50/p95/p99, GPU ms
(only when a WebGPU timestamp query measured it, otherwise n/a), CPU p95, draws, triangles. A cell that fails is recorded and skipped.
Missing WebGPU skips the webgpu cells and says so.

Privacy: nothing is sent anywhere (only loopback). Strings are scrubbed of user name, host name, home/working/temp paths and path shapes;
the file name is a random id; the writer refuses to write if a secret or path still appears. Review the `.md` before sending if you wish.

Output: `tools/perf/results/device-reports/<id>.json` and `<id>.md`. Everything started (dev server, browser) is stopped on exit and Ctrl-C.
A SwiftShader/llvmpipe renderer string prints a warning and makes every verdict row INVALID.

Verdict: compares with performance-budgets.md section 1/3/4 rows (Tier A High 16.7 ms p95 / 60 FPS / 600 draws / 4 M tris; Tier B
Medium and iGPU-floor Low 33.3 ms / 30 FPS / 350 draws; Tier B 1.5 M tris, floor 1.0 M tris; GPU p95 14 / 28 ms when measured). A row is
labelled provisional unless the adapter matches the tier definition (A: RTX 4050/4060/5050/5060 Laptop; B: Iris Xe, Arc 140V, Radeon 780M;
floor: any integrated GPU). On a faster-than-tier machine a FAIL is real evidence against the tier; a PASS is only an upper bound.
It reports; performance-reviewer issues the verdict.
