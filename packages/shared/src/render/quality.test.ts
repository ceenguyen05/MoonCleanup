import { describe, expect, expectTypeOf, it } from "vitest";
import { HARDWARE_TIERS, RENDER_BACKENDS, type HardwareTier, type RenderBackend } from "./backend";
import {
  DUST_TILE_FRAME_M,
  QUALITY_PRESET_IDS,
  QUALITY_PRESETS,
  QualityPresetIdSchema,
  QualitySettingsSchema,
  type QualityPresetId,
  type QualitySettings,
} from "./quality";

/**
 * rendering-pipeline.md section 14.1 copied by hand, one row per knob, columns Low / Medium / High / Ultra.
 * A change to the canonical table must be made here and in quality.ts, on purpose.
 */
const TABLE: Record<string, readonly [low: unknown, medium: unknown, high: unknown, ultra: unknown]> = {
  // Target FPS / GPU ms: 30 / 28, 30 / 28, 60 / 14, 60 / 14
  "dynres.targetFps": [30, 30, 60, 60],
  "dynres.gpuBudgetMs": [28, 28, 14, 14],
  // Render scale range: 0.50-0.75, 0.60-0.85, 0.75-1.00, 0.85-1.00
  "dynres.scaleMin": [0.5, 0.6, 0.75, 0.85],
  "dynres.scaleMax": [0.75, 0.85, 1.0, 1.0],
  // DPR cap
  dprCap: [1.0, 1.0, 1.5, 2.0],
  // AA / upscale: SMAA / bilinear, SMAA / FSR1-style, TRAA / TAAU, TRAA / TAAU
  "post.aa": ["smaa", "smaa", "traa", "traa"],
  "post.upscale": ["bilinear", "fsr1", "taau", "taau"],
  // Sharpen (CAS-style)
  "post.sharpen": [0.3, 0.25, 0.2, 0.15],
  // CSM cascades x size: 2 x 1024, 3 x 1024, 3 x 2048, 4 x 2048
  "shadows.cascades": [2, 3, 3, 4],
  "shadows.cascadeSizePx": [1024, 1024, 2048, 2048],
  // Shadow max far
  "shadows.maxFarM": [80, 120, 200, 300],
  // Cascade-0 split
  "shadows.cascade0SplitM": [10, 10, 8, 6],
  // PCF filter 10-90 % width
  "shadows.pcfWidthTexels": [1.5, 1.5, 1.5, 1.5],
  // Night Earth shadows, horizon map
  "shadows.nightEarthShadows": [true, true, true, true],
  "shadows.horizonMap": [true, true, true, true],
  // Own Crown Lamp shadow map
  "shadows.ownLampShadowSizePx": [512, 1024, 1024, 2048],
  // Other players' shadowed lamps
  "shadows.otherLampShadowCount": [0, 0, 1, 2],
  // Depth/normal prepass
  "post.depthNormalPrepass": [false, false, true, true],
  // AO: 1/2 / 8 / 1.0 m + cavity, 1/2 / 12 / 1.2 m + cavity, full / 16 / 1.2 m, full / 16 + denoise / 1.5 m
  "post.ao.resolution": ["half", "half", "full", "full"],
  "post.ao.samples": [8, 12, 16, 16],
  "post.ao.radiusM": [1.0, 1.2, 1.2, 1.5],
  "post.ao.cavityTerm": [true, true, false, false],
  "post.ao.denoise": [false, false, false, true],
  // Bloom res / mips: 1/4 / 3, 1/4 / 4, 1/2 / 5, 1/2 / 5
  "post.bloom.resolution": ["quarter", "quarter", "half", "half"],
  "post.bloom.mips": [3, 4, 5, 5],
  // Tone mapping: AgX on every preset
  "post.toneMapping": ["agx", "agx", "agx", "agx"],
  // Exposure adaptation source: mip chain, histogram, histogram, histogram
  "post.exposureSource": ["mip-chain", "histogram", "histogram", "histogram"],
  // Max local lights; unshadowed lamp range clamp; environment probe face size
  "lights.maxLocalLights": [8, 16, 32, 64],
  "lights.unshadowedLampRangeM": [8, 8, 8, 8],
  "lights.envProbeFacePx": [64, 128, 128, 128],
  // CDLOD leaf level / patch: L8 / 17, L8 / 33, L8 / 33, L9 / 33; range multiplier
  "terrain.cdlodLeafLevel": [8, 8, 8, 9],
  "terrain.cdlodPatchVerts": [17, 33, 33, 33],
  "terrain.cdlodRangeMult": [0.75, 1.0, 1.25, 1.5],
  // Procedural detail (crater bands + noise octaves): 2 + 1, 3 + 1, 3 + 2, 3 + 2
  "terrain.detailCraterBands": [2, 3, 3, 3],
  "terrain.detailNoiseOctaves": [1, 1, 2, 2],
  // Regolith texel density <= 5 m / at 50 m (+ 2nd detail layer on Ultra), anisotropy
  "terrain.regolithTexelsPerMNear": [512, 768, 1024, 1024],
  "terrain.regolithTexelsPerMAt50m": [128, 192, 256, 256],
  "terrain.secondDetailLayer": [false, false, false, true],
  "terrain.anisotropy": [4, 8, 8, 16],
  // Texture pool: 480 MB, 600 MB, 1.5 GB, 3 GB
  texturePoolMb: [480, 600, 1536, 3072],
  // Dust atlas slots x size: 512 x 64, 1,024 x 64, 512 x 128, 1,024 x 128 (40 / 40 / 20 / 20 cm); sections 7.2 sizes
  "dust.atlas.slots": [512, 1024, 512, 1024],
  "dust.atlas.slotPx": [64, 64, 128, 128],
  "dust.atlas.texelCm": [40, 40, 20, 20],
  "dust.atlas.widthPx": [2048, 2048, 4096, 4096],
  "dust.atlas.heightPx": [1024, 2048, 2048, 4096],
  // Dust residency radius, tile rebuilds / frame
  "dust.residencyRadiusM": [80, 120, 160, 220],
  "dust.tileRebuildsPerFrame": [2, 3, 6, 10],
  // Dust detail ring size @ texel (side; radius): 1024 @ 4.0 cm (41 m; 20 m) ... 2048 @ 2.0 cm (41 m; 20 m)
  "dust.ring.sizePx": [1024, 1024, 2048, 2048],
  "dust.ring.texelCm": [4.0, 3.5, 2.5, 2.0],
  "dust.ring.sideM": [41, 36, 51, 41],
  "dust.ring.radiusM": [20, 18, 25, 20],
  // Ring / atlas cross-fade band; stroke-direction textures; footprint lifetime; tread stamp
  "dust.ringCrossFadeM": [2, 2, 2, 2],
  "dust.strokeDirection": ["ring", "ring-atlas", "ring-atlas", "ring-atlas"],
  "dust.footprintLifetimeS": [60, 120, 300, 600],
  "dust.treadNormalStamp": [true, true, true, true],
  // Berm normals / displacement: derivatives / none, derivatives / none, 4-tap / <= 10 m, 4-tap / <= 10 m
  "dust.berm.normals": ["derivatives", "derivatives", "4-tap", "4-tap"],
  "dust.berm.displacementMaxM": [0, 0, 10, 10],
  // Clean-ground sparkle: 2 cm fade 8-12 m, 2 cm 8-12 m, 1 cm 15-25 m, 1 cm 15-25 m
  "dust.sparkle.cellCm": [2, 2, 1, 1],
  "dust.sparkle.fadeNearM": [8, 8, 15, 15],
  "dust.sparkle.fadeFarM": [12, 12, 25, 25],
  // Particles GPU / CPU pool: 8k / 2k, 20k / 4k, 50k / 6k, 100k / -; soft particles
  "particles.gpuPool": [8000, 20000, 50000, 100000],
  "particles.cpuPool": [2000, 4000, 6000, 0],
  "particles.softParticles": [false, true, true, true],
  // Stars m_lim cap; Earth texture
  "sky.starMagLimit": [5.5, 6.0, 6.5, 6.5],
  "sky.earthTexture.widthPx": [1024, 1024, 2048, 2048],
  "sky.earthTexture.heightPx": [512, 512, 1024, 1024],
  "sky.earthTexture.nightLights": [false, false, false, true],
  // Draw calls / triangles per frame
  "budgets.drawCalls": [350, 350, 600, 600],
  "budgets.triangles": [1_000_000, 1_500_000, 4_000_000, 6_000_000],
  // Object distance multiplier, robot render distance, visible Dust Puck cap
  "distances.objectMult": [0.6, 0.8, 1.0, 1.3],
  "distances.robotRenderM": [150, 200, 300, 400],
  "distances.visiblePuckCap": [500, 1000, 2000, 4000],
  // Survey Globe hex mode; glass backdrop-filter
  "ui.surveyGlobeHex": [false, true, true, true],
  "ui.glassBackdropFilter": ["off", "tier-a-only", "on", "on"],
};

