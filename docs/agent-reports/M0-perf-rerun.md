# M0 perf rerun (open measurements on the final M0 code)

Task: M0 perf reruns (S06 wide/Medium/WebGL2, FXAA vs SMAA, timestamp-query cost, VT-M0-15 + 0.1 deg sweep, dist size) /
status: in-review (partial; stopped by coordinator, no new measurements after 23:44) / 2026-11-13 23:15 to 23:45 local /
performance-profiler / Opus 5.5.

**Machine:** Cee's laptop, i7-8650U + Intel UHD 620 (WebGPU adapter `intel gen-9`, `timestamp-query` present), 15.9 GB,
Windows 11 Pro 10.0.26200, headed Google Chrome (Playwright `channel: chrome`, version not re-read; 157 per the verdict),
1920x1080 DPR 1, Node 26.13.1 (fnm prefix). **Provisional below-Tier-B device: no Tier A/B claim.**
**Not idle:** two contracts workers ran tsc / vitest / verify on `packages/shared` the whole time. CPU load (5 x 1 s average,
`tools/perf/results/M0/rerun/load.log`): build 25 %; S06 run 55 % before / 49 % after; AA run 12 / 63 %; VT runs 14-31 %;
timing A/B 26 / 35 %. Every frame number below is a loaded-machine number.

