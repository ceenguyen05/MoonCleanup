// @contract render/backend v0
// @consumers apps/client/src/render (backend and tier detection), apps/client/src/app (status overlay),
//   apps/client/src/debug (F3 HUD), apps/client/src/ui, this package's events/catalog
//
// Canonical names of the render backends and the hardware tiers. Specification:
// docs/architecture/rendering-pipeline.md section 2.1 ("Naming (used in every doc)").
//
// Detection, the capability flags and the tier -> default preset rule (sections 2.1-2.3) are logic and data of
// apps/client/src/render; only the names are a contract.

/**
 * Render backends, best first. `webgpu-compat` is WebGPU on a compatibility-feature-level adapter; `webgl2` is the
 * WebGL2 fallback of the same renderer.
 */
export const RENDER_BACKENDS = ["webgpu", "webgpu-compat", "webgl2"] as const;
export type RenderBackend = (typeof RENDER_BACKENDS)[number];

/**
 * Hardware tiers: A = discrete GPU, B = integrated GPU, C = any device running the `webgl2` backend. Ultra is a
 * preset, not a tier.
 */
export const HARDWARE_TIERS = ["A", "B", "C"] as const;
export type HardwareTier = (typeof HARDWARE_TIERS)[number];
