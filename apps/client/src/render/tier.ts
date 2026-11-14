// Hardware tier, default preset and backend limits: docs/architecture/rendering-pipeline.md sections 2.2 and 2.3.
// Pure logic; the GPU class patterns are data (`gpu-classes.json`).
//
// Not here: the 3-second lobby benchmark of section 2.3 (a later task; it only ever steps the preset DOWN, through
// RenderQualityService.stepDown).

import {
  QUALITY_PRESET_IDS,
  QUALITY_PRESETS,
  type HardwareTier,
  type QualityPresetId,
  type QualitySettings,
  type RenderBackend,
} from "@moon-cleanup/shared";

export const GPU_CLASSES = ["ultra", "discrete", "integrated", "unknown"] as const;
export type GpuClass = (typeof GPU_CLASSES)[number];

/** Shape of `gpu-classes.json`. */
export interface GpuClassTable {
  readonly ultra: readonly string[];
  readonly discrete: readonly string[];
  readonly integrated: readonly string[];
  /** Lower-case adapter vendor -> class, used when no pattern matched (Chrome often hides the device name). */
  readonly vendorFallback: Readonly<Record<string, string>>;
}

function matchesAny(patterns: readonly string[], description: string): boolean {
  for (const pattern of patterns) {
    let expression: RegExp;
    try {
      expression = new RegExp(pattern, "i");
    } catch {
      continue;
    }
    if (expression.test(description)) return true;
  }
  return false;
}

function classifyOne(description: string, table: GpuClassTable): GpuClass {
  if (description.trim() === "") return "unknown";
  if (matchesAny(table.ultra, description)) return "ultra";
  if (matchesAny(table.discrete, description)) return "discrete";
  if (matchesAny(table.integrated, description)) return "integrated";
  return "unknown";
}

function isGpuClass(value: string | undefined): value is GpuClass {
  return value !== undefined && (GPU_CLASSES as readonly string[]).includes(value);
}

/**
 * Classifies a GPU from its descriptions, most specific source first (WebGPU adapter description, then the
 * WEBGL_debug_renderer_info string), then from the adapter vendor. `unknown` when nothing matches.
 */
export function classifyGpu(descriptions: readonly string[], vendor: string, table: GpuClassTable): GpuClass {
  for (const description of descriptions) {
    const gpuClass = classifyOne(description, table);
    if (gpuClass !== "unknown") return gpuClass;
  }
  const fallback = table.vendorFallback[vendor.trim().toLowerCase()];
  return isGpuClass(fallback) ? fallback : "unknown";
}

/**
 * Hardware tier (section 2.1 naming): Tier C is ANY device running the `webgl2` backend; otherwise discrete and
 * Ultra-capable GPUs are Tier A, integrated and unknown GPUs Tier B (unknown is treated conservatively).
 */
export function tierFor(backend: RenderBackend, gpuClass: GpuClass): HardwareTier {
  if (backend === "webgl2") return "C";
  return gpuClass === "discrete" || gpuClass === "ultra" ? "A" : "B";
}

/** Highest preset a backend offers (section 2.2, "Max preset offered"). */
export function maxPresetFor(backend: RenderBackend): QualityPresetId {
  return backend === "webgpu" ? "ultra" : "high";
}

function presetRank(preset: QualityPresetId): number {
  return QUALITY_PRESET_IDS.indexOf(preset);
}

/** `preset`, lowered to the backend's maximum when it exceeds it. */
export function clampPresetToBackend(preset: QualityPresetId, backend: RenderBackend): QualityPresetId {
  const max = maxPresetFor(backend);
  return presetRank(preset) > presetRank(max) ? max : preset;
}

/** The next lower preset, or `null` at Low. */
export function presetBelow(preset: QualityPresetId): QualityPresetId | null {
  const rank = presetRank(preset);
  return rank > 0 ? (QUALITY_PRESET_IDS[rank - 1] ?? null) : null;
}

/**
 * Default preset (section 2.3 "Defaults"): Tier B -> Medium on `webgpu`, Low on `webgpu-compat`; Tier C -> Low;
 * Tier A -> High; Ultra-capable -> Ultra. The result never exceeds the backend's maximum.
 */
export function defaultPresetFor(tier: HardwareTier, backend: RenderBackend, gpuClass: GpuClass): QualityPresetId {
  let preset: QualityPresetId;
  if (tier === "C") preset = "low";
  else if (tier === "B") preset = backend === "webgpu" ? "medium" : "low";
  else preset = gpuClass === "ultra" ? "ultra" : "high";
  return clampPresetToBackend(preset, backend);
}

/** Cascade limit on `webgpu-compat` and `webgl2` (section 2.2, "CSM shadows ... max 3"). */
export const NON_CORE_MAX_CASCADES = 3;

const resolvedCache = new Map<string, QualitySettings>();

/**
 * The settings of `preset` as they run on `backend`. Applies the backend rules that `shared/render/quality.ts`
 * leaves to the render module (section 2.2): the preset is clamped to the backend's maximum; `webgpu-compat` and
 * `webgl2` use at most 3 cascades and the `mip-chain` exposure source (the histogram needs compute + atomics).
 *
 * The result is frozen and cached per (preset, backend): the same object is returned every time, so a frame can
 * compare settings by identity and nothing is allocated after the first call.
 */
export function resolveQuality(preset: QualityPresetId, backend: RenderBackend): QualitySettings {
  const id = clampPresetToBackend(preset, backend);
  const key = `${id}|${backend}`;
  const cached = resolvedCache.get(key);
  if (cached !== undefined) return cached;

  const base: QualitySettings = QUALITY_PRESETS[id];
  const core = backend === "webgpu";
  // The spread carries every group the render module does not adjust per backend (lights, terrain, dust, particles,
  // sky, budgets, distances, ui ...) straight from the shared preset, so new `QualitySettings` groups need no edit here.
  const resolved: QualitySettings = Object.freeze({
    ...base,
    preset: base.preset,
    dprCap: base.dprCap,
    dynres: Object.freeze({ ...base.dynres }),
    shadows: Object.freeze({
      ...base.shadows,
      cascades: core ? base.shadows.cascades : Math.min(base.shadows.cascades, NON_CORE_MAX_CASCADES),
    }),
    post: Object.freeze({
      ...base.post,
      ao: Object.freeze({ ...base.post.ao }),
      bloom: Object.freeze({ ...base.post.bloom }),
      exposureSource: core ? base.post.exposureSource : "mip-chain",
    }),
  });
  resolvedCache.set(key, resolved);
  return resolved;
}
