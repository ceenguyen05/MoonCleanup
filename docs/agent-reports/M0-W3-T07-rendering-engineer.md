# M0-W3-T07 Bench v1: real regolith material + real baked height cube

Status: **implemented, verified locally (focused checks); review pending** / 2026-11-12 / rendering-engineer, Sonnet 5.5. One Intel UHD 620 laptop, headed Chrome, 1920x1080 DPR 1 for the sweep, scene P1 walk loop. **All numbers PROVISIONAL: no Tier A/B claim, not a verdict, not the E7 CPU-trigger measurement (see caveat).** No installs, no git mutations; Vite on port 5175 and all Chrome processes stopped.

## Wired (all under `apps/client/src/render/bench/`)

- `?scene=bench` defaults to `terrain=real`; `?terrain=standin` is the v0 path (kept for comparison). Failed load -> `console.error` + stand-in; `__mcBench.stats().terrainSource` is `real | standin | standin-fallback` (+ `terrainError`, `terrainLoad` timings), so a fallback cannot pass for v1.
- Knobs: `terrainBase=<dir url>` (default `/assets/terrain/`; **nothing serves it yet**, `apps/client/public/assets/` is empty; dev runs used `/@fs/<abs repo>/assets/terrain/`), `cube=256|1024` (default 256), `horizon=on|off`, `verify=1` (hash check in the browser), `dbg=1..7` (regolith debug views in real mode). Draw knobs, `path=p1|p3`, `anim`, `probe` unchanged.
- Loading is async: chunks, props, fillers and camera are built in `build()` after the cube is known, `__mcBench` appears only then. Wait for `__mcBench.ready`, not only `__mcReady`.
- New files: `terrain-cube.ts` (CTMH/CTMW decode via `DecompressionStream("deflate-raw")`, bilinear height/horizon samplers; pure), `terrain-loader.ts`, `bench-mask.ts`, `horizon-visibility.ts`, `bench-v1.test.ts`. Edited: `bench-scene.ts`, `terrain-data.ts` (`setTerrainHeightSource` routes `terrainHeightM/groundY`: props, avatars and camera paths follow the real ground), `terrain-chunks.ts` (normal epsilon + decorate hook), `options.ts`, `terrain-material.ts`, `bench-logic.test.ts` (options asserts now `toMatchObject`), `render/README.md`.
- Terrain: same 64 skirted chunks (78,400 vertices) displaced from the baked cube on the CPU (this is not CDLOD). Location: the +Y pole = the levelled boreal pad (about -5.6 m, flat, 60 m radius), so the worksite is flat and craters only appear beyond about 80 m.
- Material: `createRegolithMaterial` through the `visuals/materials` barrel (public API only): 9 fetches, **2 sampled textures**. Mask: one plain RGBA8 sampled texture, 2048^2 over 64 m x 64 m (3.1 cm texel), filled CPU-side (so it works on webgl2), same worksite strokes as v0 (8 Lane Broom lanes, 4 narrow, outpost lane, diagonal, 6 Desk Duster scribbles); 16.8 MB base.
- Height cube lives in vertex data only; horizon map is baked into two vec4 vertex attributes and compared with the sun elevation in the fragment (`HorizonCsmNode` multiplies the material's `userData.mcHorizonVisibility` into the cascade result, same technique as T03's `MoonShadowNode`). **Fragment textures: 2 + 3 cascades (Medium) = 5**, well under 16 hard / 12 target. Consequence: v1 does not sample the height cube or horizon map in the fragment, which v0's stub did (2 horizon taps); if the production design samples a horizon texture per pixel, that cost is not in these numbers.
- Normal fix: the stub's `transformNormalToView(world normal)` is now `normalize(transformDirection(n, cameraViewMatrix))` (the regolith material already does this).
- **Gap: sun/sky/post.** `SunRig`, `MoonShadowNode` and the look post stages are not exported by the `visuals` barrel (only `VisualsModule`), and `VisualsModule` is inactive for `?scene=bench`. Bench v1 therefore keeps its own v0 sun + CSM + post chain (same bloom 4.0/0.5/0.06/0.35, AgX, SMAA / GTAO+TRAA). "Under the T03 rig" is **not** met; needs a technical-artist export or a decision to run `VisualsModule` in the bench.

## Cube decode in the browser (open item of M0-W2-T05): works

