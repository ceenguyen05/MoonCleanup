# Rendering Engine Case: Three.js (WebGPURenderer + TSL, WebGL2 fallback)

Date: 2026-11-11 · Author: advocate subagent P2a · Status: advocacy research (honest-case). All sources accessed 2026-11-11; numbered citations [n] refer to the Sources list at the end.

---

## Executive summary

- **Current stable: r187 (npm `three@0.187.0`), published 2026-10-30.** Twelve releases from r176 (2025-04-23) to r187; MIT licence; 118,167 GitHub stars; 35,595,518 npm downloads in the week 2026-11-04 to 2026-11-10. [1][6][7][17]
- **One renderer, two backends.** `WebGPURenderer` uses WebGPU when the browser has it and falls back to a WebGL 2 backend automatically. Shaders are written once in TSL (Three.js Shading Language), which compiles to WGSL or GLSL. [9][11]
- **Honest maturity flag:** the official manual still says *"The renderer itself is still in an experimental state."* WebGLRenderer is maintained but will get *"no … larger new features"*. All new work goes into WebGPURenderer. [9]
- **Every item on our visual bar has an official building block with a live example:** PBR node materials, SunLight and CSMShadowNode cascaded shadows, AgX/ACES/Neutral tone mapping, HDR half-float output, GTAO/SSAO, bloom, TRAA/SMAA/FXAA/SSAA, SSR/SSGI, DOF, motion blur, displacement and parallax, compute particles, soft particles, skinning, and IES spotlights for the helmet lamp. [3][8][13][15][18]
- **Compute for the dust masks is first-class on WebGPU:** storage textures (2D and 3D), ping-pong compute textures, partial texture updates, buffer readback, workgroup atomics, indirect dispatch and `compileComputeAsync()`. Atomics and indirect draws do **not** work on the WebGL2 fallback. [3][4][8][12][19]
- **Dynamic-resolution building blocks ship in core and examples:** per-pass resolution scale (`setResolutionScale`), a TAAU upscaling example, an FSR1 example, plus MSAA through the renderer options. [5][8][11]
- **Biggest technical risk is CPU cost per object.** Issue #30560, a WebGPURenderer UBO bottleneck with many render items, has been open and labelled *High priority* since 2025-02-19. A forum benchmark on r183 measured about 2× the CPU time per frame of WebGLRenderer and a 5–10× slower first frame. Our architecture must therefore keep draw calls low (BatchedMesh, instancing, render bundles, chunked terrain). [20][21]
- **The WebGL2 fallback is a real path, not an edge case.** Linux Chrome without Intel Gen12+ or NVIDIA-on-Wayland, Firefox on Linux and many Android devices still lack WebGPU. Those players get the WebGL2 backend, which lacks some compute features. [19][23]
- **It is a renderer, not an engine.** There is no editor, no planetary terrain/LOD system, no physics and no netcode. Official Rapier examples (character controller, vehicle controller, terrain) and community quadtree-planet projects reduce the gap. [8][34][35]
- **React Three Fiber: do not adopt it for the game runtime.** The stable line is v9.8.2 (2026-10-15). WebGPU becomes the default only in v10, which is still alpha (v10.0.0-alpha.6, 2026-10-17). [24]
- **Agent familiarity is high but skewed toward legacy WebGL code.** An official `llms.txt` steers LLMs toward WebGPURenderer and TSL. API churn is real: `PostProcessing` became `RenderPipeline` (r183), `renderAsync()` was deprecated (r181) and `PCFSoftShadowMap` was removed (r186). Mitigations: pin the version, use a ban-list lint and vendor the docs into the repo. [5][16][17]
- **Self-score: 36/50** (section 9). Strongest on visual ceiling, compute, community and modularity. Weakest on WebGPU-path CPU overhead, fallback parity and solo-dev "engine assembly" cost.

---

## 1. Version, cadence, breaking-change policy, licence, community

| Fact | Value | Source |
|---|---|---|
| Current stable | **r187**, published 2026-10-30T08:03:18Z; npm `three@0.187.0` (the official LLM instructions pin this version in their import map) | [1][2][17] |
| Recent cadence | r176 2025-04-23 · r177 2025-05-30 · r178 2025-06-30 · r179 2025-08-02 · r180 2025-09-03 · r181 2025-11-19 · r182 2025-12-10 · r183 2026-02-20 · r184 2026-04-16 · r185 2026-07-01 · r186 2026-09-24 · r187 2026-10-30. That is about monthly in 2025 and about every 1–2.5 months in 2026. | [1] |
| Versioning / breaking changes | No semver: each `rNNN` can break APIs. Changes are documented per release in the official Migration Guide. Deprecations are kept for about 10 releases (r187 *"Removed code deprecated in r177"*). | [2][5] |
| Migration burden (last 8 releases, examples) | r180: `RGBELoader` became `HDRLoader`; new DOF API. r181: `renderAsync()`/`computeAsync()` deprecated in favour of `await renderer.init()`; PBR energy and PMREM changes. r182: `colorBufferType` became `outputBufferType`. r183: `PostProcessing` became `RenderPipeline`; `Clock` deprecated for `Timer`; shadow bias retuning. r185: TSL renames; `positionLocal` semantics with skinning. r186: `PCFSoftShadowMap` removed from WebGPURenderer; `Object3D.dispose()` added. r187: PMREM moved to cube render targets; struct storage buffers are always treated as arrays. | [5] |
| Licence | MIT | [6] |
| Repository | `mrdoob/three.js`, created 2010-03-23. Last push 2026-11-11. 401 open issues + PRs. 36,951 forks. 2,517 watchers. | [6] |
| Maintainers | Small core team led by the project creator (`mrdoob`). The exact maintainer roster was **not verified** in this pass; the decider should check the GitHub contributors graph. Maintainer `Mugen87` answers WebGPU questions on the official forum. | [6][19] |
| GitHub stars | 118,167 | [6] |
| npm weekly downloads | 35,595,518 (2026-11-04 to 2026-11-10). npm counts include CI and mirror installs, so treat this as an order-of-magnitude popularity signal. | [7] |

