# ADR-0004: WebGPU-first with a real WebGL2 fallback (feature tiers)

- **Status:** Accepted (2026-11-12)
- **Deciders:** lead/orchestrator
- **Canonical source:** [tech-stack.md](../architecture/tech-stack.md) section 4 (Renderer row), constraints table ("real WebGL2 path")

## Context

As of November 2026 WebGPU ships by default in Chrome/Edge 113+ (Windows, macOS, ChromeOS, Android 12+), Firefox on Windows and macOS, and Safari 26 on macOS Tahoe and iOS 26. Linux is partial and Windows-on-ARM is behind a flag. Coverage estimates are 81.5% (Web3D Survey, working adapters) to 88.6% (Can I use), so **roughly 11-19% of visitors have no WebGPU**. WebGL2 reaches ~97-98% but has no compute shaders, and GPU timer queries work on only ~63% of clients. The dust system (ADR-0009) and particles lean on compute.

## Options considered

1. **WebGPU-first, automatic WebGL2 backend of `WebGPURenderer`, with feature tiers.** Pro: one code path, TSL compiles to GLSL; best experience where available. Con: WebGL2 lacks compute atomics, indirect draws and storage-texture compute; needs per-tier fallbacks.
2. **WebGPU only.** Pro: simplest. Con: excludes 11-19% of players; rejected by the brief ("a real WebGL2 path").
3. **WebGL2 only (legacy `WebGLRenderer`).** Pro: widest reach. Con: legacy path, no compute, three stops adding features to it.
4. **Two separate renderers.** Pro: each optimal. Con: doubles render work, impossible to keep in parity.

## Decision

Option 1. Capability detection happens once at boot in `apps/client/src/render/` and produces a **tier object** consumed by `terrain`, `visuals` and `ui` (contract: `shared/render/quality.ts`).

| Tier | Backend | Features |
| --- | --- | --- |
| **T-GPU** | WebGPU | Compute dust updates, compute particles, GTAO, TRAA (High/Ultra), timestamp queries when exposed |
| **T-GL2** | WebGL2 backend | Dust via fragment-pass stroke replay (no compute), GPU-instanced/transform-free particles, reduced AO, SMAA, lower draw budget (<= 800), no GPU timers (frame-time deltas) |
| **T-LOW** | Either, Low preset | Render scale 0.5-0.75, 2 cascades, no AO/bloom options on iGPU |

- Quality presets (Low/Medium/High/Ultra) are independent of backend; tier only removes features the backend cannot do.
- Optional WebGPU features (BC vs ETC2/ASTC, subgroups, float32-filterable) are queried, never assumed; texture format is chosen via KTX2 transcode (ADR-0013).
- Device loss or out-of-memory downgrades one quality step automatically.
- CI runs a software-WebGL2 smoke lane; WebGPU baselines run locally (ADR-0019).

## Consequences

**Positive**
- ~97% of browsers can play; the same TSL materials run on both backends.

**Negative / risks**
- Two visual outputs to review; the WebGL2 dust path is extra work and is part of the competing prototypes (ADR-0009).
- WebGPU in headless CI is unreliable; WebGPU visual regression needs a real-GPU machine.
- iOS/Android are out of scope (ADR-0021), so the wide-fragmentation risk is deferred.

## Revisit trigger

- WebGPU coverage of the target audience (desktop) exceeds ~95% and the WebGL2 path costs more than ~15% of rendering effort: consider dropping to a degraded "best effort" fallback.
- Three removes or breaks the WebGL2 backend.

## Evidence

- [browser-feasibility.md](../research/browser-feasibility.md) (Executive summary 1-7, section 1, recommended budgets)
- [rendering-case-threejs.md](../research/tech/rendering-case-threejs.md) (one renderer, two backends; fallback parity)
- [terrain-and-dust-techniques.md](../research/tech/terrain-and-dust-techniques.md) (section 6, WebGPU notes)
