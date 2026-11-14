// App-level launch policy (pure, no DOM): which scenes the composition root routes, whether GPU timestamp queries
// are requested, and the default quality preset for integrated GPUs. Kept here (not in render/) because it is the
// composition root's decision; the render module's own detection (rendering-pipeline.md section 2.3) is unchanged.

import { QUALITY_PRESET_IDS, type QualityPresetId } from "@moon-cleanup/shared";
import type { GpuClass } from "../render";

/**
 * Scene ids the visuals module routes itself: the look-dev scenes S01-S03, S05, S06 and the `typical` worksite (M0-W3-T08).
 * Mirrors `LOOKDEV_SCENE_IDS` of the visuals barrel (kept as literals so this file stays free of three imports).
 */
export const VISUALS_SCENE_IDS: readonly string[] = ["s01", "s02", "s03", "s05", "s06", "typical"];
/** Scenes owned by the render module (it replaces the smoke mesh). */
export const RENDER_SCENE_IDS: readonly string[] = ["bench", "verify"];
/** Look-dev scenes that exist but are not routed by any module (none since M0-W3-T08 routed S02 / S03). */
export const UNROUTED_SCENE_IDS: readonly string[] = [];

export interface ScenePlan {
  /** Normalised `?scene=` value ("" when absent). */
  readonly scene: string;
  /** The built-in parity mesh is the visible scene (hello world, `?scene=smoke`, hud-test, unknown ids). */
  readonly smokeScene: boolean;
  /** A requested scene that is not wired; the caller logs a warning. */
  readonly unrouted: boolean;
}

export function planScene(search: string): ScenePlan {
  const scene = (new URLSearchParams(search).get("scene") ?? "").trim().toLowerCase();
  const owned = VISUALS_SCENE_IDS.includes(scene) || RENDER_SCENE_IDS.includes(scene);
  return { scene, smokeScene: !owned, unrouted: UNROUTED_SCENE_IDS.includes(scene) };
}

/**
 * URL params that point asset loaders at another origin (`terrainBase` for the bench, `terrain` for look-dev S01).
 * Dev-only knobs: in a production build a crafted link must not make the tab fetch and inflate attacker terrain
 * (security review N8).
 */
export const DEV_ONLY_ASSET_PARAMS: readonly string[] = ["terrainBase", "terrain"];

/**
 * The `location.search` the composition root hands to modules. Production builds (`import.meta.env.PROD`) drop the
 * dev-only asset-URL params, so loaders fall back to their same-origin defaults; dev builds pass it through.
 * Returns the input unchanged when nothing was removed.
 */
export function launchSearch(search: string, production: boolean): string {
  if (!production) return search;
  const params = new URLSearchParams(search);
  let removed = false;
  for (const name of DEV_ONLY_ASSET_PARAMS) {
    if (params.has(name)) {
      params.delete(name);
      removed = true;
    }
  }
  if (!removed) return search;
  const rest = params.toString();
  return rest.length === 0 ? "" : `?${rest}`;
}

/**
 * GPU timestamp queries are WebGPU-only: on the WebGL2 lane three still begins a timer query per render call when
 * asked, which logs `beginQuery: a query is already active`. `?backend=webgl2` or a missing `navigator.gpu` means
 * the WebGPU path will not run. (A silent WebGPU->WebGL2 fallback inside the renderer start still tracks; that needs
 * the render module to expose the decision before runtime creation: open item for the rendering worker.)
 */
export function wantsTimestampQueries(input: {
  readonly perfEnabled: boolean;
  readonly search: string;
  readonly hasNavigatorGpu: boolean;
}): boolean {
  if (!input.perfEnabled || !input.hasNavigatorGpu) return false;
  return new URLSearchParams(input.search).get("backend")?.trim().toLowerCase() !== "webgl2";
}

function rank(preset: QualityPresetId): number {
  return QUALITY_PRESET_IDS.indexOf(preset);
}

/**
 * Integrated GPUs (Intel UHD / Iris, Radeon Graphics, Apple A-series ...) never default above Low: the UHD 620 spike
 * (M0-W3-T02) measured Medium at 49-59 ms and High at 141-155 ms in the bench. Returns the preset to switch to, or
 * `null` to keep the render module's choice. An explicit `?preset=` or a saved choice always wins.
 */
export function integratedGpuPreset(input: {
  readonly gpuClass: GpuClass;
  readonly current: QualityPresetId;
  readonly explicit: boolean;
}): QualityPresetId | null {
  if (input.explicit || input.gpuClass !== "integrated") return null;
  return rank(input.current) > rank("low") ? "low" : null;
}
