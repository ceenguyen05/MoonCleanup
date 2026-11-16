# render

Owner: rendering-engineer. Renderer setup and backend detection, frame orchestration, quality presets, render scale,
GPU resource lifetime. Spec: `docs/architecture/rendering-pipeline.md` sections 2, 3.1, 4, 8.1, 9, 14, 18.
Import from `../render` (the barrel) only; at run time use the service registry.

## Files

| File                                 | Content                                                                                                                           | three |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- | ----- |
| `backend.ts`                         | Section 2.1 detection (override, adapter, software adapter, blocklist, unsupported); backend read-back                            | no    |
| `tier.ts`                            | GPU class, tier A/B/C, default preset, backend limits, `resolveQuality`                                                           | no    |
| `gpu-classes.json`, `blocklist.json` | Data for the two above (regular expressions; blocklist is empty until a failure is recorded)                                      | no    |
| `quality-service.ts`                 | `quality` service: current settings, capabilities, `setPreset`, `stepDown`, `quality.changed`                                     | no    |
| `url-options.ts`                     | `?backend ?preset ?dpr ?scale ?dynres ?scene ?capture`                                                                            | no    |
| `viewport.ts`                        | CSS size + capped DPR, polled once per frame                                                                                      | no    |
| `render-scale.ts`                    | Render scale range, clamp and pins (`floor`, `ceil`, fixed number)                                                                | no    |
| `dynres.ts`                          | `DynamicResolution`: the section 9 control law (p90 window, hysteresis, vsync probe), no allocation per sample                    | no    |
| `renderer-host.ts`                   | Create / init / device-lost recreation state machine, frame scheduler                                                             | no    |
| `frame-loop.ts`                      | Per-frame module order, `mc:<module>:update` spans, manual stepping, frame-time stats                                             | no    |
| `harness-hooks.ts`                   | `__mcReady`, `__mcStep`, `__mcInfo` for the screenshot harness and e2e smoke; `__mcDynres()`, `__mcRenderScale(s)` for perf tools | no    |
| `three-renderer.ts`                  | `WebGPURenderer` driver, canvas mount, WebGL2 probe, feature probe                                                                | yes   |
| `pipeline.ts`                        | `RenderPipeline` skeleton: HDR scene pass, `renderOutput`, stage hooks                                                            | yes   |
| `scene-roots.ts`                     | Scene, root groups, main camera and its depth range                                                                               | yes   |
| `smoke-scene.ts`                     | `?scene=smoke` parity test mesh                                                                                                   | yes   |
| `module.ts`                          | `RenderModule` (ClientModule + `renderer` service)                                                                                | types |

## Services

- `renderer` (`RenderRendererService`): `backend`, `tier`, `forced`, `renderer` (the `WebGPURenderer`, `null` while it
  is being recreated), `canvas`, `viewport`, `renderScale`, `setPipelineStages`, `readStats`, `onLost`, `onRecreated`,
  `onFatal`, plus `scheduler` and `viewportSource` for the frame loop.
- `sceneRoots` (`SceneRoots`): `scene`, `world`, `sky`, `vfx`, `debug`, `camera`.
- `quality` (`RenderQualityService`): `current`, `maxPreset`, `recommendedPreset`, `capabilities`, `setPreset`,
  `stepDown`. Settings objects are frozen and replaced, never mutated: compare by identity.

Events: `render.backendSelected` (at boot; again only if a recreated renderer runs on another backend or tier) and
`quality.changed` (first choice and every change).

## Dynamic resolution (M0-W3-T08)

