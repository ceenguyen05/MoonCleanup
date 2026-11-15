// Regolith / dust material v0 (M0-W3-T04): TSL node material on `MeshStandardNodeMaterial`, identical on WebGPU and the
// WebGL2 backend. Look: art-direction.md sections 2.3 and 3.1-3.3; data hooks: world-and-dust-simulation.md 7.7;
// materials rules: rendering-pipeline.md section 7. REFERENCE MODE (REFERENCE_TARGET.md): clean ground is bright and
// smooth, dust is dark and warm, the edge between them is crisp with a stepped lip, passes overlap cleanly.
//
// Per fragment (fetches are counted while the graph is built, `fetchCount`; distinct textures: `textureBindings`):
//   mask   5 taps of ONE texture (centre + 4 for the height gradient)   R grime, G berm height (mask-texture.ts)
//   detail 4 taps of ONE texture (2 scales x 2 stochastic taps)         height, gradient, albedo breakup
//   = 9 fetches, 2 sampled textures; CSM cascades, probe and lamp shadow share the 16-texture stage limit (target <= 12).
//
// What it does:
//   * presence mask m = smoothstep(-w, +w, R - tau), tau = 0.04 + 0.08 h_eff: edges break up along the real relief
//     (peaks clean first, dust lingers in hollows); w from screen derivatives, floor of one output pixel;
//   * thickness t = m (0.35 + 0.65 R): albedo and roughness = mix(clean, grime, t); thin layers read as lighter dust;
//   * height field H = layerGain * D * R + bermGain * B_max * G; its gradient (central differences of the 4 extra taps)
//     is the berm / lip normal; two detail scales add pebbles and clods; one surface-gradient perturbation does all;
//   * clean ground gets glass-bead glints on world cells (<= 4x diffuse, never past 0.6 of the bloom threshold);
//   * grazing-sun detail fade: the detail slopes shrink with the local sun elevation below 20 degrees (regolith-constants),
//     so a dawn sun never turns the relief into hard black patches;
//   * optional macro variation (`macroVariation`): large-scale tone and warm / cool hue drift, value noise, no fetch.
//
// Not in v0 (listed in the report): lane stripes (needs the direction texture, M1), footprints (ring channel A),
// opposition surge / lunar-Lambert BRDF, cavity term from the height cube, per-preset density switches.
//
// TSL node typing in @types/three is strict per value type; this graph mixes float / vec2 / vec3 freely and is built once
// per material (never per frame), so it is typed loosely on purpose (same as the bench terrain stub).
/* eslint-disable @typescript-eslint/no-explicit-any */
type TslNode = any;

import {
  abs,
  cameraPosition,
  cameraViewMatrix,
  clamp,
  dFdx,
  dFdy,
  dot,
  float,
  floor,
  fract,
  fwidth,
  length,
  max,
  min,
  mix,
  normalWorldGeometry,
  normalize,
  positionWorld,
  sin,
  smoothstep,
  step,
  texture,
  transformDirection,
  uniform,
  vec2,
  vec3,
  vec4,
} from "three/tsl";
import {
  DataTexture,
  LinearFilter,
  LinearMipmapLinearFilter,
  MeshStandardNodeMaterial,
  NoColorSpace,
  RGBAFormat,
  RepeatWrapping,
  UnsignedByteType,
  Vector2,
  type Node,
  type Texture,
} from "three/webgpu";
import { SHADOW_FLAT_RECEIVER_KEY } from "../lighting/cascade-shadow-node";
import { keyDirectionUniform } from "../lighting/key-direction";
import { DETAIL_GRAD_RANGE, generateDetailTile } from "./detail-texture";
import {
  ALBEDO_CLEAN,
  ALBEDO_GRIME,
  BERM_HEIGHT_MAX_M,
  CLEAN_TINT,
  CLEAN_TINT_COOL,
  CLEAN_TINT_WARM,
  DETAIL_AMPLITUDE_M,
  DETAIL_FADE_M,
  DETAIL_GAIN,
  DETAIL_TILE_M,
  DUST_LAYER_DEPTH_M,
  GRAZING_DETAIL_MIN,
  GRAZING_DETAIL_SIN,
  GRIME_TINT,
  GRIME_TINT_COOL,
  GRIME_TINT_WARM,
  MACRO_CELL_M,
  MACRO_TONE,
  ROUGHNESS_CLEAN,
  ROUGHNESS_GRIME,
  ROUGHNESS_POLISHED,
  SPARKLE,
  TAU_BASE,
  TAU_RELIEF,
  THIN_BASE,
  THIN_SLOPE,
  type Rgb,
} from "./regolith-constants";
import type { MaskWorldRect } from "./stroke-mask";

