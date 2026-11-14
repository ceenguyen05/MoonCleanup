# M0 performance verdict

performance-reviewer / 2026-11-13. **Evidence reuse only: no new captures, no builds, no GPU load started by me.** Hardware: one Intel UHD 620 laptop (i7-8650U, 15.9 GB, Win 11, headed Chrome 157, 1920x1080 DPR 1), a provisional below-Tier-B worst case. **No Tier A or Tier B verdict exists or is claimed; every Tier A/B row is BLOCKED (Q21).** The "iGPU floor" rows (Low preset, 30 fps, 33.3 ms p95, 350 draws, 1.0 M tris, GPU p95 28) are the only rows this device can judge, and even those are provisional (1 run per cell, 8-12 s captures, not the 60 s after 10 s warm-up of budgets section 8).

## Overall

**M0 performance: NOT PASSED, CONDITIONAL.** Nothing is proven at a conforming scale on a conforming scene. On the one scene that stands in for solo play (`typical`) the floor device reaches 30 fps only by trading resolution (Low at the 0.75 ceiling, vsync-locked) with no frame-time headroom. The look-dev scenes S01/S05/S06 miss the floor p95 row; S06 also misses fps. Download size is inside budget. Server tick and bandwidth are inside budget locally, but never inside a 0.1-CPU container and server RSS is unmeasured. No blocker for finishing M0 scaffolding; blockers for claiming "solo feel holds on the floor" at M1 (section "Solo-first").

## Evidence index (all UHD 620)

| Id | Source | Notes |
| --- | --- | --- |
| E1 | `tools/perf/results/device-reports/8503205715bc.md`, `8aea5f4a797d.md` (device script, 15:45 and 16:00 UTC) | bench + S01, **before the r2b ground fix**; header says "scale ceil" but the Scale column is 1.00 (see Tool defect) |
| E2 | `docs/visual-reviews/M0/checks/r2b/device/{before,after}/*.md` (17:07 UTC), `docs/agent-reports/M0-look-polish-r2b.md` | S01/S05/S06 on real regolith; free-running Low at ceiling 0.75, one 8 s page per cell |
| E3 | `docs/agent-reports/M0-W3-T08-perf-pass.md`, `tools/perf/results/M0/t08/**` | `typical` scene, dynres, knobs; 8 s warm-up + 12 s, no vsync |
| E4 | `docs/agent-reports/M0-W3-T02-performance-profiler.md`, `tools/perf/results/M0/{matrix,sweep}-*` | bench matrix, 2 runs/cell, machine noisy (1.5-2x slower than other days) |
| E5 | `M0-W2-T02-rendering-engineer.md` | heap 60 s, pipelines after warm-up |
| E6 | `M0-W2-T04-longrun-qa-test-engineer.md`, `M0-quiet-runs.md`, `M0-netcode-live-confirmation.md` | 6-bot 10 min runs, real server entry under tsx, loopback |
| E7 | `apps/client/dist` (built 10:49 local), `apps/server/dist` (11:06) | I measured sizes with gzip -9 (same method as `tools/perf/src/download.ts`) |

## Verdict per budget row

Status key: PASS / FAIL / NOT RUN / BLOCKED (no matching hardware or environment). "(prov.)" = floor device only.

### Frame time and GPU (sections 1-3, 4)