- The scale applies to the scene pass (and the look's prepass) through `setResolutionScale`; canvas and DOM UI stay native.
- `renderer.setRenderScale(scale)`: set it now, clamped to the preset's range (returns the scale in effect; a pin wins).
  `renderer.setDynamicResolution(on)`, `renderer.dynamicResolution` (read-out: `enabled, pinned, scale, scaleMin, scaleMax,
signal, p90Ms, targetMs, steps, floorHint`), `renderer.reportGpuFrameMs(ms)` (a GPU-time reporter; while reports are
  younger than 1 s the controller steers on GPU ms against `dynres.gpuBudgetMs`, else on the frame loop's `dt` against
  `1000 / dynres.targetFps`).
- Law: every 0.5 s on the p90 of the last 30 frames; over 1.05 x target: -0.10; under 0.80 x target for 4 s: +0.05; no
  reverse within 4 s; one change per 2 s. Interval signal only: after 8 s on budget it probes +0.05 (vsync hides headroom)
  and takes a failed probe back within about 1.5 s, doubling the hold up to 64 s.
- Start: integrated GPUs start at the range floor and climb; everything else starts at the ceiling.
- Ranges (`shared/render/quality.ts`): Low 0.50-0.75, Medium 0.75-0.85 (floor raised from 0.60, owner 2026-11-16), High 0.75-1.00,
  Ultra 0.85-1.00.
- Off: `?scale=floor|ceil|<0.25..1>` (a number is a fixed pin, not limited to the preset range: `?scale=1` is 1.0 on any
  preset), `?capture=1` (ceiling), `?dynres=off` (holds the start scale; the setter still works).
- GPU signal: `GpuTimingPump` (`gpu-timing.ts`) resolves three's timestamp queries sparsely (every 16 frames; every 8 in the
  debug module), one request in flight, and calls `reportGpuFrameMs(render + compute ms)`. Production: the composition
  root registers `GpuTimingModule` in the last (`debug`) frame slot whenever dynres can run and WebGPU is expected
  (`navigator.gpu`, not `?backend=webgl2`, not `?dynres=off` / `?scale=` / capture); it has no HUD, DOM or window hook. Dev or
  `?perf=1`: the debug module owns the same pump instead (never both). No `timestamp-query` or WebGL2: no query is issued
  and dynres steers on the frame interval (CPU frame pacing).
- Not wired yet: no TRAA history resample on a step, no "Lower preset?" toast for `floorHint`.

### Frame-rate goal and pace guard (M1-W2-T03)

- **60 fps on every preset** (`frame-target.ts`): the controller steers to `max(contract targetFps, 60)` and at most a
  14 ms GPU budget. The shared contract still says 30 fps / 28 ms for Low and Medium; with those numbers the UHD 620
  climbed to scale 0.85 and ran at 42 to 54 fps. `?fps=contract` restores the contract's targets, `?fps=<n>` sets
  another goal. `renderer.dynamicResolution.targetFps` reports the goal in effect.
- **Pace guard** (`dynres.ts`): with the GPU signal the controller also watches the frame interval. Over budget = GPU
  p90 over its budget **or** interval p90 over the frame period (never tighter than the display's own interval). A step
  up on GPU headroom is judged like a vsync probe: taken back after 2 s if the budget breaks, and the next try waits twice
  as long (4, 8, 16, 32 s). Read-out: `paceP90Ms`, `paceTargetMs`, `paceLimited`.
- A failed probe is now taken back after 2 s, not 1 s (acceptance: at most one change per 2 s).
- Warm-up frames are not sampled, and the window restarts when a warm-up ends.

## Culling and LOD (`culling.ts`, M1-W2-T03)

Pure math, no three, nothing allocated per call. Owners keep their own bounding spheres and call these.

- `cullDistanceM(class, quality.current)`: props 150 m, pucks 120 m, builds 400 m, times `distances.objectMult`; robots
  use the preset's `distances.robotRenderM`.
- `HorizonCuller`: `setCamera(x, y, z, moonRadius + lowestGround)` once per frame (moon-centred metres), then
  `isHidden(x, y, z, radius)`. Conservative: it hides a sphere only when all of it is behind the horizon.
- `SideFrustum`: `setFromMatrix(projectionViewMatrix.elements)`, `intersectsSphere(...)`. Side planes only, so it is the
  same on reversed-Z WebGPU and on WebGL2.
- `cullSpheres(spheres, count, camera..., maxDistance, horizon, frustum, visibleOut, counts)`: all three tests over a
  packed `x, y, z, r` list; writes a `Uint8Array` and reject counts. Feed the result to `InstancedSet` / `BatchedPool`.
- `projectedSizePx(radius, distance, vfovRad, viewportHeightPx)` and `selectLod(current, sizePx, thresholdsPx,
quality.current.distances.objectMult)`: screen-size LOD with 10 % hysteresis. Use the OUTPUT height, not the render
  scale, so LOD does not move when dynamic resolution steps.
- Terrain nodes are culled by the terrain module (CDLOD); three still frustum-culls ordinary meshes by itself.

## Draw budget, warm-up, memory (M1-W2-T03)

- `renderer.drawBudget`: last frame's draws and triangles (all passes) against `quality.budgets` (350 Low / Medium, 600
  High / Ultra), `over`, `overFrames`, peaks. Reset on a preset change.
