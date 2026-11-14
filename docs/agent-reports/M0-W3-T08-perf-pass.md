# M0-W3-T08 Performance + quality pass (render + visuals)

Status: **implemented, focused checks green, in-review** / 2026-11-13 / rendering-engineer (single writer of `render/**` and
`visuals/**` for this task), Fable 5.2, high effort. One Intel UHD 620 laptop (i7-8650U), headed Chrome, 1920x1080 DPR 1.
**All numbers PROVISIONAL: floor device, 1 run per cell, no Tier A/B claim.** No installs, no git mutations. My Vite (port 5180,
PID 46808) is stopped; no capture browser left running. `pnpm verify` NOT RUN (lead's integration step).

## Done

1. **Knobs** (`visuals/look-knobs.ts`, read by `VisualsModule` and the bench's visuals look): `aa=smaa|fxaa|traa|none`,
   `traa=on|off`, `gtao=on|off`, `aainput=rgba8|half-float`, `shadowres=512..4096`, `cascades=0..4`,
   `shadowfilter=vogel5|tent4|hard`, `pcf=<texels>`, `bloom=off|quarter|half`, `grade=look|neutral|off`, `sky=<level>|off`,
   `skyoff=dome,stars,earth,halo,sun`, `skydome=baked|procedural`. No knob = shipped look. Reported by
   `__mcBench.stats().lookKnobs` and `__mcLook.info().knobs / skyDome / shadowFilter`.
2. **Rig cost found and fixed.** The 2x GPU cost vs v0 was the **sky dome**: 7 octaves of 3D fractal noise on every pixel of
   the frame, drawn before the ground. Cuts (old path stays selectable by knob):
   - backdrop (gradient + nebula) baked once per renderer into a 1024x256 RGBA16F texture (2 MB) with the same node graph; per
     pixel one fetch + the analytic sun glow (`skydome=procedural` = old);
   - `tent4` PCF kernel on SMAA presets: 4 fixed hardware comparisons instead of 5 Vogel taps rotated per pixel; no penumbra
     dither (`shadowfilter=vogel5` = old; TRAA presets keep vogel5);
   - grade builds the contrast `pow` only when contrast != 1 (shipped grades: 1); `__mcLook.setGrade({contrast})` rebuilds;
   - SMAA / FXAA read an RGBA8 copy of the tone-mapped frame instead of three's RGBA16F default (`aainput=half-float` = old).
3. **Dynamic render scale.** `render/dynres.ts` (`DynamicResolution`: rendering-pipeline section 9 law, typed-array window, no
   allocation per sample, stalls dropped, floor hint) + `RenderModule.setRenderScale(scale): number`, `setDynamicResolution(on)`,
   `reportGpuFrameMs(ms)`, `dynamicResolution` read-out; window hooks `__mcDynres()`, `__mcRenderScale(s)`. Signal: reported GPU
   ms when fresh, else the frame loop's `dt` against `1000 / targetFps`. Addition to section 9 (interval signal only): after 8 s
   on budget probe +0.05, take a failed probe back in about 1 s, double the hold up to 64 s (vsync hides headroom).
   Integrated GPUs now **start at the range floor and climb**. Off: `?scale=floor|ceil|<0.25..1>` (a number is a fixed pin, NOT
   limited to the preset range: **`?scale=1` pins 1.0 on any preset** for the device-capture script), `?capture=1`, `?dynres=off`.
4. **S02 / S03 routed.** Exported from the visuals barrel (`S02Scene`, `S03Scene`, `createLookdevScene`, types) and routed by
   `VisualsModule`: `?scene=s02`, `?scene=s03`. Under the module they set the sun in its state and are lit by its rig (one key
   light, full look); the stand-alone dev entry is unchanged.
5. **Typical scene** `?scene=typical` (`visuals/lookdev/typical-worksite.ts`: outpost, cleaned patch + lanes + hand strokes on
   the REAL regolith material, custodian, 36 boulders, posts; views `play|work|wide`), measured below.

## Evidence

Method: `tools/perf` `cli.ts capture` (8 s warm-up + 12 s, `--disable-frame-rate-limit`), raw JSON/MD in
`tools/perf/results/M0/t08/<label>/`; drivers, traces and captures in `docs/agent-reports/M0-W3-T08-evidence/`.
**GPU timestamp p50/p95 is present only in some cells** (the debug collector drops many resolves; not my path): frame p50/p95 is
the comparable column (the device is GPU-bound: frame tracks GPU).

**Bench, webgpu Medium, scale 0.85, P1** (frame p50 / p95 ms; GPU p50 / p95 where reported):

| Cell | Frame | GPU | Delta |
| --- | --- | --- | --- |
| v0 look | 31.5 / 46.0 | 27.5 / 29.0 | |
| visuals rig before this task | 59.6 / 69.9 | n/a | |
| `skydome=procedural` (old dome) | 58.7 / 70.2 | n/a | +25.0 |
| **baked dome** (other cuts not yet in) | **33.7 / 51.2** | n/a | 0 |
| `skyoff=dome` / `sky=off` | 33.5 / 51.7, 33.7 / 52.1 | - , 29.2 / 31.1 | -0.2 / 0.0 |
| `grade=off` | 32.7 / 51.0 | n/a | -1.0 |
| `bloom=off` | 31.4 / 48.4 | 28.4 / 30.1 | -2.3 |
| `shadowfilter=tent4` / `hard` | 31.8 / 49.1, 32.0 / 48.5 | 28.1 / 28.7, 27.5 / 28.5 | -1.9 / -1.7 |
| `cascades=0` (720k fewer triangles) | 25.7 / 29.8 | n/a | -8.0 |
| `aa=none` | 26.5 / 31.7 | 23.0 / 25.9 | -7.2 |

Stars, Earth, halo and sun disk cost nothing measurable. Remaining rig terms: sun shadows about 8 ms, SMAA about 7 ms, bloom 2.3.

**Typical scene, walk path (`typical-walk.json`), 190-255 draws, 346-454k triangles, final code:**

| Backend / preset | Ceiling: frame p50 / p95, fps | Floor: frame p50 / p95, fps | GPU p50 / p95 |
| --- | --- | --- | --- |
| webgpu Low (0.75 / 0.5) | 26.8 / 31.3, 37.3 | 21.3 / 36.2, 46.9 | ceiling 22.9 / 24.0 |
| webgpu Medium (0.85 / 0.6) | 30.5 / 45.9, 32.4 | 23.7 / 34.0, 41.3 | floor 20.4 / 20.7 |
| webgl2 Low | 20.4 / 35.5, 50.9 | 14.8 / 32.6, 62.7 | n/a (no timer) |
| webgl2 Medium | 23.7 / 36.2, 41.6 | 16.7 / 35.5, 54.6 | n/a |

Splits on webgpu Low 0.75: `aa=none` 20.3 (GPU 17.4), `aa=fxaa` 22.7, `aainput=half-float` 28.6 vs 26.8 (RGBA8 saves 1.8),
`cascades=0` 24.4, `bloom=off` 24.7. Medium before the AA/tent cuts was 32.1 / 48.5.

**What the UHD 620 sustains (typical scene):** 30 fps vsync-locked on **Low at the 0.75 ceiling** on both backends (dynamic run:
33.3 / 33.6 ms) and on **Medium with the controller between 0.75 and 0.85**; unthrottled 37-47 fps (webgpu Low), 51-63 fps
(webgl2 Low). 60 fps is not held anywhere (best: webgl2 Low floor, p50 14.8 but p95 32.6). webgl2 is about 30 % faster than
webgpu here. The bench stays the worst case (about 30 fps Medium).

**Controller demonstration** (real app, vsync on, traces `dynres-typical-*.json`): Low webgpu 0.5 -> 0.55 (8.9 s) -> ... -> 0.75
(41 s), 0 errors. Medium webgpu 0.6 -> ... -> 0.8 (34.1 s) -> 0.75 (35.1 s, failed probe taken back) -> 0.8 -> 0.85 (60 s) ->
0.75 (100.8 s, law step -0.10 on the heavy view) -> 0.8. Low webgl2 0.5 -> 0.75 in 38 s. First attempt used `performance.now()`
at the render step (+-6 ms jitter, false "over budget", stuck at the floor): fixed by reading the frame loop's `dt`, unit-tested.

**Look kept** (webgpu Medium; "before" = `skydome=procedural&shadowfilter=vogel5&aainput=half-float`): S01 72-block grid mean
|dLuma| 0.03, max 0.12 codes; S05 `shade` max 0.86, `wall` max 0.36. VT numbers: S02 through the real app chart
**129.9 / 180.2 / 212.3** (126 / 181 / 213 +-8), grime chip 119.8, clean chip 181.8 (ratio 1.52), same on webgl2; S05 fill flat lit
**183.5**, flat shadow **85.1** (T03b: 183.5 / 85.1). webgl2: baked vs procedural dome max 0.05; 0 console errors on s01, s02,
typical; s03 loads with 0 errors (not measured). Looked at `s01-after.png`, `typical-medium-webgpu.png`, `s02-medium-webgpu.png`.

Checks: `tsc -p apps/client --noEmit` clean; `eslint src/render src/visuals src/app` clean; `prettier` applied to touched files;
`vitest run src/render src/visuals src/app src/debug` 18 files / 212 tests + new `visuals/perf-pass.test.ts` 9 tests pass.

## Findings / requests

1. **S01 / S05 / S06 are slow because of their STAND-IN ground, not the rig.** Same preset, scale, orbit camera and 230
   boulders, webgpu Low 0.75: S01 **121.6 / 140.9 ms** vs typical (real regolith material) **23.5 / 28.8 ms**. The stand-in
   (`lookdev/ground-material.ts`) evaluates about 39 octaves of 3D noise per ground pixel. The baked dome saves 28 ms there
   (150.1 -> 121.6). Not changed: it is the T03b-approved look. **technical-artist / lead:** move S01/S05/S06 onto the real
   material (the typical scene is the pattern) with a visual review; do not judge device performance on S01.
2. **SMAA is the largest post term on the floor device** (7.6 ms of a 27.9 ms Low frame; FXAA 2.4 ms, +8 fps). The contract
   (`shared/render/quality.ts` `post.aa: smaa|traa`) fixes SMAA on Low. **contracts-architect / lead: allow `fxaa` on Low?**
3. **performance-profiler:** call `renderer.reportGpuFrameMs(render.timestamp)` after `collector.recordGpu` in
   `debug/module.ts` (then the controller steers on GPU ms when `?perf=1`); GPU timestamps are missing in about 2/3 of captures.
4. **integrator (`app/**`):** I edited `app/launch-policy.ts` (`VISUALS_SCENE_IDS` = `s01,s02,s03,s05,s06,typical`,
   `UNROUTED_SCENE_IDS` = empty) and its test: the only app change needed. Route names: `?scene=s02`, `?scene=s03`,
   `?scene=typical`. `boot.ts` still carries the now-dead "not routed yet" warning text (cosmetic). The Low-on-iGPU policy needs
   no change: the render module starts integrated GPUs at the floor and climbs.
5. Observation (pre-existing): S01 webgpu vs webgl2 differ by 6 codes in one ground block (bottom-right), old and new path alike.
6. Low / Medium target 30 fps, so the controller spends headroom above 30 fps on pixels (webgl2 Low could hold about 50 fps
   at the floor instead). Raising `targetFps` is a preset-table decision.

## NOT RUN

High / Ultra cells and the GTAO vs TRAA vs 2048-shadow split (knobs exist; `gtao=on` without TRAA was never run in a browser);
the bench re-captured with all four cuts together (only the dome total and single deltas); contact-AO blobs, horizon-map
sampling and regolith fetch count in isolation (no knob; the real material measured cheap in T07); device loss / renderer
recreation with the baked sky (the re-bake path is coded, not exercised); TRAA history resample on a scale step; the "Lower
preset?" toast; S03 numbers; Tier A/B; `pnpm verify`.

## Files

New: `apps/client/src/render/dynres.ts`, `dynres.test.ts`; `apps/client/src/visuals/look-knobs.ts`, `look-knobs.test.ts`,
`perf-pass.test.ts`, `lighting/shadow-filter.ts`, `lookdev/typical-worksite.ts`; `docs/agent-reports/M0-W3-T08-evidence/**`;
`tools/perf/results/M0/t08/**`.
Edited: `render/{module.ts, module.test.ts, tier.test.ts, render-scale.ts, url-options.ts, harness-hooks.ts, index.ts,
README.md, bench/look.ts, bench/look-visuals.ts, bench/bench-scene.ts}`; `visuals/{index.ts, module.ts, lighting/sun-rig.ts,
post/look-stages.ts, sky/sky-dome.ts, sky/sky-rig.ts, lookdev/hooks.ts, lookdev/s02-lookdev-kit.ts, lookdev/s02-first-stroke.ts,
lookdev/s03-distance-ladder.ts}`; `app/{launch-policy.ts, launch-policy.test.ts}`.

Next: lead decisions 1, 2, 6; profiler wiring 3; High-pack split and device-loss check on better hardware; `pnpm verify`.

Commit suggestion: `perf(client): bake sky backdrop, cheaper shadow/AA paths, dynamic render scale, look knobs, typical scene (M0-W3-T08)`
