// Look-dev scene S06 "night shift" (visual-target 6.2): near-side midnight. Full Earth is the key (the sun's CSM is re-pointed
// at it), earthlit ground, dense stars, a shadowed Crown Lamp pool 5 m ahead of the custodian, warm outpost floods.
// `?scene=s06&view=pool|wide`. Ground: the REAL regolith material on a stamped mask (`look-ground.ts`; `&ground=standin` = old).

import type { QualitySettings } from "@moon-cleanup/shared";
import { Color, PointLight, SpotLight, type Object3D } from "three/webgpu";
import { EV100, preExposureScale } from "../lighting/key-light";
import { LocalPointLight, LocalSpotLight, configureLampShadow, markLampCasters } from "../lighting/local-lights";
import { createCrownLamp, CROWN_LAMP_LEVELS, updateCrownLamp } from "../lighting/crown-lamp";
import { defaultShadowFilter } from "../lighting/sun-rig";
import { wantsStandInGround } from "./look-ground";
import { s01Height } from "./s01-approach";
import { SceneKit, capResolution, type LookScene, type Pose, type ProbeFn, type SceneContext } from "./scene-base";

export const S06_VIEWS: Readonly<Record<string, Pose>> = {
  pool: { position: [0.6, 2.3, -5.2], target: [0, 0.5, 4] },
  wide: { position: [-9, 3.6, -9], target: [0, 1.8, 14] },
};

/** The cleaned patch around the outpost: Lane Broom rows filling this disk. */
export const S06_CLEAN_CENTRE: readonly [number, number] = [0, 8];
export const S06_CLEAN_RADIUS_M = 38;

/** Crown Lamp "Spot Ring" (art-direction 2.2): 22,000 cd, 30 degree cone. */
export const SPOT_RING_CD = 22_000;

/**
 * Cost-split switches of the scene (`&off=<comma list>`, profiling only): `lampshadow` (the Crown Lamp casts nothing),
 * `lamp`, `flood`, `glow` (the light is not added at all).
 */
export function s06Off(params: URLSearchParams): ReadonlySet<string> {
  return new Set(
    (params.get("off") ?? "")
      .toLowerCase()
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s !== ""),
  );
}

export class S06Night implements LookScene {
  readonly id = "s06";
  readonly views = Object.keys(S06_VIEWS);
  readonly probes: Record<string, ProbeFn> = {
    pool: () => [0, 0, 5],
    earthlit: () => [8, 0, -4],
  };

  private readonly kit: SceneKit;
  private readonly ctx: SceneContext;
  private readonly lamp: SpotLight;
  private readonly flood: SpotLight;
  private readonly glow: PointLight;
  private readonly lamps: Object3D[] = [];
  private readonly lampResOverride: number;

