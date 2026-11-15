// Look-dev scene S05 "shadow lab" (visual-target 6.2): 1 m post, 0.5 m boulder, a custodian proxy, a 20 degree ramp (facing away
// from the sun by default), a wall and two shade canopies, all on flat clean ground. Selected by `?scene=s05`; the sun comes
// from `?sun=<elevation deg>&az=<azimuth deg>` (VT-M0-04b: 60 / 15 / 4 / 1), the view from `?view=<name>`.
// The ground is the REAL regolith material, all clean, no macro variation (`look-ground.ts`; `&ground=standin` = old, A/B).
//
// Layout (camera looks +z, camera right = world -x): post (0,0,0), boulder (0,0,8), custodian (0,0,-8), wall (8,0,0) with its
// shaded face toward +z, flat canopy (14,5,-8), ramp group at (-22,0,0) with its own post, boulder and boots on the hinge and
// a canopy over the half of the ramp that is above the ground (`s05-geometry.ts`; `&rampcanopy=m0` = the M0 placement, A/B).
//
// Probes (`__mcLook.probes()`), all on surfaces the camera can see:
//   flatLit / flatShadow     flat ground in the sun / under the flat canopy
//   slopeLit                 the ramp's visible face, in the sun
//   rampShadow               centre of the ramp canopy's shadow wherever it lands (ramp face, else the flat ground)
//   slopeShadow              the same point, reported ONLY while it is on the ramp face (VT-M0-16 "slope facing away")
//   slopeBoots               the custodian's feet on the hinge
//   wallLit / wallShadow     the wall face toward / away from the sun, each reported only to a camera in front of it

import { BoxGeometry, Group, Mesh, Vector3 } from "three/webgpu";
import { wantsStandInGround } from "./look-ground";
import {
  S05_CANOPY_EDGE_M,
  RAMP_CANOPY_HEIGHT_M,
  RAMP_CANOPY_X_M0,
  RAMP_CANOPY_Z_M,
  RAMP_CENTRE_X,
  RAMP_HALF_X_M,
  RAMP_HALF_Z_M,
  RAMP_TILT_DEG,
  S05_GROUND_RADIUS_M,
  rampCanopyLocalX,
  rampCanopyShadow,
  rampPoint,
  rampVisibleSide,
  wallProbe,
} from "./s05-geometry";
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

export { RAMP_CENTRE_X, RAMP_TILT_DEG } from "./s05-geometry";

const DEG = Math.PI / 180;

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
  /** Ramp-local x of the ramp canopy's centre. */
  readonly rampCanopyX: number;

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
    this.rampCanopyX =
      (params.get("rampcanopy") ?? "").toLowerCase() === "m0" ? RAMP_CANOPY_X_M0 : rampCanopyLocalX(this.tilt);

    const kit = new SceneKit(ctx.roots, "mc:look-s05", { allClean: true, standIn: wantsStandInGround(params) });
    this.kit = kit;
    kit.addGround(S05_GROUND_RADIUS_M, undefined, ...capResolution(params));
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
    const slab = new Mesh(kit.own(new BoxGeometry(RAMP_HALF_X_M * 2, 0.6, RAMP_HALF_Z_M * 2)), kit.ground.material);
    slab.position.y = -0.3;
    slab.castShadow = true;
    slab.receiveShadow = true;
    ramp.add(
      slab,
      placed(props.post(1), 0, 0, 0),
      placed(props.boulder(0.5, 9), 0, 0, 8),
      placed(props.custodian(), 0, 0, -8),
    );
    ramp.add(canopy(kit, this.rampCanopyX, RAMP_CANOPY_HEIGHT_M, RAMP_CANOPY_Z_M));
    group.add(ramp);

    const side = rampVisibleSide(this.tilt);
    this.probes = {
      flatLit: () => [4, 0, -3],
      flatShadow: (s) => shadowUnder(s, [14, 5, -8], this._dir, this._p),
      slopeLit: () => rampPoint(this.tilt, side * 3, 0, -5),
      rampShadow: (s) => rampCanopyShadow(this.tilt, this.rampCanopyX, s)?.point ?? null,
      slopeShadow: (s) => {
        const hit = rampCanopyShadow(this.tilt, this.rampCanopyX, s);
        return hit !== null && hit.onRamp ? hit.point : null;
      },
      slopeBoots: () => rampPoint(this.tilt, 0, 0, -8),
      wallShadow: (s) => wallProbe("shadow", s, ctx.roots.camera.position.z),
      wallLit: (s) => wallProbe("lit", s, ctx.roots.camera.position.z),
    };
    this.setView(params.get("view") ?? "wide");
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
  const slab = new Mesh(kit.own(new BoxGeometry(S05_CANOPY_EDGE_M, 0.15, S05_CANOPY_EDGE_M)), kit.props.ivory);
  slab.name = "mc:look-canopy";
  slab.castShadow = true;
  slab.position.set(x, y, z);
  return slab;
}
