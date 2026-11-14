// The look-dev post chain on the render module's pipeline hooks (rendering-pipeline.md section 8, canonical presets section 14):
//
//   High / Ultra:  depth + normal + velocity prepass -> GTAO (indirect light only, `builtinAOContext`) -> main pass -> TRAA ->
//                  + star layer (own output-resolution pass, masked by the prepass depth) -> [look grade] -> bloom ->
//                  renderOutput (AgX)
//   Low / Medium:  main pass -> [look grade] -> bloom -> renderOutput (AgX) -> SMAA
//
// The grade's contrast term (a per-channel `pow`) is only in the graph when the grade asks for a contrast other than 1; the
// shipped grades do not, so the full-resolution output pass does not pay for three `pow` per pixel (`hasContrast`).
//
// Star layer (M0 look-polish r2, VT-M0-13): on a TRAA chain the stars are NOT in the scene pass. A temporal resolve
// reprojects and variance-clips its history, which cost the 2 px star Gaussians 28 % of their peak whenever the camera panned.
// The chain renders `layers.stars` (the star field's own scene, jitter cancelled in its vertex stage) after the resolve and
// adds it where the prepass depth is the far plane (sky). SMAA / FXAA chains keep the stars in the scene pass: no extra pass.
// `?stars=scene|layer` forces either path for A/B captures.
//
// Every stage can be switched per URL knob (`../look-knobs.ts`: aa, traa, gtao, bloom, grade) so its cost can be measured
// alone; without knobs the chain is exactly the preset's.
//
// Bloom is at its canonical values on every preset (threshold 4.0, knee 0.5, strength 0.06, radius 0.35): only the sun disk,
// the Earth limb, lamps and emissives exceed it. Tone mapping is the renderer's (`renderer.toneMapping`, AgX by default,
// ACES selectable): the render module's pipeline calls `renderOutput` once. The look grade is a neutral-by-default
// saturation / contrast pair (REFERENCE_TARGET: tunable toward the bright, readable reference mood).

import {
  builtinAOContext,
  float,
  luminance,
  mix,
  mrt,
  normalView,
  packNormalToRGB,
  pass,
  rtt,
  sample,
  screenUV,
  step,
  uniform,
  unpackRGBToNormal,
  vec3,
  vec4,
} from "three/tsl";
import { MeshBasicNodeMaterial, UnsignedByteType, type PassNode, type Scene } from "three/webgpu";
import { bloom } from "three/addons/tsl/display/BloomNode.js";
import { fxaa } from "three/addons/tsl/display/FXAANode.js";
import { ao } from "three/addons/tsl/display/GTAONode.js";
import { smaa } from "three/addons/tsl/display/SMAANode.js";
import { traa } from "three/addons/tsl/display/TRAANode.js";
import type { QualitySettings } from "@moon-cleanup/shared";
import type { PipelineStages } from "../../render";
import { DEFAULT_LOOK_KNOBS, effectiveAa, effectiveGtao, type LookKnobs } from "../look-knobs";
import type { CameraOnlyVelocity } from "./camera-velocity";

/** Canonical bloom values (rendering-pipeline.md section 8.1 step 5). */
export const BLOOM = { threshold: 4.0, knee: 0.5, strength: 0.06, radius: 0.35 } as const;

/** Grade applied in scene-linear before the tone map; the defaults are neutral. */
export interface LookGrade {
  /** 1 = unchanged. */
  saturation: number;
  /** Multiplier around mid grey (0.18) in linear light; 1 = unchanged. */
  contrast: number;
}

export const NEUTRAL_GRADE: LookGrade = { saturation: 1, contrast: 1 };

/** Reference-mood grade (M0-W3-T03b): a touch more chroma, luminance-preserving, so calibration luma is unchanged. */
export const LOOK_GRADE: LookGrade = { saturation: 1.12, contrast: 1 };

export interface LookStageHandles {
  readonly stages: PipelineStages;
  /** Names of the post nodes the chain contains, for the stats export. */
  readonly passes: readonly string[];
  /** Live grade uniforms (assign `.value`). `contrast` only acts when `hasContrast` is true. */
  readonly grade: { readonly saturation: { value: number }; readonly contrast: { value: number } };
  /** Whether the chain was built with the contrast term (`initialGrade.contrast !== 1`); if not, rebuild to change it. */
  readonly hasContrast: boolean;
  /**
   * `true` when the chain draws `layers.stars` itself after the temporal resolve: the caller must then keep the star mesh out
   * of the scene pass (`SkyRig.setStarsLayer(true)`), and put it back for a chain that reports `false`.
   */
  readonly starsLayer: boolean;
}

/** Scenes the chain renders itself, outside the scene pass. */
export interface LookLayers {
  /** The star field's layer scene (`StarField.layerScene`); `null` / absent: the stars stay in the scene pass. */
  readonly stars?: Scene | null;
}

/** Whether a chain for `settings` / `knobs` draws the stars as a post-resolve layer (needs the layer scene). */
export function starsAsLayer(
  settings: QualitySettings,
  knobs: LookKnobs,
  layers: LookLayers | null | undefined,
): boolean {
  if (layers?.stars === undefined || layers.stars === null) return false;
  if (effectiveAa(settings, knobs) !== "traa") return false;
  return knobs.starLayer ?? true;
}

interface Disposable {
  dispose(): void;
}

