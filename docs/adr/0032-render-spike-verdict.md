# ADR-0032: M0 render spike verdict - stay on three r187 WebGPURenderer + TSL

- **Status:** Accepted, lead, 2026-11-14. Verdict is **NOT PASSED, CONDITIONAL**; the engine decision of [ADR-0003](0003-rendering-engine-threejs-webgpu.md) stands.
- **Closes:** M0 exit criterion E7 ([M0-foundation.md](../milestones/M0-foundation.md)).
- **Evidence:** [M0-perf-verdict.md](../agent-reports/M0-perf-verdict.md), `tools/perf/results/M0/` (matrix, sweep, rerun, idle), [M0-W3-T02-performance-profiler.md](../agent-reports/M0-W3-T02-performance-profiler.md), [M0-W3-T08-perf-pass.md](../agent-reports/M0-W3-T08-perf-pass.md).

## Context

E7 requires Tier A / Tier B / WebGL2 numbers after look-dev v0 on the real baked height cube, and the Babylon revisit trigger evaluated on that run. The trigger (ADR-0003, tech-stack §2): WebGPU-path CPU frame time > 6 ms on Tier B for the MVP scene, or a blocking WebGPURenderer bug persisting > 2 releases.

## What was measured

- One device only: Intel UHD 620 laptop (i7-8650U, 15.9 GB, Win 11, headed Chrome 157, 1920x1080 DPR 1), below Tier B, used as a provisional floor. Evidence is single-run per cell, 8-12 s captures (not the 60 s after 10 s warm-up of the budgets), Vite dev server, a noisy shared machine (1.5-2x drift between days).
- Bench v1 matrix and sweep ran on the real baked terrain (`terrainSource=real` verified in all 22 cells; a first pass that silently used the stand-in was discarded).
- Floor Low, `typical` scene, webgpu, scale ceiling 0.75: p50/p95 26.8 / 31.3 ms, 37.3 fps, GPU p95 24.0 ms (PASS, provisional); 30 fps vsync-locked with dynres held 33.3 / 33.6 ms. Zero frame-time headroom, reached by trading resolution.
- Same scene, webgl2 Low 0.75: p95 35.5 ms vs 33.3 (marginal FAIL). Medium webgpu 0.85: p95 45.9 ms, 32.4 fps (FAIL).
- Look-dev scenes, webgpu Low 0.75: S01 p50/p95 28.0 / 35.4 ms (35.0 fps, within noise); S05 34.3 fps but p95 47.2 ms; S06 (night lamp) 21.9 fps, p50/p95 42.0 / 85.1 ms, unprofiled (blocking for S06).
- Bench (stress) scene: High on UHD 620 9.2 fps, p95 239 ms (info only); Medium 24.2 fps, p95 55.0 ms; Low 28.1 fps, p95 53.1 ms at scale 1.0. No bench cell passes 33.3 ms p95.
- Tails: p99 234.7 ms (S01 script), 622.6 ms (bench webgl2 Low); cause not isolated.
- Download: JS 571,188 B gz (budget 1.5 MB), CSS 4,658 B gz, fonts 111 KB; terrain bins add 15.5 MB if fetched early. GPU memory ledger 165 / 177 / 281 MB (Low / Medium / High).
- Not run: GPU per-pass split, 10-minute heap soak, production-build capture, shader warm-up and LCP, animated content.

## Tier status

**Tier A and Tier B are BLOCKED**: no matching hardware (Q21). No Tier A/B pass or fail is claimed. Rows from the UHD 620 are floor-device evidence only.

## Babylon revisit trigger

- **6 ms WebGPU render-CPU trigger: not settled by the numbers.** On the real-bake run, render CPU p95 tracks frame time because the `render` span waits on a GPU-bound frame (matrix webgpu Low: render CPU p95 51.4 ms, frame p95 65.6 ms). The iGPU is GPU-bound, so the data neither support nor refute the 6 ms threshold. It needs Tier B hardware.
- **Blocking WebGPURenderer bug persisting > 2 releases:** none recorded in the evidence.
- Consequence: the trigger has not fired and cannot be called cleared. The contingent task M0-W4-T01 (Babylon prototype) is not started.

## Decision

Stay on three r187 WebGPURenderer + TSL with the WebGL2 fallback. No evidence favors Babylon; the observed cost is GPU fill (webgl2 Medium fit: frame ms about 9 + 69 x scale^2), which an engine switch would not remove. The trigger is carried forward and re-evaluated on Tier B hardware.

## Conditions and follow-ups

- Reruns R1-R7 in the verdict (device-script scale pin, floor-spec 60 s captures, S06 profile, production-build capture, 10-minute heap soak, dist rebuild, server RSS) before any "solo feel holds on the floor" claim at the M1 gate.
- Floor levers: pixel scale (largest), SMAA (7.6 of 27.9 ms Low; FXAA 2.4 ms, +8 fps, needs a contract change), shadows about 8 ms, bloom 2.3 ms.
- 30 fps on the floor is at risk with M1 content (avatars, robots, dust ring, AO, night lights).

## Revisit trigger

Tier B hardware shows WebGPU render CPU p95 > 6 ms on the MVP scene, or a blocking WebGPURenderer bug persists > 2 releases.
