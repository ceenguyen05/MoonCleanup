# M0 perf idle rerun (S06 / S01 / S05 Low, GPU-timing CPU A/B)

Task: M0 perf close-out on the floor device / status: in-review / 2026-11-14 06:40-07:35 local / performance-profiler / Opus 5.5.

**Machine:** i7-8650U + Intel UHD 620 (WebGPU `intel gen-9`, `timestamp-query` yes), 15.9 GB, Windows 11 Pro 10.0.26200,
headed Chrome 157.0.8103.79 (Playwright `channel: chrome`), 1920x1080 DPR 1, on mains (battery 100 %), Node 26.13.1 (fnm prefix).
Provisional below-Tier-B device: **no Tier A/B claim.**
**Load:** no agent GPU/CPU jobs. Not mine and left running: Cee's `pnpm dev` (vite 5173 + server tsx watch, idle), Cee's own
Chrome, VS Code (about 11 % CPU), OpenAI Codex / computer-use runtime (about 3 %). Whole-machine CPU (`load.log`): 27 % before,
23 % after the frame captures; during capture the test Chrome used about 31 %, everything else under 5 %. This is "quiet",
not lab-idle.

Build: `pnpm --filter @moon-cleanup/client build` (exit 0, `idle/build.log`), served by `vite preview --port 4183`
(production; `perf=1` adds the debug module for `__mcStats`, HUD hidden with `hud=0`).

## Done

### 1. Idle frame-time rerun, Low, scale pinned to the 0.75 ceiling, webgpu unless noted

