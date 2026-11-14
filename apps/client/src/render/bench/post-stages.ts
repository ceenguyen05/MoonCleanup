// The bench's post chain on the render module's pipeline hooks (M0-W2-T02; rendering-pipeline.md section 8):
//
//   High / Ultra:  [depth + normal + velocity prepass] -> GTAO (indirect light only, `builtinAOContext`) -> main pass
//                  -> TRAA -> bloom -> renderOutput (AgX)
//   Low / Medium:  main pass -> bloom -> renderOutput (AgX) -> SMAA
//
// Bloom is at its canonical values for every preset (threshold 4.0, knee 0.5, strength 0.06, radius 0.35). Not in the
// bench v0 chain (NOT RUN, listed in the report): exposure adaptation, 3D LUT grade, Lowlight Visor, sharpen / FSR1
// upscale, half-res GTAO from MRT normals on Low / Medium, VFX layer composite.

import {
  builtinAOContext,
  mrt,
  normalView,
  packNormalToRGB,
  pass,
  sample,
  screenUV,
  unpackRGBToNormal,
} from "three/tsl";
import { MeshBasicNodeMaterial, type PassNode } from "three/webgpu";
import { bloom } from "three/addons/tsl/display/BloomNode.js";
import { ao } from "three/addons/tsl/display/GTAONode.js";
import { smaa } from "three/addons/tsl/display/SMAANode.js";
import { traa } from "three/addons/tsl/display/TRAANode.js";
import type { QualitySettings } from "@moon-cleanup/shared";
import type { PipelineStages } from "../pipeline";
import type { CameraOnlyVelocity } from "./camera-velocity";

/** Canonical bloom values (rendering-pipeline.md section 8.1 step 5). */
export const BLOOM = { threshold: 4.0, knee: 0.5, strength: 0.06, radius: 0.35 } as const;

export interface BenchStageHandles {
  readonly stages: PipelineStages;
  /** Names of the post nodes the chain contains, for the stats export. */
  readonly passes: readonly string[];
}

interface Disposable {
  dispose(): void;
}

export function createBenchStages(settings: QualitySettings, velocity: CameraOnlyVelocity): BenchStageHandles {
  const owned: Disposable[] = [];
  const passes: string[] = [];
  let prepass: PassNode | null = null;
  const useTraa = settings.post.aa === "traa";

  const stages: PipelineStages = {
    hdr(color, ctx) {
      // The post addons type their inputs per value type; the chain is built once per preset, so it is typed loosely.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let beauty: any = color;
      passes.push("scene");
      if (useTraa) {
        // Depth + normal + velocity prepass with a cheap override material (no lights, no textures): section 3.2 row 6.
        const prepassMaterial = new MeshBasicNodeMaterial();
        prepassMaterial.name = "mc:bench-prepass";
        owned.push(prepassMaterial);
        const pre = pass(ctx.scene, ctx.camera);
        pre.name = "mc:bench-prepass";
        pre.overrideMaterial = prepassMaterial;
        pre.transparent = false;
        pre.setMRT(mrt({ output: packNormalToRGB(normalView), velocity: velocity.node }));
        prepass = pre;
        owned.push(pre);
        passes.push("prepass");

        const depth = pre.getTextureNode("depth");
        const prepassVelocity = pre.getTextureNode("velocity");
        const prepassNormal = sample((uv) => unpackRGBToNormal(pre.getTextureNode().sample(uv)));

        const gtao = ao(depth, prepassNormal, ctx.camera);
        gtao.samples.value = settings.post.ao.samples;
        gtao.radius.value = settings.post.ao.radiusM;
        gtao.resolutionScale = settings.post.ao.resolution === "full" ? 1 : 0.5;
        gtao.useTemporalFiltering = true;
        owned.push(gtao);
        passes.push("gtao");
        // The AO term feeds the material's indirect light only (a hard-sunlit surface must not darken): section 8.1 step 2.
        ctx.scenePass.contextNode = builtinAOContext(gtao.getTextureNode().sample(screenUV).r);

        const resolve = traa(ctx.scenePass, depth, prepassVelocity, ctx.camera);
        resolve.useSubpixelCorrection = false;
        owned.push(resolve);
        passes.push("traa");
        beauty = resolve;
      }

      const glow = bloom(beauty, BLOOM.strength, BLOOM.radius, BLOOM.threshold);
      glow.smoothWidth.value = BLOOM.knee;
      glow.setResolutionScale(settings.post.bloom.resolution === "half" ? 0.5 : 0.25);
      owned.push(glow);
      passes.push("bloom");
      return beauty.add(glow);
    },
    display(color) {
      if (useTraa) return color;
      const spatial = smaa(color);
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
  return { stages, passes };
}