Chrome on UHD 620, webgpu and webgl2: `DecompressionStream("deflate-raw")` + row-delta/byte-plane undo of the 256 cube (0.60 MB) and horizon map (6.98 MB): fetch 244 ms + decode 236 ms (main thread, JS, localhost), `rawHashesMatch: true` for both payloads against the manifest `rawSha256`, `bakeHash 8b10f7e2...`. Node/vitest: the committed 1024 cube decodes to all golden samples within 0.02 m, face/(a,b) mapping matches the golden file, the loader verifies hashes through an injected fetch. `cube=1024` (7.9 MB) decode not run in the browser.

## Sweep (1920x1080 DPR 1, P1, 20 s capture after 8 s warm-up, 1 run each; PROVISIONAL)

Source: plain-JS copy of the tools/perf runner (`scratchpad/cap.mjs`, same metrics: in-page rAF intervals, `__mcStats` snapshots per second, medians) because `tools/perf` `cli.ts capture` fails on every run with `page.evaluate: ReferenceError: __name is not defined` (tsx/esbuild keepNames injects `__name` into the function serialised to the page; runner.ts is not mine: **needs a fix by performance-profiler**). JSONs and PNGs are in the session scratchpad (`.../scratchpad/perf2/`), not in the repo. "Draws" = renderer count over all passes (target 350 unless noted; base scene is above 350 on webgpu so no fillers).

| Backend / preset (scale) | Frame ms p50 / p95 | CPU render ms p50 / p95 | GPU render ms p50 / p95 | Draws | Tris | GPU mem ledger | Pipelines after warm-up |
| --- | --- | --- | --- | --- | --- | --- | --- |
| webgpu Medium (0.85) | 32.9 / 50.6 | 29.8 / 35.6 | 29.0 / 30.3 | 487 | 988k | 167 MB | 0 |
| webgpu High (1.0) | 113.5 / 183.1 | 114.4 / 189.1 | n/a (timestamp lost) | 601 | 1,247k | 266 MB | 0 |
| webgpu Low (0.75) | 28.6 / 48.2 | 25.2 / 35.0 | n/a | 361 | 736k | 155 MB | 0 |
| webgl2 Medium (0.85) | 25.9 / 48.0 | 23.0 / 39.1 | 26.0 / 28.1 | 361 | 989k | 167 MB | 0 |
| webgl2 High (1.0) | 129.2 / 259.9 | 124.7 / 319.8 | n/a | 365 | 1,250k | 267 MB | 0 |
| webgl2 Low (0.75) | 23.2 / 57.0 | 20.9 / 33.1 | 23.8 / 57.9 | 356 | 737k | 155 MB | 0 |
| webgpu Medium **stand-in** | 33.6 / 51.9 | 31.0 / 35.9 | n/a | 482 | 986k | 155 MB | 0 |
| webgl2 Medium **stand-in** | 25.9 / 37.8 | 23.7 / 32.8 | 27.1 / 29.0 | 355 | 988k | 156 MB | 0 |

Draws sweep, Medium, real terrain (frame p50 / p95, draws): webgpu `draws=200` 32.7 / 50.7 (489: floor above target), 350 32.9 / 50.6 (487), 600 31.6 / 50.9 (605, 119 fillers), 900 35.5 / 57.8 (910, 419 fillers). webgl2 200 27.8 / 76.4 (303, floor), 350 25.9 / 48.0 (361), 600 31.4 / 77.4 (610), 900 31.5 / 60.5 (907). Heap flat or falling over each run (e.g. webgpu 129 -> 133 MB, webgl2 145 -> 138 MB), `pipelinesAfterWarmup` 0 in all 14 runs, 0 console errors, 0 context losses. The P1 base scene is 487 draws on webgpu vs 361 on webgl2 (v0 showed the same 413 vs 272 gap, still uninvestigated; webgpu cannot reach draws=200/350 on Medium/Low).

**What the real material adds over the stand-in:** per-pass GPU ms is **not available** in r187 (one total per frame, tools/perf README), so there is no per-pass number. Total GPU render ms Medium webgl2: real 26.0 vs stand-in 27.1 p50 (within noise, stand-in 1 ms slower); webgpu GPU timing was lost in the stand-in run, CPU p50 29.8 (real) vs 31.0 (stand-in). Static 1280x720 HUD readings (not a sweep): webgpu real GPU p50 18.4 ms. Reading: the real material (9 fetches, 2 textures, one extra mask upload of 16.8 MB) is **not more expensive than the worst-case stub** (27 fetches); its +12 MB GPU memory (167 vs 155 MB) is the mask with mips. No per-pixel horizon texture cost is included (see above).

