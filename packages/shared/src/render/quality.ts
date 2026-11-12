// @contract render/quality v0
// @consumers apps/client/src/render (preset selection, DPR cap, dynamic resolution, shadows, post chain),
//   apps/client/src/visuals, apps/client/src/terrain, apps/client/src/ui (settings screen), apps/client/src/debug,
//   this package's client/module (FrameInfo.quality) and events/catalog (quality.changed)
//
// Render quality presets Low / Medium / High / Ultra. Specification: docs/architecture/rendering-pipeline.md
// section 14.1, THE canonical preset table. The numbers below are copied from that table and nowhere else; a change
// there is a change here in the same contracts wave (quality.test.ts repeats the table and fails on a drift).
//
// v0 covers the knob groups M0 code reads: DPR cap, dynamic-resolution range and target, shadows, post chain.
// The remaining rows of the table (terrain LOD, dust atlas and ring, particles, lights, sky, budgets, distances)
// are added as new fields in later contracts waves; adding a field is not a breaking change for readers.
//
// What is NOT encoded here, because it depends on the backend and is the render module's rule
// (rendering-pipeline.md section 2.2): `webgpu-compat` and `webgl2` use at most 3 cascades and offer at most High;
// the `histogram` exposure source needs `webgpu` and falls back to `mip-chain` elsewhere.

import { z } from "zod";

/** Preset ids, lowest quality first. Also the values of the `?preset=` URL parameter. */
export const QUALITY_PRESET_IDS = ["low", "medium", "high", "ultra"] as const;
export const QualityPresetIdSchema = z.enum(QUALITY_PRESET_IDS);
export type QualityPresetId = z.infer<typeof QualityPresetIdSchema>;

/** Square texture edge in pixels (shadow maps). */
const TextureSizePxSchema = z.literal([512, 1024, 2048, 4096]);

/** Dynamic-resolution controller inputs (rendering-pipeline.md sections 9 and 14.1). */
export const DynresQualitySchema = z
  .object({
    /** Target frame rate in frames per second. */
    targetFps: z.int().min(1).max(240),
    /** GPU frame-time budget in milliseconds the controller steers to. */
    gpuBudgetMs: z.number().positive().max(1000),
    /** Lowest render scale (fraction of the output resolution per axis) the controller may choose. */
    scaleMin: z.number().min(0.25).max(1),
    /** Highest render scale the controller may choose. */
    scaleMax: z.number().min(0.25).max(1),
  })
  .refine((dynres) => dynres.scaleMin <= dynres.scaleMax, {
    message: "scaleMin must not exceed scaleMax",
    path: ["scaleMin"],
  });
export type DynresQuality = z.infer<typeof DynresQualitySchema>;

/** Sun / Earth cascaded shadows and Crown Lamp shadows (rendering-pipeline.md sections 5.2, 5.3 and 14.1). */
export const ShadowQualitySchema = z
  .object({
    /** Number of CSM cascades. */
    cascades: z.int().min(1).max(4),
    /** Edge of one cascade's shadow map in pixels. */
    cascadeSizePx: TextureSizePxSchema,
    /** Far distance of the last cascade in metres. */
    maxFarM: z.number().positive(),
    /** Far distance of cascade 0 in metres. */
    cascade0SplitM: z.number().positive(),
    /** Width of the PCF filter's 10-90 % transition, in shadow-map texels. */
    pcfWidthTexels: z.number().positive(),
    /** At night the cascades are re-pointed at the Earth. */
    nightEarthShadows: z.boolean(),
    /** Far terrain shadow from the baked horizon map. */
    horizonMap: z.boolean(),
    /** Edge of the own Crown Lamp's shadow map in pixels. */
    ownLampShadowSizePx: TextureSizePxSchema,
    /** How many other players' lamps cast shadows. */
    otherLampShadowCount: z.int().min(0).max(8),
  })
  .refine((shadows) => shadows.cascade0SplitM < shadows.maxFarM, {
    message: "cascade0SplitM must be smaller than maxFarM",
    path: ["cascade0SplitM"],
  });
export type ShadowQuality = z.infer<typeof ShadowQualitySchema>;

/** Post chain (rendering-pipeline.md sections 8 and 14.1). Bloom threshold and strength are fixed, not knobs. */
export const PostQualitySchema = z.object({
  /** Anti-aliasing technique. */
  aa: z.enum(["smaa", "traa"]),
  /** Upscaler from render resolution to output resolution. `fsr1` is the FSR1-style spatial upscaler. */
  upscale: z.enum(["bilinear", "fsr1", "taau"]),
  /** Strength of the CAS-style sharpen, 0-1. */
  sharpen: z.number().min(0).max(1),
  /** Separate depth / normal prepass. */
  depthNormalPrepass: z.boolean(),
  /** Ambient occlusion (GTAO). */
  ao: z.object({
    /** Resolution of the AO pass relative to the render resolution. */
    resolution: z.enum(["half", "full"]),
    /** Samples per pixel. */
    samples: z.int().min(1).max(64),
    /** World-space radius in metres. */
    radiusM: z.number().positive(),
    /** Extra small-scale cavity term (used with half-resolution AO). */
    cavityTerm: z.boolean(),
    /** Spatial denoise pass. */
    denoise: z.boolean(),
  }),
  /** Bloom chain. */
  bloom: z.object({
    /** Resolution of the first bloom level relative to the render resolution. */
    resolution: z.enum(["quarter", "half"]),
    /** Number of mip levels. */
    mips: z.int().min(1).max(8),
  }),
  /** Tone mapper. AgX is the default on every preset; ACES exists as an option. */
  toneMapping: z.enum(["agx", "aces"]),
  /** Where exposure adaptation reads scene luminance from. */
  exposureSource: z.enum(["mip-chain", "histogram"]),
});
export type PostQuality = z.infer<typeof PostQualitySchema>;

