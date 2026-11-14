// HDR frame pipeline skeleton on three r187 `RenderPipeline` (docs/architecture/rendering-pipeline.md section 8.1;
// API per docs/vendor/three-r187/docs-pages/RenderPipeline.html.md and PassNode.html.md).
//
//   scene pass (RGBA16F, render scale)  ->  [hdr stage]  ->  renderOutput (tone map + sRGB, once)  ->
//   [display stage]  ->  canvas
//
// `outputColorTransform` is off so the display stage runs display-referred (SMAA, sharpen; section 8.1 steps 8-10).
// The two stages are the hooks of technical-artist (visuals/post): AO, TRAA, VFX composite, bloom and exposure go
// into `hdr`; SMAA and sharpen into `display`. The skeleton itself adds no look.
//
// The tone mapper and the output colour space are the RENDERER's (`renderer.toneMapping`, set from the quality
// settings; `renderer.outputColorSpace`, sRGB by default): `renderOutput()` without arguments reads them from the
// pipeline context, and RenderPipeline rebuilds its output by itself when either changes.

import { pass, renderOutput } from "three/tsl";
import {
  ACESFilmicToneMapping,
  AgXToneMapping,
  HalfFloatType,
  RenderPipeline,
  type Camera,
  type Node,
  type PassNode,
  type Scene,
  type ToneMapping,
  type WebGPURenderer,
} from "three/webgpu";
import type { PostQuality } from "@moon-cleanup/shared";

export interface PipelineStageContext {
  /** The scene pass: MRT setup, depth / velocity texture nodes, `setResolutionScale`. */
  readonly scenePass: PassNode;
  readonly scene: Scene;
  readonly camera: Camera;
  readonly renderer: WebGPURenderer;
}

/** Maps a colour node to a colour node. Called when the pipeline is (re)built, never per frame. */
export type PipelineStage = (color: Node, context: PipelineStageContext) => Node;

export interface PipelineStages {
  /** Scene-linear HDR, before tone mapping. */
  readonly hdr?: PipelineStage | null;
  /** Display-referred (tone-mapped, sRGB), before the canvas. */
  readonly display?: PipelineStage | null;
  /** Releases what the stages created (effect nodes, their render targets). Called before a rebuild and on dispose. */
  readonly dispose?: (() => void) | null;
  /**
   * Render scale changed (dynamic resolution, section 9): stages that own extra scene-sized passes (a depth / normal
   * prepass) apply it to them. Also called once after every build with the scale in effect.
   */
  readonly setRenderScale?: ((scale: number) => void) | null;
}

/** What the render module needs of a pipeline (so tests can substitute it). */
export interface FramePipelineLike {
  render(): void;
  setRenderScale(scale: number): void;
  setStages(stages: PipelineStages | null): void;
  dispose(): void;
}

/** three tone-mapping constant of a quality setting. */
export function toneMappingFor(setting: PostQuality["toneMapping"]): ToneMapping {
  return setting === "aces" ? ACESFilmicToneMapping : AgXToneMapping;
}

export class FramePipeline implements FramePipelineLike {
  /** The HDR scene pass. Replaced on `setStages` (MRT and texture nodes belong to one graph). */
  scenePass: PassNode;

  private readonly renderer: WebGPURenderer;
  private readonly scene: Scene;
  private readonly camera: Camera;
  private readonly pipeline: RenderPipeline;
  private stages: PipelineStages | null = null;
  private renderScale = 1;

  constructor(renderer: WebGPURenderer, scene: Scene, camera: Camera, stages: PipelineStages | null = null) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this.pipeline = new RenderPipeline(renderer);
    // Tone mapping and the sRGB transform happen once, in our own renderOutput() (section 8.1 step 8).
    this.pipeline.outputColorTransform = false;
    this.stages = stages;
    this.scenePass = this.build();
  }

  /** Renders the frame to the canvas. Requires an initialised renderer (`await renderer.init()`). */
  render(): void {
    this.pipeline.render();
  }

  /** Render scale of the scene pass (dynamic resolution, section 9). The canvas stays at output resolution. */
  setRenderScale(scale: number): void {
    this.renderScale = scale;
    this.scenePass.setResolutionScale(scale);
    this.stages?.setRenderScale?.(scale);
  }

  /** Installs (or with `null` removes) the post stages and rebuilds the graph. Not for per-frame use. */
  setStages(stages: PipelineStages | null): void {
    this.stages?.dispose?.();
    this.scenePass.dispose();
    this.stages = stages;
    this.scenePass = this.build();
  }

  dispose(): void {
    this.stages?.dispose?.();
    this.stages = null;
    this.scenePass.dispose();
    this.pipeline.dispose();
  }

  private build(): PassNode {
    // Half-float HDR colour on every preset (section 8.2); PassNode's default, stated on purpose.
    const scenePass = pass(this.scene, this.camera, { type: HalfFloatType });
    scenePass.setResolutionScale(this.renderScale);

    const context: PipelineStageContext = {
      scenePass,
      scene: this.scene,
      camera: this.camera,
      renderer: this.renderer,
    };
    let color: Node = scenePass;
    const hdr = this.stages?.hdr;
    if (hdr !== undefined && hdr !== null) color = hdr(color, context);
    color = renderOutput(color);
    const display = this.stages?.display;
    if (display !== undefined && display !== null) color = display(color, context);
    this.stages?.setRenderScale?.(this.renderScale);

    this.pipeline.outputNode = color;
    this.pipeline.needsUpdate = true;
    return scenePass;
  }
}