export function createLookStages(
  settings: QualitySettings,
  velocity: CameraOnlyVelocity,
  initialGrade: LookGrade = NEUTRAL_GRADE,
  knobs: LookKnobs = DEFAULT_LOOK_KNOBS,
  layers: LookLayers | null = null,
): LookStageHandles {
  const owned: Disposable[] = [];
  const passes: string[] = [];
  let prepass: PassNode | null = null;
  const aa = effectiveAa(settings, knobs);
  const useTraa = aa === "traa";
  const useGtao = effectiveGtao(settings, knobs);
  const starsLayer = starsAsLayer(settings, knobs, layers);
  const bloomMode = knobs.bloom ?? settings.post.bloom.resolution;
  const hasContrast = initialGrade.contrast !== 1;
  const saturation = uniform(initialGrade.saturation);
  const contrast = uniform(initialGrade.contrast);

  const stages: PipelineStages = {
    hdr(color, ctx) {
      // The post addons type their inputs per value type; the chain is built once per preset, so it is typed loosely.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let beauty: any = color;
      passes.push("scene");
      if (useTraa || useGtao) {
        // Depth + normal (+ velocity for TRAA) prepass with a cheap override material (no lights, no textures): section 3.2 row 6.
        const prepassMaterial = new MeshBasicNodeMaterial();
        prepassMaterial.name = "mc:look-prepass";
        owned.push(prepassMaterial);
        const pre = pass(ctx.scene, ctx.camera);
        pre.name = "mc:look-prepass";
        pre.overrideMaterial = prepassMaterial;
        pre.transparent = false;
        pre.setMRT(
          useTraa
            ? mrt({ output: packNormalToRGB(normalView), velocity: velocity.node })
            : mrt({ output: packNormalToRGB(normalView) }),
        );
        prepass = pre;
        owned.push(pre);
        passes.push("prepass");

        const depth = pre.getTextureNode("depth");

        if (useGtao) {
          const prepassNormal = sample((uv) => unpackRGBToNormal(pre.getTextureNode().sample(uv)));
          const gtao = ao(depth, prepassNormal, ctx.camera);
          gtao.samples.value = settings.post.ao.samples;
          gtao.radius.value = settings.post.ao.radiusM;
          gtao.resolutionScale = settings.post.ao.resolution === "full" ? 1 : 0.5;
          // The temporal noise rotation needs a temporal resolve to average it out.
          gtao.useTemporalFiltering = useTraa;
          owned.push(gtao);
          passes.push("gtao");
          // The AO term feeds the material's indirect light only (a hard-sunlit surface must not darken): section 8.1 step 2.
          ctx.scenePass.contextNode = builtinAOContext(gtao.getTextureNode().sample(screenUV).r);
        }

        if (useTraa) {
          const resolve = traa(ctx.scenePass, depth, pre.getTextureNode("velocity"), ctx.camera);
          resolve.useSubpixelCorrection = false;
          owned.push(resolve);
          passes.push("traa");
          beauty = resolve;

          const starScene = layers?.stars;
          if (starsLayer && starScene !== undefined && starScene !== null) {
            // Output resolution on every render scale: the layer keeps the stars crisp under dynamic resolution.
            const starPass = pass(starScene, ctx.camera);
            starPass.name = "mc:star-layer";
            owned.push(starPass);
            passes.push("stars");
            // Sky = nothing in the opaque prepass (far plane, linear depth 1); terrain and props hide the stars.
            const sky = step(0.5, pre.getLinearDepthNode());
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const starColour: any = starPass;
            beauty = vec4(resolve.rgb.add(starColour.rgb.mul(sky)), 1);
          }
        }
      }

      // Look grade in scene-linear: contrast around mid grey, then saturation about the luminance. `grade=off` drops the stage.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let base: any = beauty;
      if (knobs.grade !== "off") {
        const pivot = float(0.18);
        const contrasted = hasContrast ? beauty.rgb.div(pivot).pow(contrast).mul(pivot) : beauty.rgb;
        const graded = mix(vec3(luminance(contrasted)), contrasted, saturation);
        base = vec4(graded, 1);
        passes.push("grade");
      }

      if (bloomMode === "off") return base;
      const glow = bloom(base, BLOOM.strength, BLOOM.radius, BLOOM.threshold);
      glow.smoothWidth.value = BLOOM.knee;
      glow.setResolutionScale(bloomMode === "half" ? 0.5 : 0.25);
      owned.push(glow);
      passes.push("bloom");
      return base.add(glow);
    },
    display(color) {
      if (aa !== "smaa" && aa !== "fxaa") return color;
      // The spatial AA reads the tone-mapped frame several times per pixel. It is display-referred (0..1, sRGB encoded), so
      // its intermediate is RGBA8, not three's default RGBA16F for converted nodes: half the bandwidth, same image.
      const ldr = knobs.aaInput === "half-float" ? color : rtt(color, null, null, { type: UnsignedByteType });
      if (ldr !== color) owned.push(ldr as unknown as Disposable);
      if (aa === "fxaa") {
        const fast = fxaa(ldr);
        owned.push(fast);
        passes.push("fxaa");
        return fast;
      }
      const spatial = smaa(ldr);
      owned.push(spatial);
      passes.push("smaa");
      return spatial;
    },
    setRenderScale(scale) {
      prepass?.setResolutionScale(scale);
    },
    dispose() {
      for (const item of owned.splice(0)) {
        try {
          item.dispose();
        } catch {
          // A node whose targets were never created (the device was lost before the first frame) has nothing to free.
        }
      }
      prepass = null;
      passes.length = 0;
    },
  };
  return { stages, passes, grade: { saturation, contrast }, hasContrast, starsLayer };
}
