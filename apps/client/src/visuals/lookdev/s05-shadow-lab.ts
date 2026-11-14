// Look-dev scene S05 "shadow lab" (visual-target 6.2): 1 m post, 0.5 m boulder, a custodian proxy, a 20 degree ramp (facing away
// from the sun by default), a wall and two shade canopies, all on flat clean ground. Selected by `?scene=s05`; the sun comes
// from `?sun=<elevation deg>&az=<azimuth deg>` (VT-M0-04b: 60 / 15 / 4 / 1), the view from `?view=<name>`.
// The ground is the REAL regolith material, all clean, no macro variation (`look-ground.ts`; `&ground=standin` = old, A/B).
//
// Layout (camera looks +z, camera right = world -x): post (0,0,0), boulder (0,0,8), custodian (0,0,-8), wall (8,0,0) with its
// shaded face toward +z, flat canopy (14,5,-8), ramp group at (-22,0,0) with its own post, boulder, boots and canopy.

import { BoxGeometry, Group, Mesh, Vector3 } from "three/webgpu";
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
import { directionFromAzEl } from "../sky/sky-math";

const DEG = Math.PI / 180;
export const RAMP_CENTRE_X = -22;
export const RAMP_TILT_DEG = 20;

export const S05_VIEWS: Readonly<Record<string, Pose>> = {
  wide: { position: [0, 3.4, -19], target: [0, 0.9, 0] },
  post: { position: [0, 1.5, -3], target: [0, 0.5, 0] },
  boulder: { position: [0, 1.4, 4.5], target: [0, 0.3, 8] },
  boots: { position: [-0.3, 1.2, -12], target: [0, 0.15, -8] },
  slope: { position: [RAMP_CENTRE_X, 3.2, -15], target: [RAMP_CENTRE_X, 0.7, 0] },
  wall: { position: [8, 1.7, 7.5], target: [8, 1.1, 0] },
  shade: { position: [14, 3.2, -18], target: [14, 0, -8] },
  shadeSlope: { position: [RAMP_CENTRE_X, 5.2, -10], target: [RAMP_CENTRE_X, 0, 3] },
};

export class S05ShadowLab implements LookScene {
  readonly id = "s05";
  readonly views = Object.keys(S05_VIEWS);
  readonly probes: Record<string, ProbeFn>;

  private readonly kit: SceneKit;
  private readonly ctx: SceneContext;
  private readonly tilt: number;
  private readonly _dir = new Vector3();
  private readonly _p = new Vector3();

  constructor(ctx: SceneContext) {
    this.ctx = ctx;
    const { params, state } = ctx;
    state.sunElevationDeg = numberParam(params, "sun", 60);
    state.sunAzimuthDeg = numberParam(params, "az", 200);
    state.sunRateDegPerS = numberParam(params, "rate", 0);
    state.earthElevationDeg = 32;
    state.earthAzimuthDeg = 60;
    this.tilt = (params.get("slope") === "toward" ? 1 : -1) * RAMP_TILT_DEG * DEG;

    const kit = new SceneKit(ctx.roots, "mc:look-s05", { allClean: true, standIn: wantsStandInGround(params) });
    this.kit = kit;
    kit.addGround(170, undefined, ...capResolution(params));
    const { props, group } = kit;

    group.add(placed(props.post(1), 0, 0, 0));
    group.add(placed(props.boulder(0.5, 7), 0, 0, 8));
    group.add(placed(props.custodian(), 0, 0, -8));
    group.add(placed(props.wall(), 8, 0, 0));
    group.add(canopy(kit, 14, 5, -8));

    const ramp = new Group();
    ramp.name = "mc:look-ramp";
    ramp.position.set(RAMP_CENTRE_X, 0, 0);
    ramp.rotation.z = this.tilt;
    const slab = new Mesh(kit.own(new BoxGeometry(14, 0.6, 22)), kit.ground.material);
    slab.position.y = -0.3;
    slab.castShadow = true;
    slab.receiveShadow = true;
    ramp.add(
      slab,
      placed(props.post(1), 0, 0, 0),
      placed(props.boulder(0.5, 9), 0, 0, 8),
      placed(props.custodian(), 0, 0, -8),
    );
    ramp.add(canopy(kit, -3, 5, 2));
    group.add(ramp);

    this.probes = {
      flatLit: () => [4, 0, -3],
      flatShadow: (s) => shadowUnder(s, [14, 5, -8], this._dir, this._p),
      slopeLit: () => this.rampPoint(3, 0, -5),
      slopeShadow: (s) => this.rampShadow(s),
      slopeBoots: () => this.rampPoint(0, 0, -8),
      wallShadow: () => [8, 1.2, 0.17],
      wallLit: () => [8, 1.2, -0.17],
    };
    this.setView(params.get("view") ?? "wide");
  }