/** The knob set of v0: one named preset's values, or a preset with player overrides applied. */
export const QualitySettingsSchema = z.object({
  /** The preset these values come from. */
  preset: QualityPresetIdSchema,
  /** Upper limit for the canvas device pixel ratio. The DOM UI is not affected by it. */
  dprCap: z.number().min(1).max(3),
  dynres: DynresQualitySchema,
  shadows: ShadowQualitySchema,
  post: PostQualitySchema,
});
export type QualitySettings = z.infer<typeof QualitySettingsSchema>;

/** Default values of the four presets (rendering-pipeline.md section 14.1). Treat as read-only. */
export const QUALITY_PRESETS = {
  low: {
    preset: "low",
    dprCap: 1.0,
    dynres: { targetFps: 30, gpuBudgetMs: 28, scaleMin: 0.5, scaleMax: 0.75 },
    shadows: {
      cascades: 2,
      cascadeSizePx: 1024,
      maxFarM: 80,
      cascade0SplitM: 10,
      pcfWidthTexels: 1.5,
      nightEarthShadows: true,
      horizonMap: true,
      ownLampShadowSizePx: 512,
      otherLampShadowCount: 0,
    },
    post: {
      aa: "smaa",
      upscale: "bilinear",
      sharpen: 0.3,
      depthNormalPrepass: false,
      ao: { resolution: "half", samples: 8, radiusM: 1.0, cavityTerm: true, denoise: false },
      bloom: { resolution: "quarter", mips: 3 },
      toneMapping: "agx",
      exposureSource: "mip-chain",
    },
  },
  medium: {
    preset: "medium",
    dprCap: 1.0,
    dynres: { targetFps: 30, gpuBudgetMs: 28, scaleMin: 0.6, scaleMax: 0.85 },
    shadows: {
      cascades: 3,
      cascadeSizePx: 1024,
      maxFarM: 120,
      cascade0SplitM: 10,
      pcfWidthTexels: 1.5,
      nightEarthShadows: true,
      horizonMap: true,
      ownLampShadowSizePx: 1024,
      otherLampShadowCount: 0,
    },
    post: {
      aa: "smaa",
      upscale: "fsr1",
      sharpen: 0.25,
      depthNormalPrepass: false,
      ao: { resolution: "half", samples: 12, radiusM: 1.2, cavityTerm: true, denoise: false },
      bloom: { resolution: "quarter", mips: 4 },
      toneMapping: "agx",
      exposureSource: "histogram",
    },
  },
  high: {
    preset: "high",
    dprCap: 1.5,
    dynres: { targetFps: 60, gpuBudgetMs: 14, scaleMin: 0.75, scaleMax: 1.0 },
    shadows: {
      cascades: 3,
      cascadeSizePx: 2048,
      maxFarM: 200,
      cascade0SplitM: 8,
      pcfWidthTexels: 1.5,
      nightEarthShadows: true,
      horizonMap: true,
      ownLampShadowSizePx: 1024,
      otherLampShadowCount: 1,
    },
    post: {
      aa: "traa",
      upscale: "taau",
      sharpen: 0.2,
      depthNormalPrepass: true,
      ao: { resolution: "full", samples: 16, radiusM: 1.2, cavityTerm: false, denoise: false },
      bloom: { resolution: "half", mips: 5 },
      toneMapping: "agx",
      exposureSource: "histogram",
    },
  },
  ultra: {
    preset: "ultra",
    dprCap: 2.0,
    dynres: { targetFps: 60, gpuBudgetMs: 14, scaleMin: 0.85, scaleMax: 1.0 },
    shadows: {
      cascades: 4,
      cascadeSizePx: 2048,
      maxFarM: 300,
      cascade0SplitM: 6,
      pcfWidthTexels: 1.5,
      nightEarthShadows: true,
      horizonMap: true,
      ownLampShadowSizePx: 2048,
      otherLampShadowCount: 2,
    },
    post: {
      aa: "traa",
      upscale: "taau",
      sharpen: 0.15,
      depthNormalPrepass: true,
      ao: { resolution: "full", samples: 16, radiusM: 1.5, cavityTerm: false, denoise: true },
      bloom: { resolution: "half", mips: 5 },
      toneMapping: "agx",
      exposureSource: "histogram",
    },
  },
} as const satisfies Record<QualityPresetId, QualitySettings>;
