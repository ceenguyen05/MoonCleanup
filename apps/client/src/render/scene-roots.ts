// Scene graph roots and the main camera: the `sceneRoots` service.
// Camera numbers: docs/architecture/rendering-pipeline.md section 4 (reversed-Z near 0.05 m / far 30 km; without
// reversed-Z near 0.1 m / far 6 km for the surface camera).
//
// Ownership: render creates the roots and owns the camera's PROJECTION (aspect, near, far). Other modules add their
// objects under the root that fits and remove them in their own dispose(); gameplay's camera rig owns the camera's
// transform and field of view.

import { Group, PerspectiveCamera, Scene } from "three/webgpu";
import type { ViewportSize } from "@moon-cleanup/shared";

/** Surface-camera depth range with reversed-Z (section 4). */
export const CAMERA_NEAR_REVERSED_M = 0.05;
export const CAMERA_FAR_REVERSED_M = 30_000;
/** Surface-camera fallback without reversed-Z (WebGL2 without EXT_clip_control). */
export const CAMERA_NEAR_FALLBACK_M = 0.1;
export const CAMERA_FAR_FALLBACK_M = 6_000;
/** Default vertical field of view in degrees (section 14.1 quotes texel sizes at vFOV 60). */
export const CAMERA_DEFAULT_VFOV_DEG = 60;

/** Depth range for the surface camera. Pure. */
export function cameraDepthRange(reversedDepth: boolean): { readonly near: number; readonly far: number } {
  return reversedDepth
    ? { near: CAMERA_NEAR_REVERSED_M, far: CAMERA_FAR_REVERSED_M }
    : { near: CAMERA_NEAR_FALLBACK_M, far: CAMERA_FAR_FALLBACK_M };
}

/** The `sceneRoots` service. */
export interface SceneRoots {
  /** The one scene the main pass renders. No background: the clear is black and visuals/sky draws the sky. */
  readonly scene: Scene;
  /** Terrain, outpost, characters, vehicles, robots, props: everything lit and depth-tested in the world. */
  readonly world: Group;
  /** Sky objects (stars, Earth, sun disk), owned by visuals/sky. */
  readonly sky: Group;
  /** Particles and other effects, owned by visuals/vfx. */
  readonly vfx: Group;
  /** Debug helpers (F3 views), owned by debug. */
  readonly debug: Group;
  /** The main camera. */
  readonly camera: PerspectiveCamera;
}

export function createSceneRoots(): SceneRoots {
  const scene = new Scene();
  scene.name = "mc:scene";
  const world = new Group();
  world.name = "mc:world";
  const sky = new Group();
  sky.name = "mc:sky";
  const vfx = new Group();
  vfx.name = "mc:vfx";
  const debug = new Group();
  debug.name = "mc:debug";
  scene.add(world, sky, vfx, debug);

  const range = cameraDepthRange(true);
  const camera = new PerspectiveCamera(CAMERA_DEFAULT_VFOV_DEG, 1, range.near, range.far);
  camera.name = "mc:camera";
  // Eye height of a standing custodian until gameplay's camera rig takes over.
  camera.position.set(0, 1.7, 0);
  scene.add(camera);

  return { scene, world, sky, vfx, debug, camera };
}

/** Applies the viewport aspect and the depth range to the camera. Called on resize and renderer (re)creation. */
export function applyCameraProjection(camera: PerspectiveCamera, viewport: ViewportSize, reversedDepth: boolean): void {
  const range = cameraDepthRange(reversedDepth);
  if (viewport.widthCssPx > 0 && viewport.heightCssPx > 0) camera.aspect = viewport.widthCssPx / viewport.heightCssPx;
  camera.near = range.near;
  camera.far = range.far;
  camera.updateProjectionMatrix();
}
