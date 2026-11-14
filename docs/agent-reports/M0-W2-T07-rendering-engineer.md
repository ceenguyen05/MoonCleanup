# M0-W2-T07 r187 feature verification matrix

Status: **in-review** (all 15 rows run on `webgpu` and `webgl2`; SwiftShader lane and Tier B device NOT RUN) / 2026-11-12 / rendering-engineer, Sonnet 5.5. One Intel UHD 620 laptop only (headed Chrome, ANGLE D3D11 for webgl2, Medium preset, 1280x720): **no Tier A/B claim, no frame-time claim**.

Result: **13 PASS on both backends, 1 PASS with a custom node (row 5), 1 backend-split FAIL (row 13 storage textures on webgl2), row 11 N/A on webgl2.** Every PASS run had 0 console errors (the driver turns any console error into FAIL).

## Delivered (all under `apps/client/src/render/verify/`, plus 6 lines in `render/module.ts`)

- `?scene=verify&row=<n>` (1-15): one tiny scene per row, variants switched at runtime, `window.__mcVerify` (variants, `setVariant`, `measure`, `evaluate`). `app/**` untouched.
- `analysis.ts` (pure pixel stats, tested), `common.ts`, `types.ts`, `rows.ts` (registry), `rows-shadow.ts` (1-3), `rows-gpu.ts` (5, 10, 13), `rows-post.ts` (4, 6, 7, 8, 9, 14), `rows-more.ts` (11, 12, 15), `verify-scene.ts`.
- `run-matrix.mjs`: `node src/render/verify/run-matrix.mjs --lane gpu|ci --backend webgpu|webgl2 --rows 1,2,3|all --out <dir>` with `vite --port 5181` running in `apps/client`. Playwright from tools/screenshots; no installs.
- Screenshots: `docs/agent-reports/M0-W2-T07-evidence/` (rows 1, 2, 3, 5, 7, 12 on both backends; 8 TAAU; 13). Per-variant JSON/PNG of the full run is in the session scratchpad (`.../scratchpad/v2..v4`).
- Rules: no WebGLRenderer / EffectComposer / GLSL ShaderMaterial / renderAsync; `update()` in the rows allocates nothing (scratch `Matrix4`, closures built once).

## Matrix (rendering-pipeline.md section 21)