/** Read `a.b.c` from a nested object. */
function at(root: unknown, path: string): unknown {
  let node: unknown = root;
  for (const key of path.split(".")) node = (node as Record<string, unknown>)[key];
  return node;
}

/** Every leaf path of a nested object, for example `post.ao.samples`. */
function leafPaths(node: unknown, prefix = ""): string[] {
  if (typeof node !== "object" || node === null) return [prefix];
  return Object.entries(node).flatMap(([key, value]) => leafPaths(value, prefix === "" ? key : `${prefix}.${key}`));
}

describe("quality presets", () => {
  it("lists the four presets, lowest first", () => {
    expect(QUALITY_PRESET_IDS).toEqual(["low", "medium", "high", "ultra"]);
    expect(Object.keys(QUALITY_PRESETS)).toEqual([...QUALITY_PRESET_IDS]);
    expectTypeOf<QualityPresetId>().toEqualTypeOf<"low" | "medium" | "high" | "ultra">();
  });

  it.each(QUALITY_PRESET_IDS)("%s parses with the schema and is returned unchanged", (id) => {
    const parsed = QualitySettingsSchema.parse(QUALITY_PRESETS[id]);
    expect(parsed).toEqual(QUALITY_PRESETS[id]);
    expect(parsed.preset).toBe(id);
    // JSON round trip: presets can be stored with the player's settings.
    expect(QualitySettingsSchema.parse(JSON.parse(JSON.stringify(parsed)))).toEqual(parsed);
  });

  it("matches the canonical table of rendering-pipeline section 14.1, knob by knob", () => {
    for (const [path, row] of Object.entries(TABLE)) {
      QUALITY_PRESET_IDS.forEach((id, column) => {
        expect(at(QUALITY_PRESETS[id], path), `${id}.${path}`).toBe(row[column]);
      });
    }
  });

  it("has no knob that the table check above does not cover", () => {
    for (const id of QUALITY_PRESET_IDS) {
      const paths = leafPaths(QUALITY_PRESETS[id]).filter((path) => path !== "preset");
      expect(paths.sort()).toEqual(Object.keys(TABLE).sort());
    }
  });

  it("never lowers a quality knob from one preset to the next", () => {
    for (let i = 1; i < QUALITY_PRESET_IDS.length; i += 1) {
      const lower: QualitySettings = QUALITY_PRESETS[QUALITY_PRESET_IDS[i - 1] as QualityPresetId];
      const higher: QualitySettings = QUALITY_PRESETS[QUALITY_PRESET_IDS[i] as QualityPresetId];
      expect(higher.dprCap).toBeGreaterThanOrEqual(lower.dprCap);
      expect(higher.dynres.scaleMin).toBeGreaterThanOrEqual(lower.dynres.scaleMin);
      expect(higher.dynres.scaleMax).toBeGreaterThanOrEqual(lower.dynres.scaleMax);
      expect(higher.shadows.cascades).toBeGreaterThanOrEqual(lower.shadows.cascades);
      expect(higher.shadows.cascadeSizePx).toBeGreaterThanOrEqual(lower.shadows.cascadeSizePx);
      expect(higher.shadows.maxFarM).toBeGreaterThan(lower.shadows.maxFarM);
      expect(higher.post.ao.samples).toBeGreaterThanOrEqual(lower.post.ao.samples);
      expect(higher.post.bloom.mips).toBeGreaterThanOrEqual(lower.post.bloom.mips);
    }
  });
});

