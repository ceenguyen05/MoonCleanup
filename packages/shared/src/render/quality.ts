// @contract render/quality v1
// @consumers apps/client/src/render (preset selection, DPR cap, dynamic resolution, shadows, post chain),
//   apps/client/src/visuals, apps/client/src/terrain, apps/client/src/ui (settings screen), apps/client/src/debug,
//   this package's client/module (FrameInfo.quality) and events/catalog (quality.changed)
//
// Render quality presets Low / Medium / High / Ultra. Specification: docs/architecture/rendering-pipeline.md
// section 14.1, THE canonical preset table. The numbers below are copied from that table and nowhere else; a change
// there is a change here in the same contracts wave (quality.test.ts repeats the table and fails on a drift).
//
// v0 covered the knob groups M0 code reads: DPR cap, dynamic-resolution range and target, shadows, post chain.
// v1 (M1-W0-T03, additive for readers; a literal that builds a whole QualitySettings must add the new groups) adds the
// remaining rows of the table: lights, terrain LOD and detail, texture pool, the dust atlas, the dust detail ring,
// footprints, berms and sparkle, particles, sky, draw-call and triangle budgets, distance multipliers and UI.
// Cross-checks (world-and-dust-simulation.md sections 7.2 and 7.5): atlas slots x slot area = atlas area; slot edge x
// texel = the 25.6 m tile frame; ring side = ring size x texel (within 0.5 m).
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

/** Local lights and the environment probe (rendering-pipeline.md sections 5.5 and 14.1). */
export const LightQualitySchema = z.object({
  /** Most local lights (lamps, floods) lit per frame. */
  maxLocalLights: z.int().min(1).max(256),
  /** Range clamp of a lamp that casts no shadow, in metres. */
  unshadowedLampRangeM: z.number().positive(),
  /** Edge of one environment-probe cube face in pixels. */
  envProbeFacePx: z.literal([64, 128, 256]),
});
export type LightQuality = z.infer<typeof LightQualitySchema>;

/** Terrain LOD and procedural detail (rendering-pipeline.md section 14.1; world-and-dust-simulation.md section 3.6). */
export const TerrainQualitySchema = z.object({
  /** CDLOD leaf level (the finest quadtree level). */
  cdlodLeafLevel: z.int().min(1).max(12),
  /** Vertices along one CDLOD patch edge. */
  cdlodPatchVerts: z.literal([17, 33, 65]),
  /** Multiplier on the CDLOD LOD ranges (larger keeps detail further out). */
  cdlodRangeMult: z.number().positive(),
  /** Crater bands of the procedural detail. */
  detailCraterBands: z.int().min(0).max(8),
  /** Noise octaves of the procedural detail. */
  detailNoiseOctaves: z.int().min(0).max(8),
  /** Regolith texel density up to 5 m from the camera, texels per metre. */
  regolithTexelsPerMNear: z.int().positive(),
  /** Regolith texel density at 50 m, texels per metre. */
  regolithTexelsPerMAt50m: z.int().positive(),
  /** A second regolith detail layer (Ultra only). */
  secondDetailLayer: z.boolean(),
  /** Anisotropic filtering taps. */
  anisotropy: z.literal([1, 2, 4, 8, 16]),
});
export type TerrainQuality = z.infer<typeof TerrainQualitySchema>;

/** Side of one dust tile in metres (64 px x 40 cm = 128 px x 20 cm). */
export const DUST_TILE_FRAME_M = 25.6;

/** Dust tile atlas (world-and-dust-simulation.md section 7.2). One resident tile covers a 25.6 m square. */
export const DustAtlasQualitySchema = z
  .object({
    /** Resident tile slots. */
    slots: z.int().positive(),
    /** Edge of one slot in texels. */
    slotPx: z.literal([64, 128]),
    /** Size of one texel in centimetres. */
    texelCm: z.number().positive(),
    /** Atlas texture width in texels. */
    widthPx: z.literal([2048, 4096]),
    /** Atlas texture height in texels. */
    heightPx: z.literal([1024, 2048, 4096]),
  })
  .superRefine((atlas, ctx) => {
    if (atlas.slots * atlas.slotPx * atlas.slotPx !== atlas.widthPx * atlas.heightPx) {
      ctx.addIssue({ code: "custom", message: "slots x slotPx^2 must equal widthPx x heightPx", path: ["slots"] });
    }
    if (Math.abs((atlas.slotPx * atlas.texelCm) / 100 - DUST_TILE_FRAME_M) > 1e-9) {
      ctx.addIssue({ code: "custom", message: "slotPx x texelCm must give a 25.6 m tile", path: ["texelCm"] });
    }
  });
