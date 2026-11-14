// The visuals bench look (M0-W3-T07 follow-up): the technical-artist rig through the `visuals` public barrel only - `SunRig`
// (key light + `MoonShadowNode` filtered cascades + regolith fill), `SkyRig` (dome, stars, Earth, sun disk) and
// `createLookStages` (look grade, bloom, TRAA / SMAA). It mirrors what `VisualsModule` does per frame for a fixed sun, so the
// bench measures the look the game runs. `?look=visuals` (default); `?look=v0` selects the old bench chain.

import { Vector3, type PerspectiveCamera } from "three/webgpu";
import type { FrameInfo, QualitySettings } from "@moon-cleanup/shared";
import {
  CameraOnlyVelocity,
  LOOK_GRADE,
  NEUTRAL_GRADE,
  SkyRig,
  SunRig,
  applyLookKnobs,
  createKeyState,
  createLookStages,
  describeLookKnobs,
  earthExposureGain,
  limitingMagnitude,
  litFraction,
  parseLookKnobs,
  resolveKey,
  sunShadowsEnabled,
  type KeyState,
  type LookKnobs,
  type LookStageHandles,
} from "../../visuals";
import type { RenderRendererService } from "../module";
import {
  BENCH_SUN_ELEVATION_DEG,
  benchEarthDirection,
  benchSunDirection,
  type LookContext,
  type LookProvider,
} from "./look";

/** Stars: limiting-magnitude cap per preset (rendering-pipeline section 14.1), same table as `VisualsModule`. */
const STAR_CAP: Record<string, number> = { low: 5.5, medium: 6.0, high: 6.5, ultra: 6.5 };

export class VisualsLook implements LookProvider {
  readonly id = "visuals" as const;
  readonly ownsSky = true;
  readonly keyDirection = new Vector3();

  private readonly renderer: RenderRendererService;
  private readonly rig: SunRig;
  private readonly sky: SkyRig;
  private readonly velocity = new CameraOnlyVelocity();
  private readonly key: KeyState = createKeyState();
  private readonly earthDir = new Vector3();
  private readonly earthElevationDeg: number;
  private readonly lit: number;
  private readonly knobs: LookKnobs;
  private stages: LookStageHandles | null = null;
  private cascades = 0;
  private preset = "medium";

  constructor(context: LookContext) {
    this.renderer = context.renderer;
    this.knobs = parseLookKnobs(context.search ?? "");
    benchSunDirection(this.keyDirection);
    benchEarthDirection(this.earthDir);
    this.earthElevationDeg = (Math.asin(this.earthDir.y) * 180) / Math.PI;
    this.lit = litFraction(
      this.keyDirection.x,
      this.keyDirection.y,
      this.keyDirection.z,
      this.earthDir.x,
      this.earthDir.y,
      this.earthDir.z,
    );
    resolveKey(BENCH_SUN_ELEVATION_DEG, this.earthElevationDeg, this.lit, this.key);
    this.rig = new SunRig(context.roots.scene);
    this.sky = new SkyRig(context.roots.sky, this.knobs);
  }

  applyQuality(settings: QualitySettings): void {
    const knobs = this.knobs;
    const effective = applyLookKnobs(settings, knobs);
    this.preset = settings.preset;
    this.cascades = sunShadowsEnabled(knobs) ? effective.shadows.cascades : 0;
    // The scene calls this on every (re)bound renderer: the baked backdrop belongs to that renderer.
    this.sky.bindRenderer(this.renderer.renderer);
    this.rig.applyQuality(effective, knobs);
    this.stages?.stages.dispose?.();
    this.stages = createLookStages(
      effective,
      this.velocity,
      knobs.grade === "look" ? LOOK_GRADE : NEUTRAL_GRADE,
      knobs,
      { stars: this.sky.stars.layerScene },
    );
    // On a TRAA chain the stars are a layer after the resolve (VT-M0-13); otherwise they stay in the scene pass.
    this.sky.setStarsLayer(this.stages.starsLayer);
    this.renderer.setPipelineStages(this.stages.stages);
  }

  update(_frame: FrameInfo, camera: PerspectiveCamera): void {
    const knobs = this.knobs;
    this.rig.update(camera, this.key, this.keyDirection);
    this.sky.update(camera, {
      sunDirection: this.keyDirection,
      earthDirection: this.earthDir,
      sunVisible: true,
      earthVisible: true,
      limitingMagnitude: limitingMagnitude(this.key.ev100, STAR_CAP[this.preset] ?? 6.5),
      earthGain: earthExposureGain(this.key.scale),
      skyLevel: knobs.skyLevel,
      earthLit: this.lit,
    });
    this.velocity.update(camera);
  }

  postPasses(): readonly string[] {
    return this.stages?.passes ?? [];
  }

  cascadeCount(): number {
    return this.cascades;
  }

  describeKnobs(): string {
    return `${describeLookKnobs(this.knobs)} skydome=${this.sky.domeMode} shadowfilter=${this.rig.shadowFilter}`;
  }

  dispose(): void {
    this.renderer.setPipelineStages(null);
    this.stages?.stages.dispose?.();
    this.stages = null;
    this.sky.dispose();
    this.rig.dispose();
  }
}
