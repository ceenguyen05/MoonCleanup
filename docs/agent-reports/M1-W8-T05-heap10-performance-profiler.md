# M1-W8-T05 10-minute client heap soak (performance-profiler)

Date: 2026-11-14. Status: DONE. Result: PASS against the budget (reports only; performance-reviewer issues the verdict).

## Setup

- Machine: Intel UHD Graphics 620 (ANGLE D3D11, gen-9) laptop, Windows 11 Pro 10.0.26200, headed Google Chrome 157 (Playwright channel chrome), 1920x1080 DPR 1, vsync on, WebGPU backend, Tier B detected, preset Low (render scale 0.5 as reported by the HUD snapshot). Node 26.13.1.
- Client: Vite dev server (not a production build) on port 5220 (offset +47), URL `?scene=typical&solo=1&perf=1&preset=low`. The typical worksite with the Solo LocalRoom host forced on, camera at default. No full solo game loop exists yet, so this is the closest available solo configuration. Dev build heap is likely a little higher than production.
- Quiet machine, no other agents running.
- Tool: new `tools/perf/scripts/heap-soak.mjs` (samples CDP `Runtime.getHeapUsage` every 5 s, forced GC via `HeapProfiler.collectGarbage` x2 at start, mid (300 s) and end, in-page rAF long-frame counter, longtask observer) and `heap-soak-report.mjs` (reducer). Raw data: `tools/perf/results/M1/heap10-raw.json` (122 samples).
- Server and browser were stopped afterwards; no Chrome from the run remains.

## Numbers (JS heap used, MB, after forced GC unless noted)

| Point | Heap |
| --- | --- |
| Start (forced GC, t=0) | 40.7 |
| Mid (forced GC, t=300 s) | 40.9 |
| End (forced GC, t=600 s) | 40.9 |
| Peak (unforced sample, t=240 s) | 52.5 |
| Unforced sawtooth per minute | floor 41-42.6, ceiling 44.3-52.5 |
| Chrome `performance.memory` peak (the HUD source, not GC'd, coarser) | 105.3 |

Growth slope after warm-up: raw samples t>=60 s: -0.04 MB/min; forced-GC points: +0.02 MB/min (0.2 MB over 10 min, within noise).

## Budget

performance-budgets.md: JS heap (used, steady state) <= 300 MB on Tier B / floor. Peak 52.5 MB (105 MB by the HUD's unforced figure): PASS with a wide margin (about 195 MB headroom on the worst reading).

## Frames and pauses

- 26,291 frames over 600 s (about 44 fps, vsync, UHD 620 Low). Frames over 50 ms: 13 total (2 at load before the run began, 7 in the first 5 min, 4 in the second), max frame 183 ms. Frames over 33.4 ms: 2,363 (about 9%; the scene runs ~44 fps on this iGPU, so this is render cost, not GC).
- Longtasks (>50 ms main-thread tasks): 0 in the whole run. So the 13 slow frames are GPU-bound or compositor stalls, not main-thread JS or GC pauses of 50 ms or more.
- GC pause times themselves were NOT traced (no Chrome tracing run); the longtask count of 0 bounds any GC pause on the main thread at under 50 ms.

## Leak assessment

No leak signal: the forced-GC floor is flat (40.7, 40.9, 40.9) and the minute-by-minute floor does not trend. The sawtooth ceiling varies 44-52 MB without trend. Nothing to flag.

## Limits (honest)

- Only the typical worksite plus Solo host, idle camera and no player input, no tool use, no dust strokes, no selling: allocation paths of real gameplay are not exercised. Rerun once the solo slice exists (the script takes any `--query`).
- GPU memory not measured here (JS heap only). Dev server build, not production. One run, not N.
- 5 console warnings (powerPreference ignored on Windows, `toNonIndexed` already non-indexed, two unused font preloads); no page errors.

Re-run: start client on a free port, then
`MC_BASE=http://127.0.0.1:<port>/ node tools/perf/scripts/heap-soak.mjs --minutes 10 --out <file>` and
`node tools/perf/scripts/heap-soak-report.mjs <file>` (Node 26 prefix; run from tools/perf).
