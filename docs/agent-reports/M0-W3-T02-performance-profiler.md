# M0-W3-T02 Render spike capture matrix (UHD 620 provisional)

Status: **captures done, focused checks green; per-feature cost split NOT measurable without bench knobs (see recommendations)** / 2026-11-12 / performance-profiler. One machine: i7-8650U, Intel UHD 620, Chrome 157, Windows 11. Tier A/B verdicts BLOCKED (no hardware; OPEN_QUESTIONS Q21). Everything below is "UHD 620 provisional, worst-case iGPU". No installs, no git. My Vite (port 5174) is stopped.

## Part A fixes (done)

- `tools/perf/src/capture/runner.ts`: `__name is not defined` fixed with a plain-string init script (`PAGE_NAME_SHIM`) defining the no-op helper in every page. New flags: `--query "a=b&c=d"` (extra URL params), `--viewport WxH`; bench runs wait for `__mcBench.ready` and log `terrainSource`. Verified with real `cli.ts capture` runs (22 cells).
- `apps/client/src/debug/module.ts`: GPU timing source is `none` on webgl2 (CPU-only, labelled). three itself still begins timer queries per render call because `boot.ts` passes `trackTimestamp: perfEnabled`; to remove the `beginQuery` warnings entirely the integrator should pass `trackTimestamp` only on WebGPU (not my path).

## Method

`tools/perf` capture, headed Chrome 157, 1920x1080 DPR 1, bench v1 `?scene=bench` terrain=real (`terrainSource=real` verified in all 22 cells), orbit-v0 camera, `path=p1`, 8 s warm-up discarded, 15 s capture; matrix 2 runs per cell, sweep 1 run. No scale setter exists, so presets' own floor/ceiling were pinned (`scale=floor|ceil`) and intermediate points emulated with `?dpr` (whole pipeline at that pixel count, not scene-pass-only; Low/Medium cannot reach 1.0 by preset design, High is 1.0). GPU ms is a measurement only where shown (WebGPU timestamp query, intermittent); webgl2 is CPU-only. JSON/MD: `tools/perf/results/M0/matrix-*` and `sweep-*`.

A first pass (22 cells) was discarded: Git Bash rewrote the `terrainBase=/@fs/...` path, so every cell silently ran the stand-in (`standin-fallback`). Fixed with `MSYS_NO_PATHCONV=1`; the runner now logs `terrainSource`.

**Noise warning:** the laptop is shared with other apps and drifts. Today's absolute numbers are 1.5-2x slower than the T07 sweep (webgl2 Medium p50 49 ms vs 26 ms) with the same code. Trust ordering within this session, not absolute ms. Repeat runs vary up to about 10 % (matrix), single-run sweep cells more.

## Matrix (frame ms, median of 2 runs)

| Backend | Preset (scale) | FPS | p50 | p95 | p99 | Render CPU p95 | Draws | Tris | GPU mem ledger |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| webgpu | Low (0.75) | 20.2 | 49.2 | 65.6 | 70.5 | 51.4 | 361 | 760k | 165 MB |
| webgpu | Medium (0.85) | 17.0 | 58.9 | 69.3 | 71.4 | 60.3 | 483 | 1009k | 177 MB |
| webgpu | High (1.0) | 6.2 | 154.8 | 211.3 | 233.0 | 179.5 | 597 | 1280k | 281 MB |
| webgl2 | Low (0.75) | 22.1 | 44.5 | 79.6 | 287.8 | 73.2 | 351 | 761k | 165 MB |
| webgl2 | Medium (0.85) | 19.1 | 49.1 | 76.5 | 147.9 | 67.3 | 350 | 1010k | 177 MB |
| webgl2 | High (1.0) | 6.5 | 141.0 | 308.1 | 646.6 | 295.9 | 361 | 1281k | 281 MB |

Per-pass GPU ms does not exist in r187 (total only); webgl2 real-terrain cost is the total above. Pipelines-after-warm-up is n/a in the CLI (T07 saw 0).

## Render-scale sweep (frame p50 / p95 ms, 1 run)

| Pixel scale | webgpu Low | webgl2 Low | webgpu Medium | webgl2 Medium |
| --- | --- | --- | --- | --- |
| 0.50 | 36.6 / 53.2 | 31.3 / 59.0 | 31.1 / 48.9 (GPU 27.1) | 26.4 / 48.3 |
| 0.60 | n/a | n/a | 47.5 / 58.0 | 38.6 / 55.4 |
| 0.67 | 46.7 / 66.0 | 35.8 / 71.8 | 47.5 / 73.1 (GPU 41.4) | 38.9 / 77.8 |
| 0.75 | 57.4 / 90.1 (matrix 49.2) | 45.2 / 81.5 | 49.8 / 69.2 (GPU 46.5) | 48.1 / 94.9 |
| 0.85 | n/a | n/a | 66.1 / 89.2 (GPU 61.5) | 58.9 / 76.9 |
| 1.00 | High only: 155 / 211 | High only: 141 / 308 | - | - |