export type DustAtlasQuality = z.infer<typeof DustAtlasQualitySchema>;

/** Dust detail ring, L3 (world-and-dust-simulation.md section 7.5). Toroidal, centred on the player. */
export const DustRingQualitySchema = z
  .object({
    /** Ring texture edge in texels. */
    sizePx: z.literal([1024, 2048]),
    /** Size of one texel in centimetres. */
    texelCm: z.number().positive(),
    /** Side of the ring in metres. */
    sideM: z.number().positive(),
    /** Radius inside which the ring is shaded, in metres (about half the side). */
    radiusM: z.number().positive(),
  })
  .superRefine((ring, ctx) => {
    if (Math.abs((ring.sizePx * ring.texelCm) / 100 - ring.sideM) > 0.5) {
      ctx.addIssue({ code: "custom", message: "sideM must match sizePx x texelCm within 0.5 m", path: ["sideM"] });
    }
    if (ring.radiusM > ring.sideM / 2) {
      ctx.addIssue({ code: "custom", message: "radiusM must not exceed half of sideM", path: ["radiusM"] });
    }
  });
export type DustRingQuality = z.infer<typeof DustRingQualitySchema>;

/** The dust ledger's GPU side: atlas, ring, residency and surface detail (sections 7.2 to 7.6). */
export const DustQualitySchema = z.object({
  atlas: DustAtlasQualitySchema,
  /** Distance from the camera inside which touched plots keep a resident tile, in metres. */
  residencyRadiusM: z.number().positive(),
  /** Tiles rebuilt per frame (join, eviction return, mispredict). */
  tileRebuildsPerFrame: z.int().min(1).max(64),
  ring: DustRingQualitySchema,
  /** Width of the ring-to-atlas cross-fade band in metres. */
  ringCrossFadeM: z.number().positive(),
  /** Where the stroke-direction texture (lane stripes) exists: `ring` only (stripes off) or ring and atlas. */
  strokeDirection: z.enum(["ring", "ring-atlas"]),
  /** Lifetime of a footprint on clean ground in seconds (grime prints last 30 s on every preset). */
  footprintLifetimeS: z.number().positive(),
  /** Tread normal stamp for boots and wheels. */
  treadNormalStamp: z.boolean(),
  /** How berm normals are derived and how far berm displacement reaches. */
  berm: z.object({
    normals: z.enum(["derivatives", "4-tap"]),
    /** Displacement distance in metres; 0 = none. */
    displacementMaxM: z.number().min(0),
  }),
  /** Clean-ground sparkle cell size and distance fade. */
  sparkle: z
    .object({
      cellCm: z.number().positive(),
      fadeNearM: z.number().positive(),
      fadeFarM: z.number().positive(),
    })
    .refine((sparkle) => sparkle.fadeNearM < sparkle.fadeFarM, { message: "fadeNearM must be below fadeFarM" }),
});
export type DustQuality = z.infer<typeof DustQualitySchema>;

/** Particle pools and soft particles. A pool of 0 means that pool is not offered. */
export const ParticleQualitySchema = z.object({
  /** GPU particle pool (`webgpu` backend). */
  gpuPool: z.int().min(0),
  /** CPU particle pool (`webgpu-compat` and `webgl2` backends); 0 = not offered (Ultra is not offered there). */
  cpuPool: z.int().min(0),
  softParticles: z.boolean(),
});
export type ParticleQuality = z.infer<typeof ParticleQualitySchema>;

/** Sky: star limit and Earth texture. */
export const SkyQualitySchema = z.object({
  /** Limiting magnitude of the star field (model section 6). */
  starMagLimit: z.number().min(0).max(8),
  earthTexture: z.object({
    widthPx: z.literal([1024, 2048]),
    heightPx: z.literal([512, 1024]),
    nightLights: z.boolean(),
  }),
});
export type SkyQuality = z.infer<typeof SkyQualitySchema>;

/** Per-frame ceilings checked by the debug HUD and `/perf-check`. */
export const BudgetQualitySchema = z.object({
  drawCalls: z.int().positive(),
  triangles: z.int().positive(),
});
export type BudgetQuality = z.infer<typeof BudgetQualitySchema>;

