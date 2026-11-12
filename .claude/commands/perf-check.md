---
description: Capture frame-time, memory, draw-call, download-size and server-tick numbers and have performance-reviewer judge them against docs/architecture/performance-budgets.md.
argument-hint: "[M#-W#, optional]"
allowed-tools: Read, Write, Glob, Grep, Agent, SendMessage
---

# /perf-check

Performance gate for `$ARGUMENTS` (default: the current wave in `docs/STATUS.md`). You are the lead. Never run git.

## Inputs

- `docs/architecture/performance-budgets.md` (Tier A and Tier B definitions and every numeric budget: the only pass/fail source)
- `tools/perf/**` (capture scripts), the latest `/bot-test` report, `tools/asset-pipeline` budgets-check output
- `docs/research/tech/platform-limits.md` for the Render Free (0.1 CPU, 512 MB, 5 GB egress) context
- Preset numbers: `docs/architecture/rendering-pipeline.md` §14 (canonical); Tier B fallback ladder §14.2; `tools/perf` refuses to target `PROD_SERVER_HTTP_URL` (production is never a test target)

## Procedure

1. **Check tooling.** If `tools/perf` or the F3 HUD export does not exist or cannot run, launch `performance-profiler` first (owned files: `apps/client/src/debug/**`, `tools/perf/**`), unique port offset, wait.
2. **Capture** with `performance-profiler` (or run its documented scripts): fixed seed, fixed camera path, fixed duration, warm-up discarded, at least 3 runs, median and spread, on **Tier A** (High), **Tier B** (Medium, the real iGPU device named at M0 Gate G1) and **Tier C** (Low, `webgl2`) at the presets the budgets doc names. Backends are `webgpu` / `webgpu-compat` / `webgl2`; the Tier B verdict is marked provisional if the device is the Tier A laptop's iGPU. Record machine, GPU, browser, OS. GPU numbers must come from timestamp queries or be labeled estimates.
3. **Gather the other budget inputs:** gzipped first-load JS and asset sizes, JS heap growth over a 10-minute soak, draw calls (at most 600 on Tier A), server tick ms and bandwidth per player from the latest local `/bot-test` report (a `--staging` run only if the gate plan says so; never production).
4. **Launch `performance-reviewer`** (`subagent_type: performance-reviewer`, no isolation) with the capture paths, budgets doc, the unique port offset, and the review file to write. It judges each budget PASS/FAIL with margin, flags UNVERIFIED items, and flags revisit triggers (for example WebGPU-path CPU above 6 ms on Tier B for the MVP scene).
5. Wait for the notification; read the review file; confirm every number cites its source file.

## Output

- Captures under `tools/perf/` output location named in its README; report `docs/agent-reports/<M#-W#>-perf-check.md` (table: budget, limit, measured, margin, PASS/FAIL/UNVERIFIED, source) and `docs/agent-reports/<M#-W#>-review-performance-reviewer.md`.

## Pass / fail criteria

- PASS: every applicable budget in performance-budgets.md is met on Tier A and Tier B with the stated margin, no UNVERIFIED hot-path item, no monotonic memory growth.
- FAIL: any budget miss beyond noise, or unmeasured hot-path claims. Route findings to the owner roles (rendering-engineer, terrain-dust-engineer, technical-artist, gameplay-systems-engineer, netcode-engineer) and re-run only the failed measurements after the fix.
