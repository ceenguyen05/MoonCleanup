// The sky of the look rig: stars, Earth and sun disk under one root that follows the camera (translation only), so every
// sky object is at "infinity". The backdrop is a faint gradient dome (REFERENCE mode: art-direction 2.5 black sky is tunable); no fog, no haze on the ground.

import { Group, Vector3, type PerspectiveCamera, type WebGPURenderer } from "three/webgpu";
import { DEFAULT_LOOK_KNOBS, type LookKnobs, type SkyDomeMode, type SkyPart } from "../look-knobs";
import { EARTH_DIAMETER_DEG } from "./sky-math";
import { Earth } from "./earth";
import { SkyDome } from "./sky-dome";
import { StarField } from "./star-field";
import { SunDisk } from "./sun-disk";

export interface SkyFrame {
  readonly sunDirection: Vector3;
  readonly earthDirection: Vector3;
  readonly sunVisible: boolean;
  readonly earthVisible: boolean;
  /** Limiting magnitude of the star model for the current exposure. */
  readonly limitingMagnitude: number;
  /** Pre-exposure scale and the Earth's own gain. */
  readonly earthGain: number;
  readonly earthDiameterDeg?: number;
  /** Overall brightness of the backdrop gradient (1 by day, lower at night); 0 hides it (pure black space). */
  readonly skyLevel?: number;
  /** Lit fraction of the Earth's disk (0..1): scales the atmosphere halo. */
  readonly earthLit?: number;
  /**
   * 0..1: how far the Earth's lighting direction is turned toward the viewer (reference mood: a readable, mostly lit
   * Earth). 0 = the physical phase from the sun direction; default 0.5.
   */
  readonly earthFullness?: number;
}

export class SkyRig {
  readonly root = new Group();
  readonly dome: SkyDome;
  readonly stars: StarField;
  readonly earth: Earth;
  readonly sun: SunDisk;

  private starScale = 1;
  private readonly parts: Readonly<Record<SkyPart, boolean>>;
  private readonly _light = new Vector3();

  /** `knobs` (URL, `../look-knobs.ts`): which parts are drawn and how the backdrop is evaluated. Default: everything, baked. */
  constructor(parent: Group, knobs: Pick<LookKnobs, "sky" | "skyDome"> = DEFAULT_LOOK_KNOBS) {
    this.root.name = "mc:sky-rig";
    this.parts = knobs.sky;
    this.dome = new SkyDome(knobs.skyDome);
    this.stars = new StarField();
    this.earth = new Earth();
    this.sun = new SunDisk();
    // A hidden part is never added, so it costs neither a draw nor a pipeline.
    if (this.parts.dome) this.root.add(this.dome.mesh);
    if (this.parts.stars) this.root.add(this.stars.mesh);
    if (this.parts.earth) this.root.add(this.earth.mesh);
    if (this.parts.halo) this.root.add(this.earth.halo);
    if (this.parts.sun) this.root.add(this.sun.mesh);
    parent.add(this.root);
  }

  /**
   * Renderer-bound resources: bakes the backdrop texture. Call once a renderer exists and again after it was recreated
   * (device loss); without it the dome stays on its per-pixel procedural path.
   */
  bindRenderer(renderer: WebGPURenderer | null): void {
    if (renderer !== null && this.parts.dome) this.dome.bake(renderer);
  }

  /**
   * Draws the stars as a layer AFTER the temporal resolve (`true`, TRAA chains: the post chain renders `stars.layerScene`)
   * or inside the scene pass (`false`, the default). No effect when the stars are hidden by a knob.
   */
  setStarsLayer(layer: boolean): void {
    this.stars.setLayerMode(layer && this.parts.stars, this.parts.stars ? this.root : null);
  }

  /** How the backdrop is drawn right now (`baked` only after `bindRenderer`). */
  get domeMode(): SkyDomeMode {
    return this.dome.mode;
  }

  update(camera: PerspectiveCamera, frame: SkyFrame): void {
    // The sky sits at 70 % of the far plane so it is always inside the depth range (reversed or not).
    const distance = camera.far * 0.7;
    this.root.position.copy(camera.position);
    this.dome.mesh.scale.setScalar(distance * 1.06);
    this.dome.update(frame.sunDirection, frame.skyLevel ?? 1, frame.sunVisible);
    this.starScale = distance;
    const earthDiameterDeg = frame.earthDiameterDeg ?? EARTH_DIAMETER_DEG;
    // The stars hide behind the Earth's disk themselves only when the Earth is actually drawn.
    const earthDrawn = frame.earthVisible && this.parts.earth;
    this.stars.update(camera, frame.limitingMagnitude, 1, earthDrawn ? frame.earthDirection : null, earthDiameterDeg);

    this.earth.mesh.visible = frame.earthVisible;
    this.earth.halo.visible = frame.earthVisible;
    if (frame.earthVisible) {
      this.earth.place(frame.earthDirection, distance * 0.99, earthDiameterDeg);
      const fullness = Math.min(1, Math.max(0, frame.earthFullness ?? 0.5));
      this._light
        .copy(frame.sunDirection)
        .multiplyScalar(1 - fullness)
        .addScaledVector(frame.earthDirection, -fullness);
      if (this._light.lengthSq() < 1e-6) this._light.copy(frame.sunDirection);
      this._light.normalize();
      const lit = (frame.earthLit ?? 1) * (1 - fullness) + fullness;
      this.earth.update(this._light, frame.earthGain, lit);
    }
    this.sun.mesh.visible = frame.sunVisible;
    if (frame.sunVisible) this.sun.place(frame.sunDirection, distance * 0.98, camera);
  }

  get distanceM(): number {
    return this.starScale;
  }

  dispose(): void {
    this.dome.dispose();
    this.stars.dispose();
    this.earth.dispose();
    this.sun.dispose();
    this.root.removeFromParent();
  }
}
