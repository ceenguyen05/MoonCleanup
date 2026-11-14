// Shared plumbing of the look-dev scenes S01, S05, S06: the scene contract, the shared sun / Earth state, the ground mesh and
// camera views. A scene adds its objects under `roots.world`, owns them, and removes them in `dispose()`.

import { Group, Mesh, type BufferGeometry, type MeshStandardNodeMaterial, type PerspectiveCamera } from "three/webgpu";
import type { QualitySettings } from "@moon-cleanup/shared";
import type { SceneRoots } from "../../render";
import { buildCapGeometry, sphereDrop } from "./cap-geometry";
import { createLookGround, type LookGround, type LookGroundOptions } from "./look-ground";
import { LookProps } from "./props";
import type { HorizonVisibility } from "./terrain-patch";

/** The sun and the Earth in the local frame (azimuth from +X toward +Z, elevation from the horizon). */
export interface LookState {
  sunElevationDeg: number;
  sunAzimuthDeg: number;
  earthElevationDeg: number;
  earthAzimuthDeg: number;
  /** Sun elevation change per second (VT-M0-04b moves it 0.1 deg/s). */
  sunRateDegPerS: number;
  earthDiameterDeg: number;
}

export interface Pose {
  readonly position: readonly [number, number, number];
  readonly target: readonly [number, number, number];
  readonly fovDeg?: number;
}

export interface SceneContext {
  readonly roots: SceneRoots;
  readonly params: URLSearchParams;
  readonly state: LookState;
  /** Quality settings in force when the scene is built (lamp shadow size and the like); absent in tests. */
  readonly quality?: QualitySettings;
}

/** A named world point a check measures (patch centre), recomputed when the sun moves. */
export type ProbeFn = (state: Readonly<LookState>) => readonly [number, number, number];

export interface LookScene {
  readonly id: string;
  /** Far-occluder (horizon map) visibility of the scene's ground, when it has one (VT-M0-15 spike). */
  readonly horizon?: HorizonVisibility | null;
  /** `true` once async content (the baked terrain) has been built. */
  readonly ready?: boolean;
  readonly views: readonly string[];
  readonly probes: Readonly<Record<string, ProbeFn>>;
  setView(name: string): void;
  /** Called when the quality preset changes (after construction), for what the scene sizes from it. */
  applyQuality?(settings: QualitySettings): void;
  update(dtS: number, timeS: number): void;
  dispose(): void;
}

export function numberParam(params: URLSearchParams, name: string, fallback: number): number {
  const raw = params.get(name);
  if (raw === null || raw.trim() === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Tessellation of a look scene's ground cap: 160 rings x 256 segments (82 k triangles, what `typical` runs) unless the URL
 * asks for the old 200 x 320 (128 k) with `&cap=dense` (A/B captures). The cap is drawn once per shadow cascade as well.
 */
export function capResolution(params: URLSearchParams): readonly [rings: number, segments: number] {
  return (params.get("cap") ?? "").toLowerCase() === "dense" ? [200, 320] : [160, 256];
}

export function createLookState(): LookState {
  return {
    sunElevationDeg: 60,
    sunAzimuthDeg: 200,
    earthElevationDeg: 14,
    earthAzimuthDeg: 70,
    sunRateDegPerS: 0,
    earthDiameterDeg: 4.2,
  };
}

/** Owns the ground mesh, the props factory and the root group of one scene. */
export class SceneKit {
  readonly group = new Group();
  readonly props = new LookProps();
  /** The scene's ground: the real regolith material on a stamped mask (`look-ground.ts`). */
  readonly ground: LookGround;
  private readonly geometries: BufferGeometry[] = [];
  private readonly extra: MeshStandardNodeMaterial[] = [];

  constructor(
    private readonly roots: SceneRoots,
    name: string,
    groundOptions: LookGroundOptions,
  ) {
    this.group.name = name;
    this.ground = createLookGround(groundOptions);
    roots.world.add(this.group);
  }

  /** Adds the cap ground (receives and casts shadows). */
  addGround(radiusM: number, height?: (x: number, z: number) => number, rings?: number, segments?: number): Mesh {
    const geometry = buildCapGeometry({
      radiusM,
      ...(height === undefined ? {} : { height }),
      ...(rings === undefined ? {} : { rings }),
      ...(segments === undefined ? {} : { segments }),
    });
    this.geometries.push(geometry);
    const mesh = new Mesh(geometry, this.ground.material);
    mesh.name = "mc:look-ground";
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    this.group.add(mesh);
    return mesh;
  }

  /** Ground height at (x, z) for a flat sphere cap with optional extra height. */
  static surfaceY(x: number, z: number, height?: (x: number, z: number) => number): number {
    return sphereDrop(Math.hypot(x, z), 2000) + (height?.(x, z) ?? 0);
  }

  /** Registers a geometry for disposal with the scene. */
  own<T extends BufferGeometry>(geometry: T): T {
    this.geometries.push(geometry);
    return geometry;
  }

  applyPose(camera: PerspectiveCamera, pose: Pose): void {
    camera.position.set(...pose.position);
    camera.lookAt(...pose.target);
    if (pose.fovDeg !== undefined && camera.fov !== pose.fovDeg) {
      camera.fov = pose.fovDeg;
      camera.updateProjectionMatrix();
    }
    camera.updateMatrixWorld();
  }

  dispose(): void {
    this.group.removeFromParent();
    for (const g of this.geometries.splice(0)) g.dispose();
    for (const m of this.extra.splice(0)) m.dispose();
    this.ground.dispose();
    this.props.dispose();
  }
}