| Row | Verdict | Evidence |
| --- | --- | --- |
| Tier A: 60 fps / 16.7 ms p95, CPU <= 8 ms, GPU <= 14 ms, draws <= 600 | **BLOCKED** (no Tier A). For info only: High on UHD 620 is 9.2 fps, p95 239 ms (bench, E1) | Not a Tier A fail; High is unusable on this device |
| Tier B: 30+ fps / 33.3 ms p95, CPU <= 14, GPU <= 28, draws <= 350 | **BLOCKED** (no Tier B; UHD 620 is below class). Provisional bench Medium: 24.2 fps, p95 55.0, GPU p95 35.4 at scale 1.0 (E1) | Real evidence against nothing yet |
| Floor Low, `typical` scene, webgpu, ceiling 0.75, free-running | **PASS (prov.)** | p50/p95 26.8 / 31.3 ms, 37.3 fps, GPU p95 24.0, 190-255 draws, 346-454k tris (E3). With dynres and vsync: held 33.3 / 33.6 ms (30 fps lock, E3) |
| Floor Low, `typical`, webgl2, ceiling 0.75 | **FAIL, marginal (prov.)** | p95 35.5 vs 33.3 (+0.5 tolerance = 33.8): over by 1.7 ms; p50 20.4, 50.9 fps. Floor 0.5 passes (p95 32.6). CPU-only, no GPU timer |
| Floor Medium `typical`, webgpu, ceiling 0.85 | **FAIL (prov.)** | p95 45.9 ms, 32.4 fps; passes only when the controller sits at 0.75-0.85 (E3). Medium is not the default on this device |
| Floor Low S01 (real ground), webgpu, 0.75, free-running | **FAIL, within noise (prov.)** | p50/p95 28.0 / 35.4 ms (35.0 fps) vs 33.3: over by 2.1 ms. Identical pages differed up to 5 ms on this machine, so non-blocking, re-measure required (E2) |
| Floor Low S05 (real ground), webgpu, 0.75 | **FAIL (prov.)** | 34.3 fps but p50/p95 28.0 / 47.2: p95 over by 13.9 ms, a tail problem (E2) |
| Floor Low S06 (night lamp), webgpu, 0.75 | **FAIL (prov.), blocking for S06** | **21.9 fps**, p50/p95 42.0 / 85.1 ms (E2). 3 extra lights, one with its own shadow map; **not profiled**. Fails both fps and p95 by a wide margin, not noise |
| Floor Low S01, device script (E1/E2 after) | **FAIL, but not a spec condition** | **20.7 fps**, p95 66.6, p99 234.7 at scale **1.0** (E2 after; before the ground fix 3.6-3.7 fps, E1). The Low range is 0.50-0.75, so this cell is 1.0 versus a 0.75 ceiling: it overstates the miss by roughly (1/0.75)^2 on fill. It is still the only scripted, reproducible S01 command, so the miss is recorded, not waived |
| Floor Low bench (stress scene), webgpu, scale 1.0 | **FAIL (prov.)** | 28.1 fps, p95 53.1, GPU p95 33.5 (E1). Bench is a deliberate worst case (up to 2100 rocks, orbit camera); at pixel scale 0.5 the best cells reach p95 48 ms (E4): no bench cell passes 33.3 p95 |
| Floor Low, WebGL2 (Tier C), bench / S01 | **FAIL (prov.)** | bench 25.5 fps, p95 78.6; S01 4.9 fps, p95 421 (E1, pre-fix, scale 1.0). S01 webgl2 after the ground fix: NOT RUN (r2b was webgpu only for frame cost) |
| GPU per-pass split (budgets section 3 table) | **NOT RUN** | r187 exposes total only; timestamps present in about 1/3 of captures (E3). Only whole-frame GPU p95 exists |
| WebGPU render CPU > 6 ms revisit trigger | **NOT RUN / not measurable** | Render CPU p95 tracks frame time because the `render` span waits on a GPU-bound frame (E4). Needs a faster GPU; no verdict |
| Main-thread CPU split per subsystem (section 2) | **NOT RUN** | Spans exist in the debug module; no per-subsystem table was captured with M0 content, and M0 has no animation, sim predict or net in the frame |
| Frame time p99 hitches | **FAIL (prov.)** | p99 of 234.7 ms (S01 script), 622.6 (bench webgl2 Low), 94-530 ms elsewhere (E1/E2). Tail frames, not averages, are the solo-feel risk; cause not isolated (shader compile? GC? dev server?) |
| Dynamic resolution controller | **PASS (functional, prov.)** | Climbs from the 0.5 floor to 0.75 (Low) / 0.8-0.85 (Medium) and takes failed probes back (E3). Does not yet steer on GPU ms (hook-up request 3 of T08 open) |

### Draws, triangles, pipelines, memory (section 4)