  constructor(ctx: SceneContext) {
    this.ctx = ctx;
    const { state, params } = ctx;
    // Earth full and high over the outpost; the sun is straight behind it, below the horizon.
    state.earthElevationDeg = 24;
    state.earthDiameterDeg = Number(params.get("earthDeg") ?? 4.2);
    state.earthAzimuthDeg = 90;
    state.sunElevationDeg = -24;
    state.sunAzimuthDeg = 270;
    state.sunRateDegPerS = 0;

    const kit = new SceneKit(ctx.roots, "mc:look-s06", {
      cleanCentre: S06_CLEAN_CENTRE,
      cleanRadiusM: S06_CLEAN_RADIUS_M,
      macroVariation: 1,
      standIn: wantsStandInGround(params),
    });
    this.kit = kit;
    kit.addGround(180, s01Height, ...capResolution(params));
    const { props, group } = kit;

    const outpost = props.outpost();
    outpost.position.set(0, SceneKit.surfaceY(0, 8, s01Height), 12);
    group.add(outpost);
    const custodian = props.custodian();
    custodian.position.set(0, SceneKit.surfaceY(0, 0, s01Height), 0);
    group.add(custodian);
    group.add(
      props.boulderField(160, 120, (x, z) => SceneKit.surfaceY(x, z, s01Height), [
        [0, 12, 11],
        [0, 0, 1.5],
      ]),
    );

    const scale = preExposureScale(EV100.nightNear);
    // Own Crown Lamp: shadowed spot at the helmet crown, aimed 5 m ahead on the ground.
    // Range-culled local lights (`lighting/local-lights.ts`); `&lights=plain` = three's own nodes (A/B captures).
    const plain = (params.get("lights") ?? "").toLowerCase() === "plain";
    const Spot = plain ? SpotLight : LocalSpotLight;
    const Point = plain ? PointLight : LocalPointLight;
    const off = s06Off(params);
    // Own-lamp shadow map: the preset's size (rendering-pipeline 14.1: Low 512, Medium / High 1024, Ultra 2048).
    // `&lampres=<px>` overrides it (A/B captures).
    this.lampResOverride = Number(params.get("lampres") ?? 0) > 0 ? Number(params.get("lampres")) : 0;
    const lampSize = this.lampResOverride || (ctx.quality?.shadows.ownLampShadowSizePx ?? 1024);
    const lampFilter = ctx.quality === undefined ? "vogel5" : defaultShadowFilter(ctx.quality);
    // `&lampshadow=plain` = every object casts and three's own filter; `&lights=plain` = three's own light nodes (A/B captures).
    const plainShadow = (params.get("lampshadow") ?? "").toLowerCase() === "plain";
    let lamp: SpotLight;
    if (!plain && !plainShadow) {
      // The game's lamp: the Crown Lamp hook at L2 Spot Ring (`lighting/crown-lamp.ts`), range 20 m, props-only shadow pass.
      lamp = createCrownLamp(CROWN_LAMP_LEVELS["spot-ring"], { shadowSizePx: lampSize, shadowFilter: lampFilter });
      markLampCasters(group, (object) => object.name === "mc:look-ground");
      updateCrownLamp(lamp, scale, true);
    } else {
      lamp = new Spot(new Color(1.0, 0.906, 0.784), SPOT_RING_CD * scale, 60, (30 * Math.PI) / 180, 0.4, 2);
      lamp.name = "mc:crown-lamp";
      lamp.shadow.mapSize.set(lampSize, lampSize);
      if (!plainShadow) {
        markLampCasters(group, (object) => object.name === "mc:look-ground");
        configureLampShadow(lamp, lampSize, lampFilter);
      }
      lamp.shadow.camera.near = 0.3;
      lamp.shadow.camera.far = 40;
      lamp.shadow.bias = -0.0002;
      lamp.shadow.normalBias = 0.02;
    }
    lamp.position.set(0, 1.62, 0.15);
    lamp.target.position.set(0, 0, 5);
    lamp.castShadow = !off.has("lampshadow");
    // Outpost work light: warm, unshadowed, range clamped (rendering-pipeline 5.1).
    const flood = new Spot(new Color(1.0, 0.85, 0.66), 40_000 * scale, 24, (50 * Math.PI) / 180, 0.6, 2);
    flood.name = "mc:outpost-flood";
    flood.position.set(-6, 5.3 + SceneKit.surfaceY(0, 8, s01Height), 13.4);
    flood.target.position.set(-3, 0, 6);
    const glow = new Point(new Color(1.0, 0.8, 0.55), 900 * scale, 9, 2);
    glow.name = "mc:outpost-door-glow";
    glow.position.set(0, 2.4, 9.5);
    if (!off.has("lamp")) this.lamps.push(lamp, lamp.target);
    if (!off.has("flood")) this.lamps.push(flood, flood.target);
    if (!off.has("glow")) this.lamps.push(glow);
    ctx.roots.scene.add(...this.lamps);
    this.lamp = lamp;
    this.flood = flood;
    this.glow = glow;
    this.setView(params.get("view") ?? "pool");
  }

  setView(name: string): void {
    const pose = S06_VIEWS[name] ?? S06_VIEWS["pool"];
    if (pose !== undefined) this.kit.applyPose(this.ctx.roots.camera, pose);
  }

  applyQuality(settings: QualitySettings): void {
    const size = this.lampResOverride || settings.shadows.ownLampShadowSizePx;
    if (this.lamp.shadow.mapSize.width !== size) this.lamp.shadow.mapSize.set(size, size);
  }

  update(): void {
    // Static scene.
  }

  dispose(): void {
    for (const o of this.lamps) o.removeFromParent();
    this.lamp.dispose();
    this.flood.dispose();
    this.glow.dispose();
    this.kit.dispose();
  }
}
