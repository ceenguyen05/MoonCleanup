// The bench's look seam (M0-W3-T07 follow-up): everything the bench takes from "a look" - sun and fill lights, the cascaded
// shadow node, the sky bodies and the post chain - sits behind `LookProvider`, so the same scene content and terrain can be
// measured under two looks:
//
//   visuals  (default) the technical-artist rig: `SunRig` (key + `MoonShadowNode` + regolith fill), `SkyRig`, `createLookStages`
//            (look grade, bloom, TRAA / SMAA). This is what the game runs.
//   v0       the original bench chain (plain sun + `HorizonCsmNode`, stand-in sky, `createBenchStages`), kept selectable with
//            `?look=v0` so numbers recorded before the follow-up stay comparable.
//
// The scene owns terrain, content, draw calibration and hooks; a provider owns lights, shadow node, sky and post stages and
// is told once per frame (after the camera pose is final) and when the preset changes.

import { Vector3, type PerspectiveCamera } from "three/webgpu";
import type { FrameInfo, QualitySettings } from "@moon-cleanup/shared";
import type { RenderRendererService } from "../module";
import type { SceneRoots } from "../scene-roots";

export const BENCH_LOOK_IDS = ["visuals", "v0"] as const;
export type BenchLookId = (typeof BENCH_LOOK_IDS)[number];
export const BENCH_DEFAULT_LOOK: BenchLookId = "visuals";

/** Sun elevation of the bench (degrees) and the direction toward the sun. */
export const BENCH_SUN_ELEVATION_DEG = 35;
/** Sun azimuth (radians, from +x toward +z). */
export const BENCH_SUN_AZIMUTH_RAD = 2.5;

/** Unit direction toward the bench sun, written into `out` (no allocation). */
export function benchSunDirection(out: Vector3): Vector3 {
  const elevation = (BENCH_SUN_ELEVATION_DEG * Math.PI) / 180;
  return out.set(
    Math.cos(BENCH_SUN_AZIMUTH_RAD) * Math.cos(elevation),
    Math.sin(elevation),
    Math.sin(BENCH_SUN_AZIMUTH_RAD) * Math.cos(elevation),
  );
}

/** Direction toward the Earth in the default view. */
export function benchEarthDirection(out: Vector3): Vector3 {
  return out.set(0.3, 0.3, 0.9).normalize();
}

export interface LookContext {
  readonly roots: SceneRoots;
  readonly renderer: RenderRendererService;
  /** `location.search`: the visuals look reads its per-feature knobs from it (`visuals` `parseLookKnobs`). */
  readonly search?: string;
}

export interface LookProvider {
  readonly id: BenchLookId;
  /** True when the look draws its own sun disk and Earth (the bench hides its stand-in sky bodies). */
  readonly ownsSky: boolean;
  /** Unit direction toward the key light; fixed in the bench. The scene feeds it to the terrain's horizon term. */
  readonly keyDirection: Vector3;
  /** Rebuilds what depends on the preset (cascades, shadow map, post chain) and installs the post stages. */
  applyQuality(settings: QualitySettings): void;
  /** Once per frame, after the camera pose is final and before the render. */
  update(frame: FrameInfo, camera: PerspectiveCamera): void;
  /** Names of the post nodes of the current chain. */
  postPasses(): readonly string[];
  /** Number of shadow cascades of the current chain. */
  cascadeCount(): number;
  /** URL knobs in effect that differ from the shipped look (`default` when none; the v0 look has none). */
  describeKnobs?(): string;
  dispose(): void;
}

export type LookFactory = (id: BenchLookId, context: LookContext) => LookProvider;

export function parseBenchLook(search: string): BenchLookId {
  const raw = new URLSearchParams(search).get("look")?.trim().toLowerCase() ?? "";
  return BENCH_LOOK_IDS.find((id) => id === raw) ?? BENCH_DEFAULT_LOOK;
}