Method for frame times: `docs/visual-reviews/M0/checks/driver/r3-perf.mjs` (no vsync, scale pinned with `scale=ceil`: Low 0.75,
Medium 0.85, 6 s warm-up + 8 s, app's own `__mcStats` intervals, pages in rotated order, median of 3 pages) on the
capture Vite server (`vite.capture.config.ts`, HMR off, port 5193). The final M0 source was not edited.

## Results

| # | Budget row / check | Verdict | Numbers (median of 3 pages; per-page in the JSON) | Evidence |
| --- | --- | --- | --- | --- |
| 1a | Floor Low S06 `wide`, webgpu, 0.75 | **PASS (prov., loaded)** | 35.5 fps, p50 28.1, **p95 31.4** (31.7 / 31.4 / 30.6) vs 33.3: margin 1.9 ms | `rerun/r3-perf-s06wide.json`, `s06wide.log` |
| 1b | Floor Low S06 `pool`, webgpu, 0.75 (same run, reference) | **PASS (prov., loaded)** | 37.4 fps, 26.7 / **29.0** (29.0 / 28.7 / 30.1) | same |
| 1c | Floor Low S06 `wide`, **webgl2**, 0.75 | **FAIL, marginal (prov., loaded)** | 42.8 fps, p50 22.4, **p95 34.4** (32.8 / 34.4 / 34.8) vs 33.3 (+0.5 tol.): over by 0.6-1.1 ms; tail, not mean (p50 is 11 ms inside) | same |
| 1d | S06 `wide`, **Medium** webgpu, 0.85 | **FAIL (prov.)** | 27.5 fps, 36.3 / **40.9** ms. Medium is not the default on this device (integrated GPUs default to Low) | same |
| 1e | S06 `wide`, Medium webgl2, 0.85 (info) | **FAIL, marginal** | 36.2 fps, 27.7 / 34.1 (30.9 / 34.1 / 34.9) | same |
| 2a | FXAA vs SMAA, Low `typical`, webgpu 0.75, 3x interleaved | **Measured** | FXAA 46.4 fps, 21.4 / 23.9; SMAA 39.3 fps, 25.4 / 30.3: **FXAA saves 4.0 ms p50, 6.4 ms p95** | `rerun/r3-perf-aa.json`, `aa.log` |
| 2b | FXAA vs SMAA, Low S01 | **Measured** | FXAA 47.4 fps, 21.0 / 23.2; SMAA 38.3 fps, 26.1 / 30.1: **FXAA saves 5.1 ms p50, 6.9 ms p95**. All 12 pages 0 console errors, chain confirmed per page (`scene>grade>bloom>fxaa|smaa`) | same |
| 3a | Timestamp-query CPU cost (prod build, `on` = default dynres + GpuTimingModule vs `off` = `&dynres=off`) | **NOT RUN (invalid A/B)** | Both set to 0.75 after ready, but the `on` controller then moved to **0.50 / 0.55** in 2 of 3 pages, so frame time and script time are confounded. The one clean pair (round 0, both 0.75): on 21.0 / 24.9 ms vs off 19.8 / 35.6 ms: one pair, inside noise, no conclusion | `rerun/gpu-timing-ab-typical-low-0.75.json`, `gputiming.log` |
| 3b | Timestamp-query allocation | **No difference detected (prov.)** | Sampled allocation incl. GC'd objects: on 87-92 KB/frame, off 88-90 KB/frame (difference under the page-to-page spread) | same |
| 3c | GPU-timing feed delivers in production | **PASS (functional)** | With vsync (and plain launch) `__mcDynres().signal` = `gpu` on 14 of 15 s, GPU p90 13-21 ms; with the no-vsync launch flags it alternates `gpu` / `interval` (reports stale > 1 s), which also explains `gpuP50: null` in the r3-perf rows | `rerun/gpu-timing-probe.log` |
| 3d | Finding (not a verdict): whole-app allocation rate | **Flag for M1** | Production `typical` Low allocates about **88-92 KB per frame (4.1-5.5 MB/s)** sampled; top self-size frames are minified (`gre`, three `customCacheKey`, `getOwnPropertyNames`). The "no per-frame allocation" rule is unverified for the render path | same (`topAlloc`) |
| 4a | VT-M0-15 edge-width ratio (px), Medium webgpu, final shadow rule | **PASS at t = 0.25 / 0.75; t = 0.5 undecided** | ratio px **1.44 / 2.87 / 0.69** (bar 2). t = 0.5 has only 3 cascade edges (r2b had 2): not a usable statistic. Seam step, horizon off: 0.79 / 0.17 / 6.35 codes (bar 8). Shadowed beyond the CSM (+20 to +120 m) with the horizon term 12.9 / 11.8 / 0.5 %, without 0 %. 0 errors | `rerun/vt15/vt15-medium-webgpu.json`, `vt15-medium-webgpu.log`, `fly-*-medium-*.png` |
| 4b | VT-M0-15 on Low webgpu (info; VT asks Medium/High) | **FAIL ratio at 2 of 3 positions** | ratio px **2.04 / 3.10 / 0.57** (cascade edges n = 20 / 10 / 7); horizon edges are 10.8-21.7 px against tight Low cascade edges. Seam 3.85 / 3.42 / 4.98 codes (pass); far share 9.5 / 14.7 / 2.9 % | `rerun/vt15/vt15-low-webgpu.json` |
| 4c | 0.1 deg sun sweep (11 steps from 4.0 and from 1.0 deg), post contact gap | **PASS** | 0 cm on all 22 steps on Medium webgpu, Low webgpu and Low webgl2; 0 console errors. Stepped, not wall-clock 0.1 deg/s | `rerun/vt04b/vt04b-sweep-{medium-webgpu,low-webgpu,low-webgl2}.json`, `sheet-sweep-*.png` |
| 5a | JS <= 1.5 MB gz | **PASS** | one chunk `index-DgSoD4T8.js` 1,879,649 B raw, **574,277 B gz-9** (38 %) | `rerun/dist-sizes.tsv`, `build.log` |
| 5b | CSS <= 100 KB / fonts <= 300 KB | **PASS** | CSS 4,813 B gz; fonts 111,007 B (woff2) | same |
| 5c | First-load group <= 20 MB (CI size gate) | **PASS** | `pnpm --filter @moon-cleanup/client size:check`: **15.45 MB gzip** (limit 20.00); terrain bins 15.5 MB incompressible dominate | `rerun/size-check.log` |
| 5d | No source map in the deployable dist | **PASS** | no `.map` in `apps/client/dist` (sourcemap only with `MC_SOURCEMAP`); the 10.6 MB map flag of the verdict is cleared | `dist-sizes.tsv` |
| R4 | Idle-machine production capture (typical + S01 Low, 60 s, p99 tails, warm-up, heap) | **NOT RUN** | machine never idle; stopped by coordinator | next step below |

Build: `pnpm --filter @moon-cleanup/client build` at 23:15 (exit 0, 21 s, same content hashes as the 23:12 dist, only
`use client` directive warnings from framer-motion).

## Perf-verdict rows to update (lead / performance-reviewer decides)

- "Floor Low S06": FAIL 21.9 fps -> **PASS (prov.)** for `wide` (31.4 p95) and `pool` (29.0 p95) on webgpu; webgl2 `wide`
  FAIL marginal (34.4).
- Download rows: re-measured on a fresh build (574 KB gz JS, 15.45 MB first-load); "CI size check" NOT RUN -> PASS; .map flag cleared.
- Solo-first lever 3: FXAA on Low is worth **4.0-5.1 ms p50 / 6.4-6.9 ms p95** (not the 5.2 ms estimated from E3/E4).
- dynres GPU-timing report "not measured" item: allocation no difference detected; CPU cost still NOT RUN.

## Next (exact)

1. **Timestamp-query CPU A/B (3a):** the `on` page needs the scale held. Either (a) render owner adds a URL knob that keeps
   timestamps but disables the controller (e.g. `?dynres=hold`), or (b) extend `tools/perf/scripts/gpu-timing-ab.mjs` to
   re-pin `__mcRenderScale(0.75)` every 250 ms in both variants, then on an idle machine:
   `pnpm --filter @moon-cleanup/client build`, `cd apps/client && node node_modules/vite/bin/vite.js preview --port 4183 --strictPort`,
   `MC_BASE=http://localhost:4183/ node tools/perf/scripts/gpu-timing-ab.mjs --out C:/Users/caseyn/Downloads/BroswerMoonSweeper/tools/perf/results/M0/rerun --rounds 5 --tag typical-low-0.75-held`
   (run without the no-vsync flags too, since reports go stale under them).
2. **R4 idle rerun (last, idle machine only):** same preview server, then from `docs/visual-reviews/M0/checks/driver`:
   `MC_BASE=http://localhost:4183/ node r3-perf.mjs --out C:/Users/caseyn/Downloads/BroswerMoonSweeper/tools/perf/results/M0/rerun --tag r4-prod --base "preset=low&backend=webgpu&scale=ceil&perf=1" --variants "typical=scene=typical;s01=scene=s01" --rounds 3 --warm 10 --seconds 60`
   (`perf=1` is needed for `__mcStats` in production; the HUD then shows, cost < 0.2 ms; record load before/after).
3. **VT-15 t = 0.5:** move the cut band or add flyover positions (e.g. `--ts 0.4,0.45,0.55`) so the cascade side has at least 15 edges; Low ratio 2.04-3.10 needs a look decision only if Low is in VT-15's scope.
4. **Whole-app allocation (3d):** a dev-build heap sampling run with readable names on `typical` to find the 90 KB/frame sources (render path, three node cache keys).

## Files

New: `tools/perf/scripts/gpu-timing-ab.mjs`, `tools/perf/scripts/gpu-timing-probe.mjs`, `tools/perf/results/M0/rerun/**`.
Rebuilt: `apps/client/dist`. No source edits. `pnpm --filter @moon-cleanup/perf lint` passes (browser `window` declared
with a `/* global */` comment for the `page.evaluate` code).
Stopped: capture server 5193 and preview 4183 (both mine); no Playwright Chrome left. Note: the drivers resolve
`/c/...` POSIX `--out` paths to `C:\c\...`; my stray output there was moved into the repo, and the pre-existing `C:\c` tree
(not mine) was left alone. Use `C:/...` paths for `--out`.

## Blockers

None for the recorded rows. 3a needs a hold knob or the script change; R4 needs an idle machine.

Commit suggestion: `perf(tools): M0 perf rerun (S06 wide, FXAA vs SMAA, GPU-timing probe/A-B scripts, dist size gate)`