| Row | Verdict | Evidence |
| --- | --- | --- |
| Draws <= 350 (B/C), production scenes | **PASS (prov.)** | typical 190-255, S01 192.5 (E1-E3) |
| Draws <= 350, bench | **FAIL** (stress scene) | webgpu Low 361-424, Medium 483-489; webgl2 Low 351-378 (E1, E4). Bench exists to exceed it, but there is no Tier B draw cap enforcement in the renderer |
| Draws <= 600 (A) | **PASS, no headroom** | bench High 595-599 (E1, E4, E5). Not a Tier A claim |
| Shadow-pass share of draws (<= 200 A / 100 B) | **NOT RUN** | not counted separately |
| Triangles (1.5 M B / 1.0 M floor / 4 M A) | **PASS (prov.)** | bench Low 0.76 M, Medium 1.00 M, High 1.27 M; S01 0.53-0.88 M; typical 0.35-0.45 M (E1, E3) |
| Pipelines created during gameplay = 0 | **PASS, stale** | 0 after warm-up in bench Medium 60 s and High 30 s (E5) and T07; **not re-checked** after T08 / look-polish (baked sky, `pcf3`, real ground, S01-S06 scenes) |
| GPU memory (own ledger) | **PASS (prov.)** | 165 / 177 / 281 MB for Low / Medium / High vs 1.0-1.25 GB B/C, 3.0 GB A (E4). Per-category lines (dust atlas, ring, shadow maps, RT) not itemised; dust atlas, ring and horizon map are not yet in the M0 frame |
| JS heap <= 300-400 MB, no monotonic growth over 10 min | **NOT RUN (10-min soak)**; short evidence **PASS** | 61.3 -> 61.6 MB over 60 s, 62.3 -> 62.6 MB over 30 s, dev build (E5, T07). Hot-path allocation: code review only, no allocation profiler run. GC pause p95 <= 5 ms: NOT RUN |
| Animated robots, skinned avatars, S3 factory scene | **NOT RUN** | no content in M0 |

### Download and load (section 5), dist built 10:49 local (**before** the 11:19 r2b edits; re-measure after a rebuild)

| Row | Verdict | Evidence |
| --- | --- | --- |
| JS <= 1.5 MB gz total | **PASS** | single chunk `index-*.js` 1,874,566 B raw, **571,188 B gz** (38 % of budget). One chunk, no code splitting, so first-load JS equals total JS |
| CSS <= 100 KB | **PASS** | 20,674 B raw, 4,658 B gz |
| Fonts <= 300 KB | **PASS** | three woff2, 111 KB (already compressed) |
| First-interactive group <= 20 MB | **PASS** | HTML + JS + CSS + fonts is about 0.69 MB gz. Worst case, if the three terrain bins were also fetched before the lobby: +15.5 MB (`height-cube-1024` 7.9 MB, `horizon-map` 7.0 MB, `height-cube-256` 0.6 MB, **incompressible, gzip gains 0 %**) = about 16.2 MB, still inside |
| First in-world frame <= 50 MB cumulative | **PASS, weak** | about 16.2 MB, but M0 has no avatar, audio, KTX2 material or lobby moon assets yet. Re-judge at M1 |
| High pack <= 120 MB, total streamed <= 250 MB | **NOT RUN** | packs do not exist |
| Cold-cache <= 5 s at 50 Mbit/s, warm <= 2 s, Clock In -> first frame <= 8 / 12 s, shader warm-up <= 4 / 8 / 10 s, LCP / INP / CLS | **NOT RUN** | no throttled Playwright load, no Lighthouse; warm-up timer unmeasured on a production build (all captures used the Vite dev server) |
| CI size check | **NOT RUN** by me | `tools/perf` `measureDist` is implemented; I replicated it by hand with gzip -9 |
| Flags | non-blocking | `dist` contains a 10.6 MB `index-*.js.map`; confirm the deploy does not ship it (it inflates `dist` to 28 MB and any "total dist" CI check). Terrain bins 15.5 MB are the dominant asset; if the lobby needs them they dominate load time on slow links, so the 5 s cold target needs a real throttled run |

### Server and bandwidth (section 6), local loopback, 6 bots, real server entry under tsx (E6)