  /** World position of the ramp surface at local (x, 0, z). */
  private rampPoint(x: number, y: number, z: number): readonly [number, number, number] {
    const c = Math.cos(this.tilt);
    const s = Math.sin(this.tilt);
    return [RAMP_CENTRE_X + x * c - y * s, x * s + y * c, z];
  }

  /** Where the ramp canopy's shadow centre falls on the ramp plane. */
  private rampShadow(
    state: Readonly<{ sunElevationDeg: number; sunAzimuthDeg: number }>,
  ): readonly [number, number, number] {
    const dir = makeDir(state, this._dir);
    // Canopy centre in world space: ramp-local (-3, 5, 2).
    const top = this.rampPoint(-3, 5, 2);
    // Plane through the ramp centre with normal n = (-sin t, cos t, 0).
    const nx = -Math.sin(this.tilt);
    const ny = Math.cos(this.tilt);
    const denom = dir.x * nx + dir.y * ny + dir.z * 0;
    const t = ((RAMP_CENTRE_X - top[0]) * nx + (0 - top[1]) * ny) / denom;
    return [top[0] + dir.x * t, top[1] + dir.y * t, top[2] + dir.z * t];
  }

  setView(name: string): void {
    const pose = S05_VIEWS[name] ?? S05_VIEWS["wide"];
    if (pose !== undefined) this.kit.applyPose(this.ctx.roots.camera, pose);
  }

  update(): void {
    // Static scene; the sun moves through the shared state.
  }

  dispose(): void {
    this.kit.dispose();
  }
}

function makeDir(state: Readonly<{ sunElevationDeg: number; sunAzimuthDeg: number }>, out: Vector3): Vector3 {
  const d = directionFromAzEl(state.sunAzimuthDeg, state.sunElevationDeg, { x: 0, y: 0, z: 0 });
  return out.set(d.x, d.y, d.z);
}

/** Ground point in the shadow of a canopy centred at `top`: the sun ray through the centre hits y = 0. */
function shadowUnder(
  state: Readonly<{ sunElevationDeg: number; sunAzimuthDeg: number }>,
  top: readonly [number, number, number],
  dir: Vector3,
  out: Vector3,
): readonly [number, number, number] {
  makeDir(state, dir);
  const t = top[1] / Math.max(dir.y, 1e-3);
  out.set(top[0] - dir.x * t, 0, top[2] - dir.z * t);
  return [out.x, out.y, out.z];
}

function placed<T extends { position: Vector3 }>(object: T, x: number, y: number, z: number): T {
  object.position.x += x;
  object.position.y += y;
  object.position.z += z;
  return object;
}

function canopy(kit: SceneKit, x: number, y: number, z: number): Mesh {
  const slab = new Mesh(kit.own(new BoxGeometry(7, 0.15, 7)), kit.props.ivory);
  slab.name = "mc:look-canopy";
  slab.castShadow = true;
  slab.position.set(x, y, z);
  return slab;
}