describe("dust atlas and ring (world-and-dust-simulation sections 7.2 and 7.5)", () => {
  it.each(QUALITY_PRESET_IDS)("%s: atlas area, tile frame and ring side are consistent", (id) => {
    const { atlas, ring } = QUALITY_PRESETS[id].dust;
    expect(atlas.slots * atlas.slotPx ** 2).toBe(atlas.widthPx * atlas.heightPx);
    expect((atlas.slotPx * atlas.texelCm) / 100).toBeCloseTo(DUST_TILE_FRAME_M, 9);
    expect(Math.abs((ring.sizePx * ring.texelCm) / 100 - ring.sideM)).toBeLessThanOrEqual(0.5);
    expect(ring.radiusM).toBeLessThanOrEqual(ring.sideM / 2);
  });

  it("rejects an atlas or ring that contradicts itself", () => {
    const base = QUALITY_PRESETS.medium;
    const badAtlas = { ...base, dust: { ...base.dust, atlas: { ...base.dust.atlas, slots: 512 } } };
    const badFrame = { ...base, dust: { ...base.dust, atlas: { ...base.dust.atlas, texelCm: 20 } } };
    const badRing = { ...base, dust: { ...base.dust, ring: { ...base.dust.ring, sideM: 60 } } };
    const bigRadius = { ...base, dust: { ...base.dust, ring: { ...base.dust.ring, radiusM: 30 } } };
    for (const bad of [badAtlas, badFrame, badRing, bigRadius]) {
      expect(QualitySettingsSchema.safeParse(bad).success).toBe(false);
    }
  });

  it("grows residency, rebuilds and puck cap with the preset", () => {
    for (let i = 1; i < QUALITY_PRESET_IDS.length; i += 1) {
      const lower = QUALITY_PRESETS[QUALITY_PRESET_IDS[i - 1] as QualityPresetId];
      const higher = QUALITY_PRESETS[QUALITY_PRESET_IDS[i] as QualityPresetId];
      expect(higher.dust.residencyRadiusM).toBeGreaterThan(lower.dust.residencyRadiusM);
      expect(higher.dust.tileRebuildsPerFrame).toBeGreaterThanOrEqual(lower.dust.tileRebuildsPerFrame);
      expect(higher.distances.visiblePuckCap).toBeGreaterThan(lower.distances.visiblePuckCap);
      expect(higher.texturePoolMb).toBeGreaterThan(lower.texturePoolMb);
      expect(higher.lights.maxLocalLights).toBeGreaterThan(lower.lights.maxLocalLights);
      expect(higher.budgets.drawCalls).toBeGreaterThanOrEqual(lower.budgets.drawCalls);
    }
  });
});