Driver `docs/visual-reviews/M0/checks/driver/r3-perf.mjs` (unchanged; no vsync, scenes' own fixed views), **10 s warm-up +
60 s, 3 pages per cell, rotated order**, median of pages. 0 console errors on all 15 pages; chain `scene>grade>bloom>fxaa`.

| Cell | fps | p50 | **p95** (per page) | p99 | Budget 30 fps / p95 <= 33.3 (+0.5) | vs loaded rerun |
| --- | --- | --- | --- | --- | --- | --- |
| S06 `wide` webgpu | 36.3 | 27.4 | **29.7** (31.1 / 28.2 / 29.7) | 29.7-35.8 | PASS, margin 3.6 ms | 31.4 -> 29.7 |
| S06 `pool` webgpu | 34.0 | 29.2 | **32.0** (33.0 / 32.0 / 31.6) | 32.4-35.6 | PASS, margin 1.3 ms (thin) | 29.0 -> 32.0 (worse) |
| S06 `wide` **webgl2** | 46.9 | 20.7 | **32.3** (32.3 / 32.5 / 32.2) | 36.6-50.7 | PASS, margin 1.0 ms | FAIL 34.4 -> PASS |
| S01 webgpu | 49.1 | 20.3 | **22.0** (22.0 / 21.6 / 22.8) | 24.3-29.1 | PASS, margin 11 ms | verdict E2 35.4 -> 22.0 |
| S05 webgpu | 49.3 | 20.3 | **21.8** (22.4 / 21.7 / 21.8) | 25.9-30.4 | PASS, margin 11 ms | verdict E2 47.2 -> 21.8 |

Tails: two single hitches over 300 ms (S06 pool round 1 max 331 ms, S06 wide round 2 max 328 ms), cause not isolated;
S06 webgl2 shows a periodic hitch about every 1.35 s (49-78 per page, 16-25 ms each) not seen on webgpu.

**Device script** (`tools/perf device-report --only s01:webgpu:low,s01:webgl2:low --warmup 10 --duration 30`, dev server, orbit
camera, scale 0.75; `idle/device/8c566ede06b8.md`): S01 webgpu 43.9 fps, p50 22.4, **p95 33.7**, GPU p50/p95 **18.3 / 19.9 ms
(measured)**, 190 draws, 0.39 M tris; S01 webgl2 52.6 fps, p95 **35.3** (FAIL by 1.5 after tolerance).

**Measurement caveat (important for the verdict):** the two methods disagree on the tail. `r3-perf` p95 uses the app's
`__mcStats` intervals; the device script and r3's own rAF counter use rAF timestamps. Under `--disable-frame-rate-limit`
the rAF timestamps are quantised (S01: rAF median 20 ms but 8-10 % of intervals over 33.4 ms, while `__mcStats` p95 is 22 and
GPU p95 is 19.9). The S01/S05 p95 above (22 ms) is therefore the app-clock figure; the rAF-clock p95 for the same scenes is
about 33-34 ms. S06 p95s agree better (5 % of rAF intervals over 33.4). Treat S01/S05 as "PASS on the app clock, at the line on
the rAF clock"; a vsync-on 60 s capture settles it (Next 1).

### 2. Timestamp-query CPU A/B (`render/gpu-timing.ts`), S06 `wide` Low webgpu, production

`on` = default URL (dynres + `trackTimestamp` + `GpuTimingModule`); `off` = `&dynres=off` (no queries, no module). Both held at
0.75 by re-pinning `__mcRenderScale` every rAF in both variants (`--hold 1`; off-scale frames: on 0-2 of about 1,100 per page,
off 0). Heap sampler off. CPU = CDP `ScriptDuration` / `TaskDuration` per frame (includes time blocked in WebGPU calls).

| Mode | Variant | Pages | fps | rAF p50 / p95 / p99 | Script ms/frame (range) | Task ms/frame | Signal |
| --- | --- | --- | --- | --- | --- | --- | --- |
| no vsync, 30 s | on | 5 | 36.6 | 27.1 / 30.3 / 33.1 | **23.50** (23.35-23.75) | 27.05 | `interval` 4/5 (GPU reports stale) |
| no vsync, 30 s | off | 5 | 36.6 | 27.1 / 30.3 / 33.1 | **23.33** (22.82-23.53) | 27.05 | `interval` |
| vsync, 30 s | on | 3 | 34.6 | 33.3 / 33.4 / 33.6 | **10.55** (10.47-10.74) | 12.09 | `gpu` 3/3, GPU p90 24.7-27.4 |
| vsync, 30 s | off | 3 | 34.9 | 33.3 / 33.4 / 33.5 | **10.25** (10.00-10.90) | 11.70 | `interval` |

**Result: cost not resolvable from noise.** Delta script time +0.17 ms/frame (no vsync) and +0.31 ms/frame (vsync), task
+0.00 / +0.38; the on and off ranges overlap in both modes; fps and p50/p95/p99 identical within 0.3. Upper bound on this
device: about 0.4 ms/frame main-thread CPU. Vsync pages lock to 30 fps (33.3 / 33.4 ms p95) in both variants: p95 33.4 is inside
33.3 + 0.5. Main-thread task time 11.7-12.1 ms/frame is under the Tier B 14 ms total (includes GPU-wait, so an upper bound).

## Not run

- 60 s vsync-on capture of S01/S05/S06 (resolves the rAF-vs-app-clock p95 disagreement).
- S05/S06 via the device script: `device-report` only plans `bench` and `s01` (`matrixPlan`); r3-perf was used instead.
- Allocation (3b/3d), p99 hitch source, 10-min soak: out of scope here.

## Next

1. `MC_BASE=http://localhost:4183/ node r3-perf.mjs ... --rounds 3 --warm 10 --seconds 60` with a vsync launch (r3-perf has no
   flag; add one to a tools/perf copy) for S01/S05/S06 Low, so the rAF clock is the display clock.
2. Profile the 1.35 s periodic hitch on S06 webgl2 and the two 330 ms single hitches (Performance trace on a production build).
3. Optional tool change: add `s05`/`s06` scenes and a `--view` to `device-report`, so the device script covers all floor scenes.

## Files

Changed: `tools/perf/scripts/gpu-timing-ab.mjs` (`--hold`, `--vsync`, `--heap 0`, rAF p50/p95/p99, off-scale count; lint passes).
New: `tools/perf/results/M0/idle/**` (`r3-perf-idle-low.json`, `idle-low.log`, `gpu-timing-ab-s06wide-low-held-{novsync,vsync}.json`,
`gputiming-*.log`, `device/8c566ede06b8.{json,md}`, `device-report.log`, `load.log`, `build.log`). Rebuilt `apps/client/dist`.
No app source edits. Preview 4183 stopped; no Playwright browser left; Cee's dev servers untouched.

## Blockers

None. Defects: none found in source. Tool limitation: device script cannot run S05/S06.

Commit suggestion: `perf(tools): M0 idle perf rerun (S06/S01/S05 Low) and held GPU-timing CPU A/B`