- **Warm-up** (`warmup.ts`): three r187 `compileAsync` leaves the game black when a frame renders during it, so warm-up
  is a run of ordinary synchronous frames. A warm-up starts at boot, on a preset change, on new post stages, after a
  device loss and on `renderer.requestWarmup()`; it ends when the pipeline count stood still for 3 frames (at least 2
  frames, at most 8 s). `renderer.pipelineWarmup`: `phase`, `pipelinesReadyMs` (boot warm-up), `pipelinesAfterWarmup`
  (budget 0; every later pipeline is counted and warned about). `renderer.whenPipelinesReady()` gates Clock In and the
  "Applying settings" overlay.
- **Warm-up holds** (`renderer.holdWarmup()` returns `release`): content that loads asynchronously (baked terrain, models)
  is not on screen in the first frames, so a still pipeline count says nothing about it (measured: `?scene=moon` on WebGL2
  ended the boot warm-up after 0.7 s, then built 8 pipelines when the terrain arrived). Take a hold in `init` before the
  load starts and call `release()` right after the content (and its warm-up instances) is in the scene. The warm-up cannot
  settle while a hold is out; its 8 s cap counts from the last release; a hold never released ends after 60 s.
  `pipelineWarmup.holds` shows how many are out.
- **Warm-up sources**: `renderer.addWarmupSource((active) => ...)`. On `true` show one instance of every variant you will
  ever draw (both lamp states, every LOD, VFX quads, with `frustumCulled = false`), on `false` hide them again. Whatever
  is not on screen during warm-up compiles on first use and shows up in `pipelinesAfterWarmup`.
- **Memory ledger** (`memory-ledger.ts`, `renderer.memory`): `add(owner, category, label, bytes)` when a GPU resource
  is created, `resize(id, bytes)`, `remove(id)` in `dispose()`. Categories and budgets are the section 13 table
  (`MEMORY_BUDGET_MB`); `totals` is the per-category sum against the preset. `textureBytes(w, h, bytesPerPixel, { mips,
layers })` sizes an entry. The render module records the scene pass target itself; every other owner records its own.
  `renderer.rendererInfo` is what three's own tracker counts (textures, geometry, total), as a cross-check.
- `window.__mcRender()` (dev / perf tools): warm-up, draw budget, ledger, three's tracker and dynres in one object.
- Not built: `pipelines.manifest.ts` and its CI check (no material families exist yet to list); the count-based check
  above stands in for it. The count is three's `info.memory.programs` (shader stages): a new pipeline that reuses
  existing stages with other render state is not seen.

## Hooks for other roles

- **technical-artist (visuals):** add objects under `sceneRoots.world / sky / vfx`. Install post effects with
  `renderer.setPipelineStages({ hdr, display, dispose })`: `hdr(color, ctx)` runs scene-linear before the tone map
  (AO, TRAA, VFX composite, bloom, exposure), `display(color, ctx)` runs after `renderOutput()` (SMAA, sharpen).
  `ctx.scenePass` is the `PassNode` (call `setMRT`, `getTextureNode("depth")` on it). Stage functions are called again
  after a device loss and must build fresh nodes each time. Do not set `scene.background`: the clear is black and the
  sky is geometry. Tone mapper and output colour space are the renderer's (`renderer.toneMapping` follows
  `quality.current.post.toneMapping`; exposure stays 1, lights are pre-exposed).