**What the cadence means for us:** we should pin one release for each development milestone and upgrade deliberately, about quarterly, by walking the Migration Guide. We should not float to "latest", because each release can change look-affecting defaults: PMREM and energy conservation in r181 and r187, GTAO darkness in r185 and r186. [5]

---

## 2. WebGPURenderer maturity (Nov 2026), WebGL2 fallback, TSL

### 2.1 Status

- **Official position.** `WebGPURenderer` "has the ability to target different backends… tries to use a WebGPU backend… If not, `WebGPURenderer` falls backs to a WebGL 2 backend." [11] The manual says the renderer *"is still in an experimental state"*, that maturity has improved, and that users should upgrade to the latest version whenever possible. [9]
- **Project direction.** WebGLRenderer *"is still maintained and the recommended choice for pure WebGL 2 applications"*, with *"no plans to add larger new features"*. The team is *"investigating… limited node material support to WebGLRenderer"*. [9] The examples index now has a small `webgl / tsl` category (shadowmap, skinning, clearcoat, instancing), and r186 added node-material support to `WebGLRenderer.compile()`. [3][8] For a new project, **WebGPURenderer is where all the investment goes.**
- **Recent maturity signals (last 3 releases):**
  - r185: Forward+ clustered lighting, rendering to texture arrays, surfacing of uncaptured GPU errors and WGSL diagnostics, WebXR on WebGPU. [4]
  - r186: `compileComputeAsync()`, `DirectRenderPipeline`, SunLight with CSM, swappable lighting systems, more robust occlusion queries. [3]
  - r187: parallel pipeline compilation in `compileAsync()`, depth-only render targets, and new experimental drawing pipelines (`StandardDrawingPipeline`, `MeshletDrawingPipeline`, `VisibilityBufferDrawingPipeline`). [2] The docs mark `drawingPipeline` as experimental. [12]
- **Open-issue reality.** The search returned 25 open issues labelled `WebGPURenderer` (2026-11-11). [22] Those relevant to us:
  - #30560 UBO system performance with many render items: open since 2025-02-19, labelled *High priority / Needs Investigation*. The original report measured about 4× slower than WebGLRenderer with 20k non-instanced meshes on r173. [21]
  - #33821 *"Material initialization is extremely slow compared to WebGLRenderer"* (2026-06-16). [22]
  - #35086 *"compileAsync() does not compile shadow pass pipelines"* (2026-10-18). Shadow pipelines are compiled lazily, which can cause stutter the first time a shadow pass runs. [22]
  - #33795 *"StorageTexture compute writes not visible to RenderPipeline texture() bindings in same frame"* (2026-06-12). **This directly affects the dust-mask design.** [22]
  - #32735 inefficient compute pipeline caching (2026-01-12). [22]
  - #34720 a failed node build silently falls back to a bare NodeMaterial (2026-09-30). [22]
  - #30725 request for WebGPU Compatibility Mode, for older GPUs (2025-03-11). [22]
- **Independent benchmark (forum, r183, 2026-05-29).** Scene: 4,000 meshes over 200 geometries, about 8M triangles, RTX 4090 laptop, Chrome 148. CPU time per frame was 4.5 ms with WebGLRenderer, 9.7 ms with WebGPURenderer on WebGPU and 10.3 ms with `forceWebGL`. Cold first frame was 32 ms, 167 ms and 344 ms respectively. A community respondent advised staying on WebGLRenderer unless WebGPU features are needed. No maintainer replied in the thread. [20] **Takeaway:** the WebGPU path pays a CPU tax per object, and its WebGL2 backend does *not* inherit WebGLRenderer's optimisations.

### 2.2 The automatic WebGL2 fallback: what degrades

| Area | On the WebGL 2 backend | Source |
|---|---|---|
| Node materials / TSL | Work. TSL transpiles to GLSL. | [9] |
| Compute shaders | *"Not fully compatible with WebGL 2"*. Indirect draws via `IndirectStorageBufferAttribute` and atomics are WebGPU-only and *"can't be emulated"*. Maintainers suggest testing the compute examples on a WebGL2-only browser. | [19] |
| Storage textures | No official statement found. **Treat as WebGPU-only until tested** with `forceWebGL`. | — (unverified) |
| GPU timing | The timer query can be unavailable on the WebGL backend. r185 fixed an FPS counter that froze in that case. | [4] |
| Legacy WebGL code | `ShaderMaterial`, `RawShaderMaterial`, `onBeforeCompile` and `EffectComposer` are **not supported by WebGPURenderer on either backend**. Everything must be TSL plus `RenderPipeline`. | [9] |
| CPU overhead | Similar to the WebGPU path (≈10 ms vs 4.5 ms for WebGLRenderer in the benchmark above). | [20] |
| Testing | `forceWebGL: true` forces the fallback, for CI and QA. | [9][11] |

**Who will land on the fallback (gpuweb status, page edited 2026-10-02) [23]:**

| Browser | WebGPU shipped | Still without WebGPU (fallback users) |
|---|---|---|
| Chromium | Windows, macOS, ChromeOS (113). Android 12+ on ARM/Qualcomm/Intel (121). Linux: Intel Gen12+ (144) and NVIDIA on Wayland (147). | Other Linux GPUs (flag only). Windows ARM64 (flag only). |
| Firefox | Windows (141). macOS (145 on macOS 26+; 147 on all macOS versions). | Linux (Nightly only). Android (flag only). |
| Safari | macOS, iOS, iPadOS and visionOS 26. | — |