/** Key under which a receiver publishes its far-occluder visibility node for the CSM node (visuals/lighting/sun-rig.ts). */
const HORIZON_VISIBILITY_KEY = "mcHorizonVisibility";

/** Five taps in the mask contract (r grime, g berm height, b polish) around a world point, `stepM` metres apart. */
export interface MaskTaps {
  readonly centre: TslNode;
  readonly px: TslNode;
  readonly nx: TslNode;
  readonly pz: TslNode;
  readonly nz: TslNode;
  readonly stepM: number;
  /** Texture fetches the taps cost per fragment. */
  readonly fetches: number;
}

/** A source that supplies the mask taps instead of the one mask texture (the dust tile atlas, `visuals/dust`). */
export interface MaskTapSource {
  /** Textures the source samples (counted as bindings of the material). */
  readonly textures: readonly Texture[];
  /** `xz`: world position (x, z) in metres. */
  build(xz: TslNode): MaskTaps;
}

export interface RegolithMaterialOptions {
  /** Mask texture (contract in mask-texture.ts) and the world rectangle / pixel size it covers. */
  readonly mask: Texture;
  readonly maskRect: MaskWorldRect;
  readonly maskSize: readonly [number, number];
  /** Supplies the five mask taps (centre + 4 neighbours) instead of `mask`; `mask` is then only counted, not sampled. */
  readonly maskSource?: MaskTapSource;
  /** Packed detail tile; default: the procedural tile (generated once per material). */
  readonly detail?: Texture;
  /** 0 = the look; 1 remaining dust, 2 berm, 3 polish, 4 relief height, 5 slope length, 6 thickness t, 7 normal. */
  readonly debugView?: number;
  /** Isolation switch: 1 geometric normal only, 2 + mask slope, 3 (default) + detail. */
  readonly normalMode?: number;
  /** Environment node (specular-only probe, M0-W2-T07 row 5: a `LightingNode` that adds only the radiance). */
  readonly envNode?: Node | null;
  /** Far-occluder (horizon map) visibility node multiplied into the cascade result by `MoonShadowNode`. */
  readonly horizonVisibility?: Node | null;
  /**
   * Large-scale tone and hue variation, 0..1 (regolith-constants `MACRO_*`). 0 / absent: none, and the graph does not
   * contain the term (calibration scenes). Fixed when the material is built.
   */
  readonly macroVariation?: number;
}

export interface RegolithUniforms {
  /** Macro albedo multiplier (mare / highland, +-15 %); 1 on calibration patches. */
  readonly macro: { value: number };
  /** Scale of the dust-layer step in the height field (0 = no step shading, 1 = full 2 cm). */
  readonly layerGain: { value: number };
  /** Scale of the berm height (1 = as written in the mask). */
  readonly bermGain: { value: number };
  /** Detail relief scale (0 = flat ground). */
  readonly detailGain: { value: number };
  /** Albedo breakup from the detail tile (0 = flat albedo). */
  readonly albedoVariation: { value: number };
  /** Glint grains on clean ground (0 = off). */
  readonly sparkle: { value: number };
  /** Grazing-sun detail fade (1 = on, the look; 0 = off, for A/B captures of the black bump terminators). */
  readonly grazingFade: { value: number };
}

export interface RegolithMaterial {
  readonly material: MeshStandardNodeMaterial;
  readonly uniforms: RegolithUniforms;
  /** Texture fetches one fragment performs (counted while the graph was built). */
  readonly fetchCount: number;
  /** Distinct textures the fragment stage samples (hard limit 16 per stage, target <= 12 for terrain). */
  readonly textureBindings: number;
  /** Swaps the mask texture / rectangle without rebuilding the material. */
  setMask(mask: Texture, rect: MaskWorldRect, size: readonly [number, number]): void;
  dispose(): void;
}

