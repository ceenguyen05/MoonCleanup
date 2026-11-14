# M0-W2-T02 Render spike bench scene v0

Status: **in-review** (implemented; renders on WebGPU and WebGL2; items below marked NOT RUN remain) / 2026-11-12 / rendering-engineer, Sonnet 5.5. One Intel UHD 620 laptop only: **no Tier A/B claim**.

**v0 numbers are NOT a verdict.** E7 is decided on bench v1 (M0-W3-T07) on the real baked height cube.

## Done (all under `apps/client/src/render/`)

- `?scene=bench&draws=<200|350|600|900>&preset=<low|medium|high>` (+ `path=p1|p3`, `anim=0`, `dbg=1..7`, `probe=zfight`). `module.ts` creates `BenchScene` for `?scene=bench` and skips the smoke mesh then; `app/**` untouched. `pipeline.ts` gained the optional `PipelineStages.setRenderScale` hook (additive).
- `bench/`: 64 skirted chunk draws on the 2 km sphere; worst-case terrain shader stub (27 counted fetches, **8 texture bindings**); camera-only velocity node; 2,100 rocks in 4 instanced draws; 16 avatar proxies (48 instances) in one `BatchedMesh`; 40 props; sun disk + Earth stand-ins; sun + `CSMShadowNode` 2/3/4 cascades (custom splits, fade, 300 m margin); post chain (High: prepass + GTAO indirect-only + TRAA + bloom + AgX; Low/Medium: bloom + AgX + SMAA; bloom 4.0/0.5/0.06/0.35); filler-based draw calibrator; P1/P3 pose functions and keyframe specs; `window.__mcBench`.
- `instancing/`: `InstancedSet`, `BatchedPool`, `splitInstanceCounts`, `drawsNeeded`, `batchCapacity`.
- Docs: `render/README.md` bench section; `rendering-pipeline.md` section 7 new row "Sampled-texture limit (hard)".

## Finding: sampled-texture limit (applies to the real terrain shader)

First WebGPU run failed pipeline creation: "number of sampled textures (17) in the Fragment stage exceeds the maximum per-stage limit (16)" (adapter supports 48, device default is 16). Stub had 14 data textures + 3 CSM cascades. Fixed by packing (detail layers share one texture, horizon halves one 512x256 texture, plot centres/neighbours/table one RGBA32F 128x192 texture): **8 bindings, 27 fetches unchanged**, unit test asserts <= 12. Design rule written into rendering-pipeline.md section 7: **<= 16 sampled textures per fragment stage, target <= 12 for terrain** (CSM 3-4, env probe, lamp shadow share the stage).

## Evidence (file state 2026-11-12 21:04, Node 26.13.1)

- apps/client: `tsc` exit 0; `eslint src/render` clean (one scoped `no-explicit-any` disable in `terrain-material.ts` for TSL value typing; `post-stages.ts` one-line disable); `prettier --check` on bench, instancing, module.ts, pipeline.ts clean (render/README.md was already unformatted before my edit; not reformatted); `vitest run src/render` 7 files / 112 tests; whole client `vitest run` 11 files / 133 tests pass.
- Browser (Vite dev, Playwright, headed Chrome on UHD 620 = "gpu lane", and SwiftShader = "ci lane"; 1280x720 DPR 1; stepped `?capture=1` unless stated). Scratch driver and captures only in the session scratchpad (`.../scratchpad/bench-run.mjs`, `out/`), not in the repo. Tier labels are what the renderer detected (UHD 620 reads as tier B / integrated).

