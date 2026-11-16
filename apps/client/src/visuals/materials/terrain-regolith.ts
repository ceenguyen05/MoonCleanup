// Production terrain regolith (M1-W2-T04): TSL graph on a `MeshLambertNodeMaterial` (diffuse only, the terrain's choice:
// a standard specular lobe overshoots at grazing view toward a low sun). Identical on WebGPU and the WebGL2 backend.
// Numbers: terrain-regolith-constants.ts. Look: art-direction regolith sections; REFERENCE_TARGET RF-01.
//
// Per fragment (`fetchCount`: the worst case), all from ONE packed detail tile (detail-texture.ts):
//   close                   fine 1.28 m + coarse 4.27 m, 2 stochastic taps each   = 4 (fade out by 28 / 70 m)
//   mid / far               mid 9.5 m, broad 37 m, macro 585 m, 1 tap each       = 3
// The close block runs inside a branch: coarse only nearer than 70 m, fine only nearer than 28 m, and neither where the
// grazing-view fade has already removed them (derivatives are taken before the branch; its taps use explicit gradients).
// Mid / far taps use the hardware's own derivatives (plain samples are cheaper than gradient samples on Intel Gen9).
// No new texture binding beyond the tile; no vertex work (the terrain is vertex-bound).
//
// Coordinate: mesh-local position + mesh position wrapped to REGOLITH_PERIOD_M (CPU doubles, per object), projected on
// the dominant world axis of the fragment's direction from the moon centre (Boreal = +Y face = x / z). Known limits:
// tilt stretch up to 1/cos(slope) on steep walls, and a pattern seam exactly on cube-face edges (>= 1360 km from Boreal).
//
// Layer hooks (`layers`): footprints / tracks (M1-W5-T05) and the dust mask return a slope in projection-plane metres,
// an albedo multiplier and / or a dust thickness (1 = full grime, 0 = clean ground); see `RegolithLayer`.

/* eslint-disable @typescript-eslint/no-explicit-any */
type TslNode = any;

import {
  clamp,
  cameraViewMatrix,
  cameraWorldMatrix,
  dFdx,
  dFdy,
  dot,
  float,
  floor,
  Fn,
  fract,
  If,
  length,
  max,
  mix,
  normalize,
  positionLocal,
  positionView,
  positionWorld,
  select,
  sin,
  smoothstep,
  texture,
  transformDirection,
  uniform,
  vec2,
  vec3,
  vec4,
} from "three/tsl";
import { MeshLambertNodeMaterial, Vector3, type NodeMaterial, type Object3D, type Texture } from "three/webgpu";
import { SHADOW_FLAT_RECEIVER_KEY } from "../lighting/cascade-shadow-node";
import { keyDirectionUniform } from "../lighting/key-direction";
import { DETAIL_GRAD_RANGE } from "./detail-texture";
import { createDetailTexture } from "./regolith-material";
import {
  ALBEDO_CLEAN,
  ALBEDO_GRIME,
  CLEAN_TINT,
  GRAZING_DETAIL_MIN,
  GRAZING_DETAIL_SIN,
  GRIME_TINT,
  GRIME_TINT_COOL,
  GRIME_TINT_WARM,
  type Rgb,
} from "./regolith-constants";
import {
  CAVITY,
  CLOSE_BLOCK_END_M,
  FINE_BLOCK_END_M,
  GRAZE_STRETCH,
  GRAZE_STRETCH_FAR,
  GRAZE_TONE_FLOOR,
  REGOLITH_PERIOD_M,
  SELECTOR_GAIN,
  SELECTOR_TILES,
  TERRAIN_DETAIL_ANISOTROPY,
  TERRAIN_DETAIL,
  tileM,
  wrapPeriod,
  type DetailScale,
} from "./terrain-regolith-constants";

/** What a layer gets: all nodes of the fragment stage. */
export interface RegolithLayerContext {
  /** Precise projection-plane coordinate (m), periodic in REGOLITH_PERIOD_M: stable under camera motion. */
  readonly coord: TslNode;
  /** Mesh-local (camera-relative for the CDLOD terrain) position, precise. */
  readonly local: TslNode;
  /** World position (moon centre origin; ~0.125 m precision at the surface: for lookups at >= metre scale). */
  readonly world: TslNode;
  /** Distance to the camera (m). */
  readonly toCamera: TslNode;
  /** Unit world normal of the terrain surface before regolith detail. */
  readonly normal: TslNode;
  /** Maps a projection-plane slope vec2 to a world-axis surface gradient vec3 (for layers that need it). */
  toWorldGradient(slope: TslNode): TslNode;
}

