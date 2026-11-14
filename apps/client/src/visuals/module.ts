// The `visuals` ClientModule (M0-W3-T03): the look rig. Owns the sun / earthshine key with filtered cascades, the regolith
// fill, the sky (stars, Earth, sun disk) and the post look, and hosts the look-dev scenes (`?scene=`): S01 / S05 / S06, the
// regolith scenes S02 / S03 (they light themselves through this rig) and the `typical` worksite used for per-device numbers.
// It consumes the render module's services (`renderer`, `sceneRoots`, `quality`); it never mutates sim state.
//
// Per frame (before the render step, module-boundaries section 4): sun / Earth state -> key light -> exposure scale ->
// cascade bias -> sky placement -> camera-only velocity.
//
// Inactive for `?scene=bench|verify|smoke` (those scenes install their own lights and post chain).

import type { ClientModule, FrameInfo, ModuleContext, Unsubscribe } from "@moon-cleanup/shared";
import type { RenderServices } from "../render";
import { Vector3 } from "three/webgpu";
import { createKeyState, earthExposureGain, litFraction, resolveKey } from "./lighting/key-light";
import { SunRig } from "./lighting/sun-rig";
import { CameraOnlyVelocity } from "./post/camera-velocity";
import { createLookStages, LOOK_GRADE, NEUTRAL_GRADE, type LookGrade, type LookStageHandles } from "./post/look-stages";
import { applyLookKnobs, DEFAULT_LOOK_KNOBS, describeLookKnobs, parseLookKnobs, type LookKnobs } from "./look-knobs";
import { SkyRig } from "./sky/sky-rig";
import { limitingMagnitude } from "./sky/star-catalog";
import { directionFromAzEl } from "./sky/sky-math";
import { installLookHooks, type LookHookHost } from "./lookdev/hooks";
import { S01Approach } from "./lookdev/s01-approach";
import { S05ShadowLab } from "./lookdev/s05-shadow-lab";
import { S06Night } from "./lookdev/s06-night";
import { S02_SCENE_ID, S02Scene } from "./lookdev/s02-first-stroke";
import type { LookdevScene, LookdevSceneOptions } from "./lookdev/s02-lookdev-kit";
import { S03_SCENE_ID, S03Scene } from "./lookdev/s03-distance-ladder";
import { TYPICAL_SCENE_ID, TypicalWorksite } from "./lookdev/typical-worksite";
import { createLookState, type LookScene, type LookState } from "./lookdev/scene-base";
import { createGroundBumpHandle } from "./lookdev/bump-handle";

/** Scene ids this module routes; the composition root must not add its hello-world mesh for them. */
export const LOOKDEV_SCENE_IDS = ["s01", "s02", "s03", "s05", "s06", "typical"] as const;

/** Builds the S02 / S03 regolith look-dev scene of `id` (`null` for any other id). */
export function createLookdevScene(id: string, options: LookdevSceneOptions): LookdevScene | null {
  if (id === S02_SCENE_ID) return new S02Scene(options);
  if (id === S03_SCENE_ID) return new S03Scene(options);
  return null;
}
const FOREIGN_SCENES = new Set(["bench", "verify", "smoke"]);
/** Stars: limiting-magnitude cap per preset (rendering-pipeline section 14.1). */
const STAR_CAP: Record<string, number> = { low: 5.5, medium: 6.0, high: 6.5, ultra: 6.5 };

export interface VisualsModuleOptions {
  /** `location.search`; default: the page's. */
  readonly search?: string;
  /** Where `__mcLook` is installed; default `globalThis`. */
  readonly host?: LookHookHost;
}

export class VisualsModule implements ClientModule<RenderServices> {
  readonly id = "visuals" as const;
  readonly state: LookState = createLookState();