| Run | Result |
| --- | --- |
| webgpu, medium, draws=350 (`gpu-medium.png`) | draws **413 with 0 fillers** (base above target), 970,829 triangles, 3 cascades, 0 console errors, `pipelinesAfterWarmup` 0, reversedZ true. Look: clean lanes with berms vs dusty ground, rocks, outpost, Earth: readable |
| webgpu, low, draws=200 | base 291 draws (2 cascades), 722k triangles, 0 errors |
| webgpu, medium, draws=200 / 600 / 900 | 413 (floor) / 600 (187 fillers) / 900 (487 fillers), exact |
| webgpu, high, draws=600 | 600 (28 fillers), 1.24 M triangles, passes scene+prepass+gtao+traa+bloom, 0 errors, 0 pipelines after warm-up |
| webgl2 forced on the real UHD, medium, draws=350 | renders, 0 errors, base 272 draws (78 fillers), 971,765 triangles, reversedZ true; static frames identical (diff 0); differs from webgpu mean 3.9/255 (finer ground grain on webgpu). VT-M0-09: no black/missing materials |
| webgl2 on SwiftShader, medium | renders, 350/350, 0 errors (earlier run) |
| **Reversed-Z probe** (two planes 3 m apart at 15 km, near 0.05 / far 30 km) | **webgpu and webgl2 (real UHD): 47,188 front-plane pixels, 0 rear-plane pixels** in the probe rectangle: no z-fighting; both backends report `reversedDepthBuffer=true` (no fallback needed on this machine) |
| Static-scene TRAA check (High, two frames 20 steps apart) | max channel diff 54-69, 2.4k-6.5k px over 8 (0.3-0.7 % of the frame), mean 0.5/255; the same level of difference appears in the sky band (Earth edge), where no terrain exists. Medium/SMAA and webgl2 static frames are identical (diff 0). By construction the camera-only velocity is exactly 0 for a static camera, so terrain velocity cannot cause this; the residual is TRAA jitter convergence on edges. Maths covered by unit tests (zero when still, opposes camera motion, falls with distance) |
| Live run, webgpu, medium, draws=350, P1, 60 s | heap after forced GC 61.3 -> 61.6 MB (12 samples, +0.3 MB: flat), draws drift to 489 on the path (calibrated at the default pose), frame interval avg 20.1 ms / p95 36 ms on a UHD 620 (GPU bound; not a CPU number), `pipelinesAfterWarmup` 0, 0 errors |
| Live run, webgpu, high, draws=600, P3, 30 s | heap 62.3 -> 62.6 MB, frame interval avg 50 ms / p95 66 ms, draws 599, 0 pipelines after warm-up, 0 errors |

Frame times are the rAF interval on an iGPU below Tier B class: they say Medium on this machine is about 20-50 ms and show nothing about the 6 ms WebGPU CPU trigger (see NOT RUN).

## Observations for the lead

- WebGPU base draws 413 vs WebGL2 272 for the same scene and preset (Medium budget is 350): not investigated (likely shadow-pass submission differences); the bench cannot reach `draws=200` on Medium/Low for the base scene. Worth checking in bench v1 against the section 10.2 table.
- Draw calibration is done once at the default pose; a moving path drifts (489 vs 350 on P1).
- AgX look: clean ground reads bright, grime clearly darker; sun disk and Earth are stand-ins.

## NOT RUN (exact next steps)

1. **CPU frame time vs the 6 ms revisit trigger**: per-module CPU spans were not captured (the debug/perf HUD is not wired by `app/`, `mc:render:update` produced one User Timing entry). Next: wire `DebugModule` (integrator), run `tools/perf` P1/P3 60 s on the bench.
2. **Moving-camera TRAA smear check** (camera moves, terrain must not smear): only the static capture and the unit-tested maths exist. Next: stepped P1 frames compared against per-frame no-TRAA (Medium) captures at the same poses, or a velocity-buffer readback.
3. High preset on SwiftShader / WebGL2 (TRAA path on webgl2 backend) and Ultra: NOT RUN. Low/Medium on webgl2 real UHD: Medium only.
4. Heap flat over 60 s was measured on Medium/P1 only (High/P3 30 s); GPU timestamps per pass: NOT RUN (`trackTimestamp` not enabled by the app).
5. `tools/perf` / `__mcCameraPath` integration: the bench drives its own camera for `?path=`; `__mcBench.paths` specs are provided but never fed to `__mcCameraPath`.
6. Not in the v0 chain: exposure adaptation, LUT/visor grade, sharpen/FSR1 upscale, TAAU at render scale < 1 (TRAA stage assumes scale 1; High pins 0.75-1.0), half-res GTAO on Low/Medium, VFX layer, stars, Earth/sun lighting phase. Avatars use camera-only velocity (v0 limitation; moving casters need three's `velocity` per material).
7. Real device loss / resize on the bench: NOT RUN.

## Swap points for M0-W3-T07

Terrain mesh source (`TerrainChunks` + `terrain-data.ts` height/layout -> baked height cube + one-draw CDLOD) and terrain material (`createTerrainStub` + `BenchTextures` -> real regolith shader, atlas, ring, plot tables, horizon map). Keep the <= 12 bindings rule.

## Blockers / requests

None blocking. Lead: add the sampled-texture limit to the technical-artist brief for the terrain material; integrator: wire `DebugModule` for the CPU measurement.

Commit suggestion: `feat(client): render bench scene v0 with texture-packed terrain stub, instancing helpers and CSM/post chain`