/** A layer's contribution; omitted fields leave the look unchanged. */
export interface RegolithLayerResult {
  /** Height slope (dh/dcoord, vec2, metres per metre) added to the detail slope. */
  readonly slope?: TslNode;
  /** Albedo multiplier (1 = unchanged). */
  readonly albedo?: TslNode;
  /** Dust thickness 0..1 (1 = grime, 0 = clean). Several layers multiply. */
  readonly thickness?: TslNode;
  /** Texture fetches the layer performs per fragment. */
  readonly fetches?: number;
  /** Textures it samples (counted as bindings). */
  readonly textures?: readonly Texture[];
}

export type RegolithLayer = (ctx: RegolithLayerContext) => RegolithLayerResult;

export interface TerrainRegolithOptions {
  /** Packed detail tile; default: the procedural tile (owned and disposed by the regolith). */
  readonly detail?: Texture;
  /** Footprint / track / dust-mask layers, applied in order. */
  readonly layers?: readonly RegolithLayer[];
  /** One tap per close scale instead of two (Low preset; repeat shows more at 1:1). Default false. */
  readonly singleTap?: boolean;
  /** 1 tone multiplier, 2 relief, 3 detail normal, 4 projection axis (diagnostics); 0 / absent = the look. */
  readonly debugView?: number;
  /** Cost A/B only (`&rgcost=`): see `RegolithCostSplit`. */
  readonly costSplits?: readonly RegolithCostSplit[];
  /** Look-dev override of GRAZE_STRETCH_FAR (`&rggraze=a,b`). */
  readonly grazeStretchFar?: readonly [number, number];
  /** Look-dev scale of the mid / broad relief amplitudes (`&rgfar=<x>`); default 1. */
  readonly farReliefScale?: number;
}

/**
 * Cost splits for GPU A/B (never the look): `noclose` drops the close block, `nofar` the mid / broad / macro taps,
 * `nobranch` evaluates the close block without its distance branch, `gradfar` samples mid / far with explicit gradients,
 * `oldsel` uses the checkpoint-1 value-noise selector for the close taps, `localvary` the mesh-local position varying.
 */
export type RegolithCostSplit = "noclose" | "nofar" | "nobranch" | "gradfar" | "oldsel" | "localvary";

export interface TerrainRegolithUniforms {
  /** Detail relief scale (0 = flat: the geometric terrain normal only). */
  readonly detailGain: { value: number };
  /** Albedo breakup scale (0 = flat grime albedo, the plain terrain's tone). */
  readonly albedoVariation: { value: number };
  /** Grazing-sun relief fade (1 = on; 0 for A/B of black bump terminators). */
  readonly grazingFade: { value: number };
}

export interface TerrainRegolith {
  readonly uniforms: TerrainRegolithUniforms;
  readonly fetchCount: number;
  readonly textureBindings: number;
  dispose(): void;
}

/** Terrain surface fields the regolith needs (structural; `TerrainSurface` from the terrain module satisfies it). */
export interface RegolithSurfaceHooks {
  /** World-space surface normal in the fragment stage. */
  readonly normalWorld: TslNode;
}

const toVec3 = (rgb: Rgb): TslNode => vec3(rgb[0], rgb[1], rgb[2]);

/** Floor-based modulo (identical on WGSL and GLSL, unlike a truncating `%`). */
const fmod = (x: TslNode, y: TslNode | number): TslNode => x.sub(floor(x.div(y)).mul(y));

/** Dave Hoskins hash (no sin()), as the M0 regolith. */
const hash12 = (p: TslNode): TslNode => {
  const p3: TslNode = fract(vec3(p.x, p.y, p.x).mul(0.1031));
  const q: TslNode = p3.add(dot(p3, p3.yzx.add(33.33)));
  return fract(q.x.add(q.y).mul(q.z));
};

/** Value noise periodic over `period` cells (the coordinate wrap shifts cells by whole periods). */
const periodicValueNoise = (p: TslNode, period: number): TslNode => {
  const i: TslNode = floor(p);
  const f: TslNode = fract(p);
  const u: TslNode = f.mul(f).mul(f.mul(-2).add(3));
  const i0: TslNode = fmod(i, period);
  const i1: TslNode = fmod(i.add(1), period);
  const a = hash12(i0);
  const b = hash12(vec2(i1.x, i0.y));
  const c = hash12(vec2(i0.x, i1.y));
  const d = hash12(i1);
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
};

