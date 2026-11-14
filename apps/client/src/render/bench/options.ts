// URL options of the bench scene (M0-W2-T02): `?scene=bench&draws=<n>&preset=<low|medium|high>` plus bench-only knobs.
// Pure parsing. `preset` itself is read by the render module's own parser (url-options.ts); it is repeated nowhere here.
//
//   draws=200|350|600|900   total draw calls per frame over all passes (fillers are added until the measured count fits)
//   path=p1|p3              the bench drives the camera itself (P1 walk loop, P3 orbit + sky pan); default none
//   anim=0|1                avatar proxies walk (default 1; 0 gives a fully static frame for the velocity check)
//   dbg=1..7                terrain shader debug view (grey image of one intermediate value)
//   probe=zfight            adds the reversed-Z probe (two planes 3 m apart at 15 km) to the sky
//   terrain=real|standin    v1 (M0-W3-T07): baked height cube + real regolith material (default) or the v0 stand-in
//   terrainBase=<url dir>   where assets/terrain is served (default /assets/terrain/); real terrain falls back to the
//                           stand-in (loudly, `stats().terrainSource`) when it cannot be loaded
//   cube=256|1024           baked cube resolution decoded for the chunks (default 256)
//   horizon=on|off          far-occluder (horizon map) term in the shadow (default on; off skips the 7 MB file)
//   look=visuals|v0        which look drives sun / CSM / sky / post: the visuals rig (default) or the original bench chain
//   verify=1                hash the inflated payloads against the manifest (browser decode check)

import { parseBenchLook, type BenchLookId } from "./look";

export const BENCH_SCENE_ID = "bench";
export const BENCH_DRAW_STEPS = [200, 350, 600, 900] as const;
export const BENCH_DEFAULT_DRAWS = 350;
export const BENCH_MAX_DRAWS = 2000;
export const BENCH_PATH_IDS = ["p1", "p3"] as const;
export type BenchPathId = (typeof BENCH_PATH_IDS)[number];

export interface BenchOptions {
  readonly draws: number;
  readonly path: BenchPathId | null;
  readonly animate: boolean;
  readonly zFightProbe: boolean;
  /** Terrain shader debug view (0 = look); see `createTerrainStub` (standin) and `RegolithMaterialOptions.debugView` (real). */
  readonly debugView: number;
  readonly terrain: BenchTerrainMode;
  readonly terrainBase: string;
  readonly cube: 256 | 1024;
  readonly horizon: boolean;
  readonly verifyTerrain: boolean;
  readonly look: BenchLookId;
}

export type BenchTerrainMode = "real" | "standin";
export const BENCH_DEFAULT_TERRAIN_BASE = "/assets/terrain/";

function withTrailingSlash(url: string): string {
  return url.endsWith("/") ? url : `${url}/`;
}

export function parseBenchOptions(search: string): BenchOptions {
  const params = new URLSearchParams(search);
  const drawsRaw = params.get("draws");
  const drawsNumber = drawsRaw === null || drawsRaw.trim() === "" ? Number.NaN : Number(drawsRaw);
  const draws = Number.isFinite(drawsNumber)
    ? Math.min(BENCH_MAX_DRAWS, Math.max(0, Math.round(drawsNumber)))
    : BENCH_DEFAULT_DRAWS;
  const pathRaw = params.get("path")?.trim().toLowerCase() ?? null;
  const path = BENCH_PATH_IDS.find((id) => id === pathRaw) ?? null;
  return {
    draws,
    path,
    animate: params.get("anim") !== "0",
    zFightProbe: params.get("probe") === "zfight",
    debugView: Math.max(0, Math.min(7, Math.round(Number(params.get("dbg")) || 0))),
    terrain: params.get("terrain") === "standin" ? "standin" : "real",
    terrainBase: withTrailingSlash(params.get("terrainBase")?.trim() || BENCH_DEFAULT_TERRAIN_BASE),
    cube: params.get("cube") === "1024" ? 1024 : 256,
    horizon: params.get("horizon") !== "off",
    verifyTerrain: params.get("verify") === "1",
    look: parseBenchLook(search),
  };
}
