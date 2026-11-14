# M0-W3-T09 One-command device capture

Status: **done, focused checks green; one 1-cell smoke run on this machine (UHD 620); full matrix NOT RUN here by instruction** / 2026-11-13 / performance-profiler. No installs, no git, no apps/** or packages/** edits. All processes started were stopped.

## Deliverable

- `pnpm --filter @moon-cleanup/perf device-report` (root `pnpm perf` is a turbo wrapper that cannot forward args, so the filter form is the documented command; `device-verdict <json>` re-runs the comparison). Flags: `--channel chrome|msedge|chromium` (default chrome, falls back to bundled Chromium with a warning), `--warmup 4 --duration 10`, `--no-look`, `--only scene:backend:preset,...`, `--out`, `--headless`, `--seed`.
- Files: `tools/perf/src/device/{report,verdict,run}.ts`, `device.test.ts`; `cli.ts` commands `device-report` and `verdict`; `capture/runner.ts` exports `oneRun` (returns `terrainSource`, `readyTimeoutMs` option); package scripts; README section (prerequisites, flags, privacy, verdict rules).
- Flow: free 127.0.0.1 port, Vite dev server spawned directly with node (no shell), WebGPU probe (adapter vendor/architecture/description, limits, timestamp-query), game tier detector read with no overrides, matrix {webgpu, webgl2} x {Low, Medium, High} on `?scene=bench` (terrain source recorded, must be real) and `?scene=s01`, 1920x1080 DPR 1, `?scale=ceil` (the only pin the client offers is floor|ceil: Low 0.75, Medium 0.85, High 1.0, actual scale recorded per cell). 12 cells x (4 s warm-up + 10 s capture + about 6 s load) is about 4.3 min. Failed or missing-WebGPU cells are recorded and skipped.
- Output: `tools/perf/results/device-reports/<random-id>.{json,md}`. Privacy: loopback only; user name, host name, home/cwd/tmp paths and path shapes scrubbed (whole-token match); id is random; the writer refuses to write if a secret or path remains. Verified on the smoke output (no user or path strings).
- Cleanup: dev server (taskkill /T on Windows) and browser closed in `finally` and on SIGINT/SIGTERM.
- SwiftShader/llvmpipe renderer string prints a warning and every row becomes INVALID.
- `--verdict`: Tier A High (16.7 ms p95, 60 FPS, 600 draws, 4 M tris, GPU p95 14), Tier B Medium (33.3, 30, 350, 1.5 M, GPU 28), iGPU floor Low on WebGPU and WebGL2 (33.3, 30, 350, 1.0 M). PASS/FAIL/NO DATA/INVALID with numbers and margin; labelled provisional unless the adapter matches the tier definition (A: RTX 4050/4060/5050/5060; B: Iris Xe/Arc 140V/780M; floor: any iGPU). Frame p95 allows 0.5 ms for display-refresh quantisation (documented). Reports only; performance-reviewer decides.

## Checks

tsc clean, eslint clean, prettier applied, vitest tools/perf 26 pass (new: anonymiser, leak finder, id, schema validation, software detection, markdown, plan/time budget, verdict pass/fail/provisional/no-data/invalid).

Smoke (1 cell, `bench:webgl2:low`, 2 s warm-up, 5 s capture, headed Chrome 157, UHD 620, machine load about 10 %): terrain=real, 22.6 fps, p95 53.4 ms, verdict row FAIL as expected for the iGPU floor. Not a measurement of record.

## Notes / for Cee and the lead

- S01 is routed in the app, but the S01 cells were not exercised here; a failing S01 cell is recorded as failed and does not stop the run.
- GPU ms appear only where the WebGPU timestamp query measured them; webgl2 is CPU-only (n/a, never an estimate).
- Dev server (not a production build) is used: JS parse/transform cost is outside the timed window but heap figures are dev-build values.
- The adapter `description` is empty in Chrome 157 on this machine; the verdict falls back to adapter device plus the GPU renderer string.

## NOT RUN

Full 12-cell matrix; macOS and Linux (code is platform-neutral: no shell, `taskkill` only on win32); real Tier A/B hardware (the point of the tool); msedge channel; S01 cells.