/** RGBA8 detail tile as a repeating, mipmapped, anisotropic data texture. */
export function createDetailTexture(seed?: number): DataTexture {
  const tile = generateDetailTile(undefined, seed);
  const texture = new DataTexture(tile.data, tile.size, tile.size, RGBAFormat, UnsignedByteType);
  texture.name = "mc:regolith-detail";
  texture.colorSpace = NoColorSpace;
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.magFilter = LinearFilter;
  texture.minFilter = LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = 8;
  texture.flipY = false;
  texture.needsUpdate = true;
  return texture;
}

// ---- TSL helpers ----------------------------------------------------------------------------------------------------

/** Dave Hoskins hash: stable for the large world coordinates a moon-sized terrain feeds it (no sin()). */
const hash12 = (p: TslNode): TslNode => {
  const p3: TslNode = fract(vec3(p.x, p.y, p.x).mul(0.1031));
  const q: TslNode = p3.add(dot(p3, p3.yzx.add(33.33)));
  return fract(q.x.add(q.y).mul(q.z));
};

/** One octave of value noise (four hashes, smooth blend). */
const valueNoise = (p: TslNode): TslNode => {
  const i: TslNode = floor(p);
  const f: TslNode = fract(p);
  const u: TslNode = f.mul(f).mul(f.mul(-2).add(3));
  const a = hash12(i);
  const b = hash12(i.add(vec2(1, 0)));
  const c = hash12(i.add(vec2(0, 1)));
  const d = hash12(i.add(vec2(1, 1)));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
};

const toVec3 = (rgb: Rgb): TslNode => vec3(rgb[0], rgb[1], rgb[2]);

