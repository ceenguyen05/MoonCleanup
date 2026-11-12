# ADR-0003: Rendering engine - Three.js WebGPURenderer + TSL

- **Status:** Accepted (2026-11-12)
- **Deciders:** lead/orchestrator, after three advocate reports
- **Canonical source:** [tech-stack.md](../architecture/tech-stack.md) section 2 (matrix) and section 4 (Renderer row)

## Context

The visual bar is the heaviest-weighted requirement: a realistic moon with CSM shadows, HDR post, GPU dust masks and a whole-sphere terrain, in a browser, with 60 FPS on a discrete laptop GPU and 30+ on integrated graphics. The code is written by AI agents, so API familiarity matters. Three advocate reports (Three.js, Babylon.js, PlayCanvas) were normalized by the lead onto one 1-5 scale.

## Options considered

1. **Three.js r187 `WebGPURenderer` + TSL (vanilla).** Pro: TSL compiles one shader source to WGSL and GLSL (needed for the dust WebGL2 path); ~200 KB gz core; largest agent familiarity and an official `llms.txt`. Con: renderer is still labelled "experimental"; CPU/UBO overhead on many render items (issue #30560); no engine, we assemble.
2. **Babylon.js 9.35.** Pro: batteries included, WebGPU "complete", frame graph, snapshot rendering. Con: ~675 KB gz first load; WGSL-only compute; ~1% of three's downloads; no built-in AgX/SMAA.
3. **PlayCanvas 2.24.** Pro: editor-style engine, small team velocity. Con: WebGPU Beta; ~730 KB gz; weakest agent familiarity.
4. **Three.js via React Three Fiber.** Pro: React ergonomics. Con: WebGPU default only in v10 alpha; reconciler cost in the game loop.

## Weighted matrix summary (from tech-stack.md)

| Criterion (weight) | Three.js r187 | Babylon.js 9.35 | PlayCanvas 2.24 |
| --- | --- | --- | --- |
| Visual ceiling (15%) | 5 | 5 | 4.5 |
| Performance control (15%) | 3.5 | 4.5 | 4 |
| WebGPU maturity + WebGL2 fallback (10%) | 3.5 | 4.5 | 3 |
| Solo-dev simplicity (25%) | 3.5 | 4 | 4 |
| Modularity for parallel agents (15%) | 4.5 | 4 | 4 |
| Agent familiarity / ecosystem (20%) | 4.5 | 3 | 2.5 |
| **Weighted total** | **4.05** | **3.98** | **3.45** |

The margin over Babylon is narrow (0.07); Babylon is the documented **runner-up**.

## Decision

**`three@0.187.0`, pinned exactly, `WebGPURenderer` + TSL, vanilla (no React Three Fiber).** Mitigations are part of the decision:
- Draw-call discipline: BatchedMesh, instancing, chunked terrain, <= 600 draws on Tier A (tech-stack figure; the browser-feasibility budget allows more).
- ESLint ban-list for legacy APIs: `WebGLRenderer`, `EffectComposer`, GLSL `ShaderMaterial`, `renderAsync`, `PostProcessing`.
- Vendored docs snapshot in `docs/vendor/three-r187/` (M0 task) and an M0 render spike.
- Upgrade deliberately (about quarterly) via the Migration Guide; never float to latest, since releases change look-affecting defaults.

## Consequences

**Positive**
- One shader source for both backends; small core; agents know the API.
- Modules (terrain, dust, post, VFX) stay independent of any engine scene convention.

**Negative / risks**
- No semver: each `rNNN` can break (e.g. `PostProcessing` became `RenderPipeline` in r183, `PCFSoftShadowMap` removed in r186).
- WebGPU-path CPU overhead; compute atomics and indirect draws are missing on the WebGL2 backend (ADR-0004).
- We build the terrain/LOD, entity layer and tooling ourselves.

## Revisit trigger

M0-W2 render spike shows WebGPU-path CPU frame time **> 6 ms on Tier B** for the MVP scene, or a blocking WebGPURenderer bug persists **> 2 releases**: prototype the same scene in Babylon 9 under the competing-approach rule.

## Evidence

- [rendering-case-threejs.md](../research/tech/rendering-case-threejs.md) (Executive summary, sections 1, 9)
- [rendering-case-babylonjs.md](../research/tech/rendering-case-babylonjs.md) (Executive summary, sections 7-10)
- [rendering-case-playcanvas.md](../research/tech/rendering-case-playcanvas.md)
- [browser-feasibility.md](../research/browser-feasibility.md) (hardware tiers and budgets)

## Follow-up note (2026-11-12, planning fix)

- The **Tier B fallback ladder** (five pre-declared `quality.ts` steps applied if the Medium terrain line exceeds 7.0 ms or total GPU exceeds 28 ms on the Tier B reference device) lives in [rendering-pipeline.md §14.2](../architecture/rendering-pipeline.md); [performance-budgets.md §10](../architecture/performance-budgets.md) points to it. Its result is recorded here.
- The M0 **render-spike ADR** that closes the revisit trigger above must **cite the M0-W3-T07 run** (the final capture on Tier A / Tier B / `webgl2` with the real baked height cube and look-dev material, including the worst-case terrain-shader stub), not the earlier W2 stand-in bench alone.