| # | Feature | webgpu | webgl2 | Measured effect (luma / pixel numbers are display bytes) |
| --- | --- | --- | --- | --- |
| 1 | CSM custom splits, fade, lightMargin | PASS | PASS | 3 cascades, custom splits 10 / 42 / 120 m. A box in each cascade shadows: 53.7 / 52.7 / 86.0 vs unshadowed 132.9 / 133.9 / 134.1. Off-screen 40 m tower shadows the view with lightMargin 300 (53.4 vs 133.9). `fade` on. webgl2 numbers identical. |
| 2 | Re-point CSM light at runtime | PASS | PASS | Light A -> "Earth" (other side, low, blue) -> A: shadow flips each time (52.7 vs lit 133.9 / 105.0 / 133.9); old shadow side lit again. No rebuild needed (CSM reads `light.position`/`target` every frame). |
| 3 | PCFShadowMap radius control | PASS (caveat 3) | PASS | Edge transition fraction 0.03 / 0.07 / 0.19 for radius 1 / 3 / 8. |
| 4 | GTAO prepass, AO on indirect only | PASS | PASS | `builtinAOContext` indirect mode: shadowed crevice/open ratio 1.05 vs 1.18 without AO; sunlit crevice unchanged (1.04 vs 1.05). The multiply-composite fallback darkens the sunlit crevice (0.83), which is exactly what indirect-only avoids. Effect is modest (radius 1.5 m, 16 samples). |
| 5 | Specular-only environment | **PASS via custom node; native FAIL** | same | Cube camera -> half-float `CubeRenderTarget` -> `PMREMGenerator.fromCubemap` works (glossy sphere 77 % red/blue pixels). r187 has no switch to drop the irradiance term of `scene.environment` / `EnvironmentNode` (matte sphere luma 213 with native IBL). A `LightingNode` subclass set as `material.envNode` that adds only `context.radiance` gives matte 62 (specular only) and keeps the glossy sphere (214 vs 192). Gotcha: its `setup()` must return a node (`vec3(0)`); returning `null`/`undefined` logs `Invalid generated code, expected a "vec3"`. |
| 6 | `renderOutput()` with `outputColorTransform = false` | PASS | PASS | No tone mapping: linear 0.05 / 0.18 / 1 encode once to sRGB 63 / 118 / 255 (expected 63 / 118 / 255). AgX: 70 < 128 < 202 < 239 < 254 for 0.05 / 0.18 / 1 / 4 / 16. Limit: only our `outputColorTransform = false` path was run; the r187 default (`true`) path was not (not used by the plan). |
| 7 | Velocity: static (camera-only), instanced, batched, skinned | PASS | PASS | Velocity MRT rendered to screen: static mesh 0.0, still instanced/batched instances 0.0, animated instance 34.5, animated batched instance 32.5, animated skinned bone 16.4, all objects 46 with a moving camera (camera-only velocity works). TRAA chain on the same scene renders (object luma 173). Screenshot: velocity view. Not measured: moving-camera TRAA smear on terrain (see T02 NOT RUN). |
| 8 | TAAU and FSR1 | PASS | PASS | Render scale 0.5, checker plane, gradient-energy metric: native 645.6, bilinear 225.8, FSR1 356.8 (recovers detail), TAAU 220.7 (anti-aliased, not sharper; screenshot is clean). Static camera only; TAAU motion behaviour NOT RUN. |
| 9 | Per-pass `setResolutionScale` | PASS | PASS | Scene pass target 1280 / 960 / 640 px for scale 1 / 0.75 / 0.5 on a 1280 canvas (exact), changed live without rebuild, back to 1.0 exact; canvas stays native; bloom pass scale 0.5 / 0.25 accepted; image softer at 0.5 (edge energy 645.6 vs 225.8). Bloom target size itself not asserted. |
| 10 | Clustered lighting | PASS | PASS | `renderer.lighting = new ClusteredLighting()` before first frame; 16 / 64 / 256 point lights (7 m radius): near block 212 vs far block 0 with 16, far block 198 with 256. |
| 11 | Compatibility-mode adapter | PASS | N/A | `requestAdapter({ featureLevel: 'compatibility' })` returns an adapter that also has `core-features-and-limits`; `backend.compatibilityMode` is readable (false here). three r187 `WebGPUBackend.init` **always** asks for `featureLevel: 'compatibility'` (source), so there is no separate "compat attempt" for us to code. webgl2: no adapter concept. |
| 12 | Reversed depth | PASS | PASS | Planes 3 m apart at 15 km, 1 m at 5 km, 8 m at 25 km (near 0.05, far 30 km): nearer plane wins 100 % of centre pixels, 0 % rear, on both backends; `reversedDepthBuffer=true` on both (EXT_clip_control present via ANGLE). Fallback depth ranges (section 4) not exercised. |
| 13 | Compute, storage textures, `copyTextureToTexture` | PASS | **FAIL (storage textures)** | webgpu: compute writes a `StorageTexture` (red ramp 147 -> 192, green 189 -> 145), copy equals source (146.6 / 191.7), storage-buffer compute + `getArrayBufferAsync` exact, DataTexture copy works. webgl2: `textureStore` throws `THREE.NodeBuilder: Uniform "storageTexture" not implemented`; storage-buffer compute + readback PASS; `copyTextureToTexture` (DataTexture) PASS. |
| 14 | BloomNode threshold / knee | PASS | PASS | Isolated emitters: threshold 4: 0.5 and 2 give halo 0, 8 gives 171, 16 gives 231; threshold 1 makes emitter 2 bloom (91). Knee is the width of a `smoothstep(threshold, threshold + knee, luma)` ramp: emitter 8 at threshold 7 gives halo 165 with knee ~0 and 88 with knee 3. |
| 15 | Integer `textureLoad` | PASS | PASS | RGBA32UI and R32UI 8x8 textures read with `texture(tex).load(ivec2)`: all 5 sampled texels exact (max error 0 / 1 sRGB byte). Gotcha: do not set `DataTexture.internalFormat` to a WebGL name ("RGBA32UI"): on WebGPU it becomes the texture format and creation fails; leave it unset (works on both backends). |

## FAIL rows: consequence, fallback, owner, doc to amend (the lead edits the docs)