  private readonly options: VisualsModuleOptions;
  private active = false;
  private sceneId = "";
  private rig: SunRig | null = null;
  private sky: SkyRig | null = null;
  private scene: LookScene | null = null;
  /** S02 / S03: scenes with their own hooks (`__mcLookdev`) that set the sun in `state` and are lit by this rig. */
  private lookdev: LookdevScene | null = null;
  private stages: LookStageHandles | null = null;
  private readonly velocity = new CameraOnlyVelocity();
  private readonly key = createKeyState();
  private ctx: ModuleContext<RenderServices> | null = null;
  private appliedQuality: FrameInfo["quality"] | null = null;
  private readonly off: Unsubscribe[] = [];
  private removeHooks: (() => void) | null = null;
  /** Per-feature URL knobs (`look-knobs.ts`): `?sky=0` black space, `?grade=neutral` calibration grade, cost splits. */
  private knobs: LookKnobs = DEFAULT_LOOK_KNOBS;
  /** Grade set through `__mcLook.setGrade` (look-dev tuning); `null` = the URL's grade. */
  private gradeOverride: LookGrade | null = null;
  private readonly sunDir = new Vector3();
  private readonly earthDir = new Vector3();
  private readonly keyDir = new Vector3();
  private readonly _d = { x: 0, y: 0, z: 0 };

  constructor(options: VisualsModuleOptions = {}) {
    this.options = options;
  }

  init(ctx: ModuleContext<RenderServices>): void {
    this.ctx = ctx;
    const search = this.options.search ?? (typeof location === "undefined" ? "" : location.search);
    const params = new URLSearchParams(search);
    const sceneParam = (params.get("scene") ?? "").toLowerCase();
    if (FOREIGN_SCENES.has(sceneParam)) return;
    this.active = true;
    this.sceneId = sceneParam;
    this.knobs = parseLookKnobs(search);

    const renderer = ctx.services.get("renderer");
    const roots = ctx.services.get("sceneRoots");
    const quality = ctx.services.get("quality");

    this.rig = new SunRig(roots.scene);
    this.sky = new SkyRig(roots.sky, this.knobs);

    const sceneCtx = { roots, params, state: this.state, quality: quality.current };
    if (sceneParam === "s01") this.scene = new S01Approach(sceneCtx);
    else if (sceneParam === "s05") this.scene = new S05ShadowLab(sceneCtx);
    else if (sceneParam === "s06") this.scene = new S06Night(sceneCtx);
    else if (sceneParam === TYPICAL_SCENE_ID) this.scene = new TypicalWorksite(sceneCtx);
    else {
      this.lookdev = createLookdevScene(sceneParam, {
        roots,
        renderer,
        quality,
        search,
        host: { state: this.state, keyState: () => this.key },
      });
    }

    this.bindRenderer();
    this.off.push(renderer.onRecreated(() => this.bindRenderer()));

    const bump = createGroundBumpHandle(roots.world);
    this.removeHooks = installLookHooks(this.options.host ?? (globalThis as unknown as LookHookHost), {
      sceneId: this.sceneId,
      scene: () => this.scene,
      state: this.state,
      camera: roots.camera,
      viewport: () => renderer.viewport,
      info: () => ({
        keyMode: this.key.mode,
        ev100: this.key.ev100,
        cascades: this.rig?.cascadeInfo.map((c) => ({ ...c })) ?? [],
        preset: quality.current.preset,
        backend: renderer.backend,
        postPasses: this.stages?.passes.slice() ?? [],
        knobs: describeLookKnobs(this.knobs),
        skyDome: this.sky?.domeMode ?? "procedural",
        shadowFilter: this.rig?.shadowFilter ?? "vogel5",
      }),
      setGrade: (patch) => {
        // Kept across preset changes; a contrast other than 1 needs the chain built with the contrast term.
        const base = this.gradeOverride ?? this.baseGrade();
        this.gradeOverride = {
          saturation: patch.saturation ?? base.saturation,
          contrast: patch.contrast ?? base.contrast,
        };
        const stages = this.stages;
        if (stages === null) return;
        if (this.gradeOverride.contrast !== 1 && !stages.hasContrast) {
          this.applyQuality(quality.current);
          return;
        }
        stages.grade.saturation.value = this.gradeOverride.saturation;
        stages.grade.contrast.value = this.gradeOverride.contrast;
      },
      setBump: (strength) => bump(strength),
    });
  }

