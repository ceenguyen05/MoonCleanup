# The Case for Babylon.js (WebGPU with WebGL2 Fallback) as the Moon-Sweeper Rendering Engine

**Date:** 2026-11-11 · **Author:** advocate subagent P2b · **Type:** planning research, advocacy with weaknesses disclosed · **Scope:** rendering-engine choice only (netcode is out of scope)

> How to read this: every factual claim has a bracketed number that points to the numbered **Sources** list at the end. Each source gives its title, URL and access date (2026-11-11). Text marked *Recommendation* or *Inference* is my engineering judgement, not a documented fact. Where I could not verify something, I say so.

---

## Executive summary

1. **Current stable is Babylon.js 9.35.0.** GitHub marked it "Latest" on 6 Nov 2026, and npm's `latest` is also 9.35.0. Major 9.0 shipped on 26 Mar 2026. The 10.0 milestone is due 25 Mar 2027. The license is Apache-2.0, the project is Microsoft-backed, and it has a written "golden rule" against breaking backward compatibility. [1][2][3][4][7][8]
2. **One codebase runs on both backends.** `EngineFactory` "first tries to create a WebGPU engine if supported, then a WebGL engine, and finally a null engine". The docs call the WebGPU implementation "complete", with only a few exceptions. Core shaders have been native WGSL since 2024, and Node Materials work on both backends. [15][16][17]
3. **Almost every item on our visual list is built in.** That covers PBR + IBL, `CascadedShadowGenerator` with PCF/PCSS filtering, an HDR pipeline with ACES or Khronos PBR Neutral tone mapping, bloom/FXAA/sharpen/grain/chromatic aberration, SSAO2, SSR, TAA, motion blur, GPU particles, volumetric lighting (9.0), clustered lighting (9.0), parallax mapping and decals. [4][29][30][31][34][35][36][37][38][41][52][53]
4. **Gaps exist, and I state them plainly:**
   - AgX is not a built-in tone mapper, so it needs a custom pass.
   - I found no built-in SMAA.
   - Compute shaders are WGSL-only and WebGPU-only, so the WebGL2 path needs fragment-shader fallbacks.
   - CSM does not cull the shadow-caster list.
   [24][25][26][30][31]
5. **Frame Graph is v1 as of 9.0.** It models the frame as a DAG of tasks, comes with a visual Node Render Graph Editor, and is reported to save "40% or more" GPU memory in some cases. It ships CSM, ComputeShader, SSAO2, SSR, TAA, Bloom, Tonemap, FXAA and VolumetricLighting blocks. That gives AI agents clean module boundaries. [4][22][24][25]
6. **There are real frame-time levers:**
   - WebGPU snapshot rendering (STANDARD and FAST modes) and non-compatibility "bundle" mode
   - thin instances, LOD, SceneOptimizer and reverse depth
   The caveat is that snapshot gains are JavaScript-side only, and dynamic objects need manual handling. [17][27][28][39][40][50]
