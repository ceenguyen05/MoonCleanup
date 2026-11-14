// The v0 bench look (M0-W2-T02, kept for comparability with every number recorded before the visuals rig): a plain white
// sun with `HorizonCsmNode`, a warm / bright hemisphere fill, stand-in sun disk and Earth (owned by `BenchContent`), and the
// bench post chain. `?look=v0`.

import { DirectionalLight, HemisphereLight, Vector3, type PerspectiveCamera } from "three/webgpu";
import type { CSMShadowNode } from "three/addons/csm/CSMShadowNode.js";
import type { FrameInfo, QualitySettings } from "@moon-cleanup/shared";
import type { RenderRendererService } from "../module";
import type { SceneRoots } from "../scene-roots";
import { CameraOnlyVelocity } from "./camera-velocity";
import { CSM_LAMBDA, CSM_LAMBDA_ULTRA, makeSplitsCallback } from "./csm-splits";
import { HorizonCsmNode } from "./horizon-visibility";
import { benchSunDirection, type LookContext, type LookProvider } from "./look";
import { createBenchStages, type BenchStageHandles } from "./post-stages";

export class V0Look implements LookProvider {
  readonly id = "v0" as const;
  readonly ownsSky = false;
  readonly keyDirection = new Vector3();

  private readonly roots: SceneRoots;
  private readonly renderer: RenderRendererService;
  private readonly velocity = new CameraOnlyVelocity();
  private readonly sun: DirectionalLight;
  private readonly hemisphere: HemisphereLight;
  private csm: CSMShadowNode | null = null;
  private stages: BenchStageHandles | null = null;
  private cascades = 0;
  private lastAspect = 0;

  constructor(context: LookContext) {
    this.roots = context.roots;
    this.renderer = context.renderer;
    benchSunDirection(this.keyDirection);
    // Light rig (rendering-pipeline.md section 5.1): white sun with CSM, ground-bounce fill as a normal-dependent ambient.
    this.sun = new DirectionalLight(0xffffff, 10.4);
    this.sun.name = "mc:bench-sun-light";
    this.sun.castShadow = true;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.04;
    this.sun.shadow.camera.near = 0.5;
    this.sun.shadow.camera.far = 1500;
    this.sun.target.position.set(0, 0, 0);
    this.roots.scene.add(this.sun, this.sun.target);
    this.hemisphere = new HemisphereLight(0xffffff, 0xffffff, 1);
    this.hemisphere.color.setRGB(0.9, 0.85, 0.77);
    this.hemisphere.groundColor.setRGB(2.1, 1.98, 1.8);
    this.hemisphere.name = "mc:bench-fill";
    this.roots.scene.add(this.hemisphere);
    this.sun.position.copy(this.keyDirection).multiplyScalar(500);
    this.sun.updateMatrixWorld();
  }

  applyQuality(settings: QualitySettings): void {
    const shadows = settings.shadows;
    this.csm?.dispose();
    this.sun.shadow.mapSize.set(shadows.cascadeSizePx, shadows.cascadeSizePx);
    const lambda = settings.preset === "ultra" ? CSM_LAMBDA_ULTRA : CSM_LAMBDA;
    const csm = new HorizonCsmNode(this.sun, {
      cascades: shadows.cascades,
      maxFar: shadows.maxFarM,
      mode: "custom",
      customSplitsCallback: makeSplitsCallback(shadows.cascade0SplitM, lambda),
      lightMargin: 300,
    });
    csm.fade = true;
    this.sun.shadow.shadowNode = csm;
    this.csm = csm;
    this.cascades = shadows.cascades;
    this.lastAspect = 0;
    this.stages?.stages.dispose?.();
    const handles = createBenchStages(settings, this.velocity);
    this.stages = handles;
    this.renderer.setPipelineStages(handles.stages);
  }

  update(_frame: FrameInfo, camera: PerspectiveCamera): void {
    // The cascades are created lazily by the first render (`csm.camera` is null until then): fit them once they exist.
    const csm = this.csm;
    if (csm !== null && csm.camera !== null && camera.aspect !== this.lastAspect) {
      this.lastAspect = camera.aspect;
      csm.updateFrustums();
    }
    this.velocity.update(camera);
  }

  postPasses(): readonly string[] {
    return this.stages?.passes ?? [];
  }

  cascadeCount(): number {
    return this.cascades;
  }

  dispose(): void {
    this.renderer.setPipelineStages(null);
    this.stages?.stages.dispose?.();
    this.stages = null;
    this.csm?.dispose();
    this.csm = null;
    this.sun.shadow.shadowNode = undefined;
    this.sun.removeFromParent();
    this.sun.target.removeFromParent();
    this.sun.dispose();
    this.hemisphere.removeFromParent();
    this.hemisphere.dispose();
  }
}
