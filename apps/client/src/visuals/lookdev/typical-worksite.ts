// Look-dev / perf scene "typical worksite" (M0-W3-T08): what a solo player looks at most of the time, with NO stress content.
// An outpost, a cleaned patch of overlapping Lane Broom passes with a few separate lanes and hand strokes, one custodian,
// a handful of boulders and marker posts, gentle relief with distant craters, Earth over the horizon. The ground is the REAL
// regolith material (mask + detail tile, `visuals/materials`), not the S01 stand-in, so its cost is the game's.
// `?scene=typical&view=play|work|wide&sun=<deg>&az=<deg>&boulders=<n>`.
//
// It is the frame the per-device numbers are quoted on ("what can this GPU sustain in normal play"); the bench
// (`?scene=bench`) stays the worst case. The camera is static unless a camera path is applied from outside (tools/perf).

import { Group, Mesh } from "three/webgpu";
import type { SceneRoots } from "../../render";
import {
  createMaskBuffer,
  createMaskTextureFromBuffer,
  createRegolithMaterial,
  stampStroke,
  type MaskWorldRect,
  type RegolithMaterial,
  type StrokeSpec,
} from "../materials";
import { buildCapGeometry, sphereDrop } from "./cap-geometry";
import { LookProps } from "./props";
import { s01Height } from "./s01-approach";
import { numberParam, type LookScene, type Pose, type ProbeFn, type SceneContext } from "./scene-base";

export const TYPICAL_SCENE_ID = "typical";

/** Mask: 40 m x 40 m around the worksite, 1.95 cm texels at 2048^2 (the M1 ring is 2.5 cm). */
export const TYPICAL_MASK_RECT: MaskWorldRect = { originX: -20, originZ: -24, sizeX: 40, sizeZ: 40 };
export const TYPICAL_MASK_SIZE = 2048;
const OUTPOST: readonly [number, number] = [0, 9];
const CUSTODIAN: readonly [number, number] = [-2.4, -3];
const GROUND_RADIUS_M = 300;
const PLANET_RADIUS_M = 2000;

export const TYPICAL_VIEWS: Readonly<Record<string, Pose>> = {
  // Standing at the edge of the patch, outpost ahead: eye height, horizon in the upper third.
  play: { position: [-5.5, 1.7, -12.5], target: [0.5, 1.1, 4] },
  // Head down while cleaning: the ground fills the frame.
  work: { position: [-1.2, 1.7, -7.2], target: [-0.6, 0, -3.6] },
  wide: { position: [-16, 6, -24], target: [0, 1, 2] },
};

/** Strokes of the worksite in stamping order. Kept at least 1 m inside the mask rectangle. */
export function typicalStrokes(): StrokeSpec[] {
  const out: StrokeSpec[] = [];
  // The cleaned patch: 8 Lane Broom passes (1.6 m) on a 1.5 m pitch, so neighbours overlap by 10 cm and leave no ridge.
  for (let i = 0; i < 8; i++) {
    const z = -8 + i * 1.5;
    const ltr = i % 2 === 0;
    out.push({ x0: ltr ? -7 : 7, z0: z, x1: ltr ? 7 : -7, z1: z, widthM: 1.6 });
  }
  // Work in progress beyond the patch: three passes on a 2.2 m pitch (a dust ridge with its berm stays between them).
  for (let i = 0; i < 3; i++)
    out.push({ x0: -7, z0: -10.4 - i * 2.2, x1: 6 - i * 2, z1: -10.4 - i * 2.2, widthM: 1.6 });
  // The walked lane to the outpost door and one lane leaving the worksite.
  out.push({ x0: 0, z0: 3, x1: 0, z1: 7.2, widthM: 1.2 });
  out.push({ x0: 7, z0: -2, x1: 17, z1: -6, widthM: 1.6 });
  // Desk Duster scribbles in the dust next to the custodian.
  for (let i = 0; i < 5; i++) {
    out.push({
      x0: -11 + i * 0.45,
      z0: -4.6,
      x1: -11 + i * 0.45 + 1.6,
      z1: -4.6 + (i % 2 === 0 ? 1.1 : -1.1),
      widthM: 0.15,
      bermHeightM: 0.015,
      bermWidthM: 0.06,
    });
  }
  return out;
}

/** Ground height of the scene: the S01 relief (flat under the outpost, craters beyond about 30 m). */
export function typicalHeight(x: number, z: number): number {
  return s01Height(x, z - 3);
}

function surfaceY(x: number, z: number): number {
  return sphereDrop(Math.hypot(x, z), PLANET_RADIUS_M) + typicalHeight(x, z);
}

