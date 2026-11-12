# PlayCanvas (engine-only, code-first): the case for it as our rendering engine

**Date:** 2026-11-11 · **Author:** advocate subagent P2c · **Role:** technology advocate making an honest case · **Scope:** PlayCanvas Engine used as an npm library in a TypeScript + Vite monorepo. The cloud Editor is optional and not assumed. · **Status:** research only; no code written.

> Citation convention: `[n]` refers to the numbered Sources list at the end. All sources were accessed on 2026-11-11. Some claims come from search-engine summaries of official pages rather than full page fetches. Those claims are marked "(search summary)". Anything I could not verify is stated as unverified.

---

## Executive summary

- **Current release.** PlayCanvas Engine **v2.24.0 was published on 2026-11-09** under the MIT license. Minor releases ship roughly monthly: 2.21.0 on 07-21, 2.22.0 on 09-04, 2.23.0 on 10-01 and 2.24.0 on 11-09, with frequent patches in between [1][2].
- **Backing.** The engine is backed by PlayCanvas Ltd., a subsidiary of Snap Inc. [11][12][13]. The repository is 12 years old, has 17,274 stars and was pushed to on the day of research [5].
- **Post-processing is first-party.** The `CameraFrame` pipeline provides:
  - HDR bloom, including high-quality bloom.
  - SSAO.
  - TAA with temporal upscaling, and SMAA.
  - Depth of field and sharpening.
  - Auto exposure, lens flare, LUT and colour grading, vignette and fringing.

  These are documented features, not community add-ons [24][2].
- **Tone mapping covers our whole shortlist.** Options are ACES, "ACES2" (a closer fit of ACES 1.x, not ACES 2.0), Khronos PBR Neutral, and **AgX and AgX Punchy**, which were merged 2026-10-29 and shipped in 2.24.0 [26][27][28][29].
- **Sun shadows.** Directional lights get cascaded shadow maps with 1–4 cascades. Filtering options are PCF 1/3/5, VSM and PCSS (contact-hardening shadows). Recent releases added per-camera cascade splits, a far-distance shadow fade and `shadowBounds` [30][2][3].
- **Regolith detail.** Parallax mapping and opt-in **parallax occlusion mapping with soft self-shadowing** became public API in 2.22.0, which also added a "parallax terrain" example [4].
- **Dust masks.** WebGPU compute is first-party and documented: `Compute`, `ComputePass` (new in 2.24), storage buffers, storage textures, indirect dispatch and scene-depth access in compute [23][2]. WebGL2 has no compute, so it needs a fallback that renders the masks with fragment shaders into textures [23].
- **WebGPU is still labelled "Beta" in the official manual.** The engine falls back to WebGL2 automatically [16][14]. The homepage claims "full WebGPU support" [8], and the team shipped SuperSplat 3.0 as WebGPU-only [20].
- **Code-first TypeScript is a documented path.** It is scaffolded with `npm create playcanvas@latest` and set up with npm and Vite. The package ships full TypeScript declarations as ES modules and can run headless in Node.js [39].
- **First-party support for AI agents.** The "Developing with AI" guide offers `llms.txt` and `llms-full.txt`, a Context7 index, installable PlayCanvas agent Skills, and a recommended AGENTS.md/CLAUDE.md layout [55].
- **Main weaknesses.**
  - The ecosystem and training-data footprint are much smaller than Three.js: about 189k versus about 35.6M weekly npm downloads [6][7].
  - Much public example code is written in the Editor's script style rather than as engine-only code.
  - APIs change even in minor releases [2][3][4].
  - Several headline 2.24.0 features were only two days old at the time of research.
- **Verdict.** PlayCanvas is the most complete and game-ready first-party rendering stack for our visual bar. It is the right choice if we pin versions, give agents the official AI docs, and pass a two-week frame-time spike (§10).

---

## 1. Version, cadence, policy, license, backing, adoption