Our "30+ FPS on integrated graphics" target therefore has to hold on the **WebGL2 backend** for some players, for example Linux laptops with AMD integrated graphics.

### 2.3 TSL

- **What it is.** Shaders are written as JavaScript node graphs and transpiled to WGSL or GLSL depending on the backend. [9]
- **Official LLM guidance:** prefer TSL over GLSL, with *"no string manipulation or onBeforeCompile hacks"*, and use the `*NodeMaterial` classes. [17]
- **Docs and tooling.** The docs `llms.txt` links a TSL guide with a playground and a full TSL reference. [17] The examples include `webgpu_tsl_editor`, `webgpu_tsl_graph`, `webgpu_tsl_transpiler` and `webgpu_tsl_interoperability`. [8]
- **Still evolving.** r187 added implicit type promotion in operators and math functions. r185 renamed `directionToColor()` to `packNormalToRGB()` and `colorToDirection()` to `unpackRGBToNormal()`. TSL `PI2` became `TWO_PI` in r181. [5]
- **Why it suits parallel agents:** effects, material tweaks and compute kernels are plain JS functions in ES modules. They can be unit-reviewed, imported and composed without string patching. [17]

---

## 3. Feature evidence for our visual bar

Unless stated otherwise, "Example" names are verified in the official r187 examples index [8]. Live URLs follow the pattern `https://threejs.org/examples/#<name>`.