**Caveat for the E7 CPU trigger (6 ms WebGPU-path CPU):** CPU render p50 (29.8 ms) tracks GPU render p50 (29.0 ms) almost one to one, i.e. on this iGPU the `render` span is dominated by waiting for the GPU. These are **not valid CPU-submission numbers** and neither pass nor fail the 6 ms trigger; a discrete or faster GPU (or a submit-only span) is needed. Frame times here are GPU-bound: Medium at 1080p ~26-33 ms, High 113-129 ms (GTAO+TRAA at scale 1.0 is far out of reach on a UHD 620; consistent with it being below Tier B).

## Visual (LOOKED at captures)

Static default view, 1280x720, webgpu Medium real vs webgl2 Medium real vs webgpu High real vs webgpu stand-in (`scratchpad/out/`):
- Real material: bright smooth clean lanes against mid-grey dust, crisp square lane edges, faint stepped berm lines, fine pebbled detail in the foreground, rocks/outpost/Earth/sun-lit shadows intact. webgl2 frame is visually identical to webgpu (same pose and look; no black/missing materials; VT-M0-09 looked at, no pixel diff taken). High adds TRAA/GTAO: rock contact shadows deepen, ground the same.
- Stand-in comparison: grainier, higher-contrast high-frequency noise, dust bands less clean; real reads smoother and calmer at 10-40 m, with less ground grain at distance (T04 noted faint radial streaking at 25 m grazing views; not seen in these frames).
- VT-M0-06 (luma bands) and the VT-M0-08 patches are not measured here (no chips in the bench scene); VT-M0-09 only by eye.

## Checks

`tsc -p apps/client --noEmit` clean; `eslint src/render` clean; `prettier --check src/render/bench` clean (render/README.md was already unformatted before my edit, left as is); `vitest run src/render` 9 files / 127 tests pass (new `bench-v1.test.ts`: golden decode of the 1024 cube, 256 cube + horizon ranges, loader with hash verification, chunks on the height source, per-vertex horizon attributes, mask strokes inside the rectangle, regolith material = 2 textures / 9 fetches, option parsing). `pnpm verify` not run.

## Observations / requests

1. **performance-profiler:** fix `tools/perf/src/capture/runner.ts` `__name is not defined` (tsx keepNames in `page.evaluate`); until then perf-check cannot run via the CLI.
2. **technical-artist / lead:** export `SunRig` (+ `MoonShadowNode`, look stages) from the `visuals` barrel or allow `VisualsModule` in `?scene=bench`, then the bench can run the T03 rig; keep `HorizonCsmNode` only if that is not done. Decide where `assets/terrain` is served (copy to `apps/client/public/assets/terrain/` by the integrator, or keep `terrainBase`).
3. On the forced `?backend=webgl2` path the bench log lines (`loading baked terrain`, `scene=bench`) appear twice: the bench is built twice (renderer recreation); disposal looked clean (flat heap, 0 pipelines after warm-up) but worth a look by the integrator. webgl2 also logs repeated `beginQuery: a query is already active` warnings from the timer-query HUD path (debug module).
4. The default view never shows craters (pad is flat); a P3 / far view and the horizon A/B (`horizon=off`) were not captured.

## NOT RUN

Tier A/B anything; P3 sweep and moving-camera TRAA smear; Ultra; SwiftShader lane; `cube=1024` in the browser; horizon on/off visual A/B and numeric VT-M0-15; VT-M0-06/08 numbers; per-pass GPU ms (unavailable); webgpu GPU timing for the High/Low/stand-in/600 runs (timestamp query lost in the HUD, `gpuMeasured: false`); resize / device-loss on the bench; the T03 rig and look-grade stages; per-pixel horizon texture cost; a real CPU-submission measurement for the 6 ms trigger.

Commit suggestion: `feat(client): render bench v1 with real regolith material on the baked height cube (M0-W3-T07)`

## Follow-up (blockers 2, 3, 5) - done / provisional, 2026-11-12