/**
 * Builds the regolith graph on `material` (colour + normal). `normalWorld` is the terrain's per-fragment world normal.
 * The material must draw a mesh whose world matrix is a pure translation to the camera position (the CDLOD mesh): the
 * local position is then the camera-to-fragment vector, which gives the camera distance without a view-space varying.
 */
export function applyTerrainRegolith(
  material: NodeMaterial,
  normalWorld: TslNode,
  options: TerrainRegolithOptions = {},
): TerrainRegolith {
  let fetchCount = 0;
  const bound = new Set<Texture>();
  const detailTexture = options.detail ?? createDetailTexture();
  if (options.detail === undefined) detailTexture.anisotropy = TERRAIN_DETAIL_ANISOTROPY;
  const ownsDetail = options.detail === undefined;
  bound.add(detailTexture);
  const detailBase: TslNode = texture(detailTexture);

  const detailGain = uniform(1);
  const albedoVariation = uniform(1);
  const grazingFade = uniform(1);

  // Mesh position wrapped to the period, in doubles, per drawn object.
  const wrapped = uniform(new Vector3());
  wrapped.onObjectUpdate(({ object }: { object: Object3D | null }) => {
    if (object === null) return;
    const p = object.position;
    wrapped.value.set(wrapPeriod(p.x), wrapPeriod(p.y), wrapPeriod(p.z));
  });

  // Camera-to-fragment vector in world axes. Default: rotated back from the view position the cascades already carry
  // (no extra varying on the vertex-bound terrain; precise: the model-view translation is camera-relative). The CDLOD
  // mesh sits at the camera, so this equals its local position (`&rgcost=localvary`: that varying, A/B).
  const split = new Set(options.costSplits ?? []);
  const local: TslNode = split.has("localvary") ? positionLocal : cameraWorldMatrix.mul(vec4(positionView, 0)).xyz;
  const precise: TslNode = local.add(wrapped);
  const world: TslNode = positionWorld;
  const aw: TslNode = world.abs();
  const onY: TslNode = aw.y.greaterThanEqual(aw.x).and(aw.y.greaterThanEqual(aw.z));
  const onX: TslNode = aw.x.greaterThanEqual(aw.z);
  const coord: TslNode = select(onY, precise.xz, select(onX, precise.zy, precise.xy));
  const toWorldGradient = (s: TslNode): TslNode =>
    select(onY, vec3(s.x, 0, s.y), select(onX, vec3(0, s.y, s.x), vec3(s.x, s.y, 0)));
  // The CDLOD mesh sits at the camera, so the local position is the camera-to-fragment vector (no positionView varying).
  const toCamera: TslNode = length(local);
  const base: TslNode = normalize(normalWorld);

  // Grazing-view fade: an elongated pixel footprint smears the packed gradients into radial streaks. The mid / broad
  // normals fade earlier (GRAZE_STRETCH_FAR): their tiles are minified along the view at mid range, and a filtered
  // gradient there draws faint along-view streaks under a high sun.
  const dcx: TslNode = dFdx(coord);
  const dcy: TslNode = dFdy(coord);
  // Footprint elongation = 1 / cos(incidence) of the view ray on the surface (analytic: no derivative lengths).
  const stretch: TslNode = toCamera.div(max(dot(local, base).abs(), toCamera.mul(1e-3)));
  const grazeFade: TslNode = float(1).sub(smoothstep(GRAZE_STRETCH[0], GRAZE_STRETCH[1], stretch));
  const grazeFar = options.grazeStretchFar ?? GRAZE_STRETCH_FAR;
  const grazeFadeFar: TslNode = float(1).sub(smoothstep(grazeFar[0], grazeFar[1], stretch));
  const fadeAt = (scale: DetailScale, distance: TslNode): TslNode =>
    scale.fadeM === null ? float(1) : float(1).sub(smoothstep(scale.fadeM[0], scale.fadeM[1], distance));
  const fadeOf = (scale: DetailScale): TslNode => fadeAt(scale, toCamera);

  /**
   * One scale: packed sample (r relief, gb gradient, a albedo) at coordinate `c`. Two stochastic taps (or one) with the
   * explicit gradients `dx` / `dy` (safe in a branch), or, with `dx === null`, one plain sample (outside any branch).
   */
  const sampleScale = (
    scale: DetailScale,
    seed: number,
    twoTaps: boolean,
    c: TslNode,
    dx: TslNode | null,
    dy: TslNode | null,
    selector: TslNode | null = null,
  ): TslNode => {
    const t = tileM(scale);
    const uv: TslNode = c.div(t);
    if (dx === null || dy === null) {
      return detailBase.sample(uv.add(seed * 0.137));
    }
    const gx: TslNode = dx.div(t);
    const gy: TslNode = dy.div(t);
    if (!twoTaps) {
      return detailBase.sample(uv.add(seed * 0.137)).grad(gx, gy);
    }
    if (selector !== null) {
      // Cheap selector (default): a smooth field already fetched (the macro texel, periodic in the wrap) picks a pair of
      // golden-ratio tile offsets; no noise, no transcendental.
      const l: TslNode = selector.mul(SELECTOR_GAIN).add(seed);
      const idx: TslNode = floor(l);
      const f: TslNode = fract(l);
      const offA: TslNode = fract(vec2(0.6180339887, 0.7548776662).mul(idx));
      const offB: TslNode = fract(vec2(0.6180339887, 0.7548776662).mul(idx.add(1)));
      const a: TslNode = detailBase.sample(uv.add(offA)).grad(gx, gy);
      const b: TslNode = detailBase.sample(uv.add(offB)).grad(gx, gy);
      return mix(a, b, smoothstep(0.2, 0.8, f.sub(a.r.sub(b.r).mul(0.1))));
    }
    // Noise selector (`&rgcost=oldsel`): cells of SELECTOR_TILES tiles pick a pair of tile offsets (periodic in the wrap).
    const k: TslNode = periodicValueNoise(uv.div(SELECTOR_TILES).add(seed), scale.tiles / SELECTOR_TILES);
    const l: TslNode = k.mul(8);
    const idx: TslNode = floor(l);
    const f: TslNode = fract(l);
    const offA: TslNode = sin(vec2(3, 7).mul(idx.add(0.5)).add(seed));
    const offB: TslNode = sin(vec2(3, 7).mul(idx.add(1.5)).add(seed));
    const a: TslNode = detailBase.sample(uv.add(offA)).grad(gx, gy);
    const b: TslNode = detailBase.sample(uv.add(offB)).grad(gx, gy);
    const w: TslNode = smoothstep(0.2, 0.8, f.sub(a.r.sub(b.r).mul(0.1)));
    return mix(a, b, w);
  };
  const slopeOf = (texel: TslNode, scale: DetailScale): TslNode =>
    vec2(texel.g, texel.b)
      .mul(2)
      .sub(1)
      .mul((DETAIL_GRAD_RANGE * scale.amplitudeM) / tileM(scale));

  // ---- Close: fine pebbles + coarse clods -> vec4(slope.xy, tone, relief) -----------------------------------------
  const twoTaps = options.singleTap !== true;
  const oldSel = split.has("oldsel");
  /** The close block from its two texels (a neutral texel, 0.5 everywhere, adds nothing). */
  const closeOf = (fine: TslNode, coarse: TslNode, distance: TslNode, graze: TslNode): TslNode => {
    const fFine: TslNode = fadeAt(TERRAIN_DETAIL.fine, distance).mul(graze);
    const fCoarse: TslNode = fadeAt(TERRAIN_DETAIL.coarse, distance).mul(graze);
    const slope: TslNode = slopeOf(fine, TERRAIN_DETAIL.fine)
      .mul(fFine)
      .add(slopeOf(coarse, TERRAIN_DETAIL.coarse).mul(fCoarse));
    const tone: TslNode = fine.a
      .sub(0.5)
      .mul(TERRAIN_DETAIL.fine.albedo * 2)
      .mul(fFine)
      .add(
        coarse.a
          .sub(0.5)
          .mul(TERRAIN_DETAIL.coarse.albedo * 2)
          .mul(fCoarse),
      );
    const fCavity: TslNode = float(1)
      .sub(smoothstep(CAVITY.fadeM[0], CAVITY.fadeM[1], distance))
      .mul(graze);
    const relief: TslNode = mix(float(0.5), fine.r.mul(0.65).add(coarse.r.mul(0.35)), fCavity);
    return vec4(slope, tone, relief);
  };
  // Mid / far taps first: the macro texel also drives the close block's stochastic selector.
  const noFar = split.has("nofar");
  const gradFar = split.has("gradfar");
  const neutral: TslNode = vec4(0.5, 0.5, 0.5, 0.5);
  const farTap = (scale: DetailScale, seed: number): TslNode =>
    noFar ? neutral : sampleScale(scale, seed, false, coord, gradFar ? dcx : null, gradFar ? dcy : null);
  const mid: TslNode = farTap(TERRAIN_DETAIL.mid, 23.9);
  const broad: TslNode = farTap(TERRAIN_DETAIL.broad, 41.3);
  const macro: TslNode = farTap(TERRAIN_DETAIL.macro, 7.1);
  // Worst-case taps, counted here (the branch body is built lazily, by the renderer).
  if (!split.has("noclose")) fetchCount += twoTaps ? 4 : 2;
  if (!split.has("nofar")) fetchCount += 3;
  let close: TslNode;
  if (split.has("noclose")) {
    close = vec4(0, 0, 0, 0.5);
  } else if (split.has("nobranch")) {
    close = closeOf(
      sampleScale(TERRAIN_DETAIL.fine, 3.7, twoTaps, coord, dcx, dcy, oldSel ? null : macro.a),
      sampleScale(TERRAIN_DETAIL.coarse, 11.3, twoTaps, coord, dcx, dcy, oldSel ? null : macro.r),
      toCamera,
      grazeFade,
    );
  } else {
    // Branch: nothing past CLOSE_BLOCK_END_M or where the grazing fade is 0; fine only nearer than FINE_BLOCK_END_M.
    // Every input is a variable assigned before the branch (derivatives must not be taken inside it).
    close = Fn(() => {
      const c = coord.toVar();
      const dx = dcx.toVar();
      const dy = dcy.toVar();
      const distance = toCamera.toVar();
      const graze = grazeFade.toVar();
      const sel = macro.toVar();
      const result = vec4(0, 0, 0, 0.5).toVar();
      If(distance.lessThan(CLOSE_BLOCK_END_M).and(graze.greaterThan(0)), () => {
        const coarse = sampleScale(TERRAIN_DETAIL.coarse, 11.3, twoTaps, c, dx, dy, oldSel ? null : sel.r).toVar();
        const fine = vec4(0.5, 0.5, 0.5, 0.5).toVar();
        If(distance.lessThan(FINE_BLOCK_END_M), () => {
          fine.assign(sampleScale(TERRAIN_DETAIL.fine, 3.7, twoTaps, c, dx, dy, oldSel ? null : sel.a));
        });
        result.assign(closeOf(fine, coarse, distance, graze));
      });
      return result;
    })();
  }
  const closeSlope: TslNode = close.xy;
  const closeTone: TslNode = close.z;
  const relief: TslNode = close.w;

  // ---- Mid / far: one tap each -------------------------------------------------------------------------------------
  const broadGraze: TslNode = mix(float(GRAZE_TONE_FLOOR), float(1), grazeFadeFar);
  const fMid: TslNode = fadeOf(TERRAIN_DETAIL.mid).mul(grazeFadeFar);
  const fBroad: TslNode = fadeOf(TERRAIN_DETAIL.broad);
  const farSlope: TslNode = slopeOf(mid, TERRAIN_DETAIL.mid)
    .mul(fMid)
    .add(slopeOf(broad, TERRAIN_DETAIL.broad).mul(fBroad.mul(grazeFadeFar)))
    .mul(options.farReliefScale ?? 1);
  const tone: TslNode = closeTone
    .add(
      mid.a
        .sub(0.5)
        .mul(TERRAIN_DETAIL.mid.albedo * 2)
        .mul(fadeOf(TERRAIN_DETAIL.mid))
        .mul(grazeFadeFar),
    )
    .add(
      broad.a
        .sub(0.5)
        .mul(TERRAIN_DETAIL.broad.albedo * 2)
        .mul(fBroad)
        .mul(broadGraze),
    )
    .add(macro.a.sub(0.5).mul(TERRAIN_DETAIL.macro.albedo * 2));
  const toneMul: TslNode = clamp(float(1).add(tone.mul(albedoVariation)), 0.55, 1.5);
  // Warm umber <-> cool slate drift of the dust at constant luma, driven by the far scales.
  // The broad share fades at a grazing view as its tone does (its blobs read as streaks there).
  const hue: TslNode = smoothstep(0.35, 0.65, mix(macro.a, macro.a.mul(0.6).add(broad.a.mul(0.4)), broadGraze));
  const grimeTint: TslNode = mix(toVec3(GRIME_TINT), mix(toVec3(GRIME_TINT_WARM), toVec3(GRIME_TINT_COOL), hue), 0.5);

  // ---- Layers (footprints, tracks, dust mask) ----------------------------------------------------------------------
  let layerSlope: TslNode = vec2(0, 0);
  let layerAlbedo: TslNode = float(1);
  let thickness: TslNode = float(1);
  const ctx: RegolithLayerContext = { coord, local, world, toCamera, normal: base, toWorldGradient };
  for (const layer of options.layers ?? []) {
    const r = layer(ctx);
    if (r.slope !== undefined) layerSlope = layerSlope.add(r.slope);
    if (r.albedo !== undefined) layerAlbedo = layerAlbedo.mul(r.albedo);
    if (r.thickness !== undefined) thickness = thickness.mul(r.thickness);
    fetchCount += r.fetches ?? 0;
    for (const t of r.textures ?? []) bound.add(t);
  }

  // ---- Normal: one surface-gradient perturbation of the terrain normal ------------------------------------------
  const sunOnGround: TslNode = max(dot(base, keyDirectionUniform), 0);
  const grazingGain: TslNode = mix(
    float(1),
    clamp(sunOnGround.div(GRAZING_DETAIL_SIN), GRAZING_DETAIL_MIN, 1),
    grazingFade,
  );
  // Dust is softer than clean ground (art-direction "soft, clumpy" vs "crisper grain").
  const softness: TslNode = mix(float(1), float(0.65), thickness);
  const slope: TslNode = closeSlope.add(farSlope).mul(detailGain.mul(grazingGain).mul(softness)).add(layerSlope);
  const g: TslNode = toWorldGradient(slope);
  const tangentGradient: TslNode = g.sub(base.mul(dot(base, g)));
  const worldNormal: TslNode = normalize(base.sub(tangentGradient));

  // ---- Colour -----------------------------------------------------------------------------------------------------
  const cavity: TslNode = mix(float(CAVITY.low), float(CAVITY.high), relief);
  const variation: TslNode = toneMul.mul(mix(float(1), cavity, albedoVariation)).mul(layerAlbedo);
  const grime: TslNode = grimeTint.mul(ALBEDO_GRIME);
  const clean: TslNode = toVec3(CLEAN_TINT).mul(ALBEDO_CLEAN);
  const albedo: TslNode = mix(clean, grime, thickness).mul(variation);

  const debug = options.debugView ?? 0;
  const debugColour: TslNode[] = [
    vec3(toneMul.mul(0.5)),
    vec3(relief),
    worldNormal.mul(0.5).add(0.5),
    select(onY, vec3(0, 1, 0), select(onX, vec3(1, 0, 0), vec3(0, 0, 1))),
  ];
  material.colorNode = debug > 0 && debug <= debugColour.length ? vec4(debugColour[debug - 1], 1) : vec4(albedo, 1);
  material.normalNode = normalize(transformDirection(worldNormal, cameraViewMatrix));
  material.needsUpdate = true;

  return {
    uniforms: { detailGain, albedoVariation, grazingFade },
    fetchCount,
    textureBindings: bound.size,
    dispose() {
      if (ownsDetail) detailTexture.dispose();
    },
  };
}

/**
 * Terrain material factory with the CDLOD factory's shape, for `TerrainScene`'s material hook (H1) through
 * `TerrainRegolithProvider`. `applySurface` is `applyTerrainSurface` from the terrain module.
 */
export function createTerrainRegolithMaterial<S extends RegolithSurfaceHooks>(
  surface: S,
  applySurface: (material: NodeMaterial, surface: S) => void,
  options: TerrainRegolithOptions = {},
): { material: NodeMaterial; regolith: TerrainRegolith } {
  const material = new MeshLambertNodeMaterial();
  material.name = "mc:terrain-regolith";
  material.userData[SHADOW_FLAT_RECEIVER_KEY] = true;
  const regolith = applyTerrainRegolith(material, surface.normalWorld, options);
  applySurface(material, surface);
  return { material, regolith };
}

/** Period exported for tests / reports. */
export const TERRAIN_REGOLITH_PERIOD_M = REGOLITH_PERIOD_M;
