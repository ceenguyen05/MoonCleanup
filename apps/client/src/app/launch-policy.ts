// App-level launch policy (pure, no DOM): which scenes the composition root routes, whether GPU timestamp queries
// are requested, and the default quality preset for integrated GPUs. Kept here (not in render/) because it is the
// composition root's decision; the render module's own detection (rendering-pipeline.md section 2.3) is unchanged.

import { QUALITY_PRESET_IDS, type QualityPresetId } from "@moon-cleanup/shared";
import type { GpuClass } from "../render";

/**
 * Scene ids the visuals module routes itself: the look-dev scenes S01-S03, S05, S06, the `typical` worksite (M0-W3-T08)
 * and the `dust` worksite (M1-W3-T02). Mirrors `LOOKDEV_SCENE_IDS` of the visuals barrel (kept as literals so this
 * file stays free of three imports).
 */
export const VISUALS_SCENE_IDS: readonly string[] = ["s01", "s02", "s03", "s05", "s06", "typical", "dust", "moon"];
/** Visuals scenes that show the game's own Solo host state, so the host starts for them by default (`&solo=0`: off). */
export const SOLO_FED_SCENE_IDS: readonly string[] = ["dust"];
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

/**
 * Whether the composition root starts the Solo LocalRoom host (ADR-0031). Default: on for the game launch (no `?scene=`
 * or a scene that no module routes, e.g. the hello world and the HUD test page). Off for the harness lanes that must
 * stay deterministic and cheap: look-dev / bench / verify scenes and `?capture=1`. The `dust` scene is fed by the host
 * (its strokes are the game's own), so it starts it too. `?solo=0` forces off, `?solo=1` on.
 */
export function wantsSoloHost(search: string): boolean {
  const params = new URLSearchParams(search);
  const forced = params.get("solo");
  if (forced === "0") return false;
  if (forced === "1") return true;
  if (params.get("capture") === "1") return false;
  const plan = planScene(search);
  return plan.smokeScene || SOLO_FED_SCENE_IDS.includes(plan.scene);
}

/** `?scene=dust` with the Solo host: the scene shows the host's strokes through the main-thread ledger view. */
export function wantsHostDustFeed(search: string): boolean {
  return planScene(search).scene === "dust" && wantsSoloHost(search);
}

/** Visuals scene the default game launch shows: the dust worksite (regolith ground + dust layer), fed by the Solo host. */
export const GAME_WORKSITE_SCENE_ID = "dust";
/** Centre of the game worksite: Outpost Boreal (+Y, WDS section 1); the default spawn and the sell points are within 60 m. */
export const GAME_SITE_DIRECTION: Readonly<{ x: number; y: number; z: number }> = Object.freeze({ x: 0, y: 1, z: 0 });

/**
 * The default launch (no `?scene=`, no `?play=1`) is the playable Solo game: the player's own Contract on the dust
 * worksite at Boreal with player input. Off when the Solo host is off (`?solo=0`, `?capture=1`: the hello world stays the
 * capture lanes' parity scene). `?play=1` keeps the dev hello world with player input; every `?scene=` keeps its dev scene.
 */
export function wantsGameWorksite(search: string): boolean {
  const params = new URLSearchParams(search);
  if ((params.get("scene") ?? "").trim() !== "") return false;
  if (params.get("play") === "1") return false;
  return wantsSoloHost(search);
}

/** Visuals scene of the terrain game: the CDLOD moon with the dust layer on its regolith. */
export const GAME_TERRAIN_SCENE_ID = "moon";

/**
 * Launch-policy switch of the game's ground (M1-W3-T05 round 3): `?ground=terrain` runs the game on the CDLOD terrain
 * with the dust layer, the Solo host on the baked height cube. The flat dust worksite stays the default until the
 * terrain path is measured within the UHD 620 Medium budget (then flip `GAME_GROUND_DEFAULT`); `?ground=flat` forces it.
 */
export const GAME_GROUND_DEFAULT: "flat" | "terrain" = "flat";

export function wantsTerrainGame(search: string): boolean {
  if (!wantsGameWorksite(search)) return false;
  const asked = (new URLSearchParams(search).get("ground") ?? "").trim().toLowerCase();
  return asked === "terrain" || (asked !== "flat" && GAME_GROUND_DEFAULT === "terrain");
}

/** The module search of the game launch: the given (already filtered) search with the game's scene. */
export function gameModuleSearch(search: string, terrain = false): string {
  const params = new URLSearchParams(search);
  params.set("scene", terrain ? GAME_TERRAIN_SCENE_ID : GAME_WORKSITE_SCENE_ID);
  return `?${params.toString()}`;
}

/** The audio module is registered unless `?audio=0` or capture mode (the capture lanes never take a gesture). */
export function wantsAudio(search: string): boolean {
  const params = new URLSearchParams(search);
  return params.get("audio") !== "0" && params.get("capture") !== "1";
}