Rough fit (webgl2 Medium): frame ms about 9 + 69 x scale^2, i.e. fill/GPU bound. Render CPU p95 tracks frame time (the `render` span waits on the GPU), so the 6 ms WebGPU render-CPU trigger is NOT measurable on this iGPU and no verdict is given. WebGPU timestamps, where present, are 85-95 % of the frame.

## Ranked cost table (UHD 620, bench scene)

1. **Render resolution**: Medium webgpu 0.85 to 0.5 saves about 35 ms (66 to 31); webgl2 about 32 ms (59 to 26). Biggest lever by far.
2. **High pack** (GTAO + TRAA + depth/normal/velocity prepass + 2048 shadow maps, at scale 1.0): about +60-70 ms over Medium area-scaled to 1.0 (about 65-78 ms) versus High 141-155 ms; the prepass redraws the scene (webgpu draws 483 to 597). Unusable here. GTAO vs TRAA vs shadow size are **not individually measured** (no knobs).
3. **Backend**: webgl2 has the lower median (Low 44.5 vs 49.2, Medium 49.1 vs 58.9) but far worse tails (p99 148-647 ms hitches); webgpu has tight tails (p99/p50 1.2-1.5) and a GPU timer. Choose by smoothness, not median.
4. **Third CSM cascade + extra bloom mips (Low to Medium) at equal 0.75 pixels**: webgpu 49 vs 50, webgl2 45 vs 48: about 0-3 ms, inside noise.
5. **Shadow size (1024 on Low and Medium), bloom, SMAA**: not isolated; no large post term visible in the deltas. NOT MEASURED individually.

## Answer for Cee: smooth settings on the UHD 620

- **No cell reaches 45 fps on bench v1**, a stress scene (350-500 draws, 1.0 M triangles, 2100 rocks, all props, orbiting camera). Best cells: webgl2 Medium at 0.5 pixel scale 26 ms (38 fps, p95 48), webgl2 Low 0.5 31 ms, webgpu Medium 0.5 31 ms (p95 49), webgpu Low 0.5 37 ms. Against the frame p95 33.3 ms row (performance-budgets section 1), **no cell passes** (best p95 48 ms). Provisional, worst-case iGPU; the budget row an iGPU falls under is the lowest tier (30 fps).
- A typical solo scene (lighter than the bench) was **not measured**: look-dev S01/S05 are not routed (`VisualsModule` is not registered in `app/boot.ts`) and bench has no light-scene variant. The cost model (about 9 ms fixed + 69 ms x scale^2) suggests a much lighter scene could reach 45+ fps at Low 0.5-0.6, but that is a model, not a measurement.
- **Recommended provisional default for this device:** preset **Low**, SMAA, 2 cascades 1024, WebGPU (webgl2 fallback), render scale at the **0.5 floor** (dynamic resolution 0.5 to 0.6, never 0.75+), no GTAO/TRAA, never High. Medium only if dynamic resolution holds 0.5-0.6. Re-measure with a typical scene before promising 45-60 fps.

## Recommendations for rendering / look workers (proposals; no render/visuals edits made)

1. Bench URL knobs `?gtao=off&traa=off&cascades=1..4&shadowpx=512..2048&bloom=off&aa=smaa|none` to cost each feature at equal pixels.
2. A scene-pass render-scale hook (`?scale=0.67` or a window setter) so the sweep needs no `?dpr` emulation and dynamic resolution can be tested.
3. Register `VisualsModule` in `app/boot.ts` (or allow it in bench) so S01/S05 can be captured; add a light "typical solo" bench variant (about 150 draws, fewer rocks).
4. Keep GTAO/TRAA strictly Tier A; consider half-res GTAO and no second scene draw on Medium.
5. Detect Intel iGPU class as Low by default, with the dynamic-resolution floor 0.5.
6. `boot.ts`: pass `trackTimestamp` only on WebGPU (removes the webgl2 `beginQuery` warnings).
7. Serve `assets/terrain` from the client (until then `--query "terrainBase=/@fs/<abs repo>/assets/terrain/"`, and on Git Bash set `MSYS_NO_PATHCONV=1`).

## Checks

`tsc` (tools/perf, apps/client) clean; eslint clean (tools/perf src, client debug); prettier applied to touched files; vitest tools/perf 13 pass, client `src/debug` 11 pass. Processes: my Vite on 5174 stopped; no Playwright Chrome left; another agent's Vite on 5181 and the user's own Chrome were left alone.

## NOT RUN

Tier A/B (BLOCKED, Q21); draws 200/600/900; path P3; S01/S05 (not routed); per-feature ablation (no knobs); per-pass GPU ms (unavailable); 6 ms WebGPU render-CPU trigger (not measurable here); pipelines-after-warm-up from the CLI; Tier B fallback ladder; a repeat on a quiet machine.