7. **Animation and particles are strong:**
   - animation groups, blending, weights and additive layers
   - animation retargeting, with a no-code tool (9.0)
   - GPU particles (the docs' example uses 1,000,000 particles)
   - the Node Particle Editor, flow maps and attractors (9.0)
   [4][41][45][46][47]
8. **Physics comes with the engine.** The Havok plugin is MIT-licensed, with a 2.09 MB WASM file. It includes `PhysicsCharacterController`, and in large-world mode Havok splits the world into multiple regions, each with its own gravity. Rapier is available only through community plugins. [54][55][56][57][58][59]
9. **Scale is covered.** `useLargeWorldRendering` (floating origin, 9.0) automatically handles PBR, Node Materials, CSM and particles. The Geospatial Camera targets spherical worlds. There is no official planetary terrain LOD system, so we build our own chunked sphere. [5][59]
10. **Tooling and agent support:**
    - Inspector v2, a multi-file Playground with npm imports, and the NME/NPE/NRGE/GUI editors
    - official MCP servers for those editors (June 2026)
    - a generated `llms.txt` plus per-page Markdown for 818 doc pages, merged 5 Nov 2026
    [5][64][65]
11. **The top weaknesses are:**
    - **First-load weight.** Babylon's own team measured 675 KB gzipped JS for a PBR glTF scene.
    - **Smaller ecosystem.** Babylon gets about 1% of Three.js's npm downloads, so agents have less training data and are more likely to mix old and new APIs.
    - **Split team attention.** The team is also building a WebGPU-only sibling, Babylon Lite.
    [10][11][12][13]
12. **My self-score is 43/50 (average 4.3).** It is highest on visual coverage, WebGPU/WebGL2 parity, tooling and animation, and lowest on ecosystem and agent familiarity (3/5).

---

## 1. Version, cadence, compatibility policy, license, governance, adoption

| Item | Verified fact | Source |
|---|---|---|
| Current stable | **9.35.0**, tagged "Latest" on GitHub on 06 Nov (2026). The npm registry `latest` manifest for `@babylonjs/core` is 9.35.0. | [1][2] |
| Recent releases | 9.31.2 (20 Oct), 9.31.3 (21 Oct), 9.32.0 (22 Oct), 9.32.1 (27 Oct), 9.33.0 (29 Oct), 9.33.1 (30 Oct), 9.33.2 (2 Nov), 9.33.3 (5 Nov), 9.34.0 (5 Nov), 9.35.0 (6 Nov). That is 10 releases in about 2.5 weeks. | [1] |
| Major cadence | 9.0 was released on 26 Mar 2026. The GitHub "10.0" milestone is due 25 Mar 2027 and is 94% complete (last updated 3 Nov 2026). | [3][4][7] |
| Backward-compatibility policy | Golden rule 1 in contributing.md: "You cannot add code that will break backward compatibility". It adds: "even if something could be simpler to do by breaking the backward compatibility, we will not do it" (exceptions "if there is a problem with performance or if this is related to a bug"), and "You can always add to an API, you cannot ever remove anything from one." | [8] |
| BC going forward | Babylon team member RaananW (July 2026): Babylon.js 10 "will continue following the guidelines of the main babylon.js repo". | [14] |
| License | Apache-2.0 (npm manifest and GitHub). | [2][9] |
| Governance | The GitHub org is `BabylonJS`. Major releases are announced on Microsoft's Windows Developer Blog (Microsoft-backed). | [4][9] |
| GitHub | 26.3k stars, 3.7k forks. | [9] |
| npm weekly downloads (4–10 Nov 2026) | `@babylonjs/core`: **366,164**. Legacy UMD `babylonjs`: **36,496**. For scale, `three` had **35,595,518** in the same week. | [10][11][12] |
| Sibling engine | **Babylon Lite**, announced 17 Jun 2026: "WebGPU-exclusive", not backward compatible. The announcement says: "this is not a replacement, and Babylon.js is not going anywhere … we are fully committed to both." | [13][14] |

**What this means for us:**

- *Inference:* The release pace is very fast, with weekly minors and patches. That brings fixes quickly, but also a real chance of a regression in any given build.
- *Recommendation:* Pin an exact version and upgrade on purpose, once per milestone.
- The backward-compatibility rule is unusually strong for a JavaScript engine [8]. That is a real advantage for a solo developer whose code is partly written by agents: older, still-valid API idioms keep working.
- Babylon Lite is not a candidate for this project. It has no WebGL fallback [13], and we need WebGL2 for the integrated-GPU and older-browser tier. It is still worth tracking as a possible future path (see §10).

---

## 2. WebGPU maturity, WebGL2 fallback, shaders, node materials, Frame Graph, compute

### 2.1 Maturity and the single codebase

**WebGPU history and status:**

- WebGPU support has existed "Since the Babylon.js 5.0 release in May 2022 … backward compatible with the WebGL implementation of the engine" [15].
- "Support for WebGL and WebGPU is maintained side by side for the foreseeable future" [15].
- The status page says: "The implementation in WebGPU is complete and, besides a few exceptions, all features are available both in WebGPU and WebGL" [16].
- The documented exceptions don't matter to us: point-cloud point size other than 1, triangle-fan and line-loop draw modes, and the experimental WebGPU-XR features [16].

**Fallback with one codebase:**

- `EngineFactory.CreateAsync(canvas, options)` "first tries to create a WebGPU engine if supported, then a WebGL engine, and finally a null engine" [17].
- Its typed signature takes a union of WebGPU, WebGL and Null engine options and returns an `AbstractEngine` [18].
- The docs say the code for the two backends differs only in initialization: WebGPU initialization is asynchronous [15][17].

**WebGL-to-WebGPU differences we must design for [17]:**

- Pixel and texture read-backs (`readPixels` and similar) are asynchronous even on WebGL.
- Texture-array indexes in shaders must be immediate values.
- Depth precision differs. `engine.useReverseDepthBuffer = true` is recommended for large camera ranges, which suits a horizon-plus-Earth sky.

**Browser reach:** The Babylon team's own Lite announcement lists WebGPU browsers as "Chrome and Edge 113+, and recent Firefox and Safari" [13]. Everyone else, and any preset we choose to pin to WebGL2, uses the WebGL engine.

### 2.2 Shader languages (WGSL vs GLSL)

- **Core shaders are native WGSL:**
  - "In 2024, we also rewrote all core engine shaders in native WGSL to avoid the use of TintWASM in full WGSL applications" [15].
  - "most of the main shaders used by Babylon.js are written in WGSL", and Babylon "actively maintain[s] compatibility with GLSL" [19].
- **Custom GLSL on WebGPU is converted at runtime.** Babylon detects GLSL and compiles it to WGSL. This "takes some time and downloads a WASM library to do the conversion" [19]. The docs recommend writing WGSL directly for "faster startup time and smaller download sizes" [19].
- **WGSL in `ShaderMaterial`:** set `shaderLanguage` to WGSL [19].
- **Material plugins still use GLSL.** `CustomMaterial` and `PBRCustomMaterial` injections must still be GLSL [19].
- *Recommendation:* For custom effects:
  - Prefer Node Materials, which work on both backends (§2.3).
  - Where raw shaders are unavoidable, keep a WGSL file and a GLSL file per effect under one module, with shared constants.

### 2.3 Node Material Editor (NME) and other node editors

- "Node Material also supports WebGPU and can be selected in the editor" [15]. Node materials are documented at [20].
- Babylon 9.0 added a **Node Particle Editor** [4] and a **Node Render Graph Editor** (NRGE) for frame graphs [4][21].
- Each editor now has an **MCP session** that lets an AI agent read and modify the graph [64].
- **Why this matters for our team:** the regolith/dust material can be a versioned graph asset (JSON) that one agent owns, separate from gameplay code.

### 2.4 Frame Graph / Node Render Graph (v1 in 9.0)

**What it is:** The frame is a DAG of rendering tasks, from culling to post-processing, with managed texture allocation and reuse. It was promoted from alpha (8.0) to v1 (9.0) and reports GPU memory savings of "40% or more in some cases" [4]. You can build it visually (NRGE) or in code [4][21].

**Blocks and tasks that exist in source today:**

- **Post-process blocks** [24]: Bloom, SSAO2, SSR, TAA, Tonemap, FXAA, Sharpen, Grain, ChromaticAberration, MotionBlur, DepthOfField, ColorCorrection, ImageProcessing, VolumetricLighting, ScreenSpaceCurvature, MeshBlending and more.
- **Matching tasks** [25]: includes `customPostProcessTask`.
- **Rendering and misc blocks** [22]: `CascadedShadowGenerator`, `ShadowGenerator`, `ObjectRenderer`, `GeometryRenderer`, `ComputeShader`, `Cull`, `Execute`, `GUI`, `GlowLayer`, `MinMaxReducer`.

**Caveats from the FAQ [23]:**

- A graph must be set before `buildAsync()`.
- There must be exactly one main object renderer.
- `record()` may re-run on resize.
- Mirror, refraction and probe textures need registering.
- Rendering a post-process to the back-buffer colour texture fails on WebGPU.

**Why this matters for parallel agents:** Each pass is a task with explicit inputs and outputs. "Dust-mask update", "terrain G-buffer", "shadow cascades" and "post chain" can each be owned by a different agent and wired together in one graph file.

### 2.5 Compute shaders, storage textures and storage buffers

- **Compute is WebGPU-only and WGSL-only.** `ComputeShader` must be written in WGSL and is "a WebGPU-only feature (starting at v5.0)". Check for it with `engine.getCaps().supportComputeShaders` [26].
- **Storage textures:**
  - Create them with `TEXTURE_CREATIONFLAG_STORAGE` or the helpers `RawTexture.CreateRGBAStorageTexture()` and `RawTexture.CreateRStorageTexture()`.
  - Babylon's docs say "you can't read from a storage texture, only write to it". To read the result back, bind it as a regular sampled texture [26].
- **Storage buffers:** `StorageBuffer` holds read/write data, and `StorageBuffer.read` reads results back [26].
- **Dispatch:** use `dispatch()` or `dispatchWhenReady()` [26].
- **Official samples [26]:** boids, image blur, hydraulic erosion, a slime simulation that uses a storage buffer because read/write textures are unsupported, and an FFT ocean that runs "roughly 200 to 250 compute shaders per frame".
- **Volumetric lighting (9.0)** "Uses WebGPU compute shaders, with WebGL 2 fallbacks" [4]. That is the same dual-path pattern we need for dust masks.

### 2.6 What this means for our dust layer (design note, no code)

- **WebGPU tier:** A per-frame `ComputeShader` dispatch writes the new dust mask into a storage texture. The previous mask is read as an ordinary sampled texture, ping-pong style, because storage textures are write-only per [26]. It can live as a `ComputeShader` block or task in the Frame Graph [22].
- **WebGL2 tier:** There is no compute [26]. The same update runs as a fragment-shader render-to-texture pass, for example a custom post-process task [25] or a `ShaderMaterial` render target [19].
- *Recommendation:*
  - Build the fragment path first. It runs on **both** backends, so there is one implementation to get correct.
  - Add the compute path later as a WebGPU optimization behind a capability check.
  - Footprints and tracks can be "stamps" into the same mask. Persistent tracks can also use decals [53].

---

## 3. Feature evidence for our visual bar

In the Evidence column, "(URL verified)" means I confirmed the doc page exists in the official sitemap [66] but did not re-read its body in this session. Claims about those pages are kept to the feature's existence.

| Visual-bar item | Babylon.js status | Evidence | Notes for our game |
|---|---|---|---|
| PBR materials | `PBRMaterial` (metal/rough, spec/gloss). OpenPBR material in **alpha** (9.0) | [29] (URL verified); [6] | Use `PBRMaterial` for production. OpenPBR is not production-ready [6]. |
| IBL + environment shadows | IBL via environment textures. **Dynamic IBL shadows** (9.0) | [29]; [6] | The moon has low ambient light, so IBL matters mostly for Earth-lit and night scenes. |
| Sun shadows | `CascadedShadowGenerator`: directional lights, 2–4 cascades (default 4), filters **PCF** and **PCSS (contact hardening)**, `stabilizeCascades`, `lambda`, `autoCalcDepthBounds` (min/max reduction), `cascadeBlendPercentage`, `depthClamp`. Requires WebGL 2+. | [30]; Playground https://playground.babylonjs.com/#KY0N7T#68 | Fits "hard but filtered" shadows: PCF for the sharp lunar look, PCSS for contact hardening. Caveats: `depthClamp` is ignored with PCSS; no caster culling (§10). |
| HDR + tone mapping | `ImageProcessingConfiguration` tone mappers: `TONEMAPPING_STANDARD`, `TONEMAPPING_ACES`, `TONEMAPPING_KHR_PBR_NEUTRAL`. Also exposure, contrast, vignette, dithering, colour curves and 3D-LUT colour grading. Separate `TonemapPostProcess` operators: Hable, Reinhard, HejiDawson, Photographic. **No AgX in source.** | [31][32]; AgX request answered as "not planned" (Dec 2023) [33] | ACES and Khronos Neutral are built in. AgX needs a custom HDR post-process with built-in tone mapping disabled. That is a small, well-scoped task for one agent. |
| Bloom, FXAA, MSAA, sharpen, chromatic aberration, grain, DoF | `DefaultRenderingPipeline` with an HDR flag ("should be `true` whenever possible"), `samples` for MSAA, `fxaaEnabled`, bloom (threshold/weight/kernel/scale), sharpen, chromatic aberration, grain, depth of field, glow layer, image processing | [34]; Playground https://playground.babylonjs.com/#Y3C0HQ#146 | Gives "subtle bloom" plus film grain for the integrated-GPU preset. |
| Ambient occlusion | SSAO2 rendering pipeline. Also a Frame Graph `ssao2` block and task | [35] (URL verified); [24][25] | Medium/high presets. |
| Screen-space reflections | SSR rendering pipeline plus Frame Graph block | [36] (URL verified); [24] | Optional (visors, vehicle paint). |
| TAA | `TAARenderingPipeline`: `samples`, `factor`, `disableOnCameraMove` (default true), `reprojectHistory` (per-pixel velocity), `clampHistory`. Needs MRT; ghosting on disocclusion | [37]; Playground https://playground.babylonjs.com/#539X0P#52 | Crisp AA on desktop presets. Fall back to MSAA + FXAA on integrated GPUs. |
| SMAA | **Not found.** There is no SMAA block or task in the Frame Graph post-process source listings, which include FXAA and TAA | [24][25] | Gap. Use FXAA/MSAA/TAA, or write a custom SMAA pass. |
| Motion blur | Motion-blur post-process plus Frame Graph block | [38] (URL verified); [24] | Optional, mainly for vehicles. |
| Volumetric light shafts | Volumetric lighting (9.0): directional lights, WebGPU compute with WebGL2 fallback | [4] | Can sell kicked-up dust haze in sunlight. |
| Many dynamic lights | Clustered lighting (9.0), WebGPU and WebGL2, "hundreds or even thousands of lights" | [4] | Helmet lamps and headlights for 16 players plus robots. |
| Regolith detail | Parallax (occlusion) mapping docs. KTX2 compressed textures | [52][42] (URLs verified) | Displacement itself means vertex displacement on LOD'd terrain chunks, which is engine-agnostic. |
| Footprints / tracks | Decals docs. Mask stamping (see §2.6) | [53] (URL verified) | |
| Instancing / LOD | Thin instances. Mesh LOD | [39][40] (URLs verified) | Rocks, debris, conveyor segments. |
| Low-gravity dust particles | `GPUParticleSystem`: "almost like regular particles". WebGL2 transform feedback since v3.2. Example with `capacity: 1000000`. Custom effects since 5.0. Limits: no sub-emitters, no mesh emitters, some gradients unsupported. Flow maps and attractors (9.0, CPU and GPU). Node Particle Editor (9.0) | [41]; Playground https://playground.babylonjs.com/#PU4WYI#4; [4] | Ballistic dust arcs. Low gravity is a gravity parameter, with attractors and flow maps for vehicle wakes. The GPU-particle doc describes only the WebGL2 implementation; I did not verify the WebGPU internals. |
| Asset pipeline | glTF loader extensions in source: `KHR_draco_mesh_compression`, `EXT_meshopt_compression`, `EXT_mesh_gpu_instancing`, `KHR_animation_pointer`, many `KHR_materials_*`. KTX2 docs | [43][44][42] | `KHR_texture_basisu` was not visible in the truncated listing I fetched [43]. The KTX2 doc exists [42]; confirm basisu-in-glTF during the spike. |
| Skeletal animation + blending | `enableBlending` / `blendingSpeed`; weighted animations ("run multiple animations simultaneously on the same target", since 3.2); additive animation; `AnimationPropertiesOverride`. Animation groups. **Retargeting** (9.0) with a no-code tool | [45]; Playground https://playground.babylonjs.com/#IQN716#9 (walk→run blend); [46][47]; [4] | Covers the astronaut locomotion blend tree, tool-use layers and shared rigs. |
| In-engine GUI | GUI (2D/3D) docs. Frame Graph `GUI` block. SDF text (9.0) | [48] (URL verified); [22]; [6] | In-world 3D labels and terminals. The HUD can stay HTML. |
| Inspector & profiling | **Inspector v2** (9.0): rebuilt, extensible. Performance profiler. On Chrome WebGPU, Inspector GPU timing "does not work because timestamp queries are currently disabled" (flags can enable them) | [5]; [49] (URL verified); [16] | Use CPU frame-time plus browser GPU tools as the source of truth. |
| Performance priorities | **Snapshot rendering** (WebGPU, since v5.0): records draw calls once and replays them. **FAST** mode updates only the scene uniform buffer. **Non-compatibility mode** (`engine.compatibilityMode = false`) builds reusable per-mesh draw "bundles". SceneOptimizer | [27]; Playground https://playground.babylonjs.com/?webgpu#SYQW69#1354; [28]; [50][51] (URLs verified) | See §10 for limits. |
| Starfield + Earth, night | Reverse depth buffer for large ranges. Skybox handled by the snapshot helper. Atmosphere addon (9.0) | [17][27][5] | Airless moon: Earth can be a textured sphere. The atmosphere addon is optional, for Earth's limb. |

---

## 4. Physics: Havok, Rapier, character controller

**Havok:**

- **License:** "It is available free to use under the MIT license" [54].
- **Package:** `@babylonjs/havok` 1.3.14, MIT, 4.37 MB unpacked across 11 files (ESM and UMD builds) [55].
- **ESM download:** `HavokPhysics.wasm` is **2.09 MB** and `HavokPhysics_es.js` is **67.4 kB** [56].
- **Requirement:** It "requires WebAssembly SIMD, which is not supported on iOS < 16.4" [54].
- **Setup:** `HavokPlugin` plus `scene.enablePhysics`. The CDN build "should not be used in production" [54].

**Large-world physics:** When floating origin is enabled, Havok bodies are spread over multiple Havok worlds, each with its own fixed origin [59]:

- bodies migrate with a 20% hysteresis margin
- `floatingOriginWorldRadius` defaults to 100000
- each region can have its own gravity through `setGravity` and `getGravity`, which take an optional world position

**Character controller:**

- `PhysicsCharacterController` lives in `@babylonjs/core/Physics/v2/characterController`. It offers `moveWithCollisions` and the per-frame `checkSupport` → `setVelocity` → `integrate` loop, with gravity passed into `integrate`. It handles animated/kinematic platforms and has a trigger-collision observable [57].
- Playground: https://playground.babylonjs.com/#WO0H1U#165 [57].
- **Honest gap:** The doc does not name the backing engine and does not document slopes, steps, or a custom "up" vector [57].
- *Inference:* Gravity is passed in every frame, so radial gravity on a sphere may only need a per-frame gravity vector. Whether slope and support logic respects a non-Y up vector is **unverified** and must be tested in week one.

**Rapier:**

- There is no official Babylon Rapier plugin. A community thread covers using Rapier with Babylon [58].
- Babylon's physics v2 is a plugin interface (`IPhysicsEnginePluginV2`), so a custom plugin is possible [58].
- *Recommendation:* Use Havok, because it is integrated, MIT-licensed and tooling-aware. Only consider Rapier if the netcode design needs deterministic cross-platform simulation, which is a separate analysis.

---

## 5. Terrain at planetary scale and floating origin

**Floating origin exists and is documented (9.0):**

- The engine option **`useLargeWorldRendering`** turns on high-precision matrices and floating origin for every scene [59]. The scene option **`useFloatingOrigin`** applies it to one scene, but then the engine needs **`useHighPrecisionMatrix`**. The doc prose also uses "useHighPrecisionMatrices", so verify the exact spelling [59].
- The active camera stays conceptually at the origin, and "all … offsetting is all performed at the last stage before passing the values to the shader" [59].
- Handled automatically: Standard and PBR materials, Node Materials, shadow generators "including cascaded shadow maps", GPU and CPU particles, sprites, clustered lights, utility layers, and the Atmosphere addon [59].
- Caveat: custom shaders must use the standard uniform names (`world`, `view`, `viewProjection`, `worldViewProjection`) [59].
- Playground: https://playground.babylonjs.com/#5U0N0Q [59].

**Spherical-world helpers (9.0):**

- The **Geospatial Camera** "orbits and navigates a spherical planet centered at the world origin". It supports `flyToAsync`, collisions and altitude-based clip-plane adjustment [5].
- **3D Tiles** support comes through NASA-AMMOS 3DTilesRendererJS's Babylon renderer [5].
- A physically based **Atmosphere** addon [5].

**What is missing:**

- I found **no official planetary or quadtree-sphere terrain LOD system or sample** in this session's research. We would build our own chunked-sphere mesher on top of thin instances, LOD, compute and node materials [26][39][40].
- Community proof that this works: **Cosmos Journeyer**, an open-source browser game built on Babylon.js that lets you "Explore telluric planet and moon surfaces from your spaceship or by foot" (AGPL-3.0, so we can study it but not copy code into a closed project) [60]. It is also listed on Babylon's official games page [61].

**Precision for our moon (inference):** A ~160k-sector moon is small. At a radius of 4 km, float32 spacing is about 0.5 mm (2^12 × 2^-23 m), which is ample. Floating origin is therefore insurance (orbital views, Earth distance), not a requirement. Babylon gives it to us as a single flag rather than a custom system [59].

---

## 6. Shipped games and demos on Babylon.js

**On the official games page [61]:**

- **Minecraft Classic** (Mojang)
- **Temple Run 2** (Imangi Studios, web version on Poki)
- **Shell Shockers** (Fun Fetched)
- **Cosmos Journeyer** (procedural space and planet exploration)
- **Razarion**
- Steam releases: **CottageCore** (Deltakosh), **Tuggowar** (Tension Games), **Path Defenders**, **Terachain**, **Crystalline Bliss**
- about 50 entries in total

**Realism evidence:** This comes mainly from official 9.0 demos, not shipped titles. The demos are volumetric lighting, clustered lighting, textured area lights, dynamic IBL shadows, the physically based atmosphere and Gaussian splats [4][5][6]. All are linked via aka.ms demo links from those posts.

**Honest assessment:** Most shipped Babylon web games are stylized or casual. I found no shipped browser game on Babylon that matches our "realistic, crisp PBR + CSM + TAA" target at scale. Proof of the visual bar has to come from our own vertical-slice spike (§10), not from precedent. That is likely true for the competing engines too, but I have not verified it.

---

## 7. Bundle size, tree-shaking and first load

**Packaging:**

- `@babylonjs/core` is an ES-module package (`"type": "module"`) with a `sideEffects` allow-list that includes shader folders `Shaders/**` and `ShadersWGSL/**` [2].
- Its install footprint is large (73.6 MB unpacked, 10,169 files), but install size is not download size [2].

**Pure imports (new in 9.x docs):**

- Every core module has a side-effect-free `.pure` path, and there is a `@babylonjs/core/pure` barrel [62].
- Features are enabled with explicit `Register…()` calls, such as `RegisterStandardMaterial()`, which are idempotent.
- Babylon's bundle-size test asserts `pure <= deep < barrel` for each test scene [62].
- Vite usually needs no configuration. Webpack needs tree-shaking enabled. Rollup may need a plugin [62].
- The general ES6 package docs are at [63].

**Babylon's own measurement:** In the Babylon Lite announcement, the team reports that a BoomBox PBR glTF scene costs **675 KB gzipped (2.8 MB raw)** on Babylon.js, versus 34 KB on Lite [13]. The Lite team also reports its own engine's CPU frame time as roughly 3.6× faster (median) [13]. Those are vendor numbers, not independent benchmarks.

**Projected first load (inference, to be measured):**

- core PBR baseline ≈ 0.7 MB gz
- plus CSM, post-processing, GUI and loaders
- plus Havok (2.09 MB WASM + 67 kB JS) [56]
- plus our KTX2 textures and meshes

*Recommendation:*

- Set a 2 MB gz JS budget for the menu-to-playable path.
- Lazy-load Havok, GUI and the Inspector.
- Use pure imports from day one.
- Serve with Brotli and long-lived immutable caching.

**Honest weakness:** Babylon.js is not a small engine. The team itself built Lite largely to fix size and CPU overhead [13].

---

## 8. AI-agent familiarity

**Footprint in public code:**

- Babylon.js has about **1.1%** of Three.js's npm downloads: 402,660 combined `@babylonjs/core` + `babylonjs` against 35,595,518 `three` in the same week [10][11][12].
- *Inference:* Agents will have seen far less Babylon code than Three.js code, so expect more hallucinated property names and more out-of-date patterns.

**Old/new API mixing risks (real ones):**

- The global `BABYLON.*` UMD style versus ES-module imports [2][11].
- Physics v1 versus Physics v2/Havok. The current plugin path is under `Physics/v2` [54].
- The audio engine was overhauled in 8.0, with further API changes in 9.0 [6].
- Inspector v1 versus v2 [5].
- Side-effect imports versus the new `.pure` imports with `Register…()` calls [62].
- `CustomMaterial` GLSL injection versus WGSL [19].

**Mitigating factors that are specific to Babylon:**

1. **Backward compatibility reduces damage.** An agent using an older idiom usually produces working code, not a breaking-change failure [8].
2. **The API is fully typed.** Babylon ships TypeScript declarations (for example `engineFactory.d.ts`) [18]. With `strict` TypeScript and CI type-checks, most invented APIs fail at compile time.
3. **Docs built for agents.** A generated `llms.txt` plus per-page Markdown for **818** documentation pages was merged on 5 Nov 2026 [65].
4. **Official MCP servers (June 2026).** Every Babylon editor (NME, NPE, GUI and others) has an "MCP-Session" through which an agent can inspect and change graphs, saving to snippets or local JSON [64].
5. **Executable references.** Agents can check behaviour against official Playground snippets, and the Playground now supports multi-file projects and npm imports pinned through esm.sh [5].

**Recommendation for the agent team:**

- Pin one Babylon version.
- Add a repo-level "Babylon conventions" note covering:
  - ES-module plus pure imports only
  - Physics v2/Havok only
  - WGSL plus GLSL file pairs for custom effects
  - the Frame Graph task contract
- Have agents fetch the per-page Markdown docs [65] before using an unfamiliar API.

---

## 9. Self-scored table (1–5)

| # | Criterion | Score | Justification | Key citations |
|---|---|---|---|---|
| 1 | Visual quality ceiling | **5** | Nearly every item on our list is built in: PBR/IBL, CSM with PCF/PCSS, HDR + ACES/Khronos Neutral, bloom, SSAO2, SSR, TAA, motion blur, volumetrics, clustered lights, parallax, GPU particles. Deductions noted but not scored down: AgX is a custom pass, no SMAA, OpenPBR is alpha. | [4][29][30][31][34][35][36][37][41] |
| 2 | Performance / frame-time control | **4** | Snapshot rendering (FAST/STANDARD), NCM bundles, thin instances, LOD, SceneOptimizer, reverse depth, Frame Graph texture reuse. Deducted because main-engine CPU overhead is high (the team's own Lite comparison), snapshot gains are JS-side only, and CSM has no caster culling. | [13][17][27][28][30][39][40][50] |
| 3 | WebGPU maturity + WebGL2 fallback | **5** | WebGPU since 5.0 (2022), documented as "complete". `EngineFactory` WebGPU → WebGL fallback. Native WGSL core. Node Materials on both. Caveat: compute and snapshot rendering are WebGPU-only. | [15][16][17][18][19][26][27] |
| 4 | Terrain / compute suitability | **4** | `ComputeShader`, storage textures and buffers, Frame Graph compute block, floating origin, Geospatial Camera, Havok regions. Deducted: no official planetary terrain LOD, compute is WebGPU/WGSL-only, storage textures are write-only per the docs. | [5][22][26][59][60] |
| 5 | Animation & particles | **5** | Groups, blending, weights, additive, overrides, retargeting tool (9.0), GPU particles (1M example), Node Particle Editor, flow maps and attractors. Minor: GPU particles lack sub-emitters and mesh emitters. | [4][41][45][46][47] |
| 6 | Tooling / debugging | **5** | Inspector v2, Playground (multi-file, npm), NME/NPE/NRGE/GUI editors with MCP sessions, performance profiler, desktop Babylon Editor. Caveat: Inspector GPU timing is off by default on Chrome WebGPU. | [5][16][49][64] |
| 7 | Ecosystem / docs / community & agent familiarity | **3** | Extensive official docs, now with `llms.txt` and per-page Markdown, plus an active forum. But about 1.1% of Three.js npm volume, so less training data, and long API history means old/new mixing risk. | [10][11][12][65] |
| 8 | Solo-dev simplicity | **4** | Batteries included in one dependency family: physics, GUI, audio, particles, post-processing, loaders, inspector. Deducted: very large API surface, pure-import registration discipline, two shader languages for custom effects. | [2][19][54][62] |
| 9 | Modularity for parallel agent workstreams | **4** | Frame Graph tasks with explicit inputs and outputs, node graphs as JSON assets, ES-module packages, typed APIs. Deducted: the shared mutable `Scene` remains a coupling point, and Frame Graph integration has ordering rules. | [4][18][21][23][62] |
| 10 | Stability / license / longevity | **4** | Apache-2.0, Microsoft-backed, written backward-compatibility rule, yearly majors with 10.0 due March 2027. Deducted: a very fast release train means regression risk (pin versions), and the team now also invests in the WebGPU-only Lite. | [1][2][4][7][8][13][14] |
| | **Total** | **43/50** | | |

---

## 10. Honest weaknesses and risks, with mitigations

| # | Weakness / risk | Evidence | Mitigation |
|---|---|---|---|
| W1 | **Heavy first load.** A PBR glTF scene is 675 KB gz JS on Babylon.js by the team's own measurement. Havok adds a 2.09 MB WASM. | [13][56] | Pure imports, code-splitting (lazy Havok, GUI, Inspector), Brotli, immutable caching, a CI bundle-size budget [62]. |
| W2 | **Smaller ecosystem and agent training footprint.** About 1.1% of Three.js npm downloads, so more hallucinated or legacy API use. | [10][11][12] | Pinned version, a conventions file, strict TypeScript in CI, agent use of `llms.txt` and per-page Markdown [65] plus MCP sessions [64]. The backward-compatibility rule limits the damage [8]. |
| W3 | **Main-engine CPU overhead.** The Babylon team reports Lite at about 3.6× faster median CPU frame time, which implies meaningful per-frame JS cost in Babylon.js. | [13] | Thin instances for repeated geometry [39]. Snapshot rendering for static terrain chunks on WebGPU [27]. NCM bundles [28]. Few, large terrain chunks. Measure on the target laptop in week one. |
| W4 | **Snapshot rendering constraints.** JS-side gain only. "adding or removing meshes won't work" without reset. FAST mode needs manual transform updates. WebGPU only. | [27] | Use snapshot only for the static world layer. Keep dynamic actors (players, vehicles, robots) outside it, or use the `SnapshotRenderingHelper` (`updateMesh`, bones support) [27]. |
| W5 | **No built-in AgX; no SMAA found.** | [31][33][24][25] | AgX as a custom HDR post-process task (small, isolated). AA presets: TAA (desktop), MSAA + FXAA (integrated) [34][37]. |
| W6 | **Compute is WebGPU + WGSL only.** Storage textures are documented as write-only. | [26] | Fragment-shader render-to-texture dust-mask path that works on both backends first; compute later. Ping-pong textures or storage buffers [26]. |
| W7 | **CSM caveats.** No caster culling. Camera `maxZ` must be tuned. `splitFrustum()` is needed after near/far changes. `depthClamp` is ignored with PCSS. | [30] | Per-cascade custom render lists (`getCustomRenderList`). Tight far plane, with Earth and stars rendered as background. PCF by default, PCSS on high presets. |
| W8 | **Custom GLSL on WebGPU triggers a runtime WASM converter** (startup cost). `CustomMaterial`/`PBRCustomMaterial` stay GLSL. | [19] | Node Materials (both backends) or hand-written WGSL plus GLSL pairs. Avoid `CustomMaterial` for core shaders. |
| W9 | **Strategic split with Babylon Lite.** WebGPU-only, not backward compatible, API still evolving. | [13][14] | Stay on Babylon.js 9.x/10.x (Lite lacks our WebGL2 tier). The team states both engines continue [13], and Lite aims for pixel parity with Node Material JSON support [13]. That leaves an optional future path, not a dependency. |
| W10 | **Fast release train.** About 10 releases in 2.5 weeks. | [1] | Exact version pins, upgrade windows, and a visual-regression screenshot test on our vertical slice. |
| W11 | **No official planetary terrain LOD; character controller "up" vector undocumented.** | [57][59] | Build our own chunked-sphere mesher (needed in any engine). Week-one spike on radial gravity with `PhysicsCharacterController` [57]. Fall back to a custom kinematic controller on Havok shape casts if needed. |
| W12 | **Havok needs WASM SIMD** (no iOS < 16.4). | [54] | Acceptable for a desktop-first target. Document a minimum-browser policy. |
| W13 | **Frame Graph and Inspector v2 are new** (v1 in 9.0). Inspector v2 bugs are tracked in the 10.0 milestone. | [4][7][23] | Start with the classic pipeline (DefaultRenderingPipeline + CSM) for the week-one spike, then move to the Frame Graph once the task boundaries are proven. Both coexist [21][34]. |
| W14 | **Few realistic shipped Babylon games to point to.** | [61] | De-risk with a two-week vertical slice that measures frame time on a mid-range discrete GPU and an integrated GPU, across presets. |

### Suggested week-one spike to validate this case (*Recommendation*)

1. Set up `EngineFactory` with a user-selectable WebGL2 override [17].
2. Build a chunked moon sector patch with PBR regolith plus parallax [29][52].
3. Add a directional sun with 4-cascade CSM, PCF, then PCSS [30].
4. Run the HDR pipeline with ACES and Khronos Neutral built in, and AgX as a custom pass [31][34].
5. Compare SSAO2 and TAA with MSAA + FXAA [35][37][34].
6. Implement the dust mask on the fragment path and on the compute path [26].
7. Add a GPU dust particle burst [41].
8. Add one animated astronaut with blended walk/run [45].
9. Test the Havok character controller under radial gravity [57].
10. Measure frame time with snapshot rendering on and off [27].
11. Check bundle size with pure imports [62].

---

## Verification notes

- Several doc pages were verified only for **existence**, via the official sitemap [66]. Claims based on them are limited to the feature existing: [29], [35], [36], [38], [39], [40], [42], [44], [46], [47], [48], [49], [50], [51], [52], [53].
- **Tone mapping:** read directly from the current `master` source [31][32]. No AgX constant exists there.
- **SMAA:** absence was inferred from the Frame Graph post-process directory listings [24][25]. It is possible a non-Frame-Graph SMAA exists somewhere I did not search, but I found none.
- **Forum thread [33]:** the AgX "not planned" reply (Dec 2023) comes from the thread's search snippet and may be outdated. The source check in [31] is the stronger evidence.
- **Rapier thread [58]:** taken from search results. I did not assess the maintenance status of any community Rapier plugin.
- **Vendor-reported numbers:** all Babylon Lite performance and size numbers are reported by the Babylon team [13], not independently benchmarked.

---

## Sources

All accessed 2026-11-11.

1. GitHub — BabylonJS/Babylon.js Releases — https://github.com/BabylonJS/Babylon.js/releases — accessed 2026-11-11
2. npm registry — `@babylonjs/core` latest manifest (version, license, sideEffects, unpackedSize) — https://registry.npmjs.org/@babylonjs/core/latest — accessed 2026-11-11
3. Babylon.js Forum — "Welcome to Babylon.js 9.0!" (PirateJC, 26 Mar 2026) — https://forum.babylonjs.com/t/welcome-to-babylon-js-9-0/62940 — accessed 2026-11-11
4. Windows Developer Blog — "Announcing Babylon.js 9.0" (26 Mar 2026) — https://blogs.windows.com/windowsdeveloper/2026/03/26/announcing-babylon-js-9-0/ — accessed 2026-11-11
5. Windows Developer Blog — "Part 2 – Babylon.js 9.0: Tooling updates and new geospatial features" (30 Mar 2026) — https://blogs.windows.com/windowsdeveloper/2026/03/30/part-2-babylon-js-9-0-tooling-updates-and-new-geospatial-features/ — accessed 2026-11-11
6. Windows Developer Blog — "Part 3 – Babylon.js 9.0: OpenPBR and additional engine updates" (2 Apr 2026) — https://blogs.windows.com/windowsdeveloper/2026/04/02/part-3-babylon-js-9-0-openpbr-and-additional-engine-updates/ — accessed 2026-11-11
7. GitHub — BabylonJS/Babylon.js "10.0" milestone — https://github.com/BabylonJS/Babylon.js/milestone/17 — accessed 2026-11-11
8. GitHub — BabylonJS/Babylon.js contributing.md (golden rules) — https://github.com/BabylonJS/Babylon.js/blob/master/contributing.md — accessed 2026-11-11
9. GitHub — BabylonJS/Babylon.js repository page (stars, forks, license) — https://github.com/BabylonJS/Babylon.js — accessed 2026-11-11
10. npm downloads API — `@babylonjs/core` last week (2026-11-04 to 2026-11-10) — https://api.npmjs.org/downloads/point/last-week/@babylonjs/core — accessed 2026-11-11
11. npm downloads API — `babylonjs` last week — https://api.npmjs.org/downloads/point/last-week/babylonjs — accessed 2026-11-11
12. npm downloads API — `three` last week — https://api.npmjs.org/downloads/point/last-week/three — accessed 2026-11-11
13. Babylon.js Forum — "Introducing Babylon Lite" (Deltakosh, 17 Jun 2026) — https://forum.babylonjs.com/t/introducing-babylon-lite/63648 — accessed 2026-11-11
14. Babylon.js Forum — "Babylon X vs. Lite vs. 9" (July 2026) — https://forum.babylonjs.com/t/babylon-x-vs-lite-vs-9/63786 — accessed 2026-11-11
15. Babylon.js Docs — WebGPU Support — https://doc.babylonjs.com/setup/support/webGPU — accessed 2026-11-11
16. Babylon.js Docs — WebGPU Status — https://doc.babylonjs.com/setup/support/webGPU/webGPUStatus — accessed 2026-11-11
17. Babylon.js Docs — WebGPU Breaking Changes (EngineFactory fallback order, async reads, reverse depth) — https://doc.babylonjs.com/setup/support/webGPU/webGPUBreakingChanges — accessed 2026-11-11
18. jsDelivr — `@babylonjs/core@9.12.0` Engines/engineFactory.d.ts — https://cdn.jsdelivr.net/npm/@babylonjs/core@9.12.0/Engines/engineFactory.d.ts — accessed 2026-11-11
19. Babylon.js Docs — Writing shaders for WebGPU in WGSL — https://doc.babylonjs.com/setup/support/webGPU/webGPUWGSL — accessed 2026-11-11
20. Babylon.js Docs — Node Material — https://doc.babylonjs.com/features/featuresDeepDive/materials/node_material — accessed 2026-11-11
21. Babylon.js Docs — Frame Graph — https://doc.babylonjs.com/features/featuresDeepDive/frameGraph — accessed 2026-11-11
22. Babylon.js Docs — Description of the Render Graph Blocks — https://doc.babylonjs.com/features/featuresDeepDive/frameGraph/frameGraphBlocks/frameGraphBlocksDescription — accessed 2026-11-11
23. Babylon.js Docs — Frame Graph FAQ and Best Practices — https://doc.babylonjs.com/features/featuresDeepDive/frameGraph/frameGraphFAQ — accessed 2026-11-11
24. GitHub source — FrameGraph/Node/Blocks/PostProcesses directory — https://github.com/BabylonJS/Babylon.js/tree/master/packages/dev/core/src/FrameGraph/Node/Blocks/PostProcesses — accessed 2026-11-11
25. GitHub source — FrameGraph/Tasks/PostProcesses directory — https://github.com/BabylonJS/Babylon.js/tree/master/packages/dev/core/src/FrameGraph/Tasks/PostProcesses — accessed 2026-11-11
26. Babylon.js Docs — Compute Shaders — https://doc.babylonjs.com/features/featuresDeepDive/materials/shaders/computeShader — accessed 2026-11-11
27. Babylon.js Docs — Snapshot Rendering (WebGPU) — https://doc.babylonjs.com/setup/support/webGPU/webGPUOptimization/webGPUSnapshotRendering — accessed 2026-11-11
28. Babylon.js Docs — Non Compatibility Mode (WebGPU) — https://doc.babylonjs.com/setup/support/webGPU/webGPUOptimization/webGPUNonCompatibilityMode — accessed 2026-11-11
29. Babylon.js Docs — Mastering PBR Materials — https://doc.babylonjs.com/features/featuresDeepDive/materials/using/masterPBR — accessed 2026-11-11
30. Babylon.js Docs — Cascaded Shadow Maps — https://doc.babylonjs.com/features/featuresDeepDive/lights/shadows_csm — accessed 2026-11-11
31. GitHub source — imageProcessingConfiguration.pure.ts (tone-mapping constants) — https://raw.githubusercontent.com/BabylonJS/Babylon.js/master/packages/dev/core/src/Materials/imageProcessingConfiguration.pure.ts — accessed 2026-11-11
32. GitHub source — thinTonemapPostProcess.ts (TonemappingOperator enum) — https://raw.githubusercontent.com/BabylonJS/Babylon.js/master/packages/dev/core/src/PostProcesses/thinTonemapPostProcess.ts — accessed 2026-11-11
33. Babylon.js Forum — "Tone Mapping The Scene" (AgX request; maintainer reply Dec 2023, via search snippet) — https://forum.babylonjs.com/t/tone-mapping-the-scene/24697 — accessed 2026-11-11
34. Babylon.js Docs — Default Rendering Pipeline — https://doc.babylonjs.com/features/featuresDeepDive/postProcesses/defaultRenderingPipeline — accessed 2026-11-11
35. Babylon.js Docs — SSAO Rendering Pipeline (SSAO2) — https://doc.babylonjs.com/features/featuresDeepDive/postProcesses/SSAORenderPipeline — accessed 2026-11-11
36. Babylon.js Docs — SSR Rendering Pipeline — https://doc.babylonjs.com/features/featuresDeepDive/postProcesses/SSRRenderingPipeline — accessed 2026-11-11
37. Babylon.js Docs — TAA Rendering Pipeline — https://doc.babylonjs.com/features/featuresDeepDive/postProcesses/TAARenderingPipeline — accessed 2026-11-11
38. Babylon.js Docs — Motion Blur Post Process — https://doc.babylonjs.com/features/featuresDeepDive/postProcesses/motionBlurPostProcess — accessed 2026-11-11
39. Babylon.js Docs — Thin Instances — https://doc.babylonjs.com/features/featuresDeepDive/mesh/copies/thinInstances — accessed 2026-11-11
40. Babylon.js Docs — Levels of Detail (LOD) — https://doc.babylonjs.com/features/featuresDeepDive/mesh/LOD — accessed 2026-11-11
41. Babylon.js Docs — GPU Particles — https://doc.babylonjs.com/features/featuresDeepDive/particles/particle_system/gpu_particles — accessed 2026-11-11
42. Babylon.js Docs — KTX2 Compressed Textures — https://doc.babylonjs.com/features/featuresDeepDive/materials/using/ktx2Compression — accessed 2026-11-11
43. GitHub source — loaders glTF 2.0 Extensions directory — https://github.com/BabylonJS/Babylon.js/tree/master/packages/dev/loaders/src/glTF/2.0/Extensions — accessed 2026-11-11
44. Babylon.js Docs — glTF importer — https://doc.babylonjs.com/features/featuresDeepDive/importers/glTF — accessed 2026-11-11
45. Babylon.js Docs — Advanced Animation Methods (blending, weights, additive) — https://doc.babylonjs.com/features/featuresDeepDive/animation/advanced_animations — accessed 2026-11-11
46. Babylon.js Docs — Animation Groups — https://doc.babylonjs.com/features/featuresDeepDive/animation/groupAnimations — accessed 2026-11-11
47. Babylon.js Docs — Animation Retargeting — https://doc.babylonjs.com/features/featuresDeepDive/animation/animationRetargeting — accessed 2026-11-11
48. Babylon.js Docs — GUI — https://doc.babylonjs.com/features/featuresDeepDive/gui/gui — accessed 2026-11-11
49. Babylon.js Docs — Performance Profiler (legacy Inspector section) — https://doc.babylonjs.com/legacy/inspector/performanceProfiler — accessed 2026-11-11
50. Babylon.js Docs — Scene Optimizer — https://doc.babylonjs.com/features/featuresDeepDive/scene/sceneOptimizer — accessed 2026-11-11
51. Babylon.js Docs — Optimize Your Scene — https://doc.babylonjs.com/features/featuresDeepDive/scene/optimize_your_scene — accessed 2026-11-11
52. Babylon.js Docs — Parallax Mapping — https://doc.babylonjs.com/features/featuresDeepDive/materials/using/parallaxMapping — accessed 2026-11-11
53. Babylon.js Docs — Decals — https://doc.babylonjs.com/features/featuresDeepDive/mesh/decals — accessed 2026-11-11
54. Babylon.js Docs — Havok Physics Plugin — https://doc.babylonjs.com/features/featuresDeepDive/physics/havokPlugin — accessed 2026-11-11
55. npm registry — `@babylonjs/havok` latest manifest — https://registry.npmjs.org/@babylonjs/havok/latest — accessed 2026-11-11
56. unpkg — `@babylonjs/havok@1.3.14` lib/esm file listing (WASM size) — https://app.unpkg.com/@babylonjs/havok@1.3.14/files/lib/esm — accessed 2026-11-11
57. Babylon.js Docs — Physics Character Controller — https://doc.babylonjs.com/features/featuresDeepDive/physics/characterController — accessed 2026-11-11
58. Babylon.js Forum — "Using Rapier Physics with Babylon" (community integration; via search) — https://forum.babylonjs.com/t/using-rapier-physics-with-babylon/32324 — accessed 2026-11-11
59. Babylon.js Docs — Large World Rendering / Floating Origin — https://doc.babylonjs.com/features/featuresDeepDive/scene/large_world — accessed 2026-11-11
60. GitHub — BarthPaleologue/CosmosJourneyer (README) — https://github.com/BarthPaleologue/CosmosJourneyer — accessed 2026-11-11
61. Babylon.js — Games page — https://babylonjs.com/games/ — accessed 2026-11-11
62. Babylon.js Docs — Using Pure Imports (tree-shaking) — https://doc.babylonjs.com/setup/frameworkPackages/es6Support/treeShaking/usingPureImports — accessed 2026-11-11
63. Babylon.js Docs — ES6 support / framework packages — https://doc.babylonjs.com/setup/frameworkPackages/es6Support — accessed 2026-11-11
64. Babylon.js Forum — "Babylon.js MCP servers are out!" (RaananW, 4 Jun 2026) — https://forum.babylonjs.com/t/babylon-js-mcp-servers-are-out/63591 — accessed 2026-11-11
65. GitHub — BabylonJS/Documentation PR #1663 "Generate llms.txt and per-page markdown for agents" (merged 5 Nov 2026) — https://github.com/BabylonJS/Documentation/pull/1663 — accessed 2026-11-11
66. Babylon.js Docs — sitemap.xml (used to verify doc URLs) — https://doc.babylonjs.com/sitemap.xml — accessed 2026-11-11
