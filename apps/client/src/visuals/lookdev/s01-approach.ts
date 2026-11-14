// Look-dev scene S01 "outpost approach" (visual-target 6.2): a chunky outpost on a patch cleaned in Lane Broom passes (rows
// that fill a 22 m disk, stepped lane ends, a lit berm along every edge), passes in progress cutting into the grimy dark
// regolith in front of it (the lit-vs-clean contrast of views `a` / `b`), craters, a boulder field, a custodian proxy and
// the Earth low over the horizon.
// `?scene=s01&time=dawn|noon|morning&view=a|b|wide|close&earthDeg=<deg>`. `a` looks up-sun, `b` down-sun.
// The ground is the REAL regolith material on a stamped mask (`look-ground.ts`; `&ground=standin` = the old stand-in, A/B).
//
// VT-M0-15 spike: `&terrain=<base url of assets/terrain/>` replaces the procedural ground with the baked LOLA height cube
// around the +Y pole and adds the baked horizon map (far terrain shadows past the CSM range), and `setView("fly:<0..1>")`
// moves the camera along the P4 flyover (30 m altitude, 300 m line).

import { Mesh } from "three/webgpu";
import type { StrokeSpec } from "../materials";
import { buildCapGeometry } from "./cap-geometry";
import { wantsStandInGround } from "./look-ground";
import {
  SceneKit,
  capResolution,
  numberParam,
  type LookScene,
  type Pose,
  type ProbeFn,
  type SceneContext,
} from "./scene-base";
import {
  addHorizonAttributes,
  capHeightFromCube,
  createHorizonVisibility,
  loadTerrain,
  type HorizonVisibility,
  type TerrainData,
} from "./terrain-patch";

export const S01_VIEWS: Readonly<Record<string, Pose>> = {
  a: { position: [-3, 2.1, -23], target: [0, 2.2, 6] },
  b: { position: [-3, 2.1, -23], target: [0, 2.2, 6] },
  wide: { position: [-18, 5.5, -30], target: [0, 1.5, 6] },
  close: { position: [-2.2, 1.45, -7], target: [0, 0.2, -3] },
};

/** The cleaned patch: Lane Broom rows filling this disk. */
export const S01_CLEAN_CENTRE: readonly [number, number] = [0, 8];
export const S01_CLEAN_RADIUS_M = 22;
/** Probe on the cleaned patch (visible from views `a`, `b` and `wide`). */
export const S01_CLEAN_PROBE: readonly [number, number] = [-4, -8];
/**
 * Work in progress around the patch, all in the dust between the patch (front edge 10 m ahead of views `a` / `b`) and the
 * camera: one pass walked from the patch toward the camera, two short passes on a 2.2 m pitch to its left (a dust ridge
 * with its berm stays between them), Desk Duster scribbles to its right, and one lane leaving the patch to the east.
 */
export const S01_EXTRA_STROKES: readonly StrokeSpec[] = [
  { x0: 2.5, z0: -13.5, x1: 0.5, z1: -20, widthM: 1.6 },
  { x0: -5.5, z0: -15.4, x1: -13, z1: -15.4, widthM: 1.6 },
  { x0: -13, z0: -17.6, x1: -7.5, z1: -17.6, widthM: 1.6 },
  { x0: 4.2, z0: -17.2, x1: 5.8, z1: -16.1, widthM: 0.15, bermHeightM: 0.015, bermWidthM: 0.06 },
  { x0: 4.7, z0: -17.4, x1: 6.3, z1: -18.5, widthM: 0.15, bermHeightM: 0.015, bermWidthM: 0.06 },
  { x0: 5.2, z0: -17.3, x1: 6.8, z1: -16.2, widthM: 0.15, bermHeightM: 0.015, bermWidthM: 0.06 },
  { x0: 19, z0: 2, x1: 26, z1: 0.5, widthM: 1.6 },
];

/** Smooth bowl with a raised rim: the crater profile of the look-dev ground. */
export function craterHeight(x: number, z: number, cx: number, cz: number, radius: number, depth: number): number {
  const d = Math.hypot(x - cx, z - cz) / radius;
  if (d > 1.6) return 0;
  const bowl = d < 1 ? -depth * (1 - d * d) : 0;
  const rim = depth * 0.28 * Math.exp(-Math.pow((d - 1.08) / 0.22, 2));
  return bowl + rim;
}

const CRATERS: readonly (readonly [number, number, number, number])[] = [
  [38, 60, 24, 2.2],
  [-62, 35, 16, 1.4],
  [14, 135, 44, 3.6],
  [-30, -70, 12, 0.9],
  [70, -10, 20, 1.6],
];

export function s01Height(x: number, z: number): number {
  let h = 0.25 * Math.sin(x * 0.045 + 1.3) * Math.cos(z * 0.038) + 0.12 * Math.sin(x * 0.11 + z * 0.09);
  for (const [cx, cz, r, d] of CRATERS) h += craterHeight(x, z, cx, cz, r, d);
  // Flatten under the outpost so the hab sits level.
  const dist = Math.hypot(x, z - 6);
  const k = Math.min(1, Math.max(0, (dist - 9) / 9));
  return h * k * k * (3 - 2 * k);
}