| Row | Verdict | Evidence |
| --- | --- | --- |
| Tick p50 / p95 / max (6 players), p95 <= 3.5 ms | **PASS (local)** | 20/10 clean 600 s: 0.11 / 0.47 / 2.72; typical (120 +/- 30 ms RTT, 1 % loss) 0.12 / 0.43 / 3.51; 30/15 post-fix 0.13 / 0.514 / 3.58. Max <= 8 ms met except one 17 ms tick in an earlier 30/15 run (host noise) |
| Server CPU share of the 0.1 quota (<= 50 %) | **PASS at default 20/10 by inference, NOT PROVEN** | the only logged CPU maxima are 46.9 % (30/15 quiet) and 75 % (30/15 typical, host noise). The run was not in a CPU-limited container; "of 0.1 quota" is process CPU divided by 0.1, an equivalent, not a throttled run. Default 20/10 CPU peak not extracted in the cited reports |
| Event-loop p99 <= 20 ms | **FAIL (local, noisy)** | max 35 ms (quiet 30/15), 188 ms in the noisy typical run; budget row says p99 <= 20 ms. Probable host noise on a shared laptop, but not shown to be |
| Max process stall with GC traced <= 50 ms | **NOT RUN** | no GC trace in the real entry |
| Solo Shift tick p95 <= 0.4 ms | **NOT RUN** | not captured separately; 6-bot p95 is 0.43-0.94 |
| Server RSS <= 300 MB, memory per room, checkpoint <= 1.5 ms/tick | **NOT RUN** | the real entry logs no RSS/heap (spike harness showed 108-145 MB, not the real server); checkpoint path not exercised under load |
| Bandwidth per client <= 5.0 KB/s busy | **PASS, thin** | 20/10: mean about 2.0, peak window 3.5; 30/15: mean about 2.9-3.0, peak window 4.57-4.69 (0.3-0.4 headroom) (E6). The 30/20 data point (about 5.2 KB/s, 90 s harness) is over and cannot run on the real server (divisibility rule) |
| Snapshot rate | **PASS** | 10.0 Hz at 20/10, 15.0 Hz at 30/15 |
| Hosted run on Render Free | **NOT RUN** (by decision; local-first, ADR-0031) | |
| 16-bot `/bot-test` 10 min | superseded by the cap of 6 | 6-bot 10 min is the applicable run |

## Tool defect found (non-blocking, fix before the final rerun)

`device-report` prints "scale mode ceil (preset ceiling)" in every report but the Scale column reads 1.00 on Low/Medium. T08 changed `?scale=`: a number is a fixed pin and `ceil` no longer resolves as T09 documented (Low 0.75, Medium 0.85), so the script runs 1.0 on every preset (confirmed by r2b and quiet-runs). The floor rows from the device script therefore test 1.0 against a Low range of 0.50-0.75 and the header is misleading. Fix: pass `?scale=0.75` for Low and `0.85` for Medium, or restore `ceil`, and record the actual scale in the report header.

## Solo-first implications

1. **The floor device holds 30 fps only by lowering pixels and with zero frame-time headroom.** `typical` (the only representative solo scene) runs Low at 0.75 with GPU p95 24 ms, 30 fps vsync-locked, uncapped 37 fps. 60 fps is not held in any cell (best: webgl2 Low floor 0.5, p50 14.8, p95 32.6). This device is GPU-bound: render CPU follows frame time, so CPU optimisation will not move it.
2. **M1 content is still to come and none of it is in `typical`:** animated avatars, robots, dust atlas and ring compute, GTAO or contact AO, VFX particles, the N-light night scene. S06 shows the price of lighting alone: 3 lights, one shadowed = 42 ms p50 versus 28 ms for S01/S05. Expect 30 fps on the floor to break at M1 unless something is traded.
3. **Remaining levers (measured, all in E3/E4):** SMAA is the largest post term (7.6 of 27.9 ms Low; FXAA 2.4 ms, +8 fps). Pixel scale is the biggest lever (about 35 ms Medium 0.85 -> 0.5). Shadows about 8 ms (cascades=0 saves 8). Bloom 2.3. The T08 request to allow `fxaa` on Low is the cheapest 8 fps and needs a contract change; the lead should decide it before M1.
4. **Tails are the solo-feel risk, not the mean.** p99 reaches 235-620 ms in several cells (S01 script 234.7 ms, bench webgl2 Low 622.6 ms). Cause not isolated. A tail of this size is a visible hitch regardless of average fps; it needs a production-build capture to separate dev-server, shader-compile and GC effects.
5. **Solo cost of netcode:** none measured in a solo frame. Solo Shift tick budget and a "no netcode frame cost in solo" capture are NOT RUN; this is a hot-path claim and stays UNVERIFIED until the debug module reports a solo frame with the net module idle (M1).
6. Raising `targetFps` above 30 for Low is a preset decision: webgl2 Low could hold about 50 fps at the floor, so headroom is currently spent on pixels rather than frames.