describe("QualitySettingsSchema", () => {
  const base: QualitySettings = QUALITY_PRESETS.high;

  it("accepts an override inside the allowed ranges", () => {
    const custom = { ...base, dynres: { ...base.dynres, scaleMin: 0.5 }, post: { ...base.post, toneMapping: "aces" } };
    expect(QualitySettingsSchema.parse(custom)).toEqual(custom);
  });

  it("rejects values outside the allowed ranges", () => {
    const bad: unknown[] = [
      { ...base, preset: "extreme" },
      { ...base, dprCap: 0.5 },
      { ...base, dprCap: 4 },
      { ...base, dynres: { ...base.dynres, scaleMin: 0.9, scaleMax: 0.8 } },
      { ...base, dynres: { ...base.dynres, scaleMin: 0.1 } },
      { ...base, dynres: { ...base.dynres, targetFps: 0 } },
      { ...base, shadows: { ...base.shadows, cascades: 5 } },
      { ...base, shadows: { ...base.shadows, cascadeSizePx: 1000 } },
      { ...base, shadows: { ...base.shadows, cascade0SplitM: 500 } },
      { ...base, post: { ...base.post, aa: "msaa" } },
      { ...base, post: { ...base.post, sharpen: 1.5 } },
      { ...base, post: { ...base.post, ao: { ...base.post.ao, samples: 0 } } },
      { ...base, post: undefined },
      {},
      null,
    ];
    for (const value of bad) {
      expect(QualitySettingsSchema.safeParse(value).success, JSON.stringify(value)).toBe(false);
    }
  });

  it("rejects unknown preset ids", () => {
    expect(QualityPresetIdSchema.safeParse("Ultra").success).toBe(false);
    expect(QualityPresetIdSchema.parse("ultra")).toBe("ultra");
  });

  it("has the knob groups of v0 in its type", () => {
    expectTypeOf<QualitySettings>().toHaveProperty("preset").toEqualTypeOf<QualityPresetId>();
    expectTypeOf<QualitySettings>().toHaveProperty("dprCap").toEqualTypeOf<number>();
    expectTypeOf<QualitySettings["dynres"]>().toEqualTypeOf<{
      targetFps: number;
      gpuBudgetMs: number;
      scaleMin: number;
      scaleMax: number;
    }>();
    expectTypeOf<QualitySettings["shadows"]["cascadeSizePx"]>().toEqualTypeOf<512 | 1024 | 2048 | 4096>();
    expectTypeOf<QualitySettings["post"]["aa"]>().toEqualTypeOf<"smaa" | "traa">();
    expectTypeOf<QualitySettings["post"]["toneMapping"]>().toEqualTypeOf<"agx" | "aces">();
    expectTypeOf(QUALITY_PRESETS.low).toExtend<QualitySettings>();
  });
});

describe("render backend and tier names", () => {
  it("are the names of rendering-pipeline section 2.1", () => {
    expect(RENDER_BACKENDS).toEqual(["webgpu", "webgpu-compat", "webgl2"]);
    expect(HARDWARE_TIERS).toEqual(["A", "B", "C"]);
    expectTypeOf<RenderBackend>().toEqualTypeOf<"webgpu" | "webgpu-compat" | "webgl2">();
    expectTypeOf<HardwareTier>().toEqualTypeOf<"A" | "B" | "C">();
  });
});