Status: (1) done, (2) diagnosed (not a renderer bug) + instrumented, (3) proposal verified, (4) one Medium pair per backend; review pending. All sweep numbers PROVISIONAL (UHD 620, no Tier claim). My processes (vite on 5175 and a scratch-config vite) are stopped; the default-profile Chrome, `vite --port 5181/5174` and the `tools/perf` node belong to others and were left running.

### (1) Bench on the visuals rig, `?look=v0` kept
- Visuals barrel (`apps/client/src/visuals/index.ts`, exports only): `SunRig`, `MoonShadowNode`, `HORIZON_VISIBILITY_KEY`, `CascadeInfo`, `createKeyState/resolveKey/litFraction/earthExposureGain/KeyState`, `SkyRig/SkyFrame`, `limitingMagnitude`, `CameraOnlyVelocity`, `createLookStages/LOOK_GRADE/NEUTRAL_GRADE/LookGrade/LookStageHandles`.
- Seam: `render/bench/look.ts` (`LookProvider`: `ownsSky`, `keyDirection`, `applyQuality`, `update`, `postPasses`, `cascadeCount`, `dispose`; `parseBenchLook`; the sun constants moved here and are re-exported from `bench-scene.ts`), `look-visuals.ts` (SunRig + SkyRig + createLookStages with `LOOK_GRADE`, fixed 35 deg sun, same per-frame order as `VisualsModule`, public barrel only), `look-v0.ts` (the old chain: sun + `HorizonCsmNode` + hemisphere + `createBenchStages`), `look-factory.ts`. `BenchScene` takes `lookFactory` (tests inject), `?look=visuals` (default) or `?look=v0`; it hides its stand-in sun/Earth when the look owns the sky. `stats().look` reports which one ran. The regolith material's horizon term reaches `MoonShadowNode` through the same `userData.mcHorizonVisibility` key (`horizon=on` runs under both: 3 cascades, 0 pipelines after warm-up, 0 console errors, both backends).
- Bug found while moving it: the old v0 code called `csm.updateFrustums()` on the first frame while `csm.camera` was still null (one TypeError swallowed by the frame loop's error boundary). `V0Look` now waits for the cascades to exist, as `SunRig` does.
- Looked at captures: visuals look = navy gradient sky with stars, same terrain/props/lane patch, hard sun shadows, no missing materials; v0 = black sky. Rocks read brighter/greyer under the rig (pre-exposed physical lux): a look difference, not a defect.
- Tests: new `bench/bench-look.test.ts` (option parsing, scene driving an injected look, both real looks construct / switch preset / dispose without a GPU).

### (2) Double bench build on forced webgl2: not a renderer bug
Not reproducible on a quiet page (3 runs, webgl2 + webgpu: one `loading baked terrain` line each, no device loss, no `onRecreated`). Reproduced by touching a source file while the page was open: Vite dev does a **full page reload** and `boot()` runs again, so every `[bench]` line appears twice. The earlier observation was a dev-server reload (source edits by concurrent workers, or dependency re-optimisation; this session's log also shows "Re-optimizing dependencies because vite config has changed"), not a second `RenderModule.init`. No code path builds `BenchScene` twice (the only `new BenchScene` is in `RenderModule.init`; `handleRecreated` only calls `bindRenderer` listeners). Hardening: `stats().buildsInPage` (must be 1) and `stats().pageTimeOrigin` (changes on reload) so a capture can assert it. Measure against `vite build && vite preview` or an idle dev server. README documents this.

### (3) Serving `assets/terrain` (integrator change: I may not edit `apps/client/vite.config.ts`)
Plugin source (verified with a scratch config): `C:/Users/caseyn/AppData/Local/Temp/claude/430d3d07c3d5e4f4/5a7524bb-e0d6-4adc-a1f7-8310425628b1/scratchpad/terrain-plugin/terrain-assets.mts` (about 45 lines, `terrainAssets(repoRoot): Plugin`; copy it to `apps/client/vite/terrain-assets.ts`). Verified: dev middleware returns `manifest.json` (7,082 B) and the 256 cube (601,663 B) with 200; `/assets/terrain/raw/ldem_16.img` falls through to the SPA fallback (text/html), so raw/cache/fixtures are NOT exposed; `vite build` emits exactly `assets/terrain/{manifest.json, height-cube-256.*.bin, height-cube-1024.*.bin, horizon-map.*.bin}` (15.5 MB), no raw/cache. The exact config change:

```ts
// apps/client/vite.config.ts
import { fileURLToPath } from "node:url";
import { terrainAssets } from "./vite/terrain-assets";

export default defineConfig({
  /* existing options unchanged */
  plugins: [terrainAssets(fileURLToPath(new URL("../../", import.meta.url)))],
});
```
The plugin lists `manifest.json` plus the manifest `outputs.*.file` names matching `^(height-cube-(256|1024)|horizon-map)\.[0-9a-f]+\.bin$`; `configureServer` and `configurePreviewServer` serve them at `/assets/terrain/<name>` (immutable cache on the hashed .bin), `generateBundle` emits them as `assets/terrain/<name>`. Needs `@types/node` visible to the config's tsconfig (not typechecked here; the scratch run strips types). Integrator decision: the 7.9 MB 1024 cube and 7 MB horizon map ship in `dist` too; gate `generateBundle` on an env flag if the production bundle must stay lean. After this the default `terrainBase` (`/assets/terrain/`) works (this session's sweeps used it through the scratch config).

### (4) Medium sweep, visuals vs v0 (1920x1080 DPR 1, scale 0.85, P1, target 350 draws, 8 s warm-up + 20 s, one run each, real terrain)
**The machine was loaded** (about 45 % CPU baseline from other workers' vite/perf/Chrome processes), so absolute frame/CPU times are 2-3x worse than the quiet T07 sweep (v0 webgl2 frame p50 62.6 ms now vs 25.9 ms then). Use only the same-session v0 vs visuals pairs, and treat frame/CPU deltas as inconclusive.

| Backend | Look | Frame p50 / p95 | CPU p50 / p95 | GPU render p50 | Draws | Tris | GPU mem | Post passes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| webgpu | v0 | 89.9 / 106.0 | 84.0 / 100.0 | 28.2 (HUD, static) | 487 | 988k | 167.2 MB | scene, bloom, smaa |
| webgpu | visuals | 78.1 / 139.1 | 61.3 / 109.8 | 57.0 (sweep), 61.2 (HUD) | 490 | 1,012k | 169.2 MB | scene, grade, bloom, smaa |
| webgl2 | v0 | 62.6 / 103.7 | 62.2 / 95.8 | n/a | 353 | 987k | 167.3 MB | scene, bloom, smaa |
| webgl2 | visuals | 79.3 / 131.7 | 83.1 / 130.5 | n/a | 353 | 1,012k | 169.2 MB | scene, grade, bloom, smaa |

Deltas visuals minus v0: draws +3 (webgpu) / 0 (webgl2) (SkyRig dome/stars/Earth/halo/sun replace the 2 stand-in bodies; webgpu base scene is still above 350); triangles +24k (+2.5 %); GPU memory +2 MB; `grade` stage added; cascades 3 in both; `pipelinesAfterWarmup` 0, `buildsInPage` 1 and 0 errors in all four runs. **Leading signal, needs attribution:** webgpu GPU render p50 is about 2x under the visuals rig (57-61 ms vs 28 ms; v0's 28 ms matches the quiet T07 reading of 29 ms, so contention alone does not explain it). Suspects, untested: SkyRig (full-screen dome, star points, Earth/halo overdraw on an iGPU), shadow PCF radius 2, the regolith/fill rig at pre-exposed lux, the look grade. Next step: per-feature A/B on a quiet machine. webgl2 GPU time is unavailable (no timer query in that lane here).

### Checks
`tsc -p apps/client --noEmit` clean; `eslint src/render src/visuals/index.ts` clean; `prettier --check src/render/bench src/visuals/index.ts` clean; `vitest run src/render src/visuals` 12 files / 156 tests pass (the bench-look scene test has a 60 s timeout because it builds the stand-in textures; it timed out at 5 s under load before). `pnpm verify` not run.

### Next
1. Integrator: apply the Vite plugin above; decide whether `dist` ships the 1024 cube / horizon map.
2. Re-run the visuals vs v0 pair on a quiet machine (discrete GPU if available) and bisect the 2x webgpu GPU delta (sky, shadow radius, grade).
3. performance-profiler: `tools/perf` `__name` fix is still needed for the CLI; assert `buildsInPage === 1` and an unchanged `pageTimeOrigin` in captures.
4. Not run: Tier A/B, Ultra, P3, `cube=1024` in the browser, horizon on/off A/B, TRAA under the visuals rig (High): only Medium was swept.