export function createRegolithMaterial(options: RegolithMaterialOptions): RegolithMaterial {
  let fetchCount = 0;
  const bound = new Set<Texture>();
  const detailTexture = options.detail ?? createDetailTexture();
  const ownsDetail = options.detail === undefined;

  const maskBase: TslNode = texture(options.mask);
  const detailBase: TslNode = texture(detailTexture);
  bound.add(options.mask);
  bound.add(detailTexture);
  for (const t of options.maskSource?.textures ?? []) bound.add(t);
  const maskTap = (uv: TslNode): TslNode => {
    fetchCount += 1;
    return maskBase.sample(uv);
  };

  const rectOrigin = uniform(new Vector2(options.maskRect.originX, options.maskRect.originZ));
  const rectSize = uniform(new Vector2(options.maskRect.sizeX, options.maskRect.sizeZ));
  const texelUv = uniform(new Vector2(1 / options.maskSize[0], 1 / options.maskSize[1]));
  const texelM = uniform(
    new Vector2(options.maskRect.sizeX / options.maskSize[0], options.maskRect.sizeZ / options.maskSize[1]),
  );

  const macro = uniform(1);
  const layerGain = uniform(0.7);
  const bermGain = uniform(1.6);
  const detailGain = uniform(1);
  const albedoVariation = uniform(1);
  const sparkleOn = uniform(1);
  const grazingFade = uniform(1);

  const material = new MeshStandardNodeMaterial();
  material.name = "mc:regolith";
  material.metalness = 0;
  // Terrain takes no shadow normal offset on the key light's cascades (it would cut every ground shadow short at a low sun).
  material.userData[SHADOW_FLAT_RECEIVER_KEY] = true;
  if (options.envNode != null) material.envNode = options.envNode as never;
  if (options.horizonVisibility != null) material.userData[HORIZON_VISIBILITY_KEY] = options.horizonVisibility;

  const build = (): void => {
    const xz: TslNode = positionWorld.xz;
    const toCamera: TslNode = length(positionWorld.sub(cameraPosition));

    // ---- Mask: centre tap and four neighbours for the height gradient ---------------------------------------------
    const uvM: TslNode = xz.sub(rectOrigin).div(rectSize);
    // A mask source (the dust tile atlas) supplies the five taps itself; otherwise they come from the one mask texture.
    const sourced = options.maskSource?.build(xz) ?? null;
    if (sourced !== null) fetchCount += sourced.fetches;
    const centre: TslNode = sourced?.centre ?? maskTap(uvM);
    const tapPx: TslNode = sourced?.px ?? maskTap(uvM.add(vec2(texelUv.x, 0)));
    const tapNx: TslNode = sourced?.nx ?? maskTap(uvM.sub(vec2(texelUv.x, 0)));
    const tapPz: TslNode = sourced?.pz ?? maskTap(uvM.add(vec2(0, texelUv.y)));
    const tapNz: TslNode = sourced?.nz ?? maskTap(uvM.sub(vec2(0, texelUv.y)));
    const tapStepM: TslNode = sourced === null ? texelM : vec2(sourced.stepM, sourced.stepM);
    const remaining: TslNode = centre.r;
    const berm: TslNode = centre.g;
    const polish: TslNode = centre.b;
    // Height field of the mask in metres: the dust layer step plus the berm.
    const maskHeight = (tap: TslNode): TslNode =>
      tap.r.mul(layerGain.mul(DUST_LAYER_DEPTH_M)).add(tap.g.mul(bermGain.mul(BERM_HEIGHT_MAX_M)));
    const dHdx: TslNode = maskHeight(tapPx).sub(maskHeight(tapNx)).div(tapStepM.x.mul(2));
    const dHdz: TslNode = maskHeight(tapPz).sub(maskHeight(tapNz)).div(tapStepM.y.mul(2));
    // Steep steps (an edge ramp is ~1.2 cm wide for a 2 cm layer) would shimmer: cap the slope length.
    const maskSlope: TslNode = vec2(dHdx, dHdz);
    const maskSlopeLen: TslNode = max(length(maskSlope), 1e-5);
    const cappedMaskSlope: TslNode = maskSlope.mul(min(float(1), float(1.6).div(maskSlopeLen)));

    // ---- Detail at two scales, 2 stochastic taps each ------------------------------------------------------------
    const detailAt = (tileM: number, seed: number): TslNode => {
      const uv: TslNode = xz.div(tileM);
      const gx: TslNode = dFdx(uv);
      const gy: TslNode = dFdy(uv);
      // Low-frequency selector: each region of the world uses a different pair of tile offsets (no visible repeat).
      const k = valueNoise(uv.mul(0.11).add(seed));
      const l = k.mul(8);
      const idx = floor(l);
      const f = fract(l);
      const offA = sin(vec2(3, 7).mul(idx.add(0.5)).add(seed));
      const offB = sin(vec2(3, 7).mul(idx.add(1.5)).add(seed));
      fetchCount += 2;
      const a: TslNode = detailBase.sample(uv.add(offA)).grad(gx, gy);
      const b: TslNode = detailBase.sample(uv.add(offB)).grad(gx, gy);
      const w = smoothstep(0.2, 0.8, f.sub(a.r.sub(b.r).mul(0.1)));
      return mix(a, b, w);
    };
    const fine: TslNode = detailAt(DETAIL_TILE_M.fine, 3.7);
    const coarse: TslNode = detailAt(DETAIL_TILE_M.coarse, 11.3);

    // Grazing-angle fade (M0-W3-T03b): where the pixel footprint on the ground is very elongated (view almost parallel to the
    // ground) the anisotropic filter cannot keep up and the packed gradients smear into radial streaks; fade detail out there.
    const footX: TslNode = length(dFdx(xz));
    const footY: TslNode = length(dFdy(xz));
    const stretch: TslNode = max(footX, footY).div(max(min(footX, footY), 1e-6));
    const grazeFade: TslNode = float(1).sub(smoothstep(9, 26, stretch));
    const fadeFine: TslNode = float(1)
      .sub(smoothstep(DETAIL_FADE_M.fine[0], DETAIL_FADE_M.fine[1], toCamera))
      .mul(grazeFade);
    const fadeCoarse: TslNode = float(1)
      .sub(smoothstep(DETAIL_FADE_M.coarse[0], DETAIL_FADE_M.coarse[1], toCamera))
      .mul(grazeFade);

    // ---- Presence mask and thickness (partial removal) ------------------------------------------------------------
    const relief: TslNode = fine.r.mul(0.65).add(coarse.r.mul(0.35));
    const footprint: TslNode = max(length(dFdx(xz)), length(dFdy(xz)));
    const subPixel: TslNode = smoothstep(0.006, 0.03, footprint);
    const hEff: TslNode = mix(relief, float(0.5), subPixel);
    const tau: TslNode = hEff.mul(TAU_RELIEF).add(TAU_BASE);
    const w: TslNode = max(fwidth(remaining), 0.012);
    const presence: TslNode = smoothstep(tau.sub(w), tau.add(w), remaining);
    const thickness: TslNode = presence.mul(remaining.mul(THIN_SLOPE).add(THIN_BASE));

    // ---- Normal: one surface-gradient perturbation of the geometric normal ----------------------------------------
    const detailGainNow: TslNode = detailGain.mul(mix(float(DETAIL_GAIN.clean), float(DETAIL_GAIN.grime), thickness));
    const slopeFine: TslNode = vec2(fine.g, fine.b)
      .mul(2)
      .sub(1)
      .mul((DETAIL_GRAD_RANGE * DETAIL_AMPLITUDE_M.fine) / DETAIL_TILE_M.fine)
      .mul(fadeFine);
    const slopeCoarse: TslNode = vec2(coarse.g, coarse.b)
      .mul(2)
      .sub(1)
      .mul((DETAIL_GRAD_RANGE * DETAIL_AMPLITUDE_M.coarse) / DETAIL_TILE_M.coarse)
      .mul(fadeCoarse);
    // Grazing-sun fade: full relief from 20 degrees of local sun elevation, proportionally flatter below.
    const sunOnGround: TslNode = max(dot(normalWorldGeometry, keyDirectionUniform), 0);
    const grazingGain: TslNode = mix(
      float(1),
      clamp(sunOnGround.div(GRAZING_DETAIL_SIN), GRAZING_DETAIL_MIN, 1),
      grazingFade,
    );
    const slope: TslNode = cappedMaskSlope.add(slopeFine.add(slopeCoarse).mul(detailGainNow.mul(grazingGain)));
    const surfaceGradient: TslNode = vec3(slope.x, 0, slope.y);
    const geometric: TslNode = normalWorldGeometry;
    const tangentGradient: TslNode = surfaceGradient.sub(geometric.mul(dot(geometric, surfaceGradient)));
    const worldNormal: TslNode = normalize(geometric.sub(tangentGradient));

    // ---- Colour ---------------------------------------------------------------------------------------------------
    // Albedo breakup and cavity fade out with distance (stretched at grazing angles they would streak).
    // The albedo terms fade earlier than the normals (M0-W3-T03b: they carried the faint radial streaks of 25 m grazing views).
    const fadeAlbedo: TslNode = float(1)
      .sub(smoothstep(6, 20, toCamera))
      .mul(grazeFade);
    const breakup: TslNode = fine.a.mul(0.5).add(coarse.a.mul(0.5)).sub(0.5).mul(fadeAlbedo);
    const cavity: TslNode = mix(float(1), mix(float(0.95), float(1.05), relief), fadeAlbedo);
    // Macro variation (optional): two octaves of value noise drive a tone multiplier (mean 1) and a warm / cool hue drift.
    const macroAmount = Math.min(1, Math.max(0, options.macroVariation ?? 0));
    let cleanTint: TslNode = toVec3(CLEAN_TINT);
    let grimeTint: TslNode = toVec3(GRIME_TINT);
    let macroTone: TslNode = float(1);
    if (macroAmount > 0) {
      const large: TslNode = valueNoise(xz.div(MACRO_CELL_M.large).add(7.3));
      const medium: TslNode = valueNoise(xz.div(MACRO_CELL_M.medium).add(31.1));
      macroTone = float(1)
        .add(large.sub(0.5).mul(2 * MACRO_TONE.large * macroAmount))
        .add(medium.sub(0.5).mul(2 * MACRO_TONE.medium * macroAmount));
      const hue: TslNode = smoothstep(0.3, 0.7, large.mul(0.6).add(medium.mul(0.4)));
      const drift: TslNode = mix(float(0.5), hue, macroAmount);
      cleanTint = mix(toVec3(CLEAN_TINT_WARM), toVec3(CLEAN_TINT_COOL), drift);
      grimeTint = mix(toVec3(GRIME_TINT_WARM), toVec3(GRIME_TINT_COOL), drift);
    }
    const cleanAlbedo: TslNode = cleanTint
      .mul(ALBEDO_CLEAN)
      .mul(macro.mul(macroTone))
      .mul(float(1).add(breakup.mul(albedoVariation.mul(0.1))))
      .mul(mix(float(1), cavity, albedoVariation));
    const grimeAlbedo: TslNode = grimeTint
      .mul(ALBEDO_GRIME)
      .mul(macro.mul(macroTone))
      .mul(float(1).add(breakup.mul(albedoVariation.mul(0.2))))
      .mul(mix(float(1), cavity, albedoVariation));

    // Glint grains on world cells of clean ground: round, stable under TAA, fade out with distance.
    const cell: TslNode = xz.div(SPARKLE.cellM);
    const cellId: TslNode = floor(cell);
    const inCell: TslNode = fract(cell).sub(0.5);
    const grain: TslNode = step(float(1).sub(SPARKLE.density), hash12(cellId)).mul(
      float(1).sub(smoothstep(0.28, 0.4, length(inCell))),
    );
    const sparkleFade: TslNode = float(1).sub(smoothstep(SPARKLE.fadeNearM, SPARKLE.fadeFarM, toCamera));
    const glint: TslNode = grain.mul(sparkleFade).mul(float(1).sub(thickness)).mul(sparkleOn);
    const glintBoost: TslNode = float(1).add(glint.mul(SPARKLE.boost));

    const albedo: TslNode = mix(cleanAlbedo.mul(glintBoost), grimeAlbedo, thickness);
    const roughness: TslNode = mix(
      mix(float(ROUGHNESS_CLEAN), float(ROUGHNESS_POLISHED), polish),
      float(ROUGHNESS_GRIME),
      thickness,
    );

    const debugValues: TslNode[] = [
      remaining,
      berm,
      polish,
      relief,
      length(slope).mul(2),
      thickness,
      worldNormal.mul(0.5).add(0.5),
    ];
    const debugValue: TslNode | undefined = options.debugView ? debugValues[options.debugView - 1] : undefined;
    material.colorNode = debugValue === undefined ? vec4(albedo, 1) : vec4(vec3(debugValue), 1);
    material.roughnessNode = roughness;
    const nm = options.normalMode ?? 3;
    // `transformNormalToView` is LOCAL -> view (model normal matrix); our normal is in WORLD space: use the view matrix.
    const finalNormal: TslNode =
      nm === 1
        ? normalWorldGeometry
        : nm === 2
          ? normalize(geometric.sub(vec3(cappedMaskSlope.x, 0, cappedMaskSlope.y)))
          : worldNormal;
    material.normalNode = normalize(transformDirection(finalNormal, cameraViewMatrix));
    void abs;
  };
  build();

  return {
    material,
    uniforms: { macro, layerGain, bermGain, detailGain, albedoVariation, sparkle: sparkleOn, grazingFade },
    fetchCount,
    textureBindings: bound.size,
    setMask(mask, rect, size) {
      bound.delete(maskBase.value);
      maskBase.value = mask;
      bound.add(mask);
      rectOrigin.value.set(rect.originX, rect.originZ);
      rectSize.value.set(rect.sizeX, rect.sizeZ);
      texelUv.value.set(1 / size[0], 1 / size[1]);
      texelM.value.set(rect.sizeX / size[0], rect.sizeZ / size[1]);
    },
    dispose() {
      material.dispose();
      if (ownsDetail) detailTexture.dispose();
    },
  };
}

// ---- Calibration chips ---------------------------------------------------------------------------------------------

/** Flat, matte, neutral (or tinted) chip of a given linear albedo: the VT-M0-06 chart and the VT-M0-08 patches. */
export function createChipMaterial(albedo: number, tint: Rgb = [1, 1, 1], name = "chip"): MeshStandardNodeMaterial {
  const material = new MeshStandardNodeMaterial();
  material.name = `mc:chip:${name}`;
  material.metalness = 0;
  material.roughnessNode = float(1);
  material.colorNode = vec3(tint[0] * albedo, tint[1] * albedo, tint[2] * albedo);
  return material;
}