## Reruns needed, with cost (nothing here started by me; GPU runs must be exclusive, one at a time, laptop on mains, other apps closed)

| # | Rerun | Command / tool | Cost | Why |
| --- | --- | --- | --- | --- |
| R1 | Fix the device-script scale pin, then S01 + bench, 3 presets x 2 backends | `pnpm --filter @moon-cleanup/perf device-report` (about 4.3 min at 4 s warm-up + 10 s) | about 5 min exclusive GPU, plus a 5-line tool change (owner: performance-profiler) | converts the floor rows from 1.0 to the spec scale; first valid post-fix S01 webgl2 number |
| R2 | Floor-spec capture of the four scenes (typical, S01, S05, S06), webgpu and webgl2 Low at 0.75 and 0.5, **60 s after 10 s warm-up, 3 pages each in rotated order** | `r2b-ground.mjs --part fps --preset low` pattern or `tools/perf cli.ts capture` | 4 scenes x 2 backends x 2 scales x about 80 s x 3 = about 64 min if every cell is repeated 3 times; minimum viable set (webgpu 0.75, 1 page, 4 scenes) about 6 min | decides the S01 p95 (35.4 vs 33.3) noise question and gives S05/S06 a spec-length number |
| R3 | S06 profile (lights, lamp shadow map, cascade count) with knobs | existing look knobs (`cascades`, `shadowres`, `shadowfilter`, `bloom`) | about 15 min exclusive | S06 is 21.9 fps; the cheapest fix is probably the lamp shadow resolution or cascade count, but that is a guess until measured |
| R4 | Production-build capture (not Vite dev) of typical + S01 on Low: p99 tails, warm-up time, heap | `pnpm build` then `vite preview`, same capture CLI | build 1-2 min CPU + 6-8 min capture | separates dev-server and compile hitches from true tails; first valid shader warm-up and LCP numbers |
| R5 | 10-minute JS heap soak on the final code, typical scene, Low | capture CLI with a 600 s duration and forced-GC heap samples | about 12 min exclusive, GPU light | the only missing item of the memory row; monotonic growth cannot be claimed on 60 s |
| R6 | Rebuild `apps/client`, re-run `measureDist`, check the .map is not deployed | `pnpm --filter client build`, `tools/perf` size check | 1-2 min, no GPU | current dist predates the last visuals edits |
| R7 | Server RSS, event-loop p99 and GC stall of the real entry, ideally in a 0.1-CPU container; solo Shift tick | `/bot-test` with RSS logging added to the real entry, `docker run --cpus 0.1` if Docker is available | about 12 min for one 10-min run, needs a small logging change | RSS, GC stall, solo tick and event-loop p99 are NOT RUN and the 0.1 quota is only inferred |

Do not run R1-R5 concurrently with each other or with bot/server runs (the machine is shared and drifts 1.5-2x; noise already invalidated absolute comparisons across days). Order: R6 and R7 can run any time (no GPU); R1, then R2, R3, R4, R5 serially.

## Blocking summary

- **Blocking for claiming S06 complete on the floor:** 21.9 fps, p95 85.1 ms, unprofiled (R3).
- **Blocking for claiming solo performance at M1 gate:** valid floor-spec, 60 s, production-build numbers for typical/S01/S05 (R1, R2, R4); 10-min soak (R5); p99 tail source unexplained.
- **Non-blocking, re-measure:** S01 Low p95 35.4 vs 33.3 (within the 5 ms run-to-run scatter); webgl2 typical Low p95 35.5 vs 33.3 (marginal); event-loop p99 spikes (likely host noise); device-script scale pin.
- **BLOCKED (hardware):** every Tier A and Tier B row, the 6 ms WebGPU render-CPU trigger, GPU per-pass splits.
- **Pass (provisional):** typical Low webgpu, draws and triangles on production scenes, GPU memory ledger, JS and CSS and font size, first-load group size, server tick p95, bandwidth peak (thin margin at 30/15), snapshot rate.

Evidence caveat: all frame numbers are single-run, dev-server, one noisy shared laptop; a PASS here is an upper bound for a quiet machine only in the sense that the machine was busy in some runs, not a guarantee.