  update(frame: FrameInfo): void {
    if (!this.active || this.ctx === null) return;
    const roots = this.ctx.services.get("sceneRoots");
    const rig = this.rig;
    const sky = this.sky;
    if (rig === null || sky === null) return;
    if (frame.quality !== this.appliedQuality) this.applyQuality(frame.quality);

    const state = this.state;
    state.sunElevationDeg += state.sunRateDegPerS * frame.dt;
    this.scene?.update(frame.dt, frame.time);
    this.lookdev?.update(frame);

    const sun = directionFromAzEl(state.sunAzimuthDeg, state.sunElevationDeg, this._d);
    this.sunDir.set(sun.x, sun.y, sun.z);
    const earth = directionFromAzEl(state.earthAzimuthDeg, state.earthElevationDeg, this._d);
    this.earthDir.set(earth.x, earth.y, earth.z);
    const lit = litFraction(
      this.sunDir.x,
      this.sunDir.y,
      this.sunDir.z,
      this.earthDir.x,
      this.earthDir.y,
      this.earthDir.z,
    );
    const key = resolveKey(state.sunElevationDeg, state.earthElevationDeg, lit, this.key);

    const camera = roots.camera;
    camera.updateMatrixWorld();
    const earthKey = key.mode === "earth";
    this.keyDir.copy(earthKey ? this.earthDir : this.sunDir);
    rig.update(camera, key, this.keyDir);
    sky.update(camera, {
      sunDirection: this.sunDir,
      earthDirection: this.earthDir,
      sunVisible: key.mode === "sun",
      earthVisible: state.earthElevationDeg > -3,
      limitingMagnitude: limitingMagnitude(key.ev100, STAR_CAP[this.ctx.services.get("quality").current.preset] ?? 6.5),
      earthGain: earthExposureGain(key.scale),
      earthDiameterDeg: state.earthDiameterDeg,
      skyLevel: this.knobs.skyLevel * (key.mode === "sun" ? 1 : key.mode === "earth" ? 0.5 : 0.3),
      earthLit: lit,
    });
    const horizon = this.scene?.horizon;
    if (horizon !== undefined && horizon !== null) horizon.keyDirection.value.copy(this.keyDir);
    this.velocity.update(camera);
  }

  dispose(): void {
    this.removeHooks?.();
    this.removeHooks = null;
    for (const off of this.off.splice(0)) off();
    if (this.ctx !== null && this.active) {
      this.ctx.services.get("renderer").setPipelineStages(null);
    }
    this.stages?.stages.dispose?.();
    this.stages = null;
    this.scene?.dispose();
    this.scene = null;
    this.lookdev?.dispose();
    this.lookdev = null;
    this.sky?.dispose();
    this.sky = null;
    this.rig?.dispose();
    this.rig = null;
    this.active = false;
  }

  /** (Re)binds what lives on the renderer: shadow maps on, shadows and post rebuilt for the current preset. */
  private bindRenderer(): void {
    const ctx = this.ctx;
    if (ctx === null) return;
    const renderer = ctx.services.get("renderer").renderer;
    if (renderer !== null) renderer.shadowMap.enabled = true;
    this.sky?.bindRenderer(renderer);
    this.applyQuality(ctx.services.get("quality").current);
  }

  /** Grade of the URL (`?grade=`): the reference-mood grade unless the neutral calibration grade is asked for. */
  private baseGrade(): LookGrade {
    return this.knobs.grade === "look" ? LOOK_GRADE : NEUTRAL_GRADE;
  }

  private applyQuality(settings: FrameInfo["quality"]): void {
    const ctx = this.ctx;
    if (ctx === null) return;
    this.appliedQuality = settings;
    const knobs = this.knobs;
    const effective = applyLookKnobs(settings, knobs);
    this.rig?.applyQuality(effective, knobs);
    this.scene?.applyQuality?.(effective);
    this.stages?.stages.dispose?.();
    const sky = this.sky;
    this.stages = createLookStages(effective, this.velocity, this.gradeOverride ?? this.baseGrade(), knobs, {
      stars: sky?.stars.layerScene ?? null,
    });
    // On a TRAA chain the stars are a layer after the resolve (VT-M0-13); otherwise they stay in the scene pass.
    sky?.setStarsLayer(this.stages.starsLayer);
    ctx.services.get("renderer").setPipelineStages(this.stages.stages);
  }
}