| Item | Fact (as of 2026-11-11) | Source |
|---|---|---|
| Latest release | **v2.24.0, published 2026-11-09**. Not a prerelease. | [1][2] |
| Recent releases | v2.23.3 (2026-10-15), v2.23.0 (2026-10-01), v2.22.0 (2026-09-04), v2.21.0 (2026-07-21) | [1] |
| Cadence | A minor release every 4–7 weeks, with frequent patches. For example, 2.22.1 through 2.22.6 shipped between 2026-09-08 and 2026-09-28. | [1] |
| Breaking changes, major versions | Migrations are documented. The move from 1.x to 2.x dropped WebGL1, the legacy script system and backward-compatibility shims. | [14] |
| Breaking changes, minor versions | **These happen in minor releases too.**<br>• 2.22.0 has an explicit "Breaking Changes" section (frustum planes stored in typed arrays; wire-drawing methods removed from `AppBase`).<br>• 2.23.0 removed the shader dump/precompile workflow and immediate-mode mesh rendering.<br>• 2.24.0 renamed FrameGraph members, deprecated the legacy post effects, and renamed "inconsistent public API names behind deprecated aliases".<br>• Overrides of the engine's shader chunks have their own migration log. | [4][3][2][15] |
| Semver statement | I could not retrieve the "Versioning and Releases" page, so no formal policy is cited. | — |
| License | **Engine: MIT.** The Editor frontend is also MIT on GitHub; per AlternativeTo it was open-sourced in August 2025. The homepage states: "The entire PlayCanvas platform is open sourced on GitHub under the MIT license." | [5][9][10][8] |
| Company | PlayCanvas Ltd. is a Snap Inc. subsidiary, and Snap holds the trademark. PitchBook dates the acquisition to May 2017. | [11][12][13] |
| Customer logos | The homepage shows Snap, Google, Toyota, Ubisoft, Activision, Nickelodeon, Zynga, King, Atari, Bethesda, Aristocrat and Polaris. It also says Snapchat Web Lenses can publish PlayCanvas games. | [8] |
| GitHub | 17,274 stars, 2,054 forks and 461 open issues. Created 2014-05-12; last push 2026-11-11. | [5] |
| npm (week of 2026-11-04 to 11-10) | **playcanvas: 189,212** downloads; three: 35,595,518 over the same window. | [6][7] |

---

## 2. WebGPU maturity, the WebGL2 path, shaders and compute

### Status

- The official Graphics manual lists the backends as follows [16]:
  - "**WebGPU (Beta)** – … compute shader support"
  - WebGL 2.0 – "Mature and widely supported across all browsers and devices"
  - A Null backend for headless use
- The same manual says: "The engine will seamlessly fall back from WebGPU to WebGL based on browser support." [16]
- The migration guide says the engine "exclusively supports WebGL2 and WebGPU (in beta)" [14].
- The homepage calls PlayCanvas "one of the first production 3D engines with full WebGPU support", including compute [8]. **Official sources disagree on maturity; the decider should weigh the manual's "Beta" label.**
- Timeline: initial WebGPU support arrived in Engine 1.62 (2023-03-31), and Editor support in 2024-04 [18][19].
- **Production signal.** SuperSplat 3.0 (2026-09-09) "is now WebGPU only". It runs in Chrome and Edge, Safari 26+, and Firefox where WebGPU is enabled. On a 4.4M-splat scene, the idle JavaScript heap fell from about 1,557 MB to about 105 MB [20].
- **Hardening is ongoing:**
  - 2.22: a fix for inverted normal mapping on WebGPU (derivative TBN) [4].
  - 2.23: recovery from device loss, a persistent storage buffer for instance matrices, and render pipelines retained between draws [3].
  - 2.24: fixes for compressed textures whose sizes are not block-aligned, and a `devicerestorefailed` event [2].

  A normal-mapping bug on WebGPU fixed only in September 2026 shows why the "Beta" label is still fair.
- **Selecting a device.** `createGraphicsDevice` tries the `deviceTypes` list in priority order, and WebGL2 is always appended as a fallback [17]. Other relevant options [17]:
  - `powerPreference: 'high-performance'`, which helps on dual-GPU laptops.
  - `antialias`, which defaults to true.
  - `displayFormat` with an HDR option. HDR display output works on WebGPU only [25].