/** Distances and caps that scale with the preset. */
export const DistanceQualitySchema = z.object({
  /** Multiplier on every object's LOD and cull distances. */
  objectMult: z.number().positive(),
  /** Robots are rendered up to this distance in metres. */
  robotRenderM: z.number().positive(),
  /** Most Dust Pucks drawn at once. */
  visiblePuckCap: z.int().positive(),
});
export type DistanceQuality = z.infer<typeof DistanceQualitySchema>;

/** UI knobs that depend on the preset. */
export const UiQualitySchema = z.object({
  /** Survey Globe hex mode. */
  surveyGlobeHex: z.boolean(),
  /** Glass `backdrop-filter`: `off` (strong glass), `tier-a-only` (off on Tier B), `on` (at most 4 panels). */
  glassBackdropFilter: z.enum(["off", "tier-a-only", "on"]),
});
export type UiQuality = z.infer<typeof UiQualitySchema>;

/** One named preset's values, or a preset with player overrides applied. */
export const QualitySettingsSchema = z.object({
  /** The preset these values come from. */
  preset: QualityPresetIdSchema,
  /** Upper limit for the canvas device pixel ratio. The DOM UI is not affected by it. */
  dprCap: z.number().min(1).max(3),
  dynres: DynresQualitySchema,
  shadows: ShadowQualitySchema,
  post: PostQualitySchema,
  lights: LightQualitySchema,
  terrain: TerrainQualitySchema,
  /** Texture memory pool in mebibytes. */
  texturePoolMb: z.int().positive(),
  dust: DustQualitySchema,
  particles: ParticleQualitySchema,
  sky: SkyQualitySchema,
  budgets: BudgetQualitySchema,
  distances: DistanceQualitySchema,
  ui: UiQualitySchema,
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
    lights: { maxLocalLights: 8, unshadowedLampRangeM: 8, envProbeFacePx: 64 },
    terrain: {
      cdlodLeafLevel: 8,
      cdlodPatchVerts: 17,
      cdlodRangeMult: 0.75,
      detailCraterBands: 2,
      detailNoiseOctaves: 1,
      regolithTexelsPerMNear: 512,
      regolithTexelsPerMAt50m: 128,
      secondDetailLayer: false,
      anisotropy: 4,
    },
    texturePoolMb: 480,
    dust: {
      atlas: { slots: 512, slotPx: 64, texelCm: 40, widthPx: 2048, heightPx: 1024 },
      residencyRadiusM: 80,
      tileRebuildsPerFrame: 2,
      ring: { sizePx: 1024, texelCm: 4.0, sideM: 41, radiusM: 20 },
      ringCrossFadeM: 2,
      strokeDirection: "ring",
      footprintLifetimeS: 60,
      treadNormalStamp: true,
      berm: { normals: "derivatives", displacementMaxM: 0 },
      sparkle: { cellCm: 2, fadeNearM: 8, fadeFarM: 12 },
    },
    particles: { gpuPool: 8000, cpuPool: 2000, softParticles: false },
    sky: { starMagLimit: 5.5, earthTexture: { widthPx: 1024, heightPx: 512, nightLights: false } },
    budgets: { drawCalls: 350, triangles: 1_000_000 },
    distances: { objectMult: 0.6, robotRenderM: 150, visiblePuckCap: 500 },
    ui: { surveyGlobeHex: false, glassBackdropFilter: "off" },
  },
  medium: {
    preset: "medium",
    dprCap: 1.0,
    dynres: { targetFps: 30, gpuBudgetMs: 28, scaleMin: 0.75, scaleMax: 0.85 },
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
    lights: { maxLocalLights: 16, unshadowedLampRangeM: 8, envProbeFacePx: 128 },
    terrain: {
      cdlodLeafLevel: 8,
      cdlodPatchVerts: 17, // 17 on Medium: about -2.5 ms GPU p50 at ground (M1-W2-T01 round 6)
      cdlodRangeMult: 1.0,
      detailCraterBands: 3,
      detailNoiseOctaves: 1,
      regolithTexelsPerMNear: 768,
      regolithTexelsPerMAt50m: 192,
      secondDetailLayer: false,
      anisotropy: 8,
    },
    texturePoolMb: 600,
    dust: {
      atlas: { slots: 1024, slotPx: 64, texelCm: 40, widthPx: 2048, heightPx: 2048 },
      residencyRadiusM: 120,
      tileRebuildsPerFrame: 3,
      ring: { sizePx: 1024, texelCm: 3.5, sideM: 36, radiusM: 18 },
      ringCrossFadeM: 2,
      strokeDirection: "ring-atlas",
      footprintLifetimeS: 120,
      treadNormalStamp: true,
      berm: { normals: "derivatives", displacementMaxM: 0 },
      sparkle: { cellCm: 2, fadeNearM: 8, fadeFarM: 12 },
    },
    particles: { gpuPool: 20_000, cpuPool: 4000, softParticles: true },
    sky: { starMagLimit: 6.0, earthTexture: { widthPx: 1024, heightPx: 512, nightLights: false } },
    budgets: { drawCalls: 350, triangles: 1_500_000 },
    distances: { objectMult: 0.8, robotRenderM: 200, visiblePuckCap: 1000 },
    ui: { surveyGlobeHex: true, glassBackdropFilter: "tier-a-only" },
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
    lights: { maxLocalLights: 32, unshadowedLampRangeM: 8, envProbeFacePx: 128 },
    terrain: {
      cdlodLeafLevel: 8,
      cdlodPatchVerts: 33,
      cdlodRangeMult: 1.25,
      detailCraterBands: 3,
      detailNoiseOctaves: 2,
      regolithTexelsPerMNear: 1024,
      regolithTexelsPerMAt50m: 256,
      secondDetailLayer: false,
      anisotropy: 8,
    },
    texturePoolMb: 1536,
    dust: {
      atlas: { slots: 512, slotPx: 128, texelCm: 20, widthPx: 4096, heightPx: 2048 },
      residencyRadiusM: 160,
      tileRebuildsPerFrame: 6,
      ring: { sizePx: 2048, texelCm: 2.5, sideM: 51, radiusM: 25 },
      ringCrossFadeM: 2,
      strokeDirection: "ring-atlas",
      footprintLifetimeS: 300,
      treadNormalStamp: true,
      berm: { normals: "4-tap", displacementMaxM: 10 },
      sparkle: { cellCm: 1, fadeNearM: 15, fadeFarM: 25 },
    },
    particles: { gpuPool: 50_000, cpuPool: 6000, softParticles: true },
    sky: { starMagLimit: 6.5, earthTexture: { widthPx: 2048, heightPx: 1024, nightLights: false } },
    budgets: { drawCalls: 600, triangles: 4_000_000 },
    distances: { objectMult: 1.0, robotRenderM: 300, visiblePuckCap: 2000 },
    ui: { surveyGlobeHex: true, glassBackdropFilter: "on" },
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
    lights: { maxLocalLights: 64, unshadowedLampRangeM: 8, envProbeFacePx: 128 },
    terrain: {
      cdlodLeafLevel: 9,
      cdlodPatchVerts: 33,
      cdlodRangeMult: 1.5,
      detailCraterBands: 3,
      detailNoiseOctaves: 2,
      regolithTexelsPerMNear: 1024,
      regolithTexelsPerMAt50m: 256,
      secondDetailLayer: true,
      anisotropy: 16,
    },
    texturePoolMb: 3072,
    dust: {
      atlas: { slots: 1024, slotPx: 128, texelCm: 20, widthPx: 4096, heightPx: 4096 },
      residencyRadiusM: 220,
      tileRebuildsPerFrame: 10,
      ring: { sizePx: 2048, texelCm: 2.0, sideM: 41, radiusM: 20 },
      ringCrossFadeM: 2,
      strokeDirection: "ring-atlas",
      footprintLifetimeS: 600,
      treadNormalStamp: true,
      berm: { normals: "4-tap", displacementMaxM: 10 },
      sparkle: { cellCm: 1, fadeNearM: 15, fadeFarM: 25 },
    },
    particles: { gpuPool: 100_000, cpuPool: 0, softParticles: true },
    sky: { starMagLimit: 6.5, earthTexture: { widthPx: 2048, heightPx: 1024, nightLights: true } },
    budgets: { drawCalls: 600, triangles: 6_000_000 },
    distances: { objectMult: 1.3, robotRenderM: 400, visiblePuckCap: 4000 },
    ui: { surveyGlobeHex: true, glassBackdropFilter: "on" },
  },
} as const satisfies Record<QualityPresetId, QualitySettings>;