- **terrain-dust-engineer / anyone with GPU-only state** (render targets, storage textures, compute state): subscribe
  to `renderer.onLost` and `renderer.onRecreated` and rebuild against the new `renderer.renderer`. Geometries,
  materials and CPU-backed textures are re-uploaded by three.
- **gameplay:** owns the camera transform and FOV; render owns aspect, near and far (`applyCameraProjection`).
- **performance-profiler (debug):** `FrameLoop.lastStepMs(step)`, `frameTimeStats()`, the User Timing spans
  `mc:<step>:update`, `renderer.readStats(out)`; construct `RenderModule` with `trackTimestamp: true` to enable GPU
  timestamp queries. `FrameLoop.setSpansEnabled(false)` removes the span cost.
- **Everyone:** the per-frame `FrameInfo` and `viewport` objects are reused; read them, do not keep them.

## Rules that hold here

- One renderer: `WebGPURenderer`; WebGL2 is its own fallback backend (`forceWebGL`), not a second code path.
- `await renderer.init()` once (inside `RendererHost`), then synchronous `render()` through `RenderPipeline`.
- The canvas is opaque, clears to black, has no MSAA; AA is a post stage. DPR cap applies to the canvas only.
- Manual stepping advances one frame per display frame: three advances its node frame once per `requestAnimationFrame`,
  so several renders inside one display frame would reuse the first scene pass.

## Bench scene v0 (`?scene=bench`, M0-W2-T02) and instancing helpers

Early-signal render spike, **not a verdict** (E7 is decided on bench v1, M0-W3-T07). Code: `bench/`, `instancing/`.

- URL: `?scene=bench&draws=200|350|600|900&preset=low|medium|high` plus `path=p1|p3` (the bench drives the camera:
  P1 walk loop, P3 orbit + sky pan), `anim=0` (static frame), `dbg=1..7` (terrain shader value as a grey image),
  `probe=zfight` (reversed-Z probe: two planes 3 m apart at 15 km; the rear one must never show). Add `capture=1` for
  frame-stepped runs.
- Content: 64 skirted terrain chunks (stand-in) with the worst-case terrain shader stub (27 counted fetches, 8 texture
  bindings), 2,100 instanced rocks in 4 draws, 16 avatar proxies in one `BatchedMesh`, 40 props, sun + `CSMShadowNode`
  (cascades from the preset), post chain: High = prepass + GTAO (indirect only) + TRAA + bloom + AgX; Low/Medium =
  bloom + AgX + FXAA (Low; client default, `?aa=smaa` restores SMAA) / SMAA (Medium). The bench look wires the post-AA star
  layer on TRAA chains like `VisualsModule`. Bloom at the canonical 4.0 / 0.5 / 0.06 / 0.35.
- `?draws=` is the renderer's own count over all passes: zero-size filler boxes are added or removed until the previous
  frame's `renderer.info` count matches (calibrated at the default pose; a moving camera drifts from it). If the base
  scene is already above the target, no filler is shown and `stats().draws` says so.
- `window.__mcBench`: `ready`, `paths.p1|p3` (keyframe specs in the shape of `__mcCameraPath`), `setPath(id|null)`,
  `setDraws(n)`, `stats()` (backend, preset, draws, triangles, fillers, cascades, post passes, texture bindings,
  `pipelinesAfterWarmup`, ...). `ready` becomes true after `compileAsync`, 8 frames and the draw calibration;
  `pipelinesAfterWarmup` is the growth of `renderer.info.memory.programs` since then.
- Velocity: `bench/camera-velocity.ts` writes camera-only reprojection (current minus previous NDC, unjittered
  matrices captured once per frame) for everything static; moving casters must keep three's `velocity` per material.