### Shader system

- The engine builds its shaders from **chunks**. Custom shaders use `ShaderMaterial`, which accepts GLSL and/or WGSL sources and can `#include` engine chunks such as `transformCoreVS` (skinning, morphing, instancing), tone mapping, fog and shadow [21].
- Running GLSL on WebGPU requires a WASM transpiler (glslang + twgsl). Shipping WGSL alongside the GLSL avoids that download [21][17]. **Recommendation:** write every custom shader in both GLSL and WGSL.
- Optional WGSL capabilities are exposed: `f16` types, subgroup-size control, and flags for reading storage textures [22].
- Since 2.22, `ShaderMaterial` supports shadow passes through `#include` [4].

### Compute

- Compute runs **on WebGPU only**; check `device.supportsCompute` first [23].
- The documented API includes:
  - `Compute` (a compute shader plus its parameters).
  - `StorageBuffer`, with asynchronous readback.
  - Storage textures, created as a `Texture` with `storage: true`.
  - `setupDispatchThreads` to dispatch by thread count.
  - Indirect dispatch (256 slots by default).
  - Scene depth and colour maps readable from compute [23].
- 2.24.0 added three related features [2]:
  - `ComputePass`, which runs computes at a chosen point in the frame.
  - Compute dispatch counters in the stats and MiniStats.
  - "Dispatch each Compute instance at most once per frame."
- **WebGL2 fallback building blocks** [4]:
  - Render targets with multiple render targets (MRT) and independent blending per target.
  - Integer and RG32F render formats.
  - Transform feedback with multiple buffers.
  - A "painter" example that paints into render targets on both APIs.

---

## 3. Feature evidence against our visual bar