1. **Row 13, storage textures on webgl2 (FAIL).** Compute shaders that write `StorageTexture` via `textureStore` cannot run on the WebGL2 backend (the WebGL2 backend has no storage texture uniform). Consequence: dust replay textures (WDS section 7.3) and any particle/terrain pass that writes a texture from compute exist only on the WebGPU path. Adopt the plan's own fallback for `webgl2`: fragment-pass writes to a render target (ping-pong) for textures. Two verified helpers for the fallback: compute into **storage buffers** works on webgl2 (read back exact), and `copyTextureToTexture` works. Not verified here: the fragment-path render-target version itself (no scene built). Owner: terrain-dust-engineer (dust/terrain compute) with technical-artist for VFX particles. Amend: world-and-dust-simulation section 7.3 (state that the fragment path is mandatory on `webgl2`, not an optimisation) and rendering-pipeline section 21 row 13 (webgl2 column). No ADR needed: the fallback is already the documented one; an ADR is only needed if the product decides WebGL2 may drop dust replay.
2. **Row 5, native specular-only switch (FAIL), fallback adopted and verified.** Use the custom `LightingNode` (`SpecularOnlyEnvironment` in `verify/rows-gpu.ts`, 10 lines) instead of `scene.environment` for the probe. Owner: technical-artist (probe, section 5.5 / 8). Amend: section 21 row 5 fallback text ("custom LightingNode via `material.envNode`; its `setup()` must return a node") and section 5.5. Cost: each material needs `envNode` assigned (or a shared material mixin); the node reads roughness and the view reflection like `EnvironmentNode`.

No other row failed. No row changes an architecture choice.

## Findings that matter beyond PASS/FAIL

1. `CSMShadowNode` clones `light.shadow` per cascade: runtime `radius` (or bias) changes must go to `csm.lights[i].shadow`. `csm.fade` is read when the shader is built (construction-time option, preset change = rebuild). Owner: technical-artist; section 5.2.
2. PCF in r187 is Vogel-disk (5 taps) plus interleaved-gradient noise: radius >= 3 shows visible dither. TRAA (High/Ultra) hides it, SMAA (Low/Medium) does not: cap the radius around 2 on Low/Medium or accept the dither. `PCFSoftShadowMap` no longer exists in r187.
3. With 3 cascades the far cascades' light-space box already contains tall casters; `lightMargin` mostly matters for the near cascade (margin 1 vs 300 changed nothing for the tower in cascade 2). The option works (row 1).
4. CSM on WebGL2 works with 3 cascades on this machine: the risk-register fallback ("`SunLight` 2-cascade on webgl2", section 18) is not needed here. The lead may retire that risk for the UHD 620 WebGL2 path (SwiftShader not run).
5. Looking down +z, world +x is screen-left (relevant to anyone placing sun azimuth).
6. `BloomNode`: threshold semantics is "ramp starts at threshold", so the canonical "threshold 4.0, knee 0.5" means emissive 4.0 contributes nothing and 4.5 contributes fully.

## NOT RUN / limits (honest list)

- SwiftShader (`--lane ci`) lane and the Tier B reference device: NOT RUN (only the UHD 620 gpu lane). The driver supports `--lane ci`.
- No frame-time / CPU numbers (this matrix is functional only); Tier A/B performance claims: none.
- TRAA/TAAU temporal behaviour under camera motion (smear, history rejection) not measured; only the velocity buffer (row 7) and static upscaling (row 8).
- Row 6 default `outputColorTransform = true` path not run; row 12 section 4 fallback depth ranges not exercised; row 13 webgl2 fragment-path replacement not built; row 9 bloom target size not asserted.
- "No per-frame allocations": by code review of `update()` bodies only (no allocation profiler run).
- Card path mismatch: the card names `docs/agent-reports/M0-W2-r187-verification.md`; this report (path given by the lead) is the matrix.

## Evidence (file state 2026-11-12 21:45, Node 26.13.1)

`tsc` exit 0; `eslint src/render` clean; `prettier --check src/render/verify src/render/module.ts` clean; `vitest run` whole client 137 tests pass (verify adds 4: analysis maths, sRGB, rect maths, registry has rows 1-15). The run logs above are from the Playwright driver; verdict lines are produced by each row's `evaluate()` in the page.

## Blockers / requests

None. Lead: apply the doc amendments above; integrator: `?scene=verify` needs nothing in `app/**`. Run `node run-matrix.mjs --lane ci ...` on a CI-capable host and the Tier B device when available.

Commit suggestion: `feat(client): r187 feature verification matrix (15 rows, both backends) and driver`