/** P4 flyover pose at t in [0, 1]: 300 m along +z at 30 m altitude, pitched 8 degrees down. */
export function flyoverPose(t: number): Pose {
  const z = -150 + 300 * Math.min(1, Math.max(0, t));
  return { position: [0, 30, z], target: [0, 30 - Math.tan((8 * Math.PI) / 180) * 60, z + 60] };
}

export class S01Approach implements LookScene {
  readonly id = "s01";
  readonly views = [...Object.keys(S01_VIEWS), "fly:<t>"];
  readonly probes: Record<string, ProbeFn> = {
    clean: () => [S01_CLEAN_PROBE[0], 0, S01_CLEAN_PROBE[1]],
    grime: () => [-6, 0, 70],
  };

  horizon: HorizonVisibility | null = null;
  ready = true;

  private kit: SceneKit | null = null;
  private height: (x: number, z: number) => number = s01Height;
  private readonly ctx: SceneContext;
  private viewName: string;
  private disposed = false;

  constructor(ctx: SceneContext) {
    this.ctx = ctx;
    const { params, state } = ctx;
    const time = params.get("time") ?? "noon";
    this.viewName = params.get("view") ?? "a";
    const up = this.viewName === "a" || this.viewName === "wide" || this.viewName.startsWith("fly");
    state.sunElevationDeg = numberParam(
      params,
      "sun",
      time === "dawn" || time === "dusk" ? 4 : time === "morning" ? 30 : 60,
    );
    state.sunAzimuthDeg = numberParam(params, "az", up ? 100 : 270);
    state.earthElevationDeg = numberParam(params, "earthEl", up ? 17 : 13);
    state.earthAzimuthDeg = numberParam(params, "earthAz", up ? 48 : 76);
    state.earthDiameterDeg = numberParam(params, "earthDeg", 4.2);
    state.sunRateDegPerS = numberParam(params, "rate", 0);

    this.build(null);
    const base = params.get("terrain");
    if (base !== null && base !== "") {
      this.ready = false;
      loadTerrain(base).then(
        (data) => {
          if (this.disposed) return;
          this.build(data);
          this.ready = true;
        },
        (error: unknown) => {
          console.error("[look] terrain load failed", error);
          this.ready = true;
        },
      );
    }
  }

  /** (Re)builds the ground and the props, procedural when `data` is null, baked terrain otherwise. */
  private build(data: TerrainData | null): void {
    this.kit?.dispose();
    const horizon = data === null ? null : createHorizonVisibility();
    this.horizon = horizon;
    const kit = new SceneKit(this.ctx.roots, "mc:look-s01", {
      cleanCentre: S01_CLEAN_CENTRE,
      cleanRadiusM: S01_CLEAN_RADIUS_M,
      extraStrokes: S01_EXTRA_STROKES,
      macroVariation: 1,
      standIn: wantsStandInGround(this.ctx.params),
      ...(horizon === null ? {} : { horizonVisibility: horizon.node }),
    });
    this.kit = kit;
    const height = data === null ? s01Height : capHeightFromCube(data.height);
    this.height = height;
    this.addGround(kit, data, height);

    const { props, group } = kit;
    const outpost = props.outpost();
    outpost.position.set(0, SceneKit.surfaceY(0, 8, height), 8);
    group.add(outpost);
    const custodian = props.custodian();
    custodian.position.set(-2.4, SceneKit.surfaceY(-2.4, -3, height), -3);
    custodian.rotation.y = 0.5;
    group.add(custodian);
    group.add(
      props.boulderField(230, 150, (x, z) => SceneKit.surfaceY(x, z, height), [
        [0, 8, 11],
        [-2.4, -3, 2],
        [-3, -24, 4],
      ]),
    );
    this.setView(this.viewName);
  }

  private addGround(kit: SceneKit, data: TerrainData | null, height: (x: number, z: number) => number): Mesh {
    if (data === null) return kit.addGround(180, height, ...capResolution(this.ctx.params));
    // The flyover needs ~700 m of ground: build the cap here so the horizon attributes go on its geometry.
    const geometry = kit.own(buildCapGeometry({ radiusM: 720, height }));
    addHorizonAttributes(geometry, data.horizon);
    const mesh = new Mesh(geometry, kit.ground.material);
    mesh.name = "mc:look-ground";
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    kit.group.add(mesh);
    return mesh;
  }

  setView(name: string): void {
    this.viewName = name;
    const kit = this.kit;
    if (kit === null) return;
    const camera = this.ctx.roots.camera;
    if (name.startsWith("fly:")) {
      const t = Number(name.slice(4));
      const pose = flyoverPose(Number.isFinite(t) ? t : 0);
      const y = SceneKit.surfaceY(pose.position[0], pose.position[2], this.height);
      kit.applyPose(camera, {
        position: [pose.position[0], pose.position[1] + y, pose.position[2]],
        target: [pose.target[0], pose.target[1] + y, pose.target[2]],
      });
      return;
    }
    const pose = S01_VIEWS[name] ?? S01_VIEWS["a"];
    if (pose !== undefined) {
      const y = SceneKit.surfaceY(pose.position[0], pose.position[2], this.height);
      kit.applyPose(camera, {
        ...pose,
        position: [pose.position[0], pose.position[1] + Math.max(y, -1), pose.position[2]],
      });
    }
  }

  update(): void {
    // Static scene.
  }

  dispose(): void {
    this.disposed = true;
    this.kit?.dispose();
    this.kit = null;
  }
}