export class TypicalWorksite implements LookScene {
  readonly id = TYPICAL_SCENE_ID;
  readonly views = Object.keys(TYPICAL_VIEWS);
  readonly probes: Record<string, ProbeFn> = {
    clean: () => [2.5, surfaceY(2.5, -4.2), -4.2],
    grime: () => [11, surfaceY(11, -13), -13],
  };
  readonly ready = true;
  /** Texture fetches and distinct textures of the ground material (for the capture sidecar). */
  readonly groundFetches: number;
  readonly groundTextures: number;

  private readonly roots: SceneRoots;
  private readonly group = new Group();
  private readonly props = new LookProps();
  private readonly regolith: RegolithMaterial;
  private readonly owned: { dispose(): void }[] = [];

  constructor(ctx: SceneContext) {
    const { roots, params, state } = ctx;
    this.roots = roots;
    this.group.name = "mc:look-typical";
    roots.world.add(this.group);

    state.sunElevationDeg = numberParam(params, "sun", 38);
    state.sunAzimuthDeg = numberParam(params, "az", 165);
    state.earthElevationDeg = numberParam(params, "earthEl", 16);
    state.earthAzimuthDeg = numberParam(params, "earthAz", 62);
    state.earthDiameterDeg = numberParam(params, "earthDeg", 4.2);
    state.sunRateDegPerS = numberParam(params, "rate", 0);

    const buffer = createMaskBuffer(TYPICAL_MASK_SIZE, TYPICAL_MASK_SIZE, TYPICAL_MASK_RECT);
    for (const stroke of typicalStrokes()) stampStroke(buffer, stroke);
    const mask = createMaskTextureFromBuffer(buffer, { mipmaps: true, anisotropy: 4 });
    mask.name = "mc:typical-mask";
    this.owned.push(mask);
    this.regolith = createRegolithMaterial({
      mask,
      maskRect: TYPICAL_MASK_RECT,
      maskSize: [TYPICAL_MASK_SIZE, TYPICAL_MASK_SIZE],
      debugView: Math.max(0, Math.min(7, Math.round(numberParam(params, "dbg", 0)))),
    });
    this.groundFetches = this.regolith.fetchCount;
    this.groundTextures = this.regolith.textureBindings;

    const geometry = buildCapGeometry({ radiusM: GROUND_RADIUS_M, rings: 160, segments: 256, height: typicalHeight });
    this.owned.push(geometry);
    const ground = new Mesh(geometry, this.regolith.material);
    ground.name = "mc:typical-ground";
    ground.castShadow = true;
    ground.receiveShadow = true;
    ground.frustumCulled = false;
    this.group.add(ground);

    const { props, group } = this;
    const outpost = props.outpost();
    outpost.position.set(OUTPOST[0], surfaceY(OUTPOST[0], OUTPOST[1]), OUTPOST[1]);
    group.add(outpost);
    const custodian = props.custodian();
    custodian.position.set(CUSTODIAN[0], surfaceY(CUSTODIAN[0], CUSTODIAN[1]), CUSTODIAN[1]);
    custodian.rotation.y = 0.5;
    group.add(custodian);
    // Marker posts at the corners of the patch.
    for (const [x, z] of [
      [-7.8, -8.8],
      [7.8, -8.8],
      [-7.8, 3.3],
      [7.8, 3.3],
    ] as const) {
      const post = props.post(1);
      post.position.set(x, surfaceY(x, z), z);
      group.add(post);
    }
    const boulders = Math.max(0, Math.min(400, Math.round(numberParam(params, "boulders", 36))));
    if (boulders > 0) {
      group.add(
        props.boulderField(boulders, 70, surfaceY, [
          [0, -3, 11],
          [OUTPOST[0], OUTPOST[1], 9],
          [-5.5, -12.5, 3],
        ]),
      );
    }
    this.setView(params.get("view") ?? "play");
  }

  setView(name: string): void {
    const pose = TYPICAL_VIEWS[name] ?? TYPICAL_VIEWS["play"];
    if (pose === undefined) return;
    const camera = this.roots.camera;
    const y = surfaceY(pose.position[0], pose.position[2]);
    camera.position.set(pose.position[0], pose.position[1] + y, pose.position[2]);
    camera.lookAt(...pose.target);
    camera.updateMatrixWorld();
  }

  update(): void {
    // Static scene: a camera path, when wanted, is applied from outside (tools/perf `__mcCameraPath`).
  }

  dispose(): void {
    this.group.removeFromParent();
    this.regolith.dispose();
    for (const item of this.owned.splice(0)) item.dispose();
    this.props.dispose();
  }
}