- Helpers for later waves: `instancing/` `InstancedSet` (one `InstancedMesh`, matrices in place, one `dispose()`),
  `BatchedPool` (one `BatchedMesh`, several geometries), `splitInstanceCounts`, `drawsNeeded`, `batchCapacity`.
- **Hard limit found by the bench:** at most 16 sampled textures per fragment stage (target <= 12 for terrain); see
  rendering-pipeline.md section 7.

### Bench v1 (M0-W3-T07): real regolith material on the baked height cube

- Default `terrain=real`; `terrain=standin` is the v0 path. Extra knobs: `terrainBase=<dir url>` (default
  `/assets/terrain/`, which nothing serves yet: in dev pass `/@fs/<abs repo path>/assets/terrain/`), `cube=256|1024`,
  `horizon=on|off`, `verify=1` (hash check of the inflated payloads in the browser). A failed load falls back to the
  stand-in loudly: `stats().terrainSource` is `real | standin | standin-fallback`, `terrainError` has the reason.
- Loading is async: `__mcBench` is installed (and `ready` can become true) only after the chunks, props and camera are
  built on the loaded height. Wait for `window.__mcBench?.ready`, not only `__mcReady`.
- Height: `terrain-cube.ts` decodes CTMH/CTMW (`DecompressionStream("deflate-raw")`) and samples bilinearly;
  `setTerrainHeightSource` makes `groundY` and the chunk builder use it. The cube lives in vertex data only. Horizon
  angles are two vec4 vertex attributes (`horizon-visibility.ts`); `HorizonCsmNode` multiplies the material's
  `userData.mcHorizonVisibility` into the cascade result. Material: `createRegolithMaterial` (visuals/materials barrel),
  mask = `bench-mask.ts` (2048^2 over 64 m, CPU filled). Fragment textures: 2 + CSM cascades.
- Look seam (follow-up): sun, fill, cascaded shadows, sky and post chain sit behind `bench/look.ts` `LookProvider`.
  `?look=visuals` (default) runs the technical-artist rig through the visuals barrel (`SunRig` + `MoonShadowNode`, `SkyRig`,
  `createLookStages` with `LOOK_GRADE`; `bench/look-visuals.ts`); `?look=v0` keeps the original bench chain (plain sun +
  `HorizonCsmNode`, stand-in sky, `createBenchStages`; `bench/look-v0.ts`) so numbers recorded earlier stay comparable.
  `stats().look` says which one ran. The regolith material's horizon term reaches `MoonShadowNode` through the same
  `userData.mcHorizonVisibility` key, so `horizon=on` works under both. Tests inject a look with `lookFactory`.
- Per-feature knobs (M0-W3-T08, visuals look and the look-dev scenes; parser `visuals/look-knobs.ts`): `aa=smaa|fxaa|traa|none`,
  `traa=on|off`, `gtao=on|off`, `aainput=rgba8|half-float`, `shadowres=512|1024|2048|4096`, `cascades=0..4`,
  `shadowfilter=vogel5|tent4|hard`, `pcf=<texels>`, `bloom=off|quarter|half`, `grade=look|neutral|off`, `sky=<level>|off`,
  `skyoff=dome,stars,earth,halo,sun`, `skydome=baked|procedural`. No knob = the shipped look; `stats().lookKnobs` reports
  them. Cost split on the UHD 620: `docs/agent-reports/M0-W3-T08-perf-pass.md`.
- Serving the terrain: nothing serves `assets/terrain` yet (see the T07 report for the Vite plugin the integrator adds);
  until then pass `terrainBase=/@fs/<abs repo path>/assets/terrain/`.
- Double "loading baked terrain" / "scene=bench" log lines are a Vite dev **full page reload** (a source file changed or
  dependencies were re-optimised while the page was open), not a second build in one page. `stats().buildsInPage` stays 1
  and `stats().pageTimeOrigin` changes when the page reloaded; a capture should assert both.