| Requirement | PlayCanvas capability | Evidence | Maturity / risk |
|---|---|---|---|
| PBR materials | `StandardMaterial` (metalness workflow, clear coat, iridescence, refraction), eight UV sets (2.23), planar reflections (2.24) | [3][2][4] | Mature core. **I did not re-verify the image-based lighting (IBL) and environment-atlas docs in this session.** |
| Harsh sun with cascaded shadows | `numCascades` 1–4, `cascadeDistribution`, PCF1/3/5 at 32F, VSM16, PCSS (directional lights only), `normalOffsetBias`, resolution up to 4096, static update mode; per-camera splits and `shadowBounds` (2.24); distance fade (2.23); `shadowCascadeMask` (2.22) | [30][2][3][4] | Mature. Cascade blending exists, but its documentation is thin [30]. |
| HDR and filmic tone mapping | RG11B10/RGBA16F/RGBA32F HDR targets; tone mapping options ACES, ACES2, Neutral, **AgX, AgX Punchy**; auto exposure | [25][26][27][28][29][24] | AgX and auto exposure are brand new (2.24.0). Tone mapping is a single full-screen pass [25]. |
| Subtle bloom | HDR physically based bloom; high-quality mode (#9700) | [24][2] | Mature, with a new quality mode. |
| Ambient occlusion | SSAO in CameraFrame; TAA resolves its noise | [24][2] | No GTAO/HBAO variants are named. |
| Crisp anti-aliasing | TAA (with upscaling), SMAA (opt-in), MSAA through the device `antialias` option and multisampled render targets | [24][2][17][4] | TAA and SMAA as CameraFrame effects shipped two days before this research. The TAA history-drift fix landed in 2.24 [2]. FXAA is not listed among CameraFrame effects. |
| Dynamic resolution and quality presets | `rendering.renderTargetScale` (0.1–1), TAA temporal upscaling, sharpening | [24] | **I found no automatic dynamic-resolution controller.** We would write a small frame-time controller. |
| Starfield and Earth | Generic sky plus meshes; lens flare (2.24) for sun glare | [24][2] | `DynamicSkyEffect` models an Earth sky, which does not apply on the Moon. |
| Night and helmet lamp | Clustered spot and omni lights with shadow and cookie atlases; 255 lights by default, raisable via `maxLights` since v2.22 | [31] | Clustered spot and omni lights share one PCF shadow type [30]. |
| Regolith displacement and parallax | Parallax mapping, parallax occlusion mapping with soft self-shadowing, `heightMapBase`; parallax terrain example | [4] | New in 2.22. Vertex displacement is possible through `ShaderMaterial` chunks [21]. WebGPU has no tessellation stage [57]. |
| Dust layer thinning (per-frame GPU masks) | Compute plus storage textures on WebGPU; render-target ping-pong on WebGL2 | [23][2][4] | Needs two implementations of the mask update. |
| Footprints and tracks | Same mask mechanism; painter example | [4] | No built-in decal system was verified. |
| Low-gravity dust particles | `ParticleSystemComponent` (`useFog`/`useTonemap` in 2.23); a particles examples category with impact and mesh particles (2.24); compute examples; rigid-body `gravityScale` (2.23) | [3][2][23] | The particle system is a classic emitter, not a node-based VFX graph. |
| Skeletal animation with blending | Anim state graph with 1D, 2D Cartesian, 2D directional and direct blend trees; Override and Additive layers; bone masks; `blendToWeight` | [32][33][34][35] (search summary) | Mature. Transition fixes landed in 2.24 [2]. Vertex-animation-texture (VAT) crowd example for robots (2.22) [4]. |
| Instancing, batching, indirect draws | Hardware instancing and indirect draws; batching; instance matrices kept in a storage buffer on WebGPU; radix-sorted draw calls | [4][3][2] | Mature. |
| LOD | No built-in mesh LOD component was found; only Gaussian-splat LOD exists | [2][4] | We would write chunk LOD, which our terrain needs anyway. |
| Render targets | MRT, MSAA colour and depth resolve, integer formats, origin option | [4] | Mature. |
| KTX2/Basis, Draco, meshopt | Basis and Draco are advertised; Draco since v1.27.0. meshopt support (`meshoptInitialize`) was merged 2026-10-19. | [36][37][38] (search summary for [36][37]) | Decoders are not bundled. I could not confirm that meshopt is in 2.24.0. |
| Profiling and debugging | MiniStats (redesigned in 2.23), a devtools hook, compute counters, `WireRenderer`, `SceneDepthReader`, CameraFrame debug views; the debug build logs deprecated API usage | [3][2][4][14] | Good, but with no Editor there is no scene inspector out of the box. |
| Engine-only TypeScript with Vite | `npm create playcanvas@latest` with the Engine format; npm + Vite; full typings; `AppBase` registers only the systems you include | [39] | First-class workflow. |
| `@playcanvas/react` and Web Components | React: "a thin wrapper", full engine access, lazily loaded physics. Web Components: docs available; pinning versions is advised. | [40][41] | Stability status is not stated. **Use the engine directly for the game core.** |

---

## 4. Physics and character controller

- **ammo.js** is the default backend behind the rigid-body and collision components. Since 2.22 a physics-backend abstraction lets the app pick a world through `AppOptions.physicsWorld`, with `AmmoPhysicsWorld` and `NullPhysicsWorld` available. Jolt is mentioned only as a possible future backend [43][4].
- The manual says that layer "is marked alpha, so its API may still change" [42].
- Useful for our game:
  - `gravityScale` (2.23) suits low gravity [3].
  - `timeScale` and a public `step()` (2.22) suit fixed-step simulation for netcode [4].
  - The Null graphics device runs the engine headless in Node, so the same code can run a server-side simulation [16][39].
- **Jolt** is available through the community "Physics Components" project (gamebop). It provides Body, Char (a character controller), Constraint, Shape and SoftBody components, plus **wheeled, tracked and motorcycle vehicles**, which fit our rovers. No version or maintenance status is stated [44][45].
- **Rapier** appears in the manual's list of alternatives, with no PlayCanvas integration listed [42]. Rapier has its own kinematic character controller [46].
- **Risk:** there is no first-party Jolt or Rapier integration, and I did not verify an official character controller.

## 5. Planetary-scale terrain and floating origin

- There is no built-in planet or terrain system. A community port of quadtree terrain LOD exists, but it works on flat terrain [47].
- What the engine gives us to build one:
  - The mesh APIs accept typed arrays (2.22) [4].
  - Culling uses bounding boxes (2.22) [4].
  - There is a parallax terrain example [4].
- There is no built-in floating origin. A forum thread on objects that "wobble" far from the origin offers no engine-level fix [48][49].
- **Our own arithmetic, with an assumption.** Our world is 160k hexes:
  - With hexes 10 m across, the sphere's area is about 1.39e7 m², so its radius is about 1.05 km.
  - With 25 m hexes, the radius is about 2.6 km.
  - At those magnitudes, float32 position spacing is about 0.12–0.24 mm.

  **So floating origin is likely unnecessary.** If needed, re-centering the world root is simple.

## 6. Shipped games, demos and performance reputation

- Evidence of shipped and showcased work:
  - Venge.io, a multiplayer FPS [52].
  - Miniclip's first PlayCanvas game [53].
  - Showreels from 2021 and 2022, plus the awesome-playcanvas list [50][51].
  - Snapchat Web Lenses and brand logos on the homepage [8].
  - The Grace Cathedral experience (2026-07-20) [18].
  - SuperSplat 3.0's memory reductions [20].
- **Honest gap.** Most showcases are casual or mobile games, product visualisation, or Gaussian splats. I found no current realistic game at our visual bar, and no independent current benchmark comparing PlayCanvas, Three.js and Babylon.js. Its reputation for mobile and low-end performance rests on its customer base, not on verified benchmarks, so we must measure it ourselves.

## 7. Bundle size and first load

- Bundlephobia measures playcanvas@2.24.0 at **2,832,044 B minified and 729,849 B gzipped**, with `sideEffects: false` [54].
- Ways to reduce it:
  - ESM tree-shaking through `AppBase` [39].
  - 2.22 moved deprecated shims so the ESM build tree-shakes [4].
  - The Draco, Basis and meshopt decoders, and ammo's WASM, load separately [38].
  - Shipping WGSL avoids downloading the GLSL→WGSL transpiler [21].
- **The real tree-shaken size is unverified; measure it in the spike.**

## 8. AI-agent familiarity

- **Risk:**
  - The download ratio is about 1:188 against Three.js [6][7], so far less public code exists for agents to learn from.
  - Much of that public code is in the Editor's script style or uses the v1 API, which was removed in v2 [14].
  - Agents may also reach for the legacy post effects (deprecated in 2.24) [2] or old shader-chunk overrides [15].
- **Mitigations available today:**
  - `developer.playcanvas.com/llms.txt`, `llms-full.txt` and `api.playcanvas.com/engine/llms.txt`.
  - A Context7 index.
  - PlayCanvas Skills, which `create-playcanvas` includes by default.
  - AGENTS.md with a CLAUDE.md that imports it.
  - The advice to "check the installed PlayCanvas types… instead of guessing APIs" [55].
  - Full TypeScript typings, so the compiler catches invented APIs [39].
  - Examples, which are engine-only code [56].
- **Our own guardrails:**
  - Lint rules that ban the Editor script style and the legacy post effects.
  - A pinned engine version.
  - One owned "render facade" module.

## 9. Self-scored table (1–5)

| Criterion | Score | Justification | Cite |
|---|---|---|---|
| Visual quality ceiling | **4.5** | Our full post-processing, tone-mapping, cascaded-shadow and parallax-occlusion list is covered first-party. Minus: several features are only days old, and IBL was not re-verified. | [24][26][30][4] |
| Performance and frame-time control | **4** | Render scale with TAA upscaling, presets via exposed properties, static shadows, cascade masks, radix-sorted draw calls, MiniStats. Minus: no automatic dynamic resolution and no independent benchmarks. | [24][30][2][3] |
| WebGPU maturity and WebGL2 fallback | **3.5** | Automatic WebGL2 fallback and a WebGPU-only flagship product. Minus: the manual still says "Beta", and WebGPU bugs were still being fixed in late 2026. | [16][20][4] |
| Terrain and compute suitability | **3** | Rich, documented compute with ComputePass and scene depth. Minus: compute is WebGPU-only, and there is no terrain, planet or LOD system. | [23][2][47] |
| Animation and particles | **4** | Blend trees, layers, masks and additive blending; VAT crowds; particle and compute examples. Minus: the particle system is a classic emitter. | [32][4][2] |
| Tooling and debugging | **3.5** | MiniStats, devtools hook, debug views, deprecation logging in the debug build. Minus: no inspector without the Editor. | [3][4][14] |
| Ecosystem, docs, community and agent familiarity | **3** | Excellent first-party AI docs, Skills and typings. Minus: a small footprint and code in the Editor style. | [55][6][7] |
| Solo-dev simplicity | **4** | Batteries included (ECS, anim, physics, audio, assets, post-processing) with an npm + Vite scaffold. | [39] |
| Modularity for parallel agent workstreams | **4** | ECS components and systems, public CameraFrameEffect hooks, ComputePass, typed modules. | [2][39] |
| Stability, license and longevity | **4** | MIT, 12 years old, Snap-owned, active releases. Minus: breaking changes in minor releases, and work is concentrated in a few maintainers (most 2.24 items are by one engineer). | [5][2][4] |

## 10. Weaknesses, risks and mitigations

| # | Weakness / risk | Mitigation |
|---|---|---|
| 1 | WebGPU is officially "Beta" and compute is WebGPU-only [16][23] | Treat WebGL2 as the guaranteed baseline and WebGPU as the quality and performance path. Put the dust-mask update behind one interface with a compute path and a fragment-shader path. Run both in CI and browser tests. |
| 2 | Small training-data footprint and code in the Editor style [6][7][14] | Use llms.txt, Context7, Skills, AGENTS.md, strict TypeScript and lint bans [55]. Have one agent own the render facade. |
| 3 | API churn in minor releases; 2.24 features are only days old [2][3][4] | Pin exact versions and upgrade deliberately each month after reading release notes. Run the debug build in development, and keep engine calls behind our own modules. |
| 4 | Full bundle is about 730 KB gzipped [54] | Tree-shake with `AppBase`, lazy-load physics and decoders, and ship WGSL [39][21]. |
| 5 | No terrain, LOD or floating-origin system; physics backends beyond ammo are community or alpha [42][44] | Write custom cube-sphere chunk LOD (we need it anyway). Floating origin is probably unnecessary (§5). Evaluate the Jolt Physics Components project or write our own adapter. |
| 6 | Bus factor and Snap's strategic focus on Gaussian splats [2][20] | The MIT license allows forking. Pin versions and keep our engine surface narrow. |

**Spike gates (2 weeks):**
- A dense moon chunk with 4-cascade PCSS, parallax occlusion mapping, SSAO, bloom, AgX and TAA.
- Must hold 60 FPS on a mid-range discrete GPU and 30 FPS or more on integrated graphics, using WebGL2 and WebGPU.
- Dust-mask update in under 1 ms on both paths.
- Measure the tree-shaken bundle size.

---

## Sources

1. GitHub API – playcanvas/engine releases — https://api.github.com/repos/playcanvas/engine/releases?per_page=40 — accessed 2026-11-11
2. Release v2.24.0 · playcanvas/engine — https://github.com/playcanvas/engine/releases/tag/v2.24.0 — accessed 2026-11-11
3. Release v2.23.0 · playcanvas/engine — https://github.com/playcanvas/engine/releases/tag/v2.23.0 — accessed 2026-11-11
4. Release v2.22.0 · playcanvas/engine — https://github.com/playcanvas/engine/releases/tag/v2.22.0 — accessed 2026-11-11
5. GitHub API – playcanvas/engine repository — https://api.github.com/repos/playcanvas/engine — accessed 2026-11-11
6. npm downloads, playcanvas, last week — https://api.npmjs.org/downloads/point/last-week/playcanvas — accessed 2026-11-11
7. npm downloads, three, last week — https://api.npmjs.org/downloads/point/last-week/three — accessed 2026-11-11
8. PlayCanvas homepage — https://playcanvas.com/ — accessed 2026-11-11
9. GitHub API – playcanvas/editor repository — https://api.github.com/repos/playcanvas/editor — accessed 2026-11-11
10. AlternativeTo: PlayCanvas Editor Frontend is now open source with MIT license (search result) — https://alternativeto.net/news/2025/8/playcanvas-editor-frontend-is-now-open-source-with-mit-license — accessed 2026-11-11
11. Crunchbase – PlayCanvas (search summary) — https://www.crunchbase.com/organization/playcanvas — accessed 2026-11-11
12. Justia Trademarks – PLAYCANVAS, Snap Inc. (search summary) — https://trademarks.justia.com/877/43/playcanvas-87743850.html — accessed 2026-11-11
13. PitchBook – PlayCanvas profile (search summary) — https://pitchbook.com/profiles/company/57818-80 — accessed 2026-11-11
14. Engine Migrations – PlayCanvas Developer Site — https://developer.playcanvas.com/user-manual/engine/migrations/ — accessed 2026-11-11
15. Shader Chunk Migrations (search summary) — https://developer.playcanvas.com/user-manual/graphics/shaders/migrations/ — accessed 2026-11-11
16. Graphics – PlayCanvas Developer Site — https://developer.playcanvas.com/user-manual/graphics — accessed 2026-11-11
17. createGraphicsDevice – Engine API Reference v2.24.0 — https://api.playcanvas.com/engine/functions/createGraphicsDevice.html — accessed 2026-11-11
18. PlayCanvas Blog – webgpu tag — https://blog.playcanvas.com/tags/webgpu — accessed 2026-11-11
19. Build WebGPU Apps Today with PlayCanvas — https://blog.playcanvas.com/build-webgpu-apps-today-with-playcanvas/ — accessed 2026-11-11
20. New in SuperSplat: Editor 3.0 Rebuilt on WebGPU — https://blog.playcanvas.com/new-in-supersplat-editor-3-0-rebuilt-on-webgpu — accessed 2026-11-11
21. Shaders – PlayCanvas Developer Site — https://developer.playcanvas.com/user-manual/graphics/shaders/ — accessed 2026-11-11
22. WGSL Capabilities — https://developer.playcanvas.com/user-manual/graphics/shaders/wgsl-capabilities/ — accessed 2026-11-11
23. Compute Shaders — https://developer.playcanvas.com/user-manual/graphics/shaders/compute-shaders/ — accessed 2026-11-11
24. Modern Post Processing (CameraFrame) — https://developer.playcanvas.com/user-manual/graphics/posteffects/cameraframe/ — accessed 2026-11-11
25. HDR Rendering — https://developer.playcanvas.com/user-manual/graphics/linear-workflow/hdr-rendering/ — accessed 2026-11-11
26. PR #9874 Add AgX and AgX Punchy tonemapping — https://github.com/playcanvas/engine/pull/9874 — accessed 2026-11-11
27. TONEMAP_AGX – Engine API v2.24.0 — https://api.playcanvas.com/engine/variables/TONEMAP_AGX.html — accessed 2026-11-11
28. TONEMAP_ACES2 – Engine API v2.24.0 — https://api.playcanvas.com/engine/variables/TONEMAP_ACES2.html — accessed 2026-11-11
29. TONEMAP_NEUTRAL – Engine API v2.24.0 — https://api.playcanvas.com/engine/variables/TONEMAP_NEUTRAL.html — accessed 2026-11-11
30. Shadows – PlayCanvas Developer Site — https://developer.playcanvas.com/user-manual/graphics/lighting/shadows/ — accessed 2026-11-11
31. Clustered Lighting — https://developer.playcanvas.com/user-manual/graphics/lighting/clustered-lighting/ — accessed 2026-11-11
32. Animstategraph Assets (search summary; direct fetch returned empty) — https://developer.playcanvas.com/user-manual/animation/anim-state-graph-assets/ — accessed 2026-11-11
33. Anim Layer Masks (search summary) — https://developer.playcanvas.com/user-manual/animation/anim-layer-masking/ — accessed 2026-11-11
34. AnimComponent – Engine API (search summary) — https://api.playcanvas.com/engine/classes/AnimComponent.html — accessed 2026-11-11
35. AnimComponentLayer – Engine API (search summary) — https://api.playcanvas.com/engine/classes/AnimComponentLayer.html — accessed 2026-11-11
36. playcanvas/engine README (search summary) — https://github.com/playcanvas/engine — accessed 2026-11-11
37. Release v1.27.0 (Draco; search summary) — https://github.com/playcanvas/engine/releases/tag/v1.27.0 — accessed 2026-11-11
38. PR #9738 Decode EXT/KHR meshopt compression — https://github.com/playcanvas/engine/pull/9738 — accessed 2026-11-11
39. PlayCanvas Engine – user manual overview — https://developer.playcanvas.com/user-manual/engine/ — accessed 2026-11-11
40. PlayCanvas React — https://developer.playcanvas.com/user-manual/react/ — accessed 2026-11-11
41. Web Components – Getting Started (search summary) — https://developer.playcanvas.com/user-manual/web-components/getting-started/ — accessed 2026-11-11
42. Alternatives to ammo.js — https://developer.playcanvas.com/user-manual/physics/ammo-alternatives/ — accessed 2026-11-11
43. PR #9266 Add AppOptions.physicsWorld — https://github.com/playcanvas/engine/pull/9266 — accessed 2026-11-11
44. Physics Components (gamebop, Jolt) — https://gamebop.github.io/physics/ — accessed 2026-11-11
45. Kinematic Character System – PlayCanvas forum (search summary) — https://forum.playcanvas.com/t/kinematic-character-system/36055 — accessed 2026-11-11
46. Rapier – Character controller (search summary) — https://rapier.rs/docs/user_guides/javascript/character_controller — accessed 2026-11-11
47. Quad tree terrain LOD engine to PlayCanvas integration – forum (search summary) — https://forum.playcanvas.com/t/quad-tree-terrain-lod-engine-to-playcanvas-integration/6894 — accessed 2026-11-11
48. Model "wobble" far from origin – PlayCanvas forum (search summary) — https://forum.playcanvas.com/t/model-wobble-far-from-origin/24020 — accessed 2026-11-11
49. Floating origin – Wikipedia (search summary) — https://en.wikipedia.org/wiki/Floating_origin — accessed 2026-11-11
50. Made with PlayCanvas — https://developer.playcanvas.com/user-manual/getting-started/made-with-playcanvas — accessed 2026-11-11
51. awesome-playcanvas — https://github.com/playcanvas/awesome-playcanvas — accessed 2026-11-11
52. Showcase: Venge.io – PlayCanvas forum (search summary) — https://forum.playcanvas.com/t/showcase-venge-io/13609 — accessed 2026-11-11
53. Miniclip launches their first PlayCanvas game (search summary) — https://blog.playcanvas.com/miniclip-launches-their-first-playcanvas-game — accessed 2026-11-11
54. Bundlephobia API – playcanvas@2.24.0 — https://bundlephobia.com/api/size?package=playcanvas@2.24.0 — accessed 2026-11-11
55. Developing with AI – PlayCanvas Developer Site — https://developer.playcanvas.com/user-manual/engine/developing-with-ai/ — accessed 2026-11-11
56. PlayCanvas Examples (search result) — https://playcanvas.vercel.app/ — accessed 2026-11-11
57. W3C WebGPU specification (general reference; not fetched this session) — https://www.w3.org/TR/webgpu/ — accessed 2026-11-11