| Visual-bar item | Three.js answer (r187) | Evidence | Caveats |
|---|---|---|---|
| PBR / physical materials | `MeshStandardNodeMaterial`, `MeshPhysicalNodeMaterial`. Improved energy conservation (r181). PMREM moved to cube render targets (r187). Retroreflection added (r186). | [1][5][17]; examples `webgpu_materials`, `webgpu_lights_physical`, `webgpu_loader_gltf`, `webgpu_materials_retroreflection`, `webgpu_furnace_test` | Look changes between releases (r181, r187), so pin and re-baseline. [5] |
| High-detail regolith: displacement / parallax | Displacement maps; parallax UV. r185 fixed shadows on displacement-mapped surfaces. | [4]; `webgpu_materials_displacementmap`, `webgpu_parallax_uv`, `webgpu_textures_anisotropy` | Production-grade parallax occlusion mapping is ours to build in TSL. |
| Single harsh sun + cascaded shadows | **SunLight** (r186): sun-like light that casts **2-cascade** CSM, 1024² per cascade by default, blended cascades, *"suited for lighting large scenes"*. With WebGPURenderer it needs `SunLight.registerNode(SunLightNode)`. **CSMShadowNode**: 3 cascades by default; `practical`, `uniform`, `logarithmic` or `custom` splits; `fade`; `lightMargin`; *"can only be used with WebGPURenderer"*. | [3][13][14][15]; `webgpu_lights_sunlight`, `webgpu_shadowmap_csm` | SunLight is fixed at 2 cascades and documented as a poor fit for small, bounded scenes. Our case is a surface walker with a horizon, so it fits. Use CSMShadowNode if we need 3–4 cascades. r186 fixed a frame-late CSMShadowNode bug. [3][13][14] |
| Shadow filtering ("hard but filtered") | `PCFShadowMap` is now soft (radius-controlled); `PCFSoftShadowMap` was removed from WebGPURenderer in r186. Soft PCF uses `textureGatherCompare` (r185). VSM and contact shadows are available. r187 fixed the PCF radius for non-square maps and the PCF bias with reversed depth. | [2][4][5]; `webgpu_shadowmap_vsm`, `webgpu_shadow_contact`, `webgpu_shadowmap` | Shadow bias needs retuning after r183. [5] |
| HDR + filmic tone mapping (AgX vs ACES) | `NoToneMapping`, `Linear`, `Reinhard`, `Cineon`, **`ACESFilmicToneMapping`**, **`AgXToneMapping`**, **`NeutralToneMapping`** (the official example defaults to Neutral). Half-float output buffer by default (`outputBufferType: HalfFloatType`). | [11][18]; `webgpu_tonemapping`, `webgpu_hdr`, `webgpu_color_grading`, `webgpu_postprocessing_3dlut` | Recommendation, not a fact: start with AgX for harsh lunar highlights and A/B against ACES using the Inspector's Color Grading extension (r186). [3] |
| Post-processing pipeline | **`RenderPipeline`** (renamed from `PostProcessing` in r183) with `pass()`, built-in **MRT** (for example `output` plus `velocity`), automatic pass merging, and `outputColorTransform` / `renderOutput()` to control where tone mapping happens. | [5][10]; `webgpu_postprocessing`, `webgpu_mrt` | `EffectComposer` passes are not usable with WebGPURenderer. [9] |
| Subtle bloom | `BloomNode`, with a faster blur in r186. Selective and emissive variants. | [3]; `webgpu_postprocessing_bloom`, `_bloom_selective`, `_bloom_emissive` | — |
| Ambient occlusion | `GTAONode` (r185/r186 rework: more physically correct, darker and wider) and `SSAONode` (r186). | [3][4][5]; `webgpu_postprocessing_ao` | AO look changed in r185/r186, so retune radius and scale. [5] |
| TAA / SMAA / FXAA / MSAA / SSAA | TRAA example and `TAAUtils` (r186); TAA depth support and `TemporalReprojectNode` work (r187). SMAA (fixed and simplified in r186), FXAA (*"must be computed in sRGB"*), SSAA, and MSAA via `antialias` / `samples`. | [2][3][10][11]; `webgpu_postprocessing_traa`, `_smaa`, `_fxaa`, `_ssaa`, `webgpu_multisampled_renderbuffers` | The crispness of TRAA and its ghosting on fast low-gravity dust must be evaluated in a spike. |
| Dynamic resolution / presets | Per-pass `setResolutionScale()` (r181), RTT resolution scaling (r185), **TAAU** and **FSR1** upscaling examples. | [4][5]; `webgpu_upscaling_taau`, `webgpu_upscaling_fsr1` | The controller that adjusts scale from frame time is ours to write. GPU frame timing needs timestamp support (WebGPU path). |
| SSR / SSGI / DOF / motion blur / extras | SSR (r187: full GGX lobe, F0/F90) with a denoiser. SSGI. DOF (new implementation in r180). Motion blur. God rays, lens flare, lens dirt (r187). Experimental VXGI (r186). | [2][3][5]; `webgpu_postprocessing_ssr`, `_ssr_denoise`, `_ssgi`, `_dof`, `_motion_blur`, `_godrays`, `_lensflare`, `webgpu_vxgi` | Mostly optional for us. A "Cinematic" preset only. |
| IBL / environment | PMREM from HDR, cube maps or scenes. Light probes. | [2][5]; `webgpu_pmrem_equirectangular`, `webgpu_pmrem_scene`, `webgpu_materials_envmaps`, `webgpu_lightprobes` | The lunar sky is black, so IBL is mostly Earth-shine fill. |
| Starfield + Earth | TSL Earth example, sky, procedural textures. For a physically based Earth atmosphere, `@takram/three-atmosphere` (WebGPU support marked "Done"). | [8][26]; `webgpu_tsl_earth`, `webgpu_sky`, `webgpu_procedural_texture` | three-geospatial's packages are Beta or Alpha. [26] |
| Convincing night + helmet lamp | Spot lights with shadows, **IES profiles**, projector lights, Forward+ clustered lighting for many vehicle and robot lights (r185). | [4]; `webgpu_lights_spotlight`, `webgpu_lights_ies_spotlight`, `webgpu_lights_projector`, `webgpu_lights_clustered` | — |
| Instancing / BatchedMesh / GPU-driven | `InstancedMesh`; `BatchedMesh` (r187: sort and draw-range fixes, merging of consecutive draws); render bundles; occlusion queries; experimental meshlet pipelines. | [2][3][12]; `webgpu_instance_mesh`, `webgpu_mesh_batch`, `webgpu_performance_renderbundle`, `webgpu_occlusion`, `webgpu_meshlets` | These are the main mitigations for the per-object CPU overhead in §2.1. |
| LOD | Core `LOD` object. BatchedMesh LOD with BVH example (WebGL). | `webgl_lod`, `webgl_batch_lod_bvh` [8] | No dedicated WebGPU LOD example in the index. Terrain LOD is DIY (§4). |
| Render targets / storage textures (dust masks) | Storage textures in 2D and 3D (`storageTexture3D` in r185), `.store()`, `textureGather`, integer stores (r186), partial texture updates, MRT readback. | [3][4]; `webgpu_compute_texture`, `webgpu_compute_texture_pingpong`, `webgpu_compute_texture_3d`, `webgpu_textures_partialupdate`, `webgpu_multiple_rendertargets_readback` | Open issue #33795 (same-frame visibility of storage-texture writes) [22]. Probably no WebGL2 parity (§2.2). |
| Compute shaders | `renderer.compute(nodes, dispatchSize)` with indirect dispatch, `compileComputeAsync()`, workgroup atomics (r186), `getArrayBufferAsync()` readback, bitonic sort in one pass (r187). | [2][3][12]; `webgpu_compute_particles`, `webgpu_compute_water`, `webgpu_compute_cloth`, `webgpu_compute_sort_bitonic`, `webgpu_compute_reduce` | Atomics and indirect dispatch are WebGPU-only. [19] |
| Low-gravity dust particles | GPU compute particles (rain, snow, fluid); `softParticles()` (r186); sprite and point instancing. | [3]; `webgpu_compute_particles_snow`, `webgpu_compute_particles_rain`, `webgpu_particles`, `webgpu_particles_soft`, `webgpu_instance_points` | — |
| Footprints / tracks | Best done as stamps into the same storage or render-target dust-mask system (compute or RTT). | Compute and storage examples above [8] | Design work, not an off-the-shelf feature. |
| KTX2/Basis, Draco, meshopt | KTX2 (`detectSupport()` after `renderer.init()` since r181; r185 fixes); compressed glTF example; Draco moving to WASM-only. A shipped three.js portfolio game uses ETC1S/UASTC and Draco. | [4][5][31]; `webgpu_loader_texture_ktx2`, `webgpu_loader_gltf_compressed` | GLTFLoader's meshopt decoder support was **not re-verified** in this pass. |
| Skeletal animation & blending | Animation system with blending and additive-blending examples. WebGPU skinning, instanced skinning and retargeting examples. Bone counts above the UBO limit (r186). AnimationAction time-warp fix (r185). | [3][4]; `webgl_animation_skinning_blending`, `webgl_animation_skinning_additive_blending`, `webgpu_skinning`, `webgpu_skinning_instancing`, `webgpu_animation_retargeting` | The blending examples are on the WebGL track. The mixer is part of three.js core rather than the renderer, but test it on WebGPU. There is no visual animation state-machine editor. |
| Timestamp queries / profiling | The official **Inspector** addon (imported from `three/addons` in official examples): FPS graph and CPU/GPU graph metrics (r185); overdraw mode (r185); timeline, split screen and color grading (r186); GPU time for indirect draws (r187). | [2][3][4][18] | The `trackTimestamp` option is not documented on the docs pages fetched [11][12]. GPU timing can be unavailable on the WebGL backend [4]. No docs page for Inspector was found (404). |
| Shader-stutter control | `compileAsync()` (parallel compilation in r187) and `compileComputeAsync()`. | [2][3][12]; `webgpu_compile_async` | Shadow-pass pipelines are not precompiled (#35086). Material init is slow (#33821). [22] |

---

## 4. Terrain at planetary (moon) scale

**What exists**
- **Official building blocks:** `webgpu_tsl_procedural_terrain`, displacement and parallax examples, `webgpu_reversed_depth_buffer` and `webgpu_camera_logarithmicdepthbuffer`. [8] The renderer exposes `reversedDepthBuffer` and `logarithmicDepthBuffer` options. [11]
- **Precision:** `Renderer.highPrecision` computes model-view and normal-view matrices with CPU 64-bit precision. Caveat from the docs: *"not compatible with InstancedMesh and SkinnedMesh"*. [12]
- **three-geospatial (takram), MIT:** atmosphere (Beta, WebGPU done), clouds (Beta, WebGPU in progress), core (Alpha, WebGPU done) and effects (Alpha). The author is moving to a node-based API that *"will be incompatible with the current one"*. [26] Useful for the Earth-in-the-sky shot, not for the moon surface.
- **Community quadtree / cube-sphere planets:**
  - `merpnderp/webglquadtreeplanet`: WebGL quadtree planet. [34]
  - PlanetTech: quadtree-LOD procedural planets. [35]
  - "Lagrange" planet builder, with TSL work in progress. [36]
  - A community agent skill describing a TSL cube-sphere quadtree. [37]

  All are unaudited references. **None is a maintained, production-grade planet-LOD library for WebGPURenderer.**

**Honest gap:** three.js ships no CDLOD/quadtree planet system, no terrain streaming and no floating-origin utility. We build these ourselves.

**Why the gap is manageable for this game (our analysis, not a sourced claim)**
- **Float precision.** 160k hex sectors on a sphere is a small world. At about 5–20 m per sector, the surface is about 3–60 km², which gives a radius of roughly 0.5–2.2 km. float32 spacing at 2–4 km from the origin is about 0.24 mm, so world-space float32 is adequate. Camera-relative rendering (re-centre a root group near the player) is cheap insurance; `highPrecision` is a fallback for non-instanced meshes. [12]
- **Terrain mesh.** A fixed set of icosphere or cube-sphere chunks, a few hundred at most, each with 3–4 discrete LODs plus geomorphing in TSL. Submit them through `BatchedMesh` or merged chunk meshes to stay under the per-object CPU cost in §2.1. [2][21]
- **Dust state.** Keep the authoritative per-sector dust (about 160k floats, around 640 KB) as server truth. Mirror it on the client into a data texture (works on both backends; partial updates via `webgpu_textures_partialupdate`). Add a higher-resolution visual mask updated by compute on WebGPU, with a fragment ping-pong path on WebGL2. Do not make netcode depend on GPU readback. [8]

---

## 5. React Three Fiber (R3F)

| Item | Status | Source |
|---|---|---|
| Stable | **v9.8.2** (2026-10-15). v9.8.0 (2026-09-22) added React 19.3 compatibility. | [24] |
| Next | **v10.0.0-alpha.6** (2026-10-17, prerelease). *"The default import renders with WebGPU"*. Use `@react-three/fiber/legacy` for GLSL or WebGL-only libraries. Requires React ≥19.0 <19.4. v10 alphas describe a move *"toward first class WebGPU and TSL support"*. | [24] |
| Post-processing ecosystem | The `pmndrs/postprocessing` README shows only a `WebGLRenderer` setup and does not mention WebGPU. This implies the classic R3F post stack (`@react-three/postprocessing`, which builds on it) does not serve a WebGPURenderer game. | [25] |
| drei, @react-three/rapier | Exist in the pmndrs ecosystem. Their WebGPU status was **not individually verified** in this pass. | — |

**Pros:**
- Declarative scene composition.
- Components map nicely to agent-owned modules.
- A large pmndrs ecosystem.
- v10 is aligning with TSL. [24]

**Cons (our assessment, partly sourced):**
1. The WebGPU-first R3F (v10) is **alpha**, and its breaking changes are still landing. [24]
2. WebGL-only libraries are split off into a `legacy` entry, which fragments the ecosystem for a WebGPU game. [24][25]
3. An authoritative-server game loop (snapshots, interpolation, prediction at fixed ticks) wants imperative, allocation-free per-frame updates. The React reconciler adds a second state model, and agents must remember to mutate in the frame loop rather than through React state. This is an engineering judgement, not a benchmark.
4. Agents must master two fast-moving APIs (R3F v9 vs v10, and three r18x) instead of one.

**Recommendation: do not use R3F for the game runtime.** Use vanilla three.js with a thin in-house scene and entity layer that has explicit module boundaries (renderer core, terrain, dust, post, VFX, animation, UI-in-DOM). If React is wanted for menus or HUD, keep it in the DOM, separate from the render loop. Revisit R3F only after v10 is stable.

---

## 6. Ecosystem helpers

| Library | Status for a WebGPURenderer game | Source |
|---|---|---|
| Rapier (physics) | Renderer-agnostic. Official three.js examples: `physics_rapier_basic`, `_instancing`, `_joints`, `_character_controller`, `_vehicle_controller`, `_terrain`. Jolt has `physics_jolt_instancing`. | [8] |
| three-mesh-bvh | BVH for raycasting and shapecasts. The README links a WebGPU API doc and "WebGPU Compute Shaders" examples (path tracing, SDF generation). It has "Sphere physics collision" and "Player movement" game examples, useful for brush and vehicle-to-terrain queries. | [29] |
| pmndrs/postprocessing | WebGL-only per its README. **Not usable**; use the built-in `RenderPipeline` nodes instead. | [10][25] |
| stats-gl | The README claims WebGPU support and GPU/compute timing (`trackGPU`, `trackCPT`), but still references `renderAsync`, which three.js deprecated in r181. A forum thread is titled "WebGPU r181: [FYI] stats-gl no longer compatible with WebGPU". **Prefer the official Inspector**, and verify stats-gl before using it. | [5][27][28] |
| Official Inspector | Built-in performance and debug UI for WebGPURenderer (see §3). | [2][3][4] |
| WebGPU Inspector (browser extension) | Third-party GPU debugger listing exists for Firefox (seen in search results only). | [38] |
| Theatre.js | Last push 2024-08-14 (Apache-2.0, 12,975 stars). **Effectively dormant; do not depend on it.** | [30] |
| three-geospatial | Atmosphere and clouds for the Earth view (Beta), WebGPU migration under way. | [26] |

---

## 7. Shipped browser games and demos on three.js

- **Messenger (abeto, 2025).** A free browser game on a **tiny round planet**, the closest analogue to our moon. 80 Level (2025-09-26) describes it as *"made with WebGL and Three.js"*. [32] Secondary coverage says other characters are real players who interact through emotes; this was seen via search only and not verified. [33] It shows that walk-on-a-small-sphere gameplay and presence-style multiplayer ship on three.js.
- **Bruno Simon's 2025 portfolio (physics/driving game).** The Awwwards case study (2026-03-11) says that *"thanks to TSL… the experience automatically runs on WebGPU when available"*. It also describes heavy instancing, ETC1S/UASTC textures, Draco-compressed models and an automatic lower-quality preset on mobile. [31] This is a widely publicised production use of exactly the WebGPURenderer + TSL + automatic-fallback approach proposed here.
- **Official game reference:** `games_fps` (capsule and octree collision) and the Rapier character and vehicle controller examples. [8]
- **Honest gap:** I could not verify, in this pass, a *photorealistic, commercial-scale* game shipped on WebGPURenderer. The strongest realism evidence is the official example suite (SSGI, SSR, VXGI, GTAO, IES lights). [8]

---

## 8. AI-agent familiarity

- **Corpus size.** three.js is the most-used web 3D library by a wide margin (118k stars, about 37k forks, about 35.6M npm downloads per week). Agents have seen a great deal of three.js code. [6][7]
- **Official steering for LLMs.** The repo and docs ship `llms.txt` files. [16][17] They:
  - tell models to use import maps instead of the old global-script CDN pattern;
  - say when to choose WebGPURenderer (TSL, compute, node materials);
  - say to use TSL instead of GLSL on WebGPURenderer, and list the `*NodeMaterial` classes. [17]

  A full `llms-full.txt` includes the TSL documentation. [16]
- **Risk: outdated code.** Most public code targets `WebGLRenderer` with `ShaderMaterial`, `onBeforeCompile` and `EffectComposer`, none of which work with WebGPURenderer. [9] Recent renames are easy to get wrong: `PostProcessing` → `RenderPipeline` (r183), `renderAsync` deprecated (r181), `PCFSoftShadowMap` removed (r186), `RGBELoader` → `HDRLoader` (r180), `Clock` → `Timer` (r183), plus the TSL renames in r185. [5] Even popular helpers lag behind; the stats-gl README still references `renderAsync`. [27]
- **Mitigations (process, not code):**
  1. **Pin `three@0.187.x`** and have every agent read a vendored copy of `llms-full.txt` and the Migration Guide entries for r180–r187. [5][16]
  2. **Lint ban-list:** `WebGLRenderer`, `ShaderMaterial`, `RawShaderMaterial`, `onBeforeCompile`, `EffectComposer`, `three/examples/jsm/postprocessing/*`, `PCFSoftShadowMap`, `renderAsync`, `RGBELoader`, `Clock`, `PostProcessing`.
  3. **Golden reference modules.** One reviewed exemplar per subsystem, each mirroring an official example (for instance `webgpu_postprocessing_traa` and `webgpu_compute_texture_pingpong`). [8]
  4. **CI runs every scene twice:** WebGPU and `forceWebGL: true`. [11]
  5. **Upgrade ritual:** one agent owns three.js upgrades and reads the Migration Guide diff. Others never bump versions.

  Community "three.js skills" for agents exist, but they are unaudited and one targets r185. [37] An internal skill document is preferable.

---

## 9. Self-scored table (1–5)

| Criterion | Score | Justification | Cites |
|---|---|---|---|
| Visual quality ceiling | **4** | Every visual-bar item has an official, maintained node or effect with an example (CSM, AgX/ACES, GTAO/SSAO, bloom, TRAA/SMAA, SSR/SSGI, compute particles, IES lights, displacement/parallax). Not 5: these are building blocks we assemble, the renderer is labelled experimental, and SunLight is limited to 2 cascades. | [3][8][9][13][14][15][18] |
| Performance / frame-time control | **3** | Rich levers: render bundles, BatchedMesh, instancing, occlusion queries, parallel `compileAsync`, resolution scale, TAAU/FSR1, experimental meshlet pipelines. But the per-object CPU overhead is open and high priority (#30560), with about 2× CPU vs WebGLRenderer in a r183 benchmark, and material init and first frame are slow. | [2][4][5][8][20][21][22] |
| WebGPU maturity + WebGL2 fallback | **3** | One TSL code path with automatic WebGL2 fallback is a genuine advantage. However: officially "experimental"; atomics and indirect draws are WebGPU-only; 25 open WebGPURenderer-labelled issues. | [9][11][19][22] |
| Terrain / compute suitability | **4** | Compute, storage textures (2D/3D), ping-pong, readback, atomics and indirect dispatch all have examples. No built-in planet LOD (DIY, but the world is small). Open same-frame storage-texture issue. | [3][4][8][12][22] |
| Animation & particles | **4** | Mature mixer with blending and additive examples; WebGPU skinning, instancing and retargeting; compute and soft particles. No visual state-machine tooling. | [3][4][8] |
| Tooling / debugging | **3** | Official Inspector (CPU/GPU graphs, timeline, overdraw, node viewer, color grading); WGSL diagnostics surfaced. No editor. GPU timing may be missing on WebGL2. Silent node-build fallback (#34720). | [2][3][4][22] |
| Ecosystem / docs / community & agent familiarity | **4** | Largest community; official `llms.txt` with TSL guidance; physics examples. Minus: the TSL-era corpus is small next to legacy WebGL code, and key ecosystem libraries (pmndrs/postprocessing) are WebGL-only. | [6][7][16][17][25] |
| Solo-dev simplicity | **3** | Small, readable API with no editor lock-in. But it is a renderer, not an engine: scene management, asset pipeline, physics glue, presets and terrain are ours to build, and there are breaking changes every release. | [5][9] |
| Modularity for parallel agent workstreams | **4** | ES-module addons. TSL kernels and materials are plain JS modules. `RenderPipeline` composes passes as nodes. Boundaries are ours to define, since no structure is imposed. | [10][16][17] |
| Stability / licence / longevity | **4** | MIT; active since 2010 (last push 2026-11-11); predictable deprecation window of about 10 releases. Minus: no semver, and APIs and looks change between releases. | [1][2][5][6] |
| **Total** | **36 / 50** | | |

---

## 10. Weaknesses, risks and mitigations

| # | Weakness / risk | Evidence | Mitigation |
|---|---|---|---|
| 1 | **The WebGPURenderer path has a higher CPU cost per object than WebGLRenderer.** The issue has been open since Feb 2025 and is labelled high priority. | [20][21] | Architect for few draw calls from day 1: BatchedMesh or merged terrain chunks, InstancedMesh for props, robots and dust, render bundles for static sets. Set a **draw-call budget**, for example ≤1–2k submitted objects; this is our target, not a sourced figure. Run a 1-week performance spike on target integrated-GPU hardware before committing. [2][8] |
| 2 | **The WebGL2 fallback is not at feature parity.** No atomics or indirect draws; storage-texture support is unverified; GPU timing may be missing. Linux (non-Intel-Gen12, non-NVIDIA-Wayland), Firefox Linux and many Android devices will land on it. | [4][19][23] | Design every compute feature with a fragment/RTT twin (dust mask ping-pong, particles via instancing). Per-backend presets ("WebGL2-Low/Med"). CI under `forceWebGL`. Use CPU-side frame-time-driven dynamic resolution when timestamps are missing. [11] |
| 3 | **"Experimental" label plus API churn every 1–2 months.** Agents also tend to write pre-TSL or WebGL-only code. | [5][9] | Pin the version; quarterly upgrade owned by one agent; ban-list lint; vendored `llms-full.txt`; golden reference modules (§8). [16][17] |
| 4 | **Shader / pipeline compile stutter.** Shadow pipelines are not precompiled; material init is slow. | [22] | Loading-screen warm-up: `compileAsync()` plus one hidden warm-up frame with all lights and shadows enabled. Minimise material permutations, using TSL uniforms instead of variants. [2][12] |
| 5 | **Same-frame storage-texture visibility bug (#33795)** affects the "update the dust mask every frame" design. | [22] | Accept one frame of latency (invisible at 60 FPS), or route through a render-target path. Spike it early. |
| 6 | **Renderer, not engine.** No editor, terrain LOD, physics or netcode. Some ecosystem libraries are dormant (Theatre.js) or WebGL-only (pmndrs/postprocessing). | [25][30] | Scope the in-house "engine layer" explicitly. Use Rapier (official examples) and three-mesh-bvh. Netcode is engine-independent anyway. [8][29] |
| 7 | **SunLight is limited to 2 cascades** at 1024² by default. CSMShadowNode is WebGPURenderer-only (both backends of it should work since it is node-based, but this is **untested here**). | [13][14][15] | Use CSMShadowNode with 3–4 cascades on High/Ultra and SunLight on Low. Validate under `forceWebGL`. |
| 8 | **Look drift across releases** (PMREM, energy conservation, GTAO). | [5] | Golden-image screenshot tests per preset, re-baselined on each upgrade. |

**Bottom line for the decider:** three.js offers the deepest set of maintained, example-backed building blocks for this visual bar and the largest agent-familiar ecosystem. It also has the cleanest single-code-path story (TSL compiling to WGSL or GLSL). The price is engine-assembly work and a WebGPU path whose CPU efficiency and maturity still trail the legacy WebGLRenderer. Both are manageable if the architecture is draw-call-lean and the team runs an early performance spike on integrated GPUs under both backends.

---

## Sources

1. three.js — GitHub Releases (REST listing r176–r187) — https://api.github.com/repos/mrdoob/three.js/releases (human page: https://github.com/mrdoob/three.js/releases) — accessed 2026-11-11
2. three.js r187 release notes — https://github.com/mrdoob/three.js/releases/tag/r187 — accessed 2026-11-11
3. three.js r186 release notes — https://github.com/mrdoob/three.js/releases/tag/r186 — accessed 2026-11-11
4. three.js r185 release notes — https://github.com/mrdoob/three.js/releases/tag/r185 — accessed 2026-11-11
5. three.js Wiki — Migration Guide — https://github.com/mrdoob/three.js/wiki/Migration-Guide — accessed 2026-11-11
6. GitHub REST API — mrdoob/three.js repository metadata — https://api.github.com/repos/mrdoob/three.js — accessed 2026-11-11
7. npm downloads API — `three`, last week — https://api.npmjs.org/downloads/point/last-week/three — accessed 2026-11-11
8. three.js official examples index (examples/files.json, master = r187); live gallery https://threejs.org/examples/ — https://raw.githubusercontent.com/mrdoob/three.js/master/examples/files.json — accessed 2026-11-11
9. three.js Manual — WebGPURenderer (source file; linked from the docs llms.txt as https://threejs.org/manual/#webgpurenderer) — https://raw.githubusercontent.com/mrdoob/three.js/master/manual/pages/webgpurenderer.html — accessed 2026-11-11
10. three.js Manual — Post-processing with WebGPURenderer (source file) — https://raw.githubusercontent.com/mrdoob/three.js/master/manual/pages/webgpu-postprocessing.html — accessed 2026-11-11
11. three.js Docs — WebGPURenderer — https://threejs.org/docs/pages/WebGPURenderer.html — accessed 2026-11-11
12. three.js Docs — Renderer — https://threejs.org/docs/pages/Renderer.html — accessed 2026-11-11
13. three.js Docs — SunLight — https://threejs.org/docs/pages/SunLight.html — accessed 2026-11-11
14. three.js Docs — SunLightShadow — https://threejs.org/docs/pages/SunLightShadow.html — accessed 2026-11-11
15. three.js Docs — CSMShadowNode — https://threejs.org/docs/pages/CSMShadowNode.html — accessed 2026-11-11
16. three.js repository llms.txt — https://raw.githubusercontent.com/mrdoob/three.js/master/llms.txt — accessed 2026-11-11
17. three.js Docs llms.txt (Instructions for Large Language Models) — https://threejs.org/docs/llms.txt — accessed 2026-11-11
18. three.js example source — webgpu_tonemapping.html — https://raw.githubusercontent.com/mrdoob/three.js/master/examples/webgpu_tonemapping.html — accessed 2026-11-11
19. three.js Forum — "TSL and webgl2 vs webgpu" (Mugen87 reply, 2025-11-07) — https://discourse.threejs.org/t/tsl-and-webgl2-vs-webgpu/87974 — accessed 2026-11-11
20. three.js Forum — "WebGPURenderer 2x slower CPU and 5-10x slower first frame than WebGLRenderer on many-mesh scenes (r183, same on both backends)" — https://discourse.threejs.org/t/webgpurenderer-2x-slower-cpu-and-5-10x-slower-first-frame-than-webglrenderer-on-many-mesh-scenes-r183-same-on-both-backends/91904 — accessed 2026-11-11
21. three.js GitHub issue #30560 — "WebGPURenderer: Current UBO system has severe performance issues with many render items." — https://github.com/mrdoob/three.js/issues/30560 — accessed 2026-11-11
22. three.js GitHub — open issues labelled WebGPURenderer (retrieved via https://api.github.com/search/issues?q=repo:mrdoob/three.js+is:issue+is:open+label:WebGPURenderer) — https://github.com/mrdoob/three.js/issues?q=is%3Aissue%20is%3Aopen%20label%3AWebGPURenderer — accessed 2026-11-11
23. gpuweb wiki — Implementation Status (page edited 2026-10-02) — https://github.com/gpuweb/gpuweb/wiki/Implementation-Status — accessed 2026-11-11
24. pmndrs/react-three-fiber — GitHub Releases (API listing) — https://github.com/pmndrs/react-three-fiber/releases (https://api.github.com/repos/pmndrs/react-three-fiber/releases) — accessed 2026-11-11
25. pmndrs/postprocessing — README — https://github.com/pmndrs/postprocessing — accessed 2026-11-11
26. takram-design-engineering/three-geospatial — README — https://github.com/takram-design-engineering/three-geospatial — accessed 2026-11-11
27. stats-gl 4.2.3 — README — https://cdn.jsdelivr.net/npm/stats-gl@4.2.3/README.md — accessed 2026-11-11
28. three.js Forum — "WebGPU r181: [FYI] stats-gl no longer compatible with WebGPU" (title and search summary only; thread not read in full) — https://discourse.threejs.org/t/webgpu-r181-fyi-stats-gl-no-longer-compatible-with-webgpu/87944 — accessed 2026-11-11
29. gkjohnson/three-mesh-bvh — README — https://github.com/gkjohnson/three-mesh-bvh — accessed 2026-11-11
30. GitHub REST API — theatre-js/theatre repository metadata — https://api.github.com/repos/theatre-js/theatre — accessed 2026-11-11
31. Awwwards — "Bruno's Portfolio" case study (published 2026-03-11) — https://www.awwwards.com/brunos-portfolio-case-study.html — accessed 2026-11-11
32. 80 Level — "Deliver Mail on Tiny Colorful Planet in This Relaxing Web Game" (2025-09-26) — https://80.lv/articles/deliver-mail-on-tiny-colorful-planet-in-this-relaxing-web-game — accessed 2026-11-11
33. Korben — "Abeto's Messenger – Mail carrier on a mini-planet" (seen via search summary only; not opened) — https://korben.info/en/abeto-messenger-mail-carrier-mini-planet.html — accessed 2026-11-11
34. merpnderp/webglquadtreeplanet (search listing only; not audited) — https://github.com/merpnderp/webglquadtreeplanet — accessed 2026-11-11
35. PlanetTech DOC.md (InterstellarJS; search listing only; not audited) — https://unpkg.com/planettech@0.0.8-alpha.0.1.6/DOC.md — accessed 2026-11-11
36. three.js Forum — "Lagrange – Procedural Planet Builder (Vue.js + three.js, TSL in-progress!)" (title only) — https://discourse.threejs.org/t/lagrange-procedural-planet-builder-vue-js-three-js-tsl-in-progress/83453 — accessed 2026-11-11
37. Community agent skill "threejs-procedural-planets" (search summary only; unaudited, targets r185) — https://raw.githubusercontent.com/linegel/threejs-complete-set-of-skill/main/threejs-procedural-planets/SKILL.md — accessed 2026-11-11
38. Mozilla Add-ons — WebGPU Inspector (listing seen in search results only) — https://addons.mozilla.org/hu/firefox/addon/webgpu-inspector — accessed 2026-11-11
