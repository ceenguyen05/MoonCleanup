// Vertex stage of the CDLOD terrain and the material hooks (WDS section 3.6; hooks for M1-W2-T04's regolith).
//
// Per vertex: grid index -> chained morph (`MORPH_STAGES` levels, same LOD distance as `cdlod/select.ts`) -> (face, a, b)
// -> equal-angle direction -> H (height twin) -> position = dir (R + H), written camera-relative: the mesh sits at the
// camera (CPU doubles) and the shader adds `origin` = moon centre - mesh position, so no large coordinate reaches the
// projection. The world normal comes from the slope of H (base: central differences at +-1/2 height texel, read from one
// 3x3 texel window; detail: analytic) and is handed to the fragment stage in the varying `terrainNormalWorld`.
//
// Procedural detail fades out with the LOD distance where the grid can no longer carry it (`DETAIL_FADES_M`), so far
// vertices skip the crater and noise loops. The JS ground function keeps full detail everywhere; within the fade-in
// distances the mesh is the JS ground.
//
// Hooks: `applyTerrainSurface(material, surface)` makes any NodeMaterial a terrain surface (position + shadow
// position); the material reads `surface.normalWorld` where a flat-world material would read `normalWorldGeometry`.
/* eslint-disable @typescript-eslint/no-explicit-any */
import * as TSL from "three/tsl";
import {
  ClampToEdgeWrapping,
  DataArrayTexture,
  LinearFilter,
  NoColorSpace,
  RGBAFormat,
  UnsignedByteType,
  Vector3,
  type NodeMaterial,
} from "three/webgpu";
import { HORIZON_VISIBILITY_KEY } from "../../visuals/lighting/sun-rig";
import { MORPH_STAGES, MORPH_START } from "./select";
import type { HeightTwin, TslNode } from "../height/height-twin";

const t = TSL as unknown as Record<string, (...args: any[]) => any>;
const Fn = t["Fn"]!;
const { attribute, clamp, cross, dot, float, fract, int, length, normalize, select, smoothstep, tan } = t as any;
const { uniform, varyingProperty, vec2, vec3 } = t as any;

const tslMax = t["max"]!;
const If = t["If"]!;
const { cameraPosition, floor, fwidth, log2, mix, positionWorld } = t as any;
const { abs, asin, atan, texture, vec4 } = t as any;
const tslMin = t["min"]!;

/** RGBA8 array texture of the horizon map: one layer per cube face, four azimuths per texel, bilinear. */
export function createHorizonArrayTexture(data: Uint8Array, faceSize: number, name: string): DataArrayTexture {
  const tex = new DataArrayTexture(data, faceSize, faceSize, 6);
  tex.name = name;
  tex.format = RGBAFormat;
  tex.type = UnsignedByteType;
  tex.colorSpace = NoColorSpace;
  tex.magFilter = LinearFilter;
  tex.minFilter = LinearFilter;
  tex.wrapS = ClampToEdgeWrapping;
  tex.wrapT = ClampToEdgeWrapping;
  tex.generateMipmaps = false;
  tex.flipY = false;
  tex.needsUpdate = true;
  return tex;
}

const createHorizonPlaceholder = (): DataArrayTexture =>
  createHorizonArrayTexture(new Uint8Array(6 * 4), 1, "mc:horizon-placeholder");

/**
 * Far-occluder visibility of the terrain (structurally the `HorizonVisibility` of the look rig: `node`,
 * `keyDirection`, `enabled`). Off (`enabled` 0, no texture read) until `setTextures` hands it the baked map.
 */
export interface TerrainHorizon {
  /** Multiply into the cascade shadow (1 = lit, 0 = behind far terrain). Fragment stage of a terrain material. */
  readonly node: TslNode;
  /** Unit direction toward the key light, world axes; the look rig writes it every frame. */
  readonly keyDirection: { value: Vector3 };
  /** 1 = on, 0 = off (A/B captures; 0 until the map is loaded). */
  readonly enabled: { value: number };
  /** Half width of the lit / shadow transition in degrees (half the sun disk plus one texel of angular error). */
  readonly softnessDeg: { value: number };
  /** Azimuths 0..3 and 4..7 as RGBA8 array textures, and the angle range the bytes span. Turns the term on. */
  setTextures(a: DataArrayTexture, b: DataArrayTexture, minAngleDeg: number, maxAngleDeg: number): void;
  dispose(): void;
}

/** Camera distances (m, times the preset's range multiplier) over which the far-field normal takes over. */
export const FAR_NORMAL_M = [200, 320] as const;
const QUARTER_PI = Math.PI / 4;

/**
 * LOD distances (m) over which each detail term fades out: [start, end], times the preset's range multiplier. Crater
 * bands 4 / 12 / 40 m, noise 1.5 / 0.4 m. Each term ends where the grid spacing reaches about half its smallest feature
 * (33-vertex patch: level 7 ends at 40 m with 0.77 m spacing, level 5 at 160 m with 3 m, level 3 at 640 m with 12 m;
 * the 17-vertex patch of Low / Medium doubles each spacing, so the 4 m crater band is under-sampled there); the crater
 * and noise loops are most of the vertex cost, in the main pass and in every shadow cascade.
 */
export const DETAIL_FADES_M = {
  craters: [
    [25, 40],
    [80, 130],
    [300, 480],
  ],
  noise: [
    [14, 22],
    [5, 9],
  ],
} as const;

export interface TerrainSurfaceUniforms {
  /** Camera position relative to the moon centre. */
  readonly lodCamera: { value: Vector3 };
  /** Radius of the LOD sphere (R + ground height under the camera). */
  readonly lodRadius: { value: number };
  /** Moon centre minus mesh position. */
  readonly origin: { value: Vector3 };
  /** Range of level 0: stages at or beyond it do not morph (the root never morphs). */
  readonly rootRange: { value: number };
  /** Multiplier on the skirt depth (1; 0 shows any crack between nodes, a diagnostic). */
  readonly skirtScale: { value: number };
  /**
   * Shadow passes push the surface away from the light by `casterDrop * max(dot(casterLight, up), 0)` metres along the
   * light direction: the light depth of a vertical drop of `casterDrop`, without moving the shadow sideways (see
   * `CASTER_DROP_M` in cdlod-terrain.ts).
   */
  readonly casterDrop: { value: number };
  /** Unit direction toward the key light, world axes (written by the cascade host each frame). */
  readonly casterLight: { value: Vector3 };
  /**
   * Multiplier on the morph ranges in shadow passes: 0.5 when the casters use the half-resolution patch (their grid is
   * one level coarser, so each morph must finish one level earlier or the cast surface jumps when a node splits),
   * 1 when the main mesh itself casts.
   */
  readonly casterRangeScale: { value: number };
  /** World position of the moon centre (fragment stage: direction of a surface point). */
  readonly center: { value: Vector3 };
}

export interface TerrainSurface {
  readonly positionNode: TslNode;
  /** Position for shadow passes: the same surface without the normal work. */
  readonly shadowPositionNode: TslNode;
  /** World-space surface normal in the fragment stage (unit length after `normalize`). */
  readonly normalWorld: TslNode;
  /** Cube-face coordinates of the fragment: vec3(a, b, face index). */
  readonly faceAB: TslNode;
  /** Far-occluder (horizon map) visibility; `null` when built without it. */
  readonly horizon: TerrainHorizon | null;
  readonly uniforms: TerrainSurfaceUniforms;
}

export interface TerrainSurfaceOptions {
  readonly twin: HeightTwin;
  readonly radiusM: number;
  /** Quads along one patch edge (16 on Low / Medium, 32 on High / Ultra; `cdlodPatchVerts - 1`). */
  readonly patchQuads: number;
  /** Multiplier on the detail fade distances (the preset's range multiplier). */
  readonly fadeScale?: number;
  /** Per-fragment normal from the height cube in the far field (default on; needs the twin's mips for distance). */
  readonly farNormals?: boolean;
  /** Build the horizon-map term (default on; it reads no texture until it is given the map). */
  readonly horizon?: boolean;
  /** Texel reads for H_base and its slope in the main pass: 9 (default, one 3x3 window) or 20 (5 bilinear, A/B). */
  readonly baseNormalTaps?: 9 | 20;
}

export function createTerrainSurface(options: TerrainSurfaceOptions): TerrainSurface {
  const { twin } = options;
  const R = options.radiusM;
  const quads = options.patchQuads;
  const fadeScale = options.fadeScale ?? 1;
  const wideBaseNormal = options.baseNormalTaps === 20;

  const lodCamera = uniform(new Vector3(0, R, 0));
  const lodRadius = uniform(R);
  const origin = uniform(new Vector3());
  const rootRange = uniform(1e9);
  const skirtScale = uniform(1);
  const casterDrop = uniform(0);
  const casterLight = uniform(new Vector3(0, 1, 0));
  const casterRangeScale = uniform(1);
  const center = uniform(new Vector3());
  const normalVarying = varyingProperty("vec3", "vTerrainNormal");
  const faceABVarying = varyingProperty("vec3", "vTerrainFaceAB");

  const build = (withNormal: boolean): TslNode =>
    Fn(() => {
      const grid = attribute("position", "vec3");
      const node = attribute("aNode", "vec4");
      const lod = attribute("aLod", "vec4");
      const fr = twin.frame(int(node.w).toVar());
      const fn = vec3(fr.n).toVar();
      const fu = vec3(fr.u).toVar();
      const fv = vec3(fr.v).toVar();
      const step = node.z.div(quads).toVar();
      const index = vec2(grid.xy).toVar();
      const directionOf = (ab: TslNode): TslNode =>
        normalize(fn.add(fu.mul(tan(ab.x.mul(QUARTER_PI)))).add(fv.mul(tan(ab.y.mul(QUARTER_PI)))));

      // Chained morph: stage k slides the odd vertices of the level-(L - k) grid onto the level-(L - k - 1) grid.
      for (let k = 0; k < MORPH_STAGES; k++) {
        const scale = 2 ** k;
        const ab = node.xy.add(index.mul(step));
        const d = length(directionOf(ab).mul(lodRadius).sub(lodCamera));
        const range = (withNormal ? lod.x.mul(scale) : lod.x.mul(scale).mul(casterRangeScale)).toVar();
        const raw = clamp(d.sub(range.mul(MORPH_START)).div(range.mul(1 - MORPH_START)), 0, 1);
        const morph = select(range.greaterThanEqual(rootRange.mul(0.999)), float(0), raw);
        const odd = fract(index.div(scale * 2)).mul(2 * scale);
        index.subAssign(odd.mul(morph));
      }

      const ab = node.xy.add(index.mul(step)).toVar();
      const ta = tan(ab.x.mul(QUARTER_PI)).toVar();
      const tb = tan(ab.y.mul(QUARTER_PI)).toVar();
      const q = fn.add(fu.mul(ta)).add(fv.mul(tb)).toVar();
      const qLen = length(q).toVar();
      const dir = q.div(qLen).toVar();
      const dist = length(dir.mul(lodRadius).sub(lodCamera)).toVar();
      // Per-instance detail floor (`lod.w`): shadow cascades fade the detail as if no nearer than this.
      const detailDist = tslMax(dist, lod.w).toVar();
      const fade = (range: readonly [number, number]): TslNode =>
        float(1).sub(smoothstep(range[0] * fadeScale, range[1] * fadeScale, detailDist));
      const weights = {
        craters: vec3(
          fade(DETAIL_FADES_M.craters[0]),
          fade(DETAIL_FADES_M.craters[1]),
          fade(DETAIL_FADES_M.craters[2]),
        ),
        noise: vec2(fade(DETAIL_FADES_M.noise[0]), fade(DETAIL_FADES_M.noise[1])).toVar(),
      };
      // Main pass: H_base and its slope from one 3x3 texel window (9 taps); shadow passes need H_base only (4 taps).
      const e = twin.halfTexelAB;
      const slope9 = withNormal && !wideBaseNormal ? twin.baseSlope(fr.face, ab.x, ab.y).toVar() : null;
      const hBase = (slope9 === null ? twin.base(fr.face, ab.x, ab.y) : slope9.x).toVar();
      const det = twin.detail(dir, fr.face, ab.x, ab.y, weights);
      const h = hBase.add(det.h).toVar();

      if (withNormal) {
        const dBaseA =
          slope9 !== null
            ? slope9.y
            : twin
                .base(fr.face, ab.x.add(e), ab.y)
                .sub(twin.base(fr.face, ab.x.sub(e), ab.y))
                .div(2 * e);
        const dBaseB =
          slope9 !== null
            ? slope9.z
            : twin
                .base(fr.face, ab.x, ab.y.add(e))
                .sub(twin.base(fr.face, ab.x, ab.y.sub(e)))
                .div(2 * e);
        // d dir / d a = (dq - dir (dir . dq)) / |q|, dq = pi/4 (1 + tan^2) u.
        const dqa = fu.mul(ta.mul(ta).add(1).mul(QUARTER_PI)).toVar();
        const dqb = fv.mul(tb.mul(tb).add(1).mul(QUARTER_PI)).toVar();
        const dDirA = dqa
          .sub(dir.mul(dot(dir, dqa)))
          .div(qLen)
          .toVar();
        const dDirB = dqb
          .sub(dir.mul(dot(dir, dqb)))
          .div(qLen)
          .toVar();
        const dHa = dBaseA.add(det.gs.mul(twin.faceHalfM)).add(dot(det.g3, dDirA));
        const dHb = dBaseB.add(det.gt.mul(twin.faceHalfM)).add(dot(det.g3, dDirB));
        const radius = h.add(R);
        const tangentA = dDirA.mul(radius).add(dir.mul(dHa));
        const tangentB = dDirB.mul(radius).add(dir.mul(dHb));
        normalVarying.assign(normalize(cross(tangentA, tangentB)));
        faceABVarying.assign(vec3(ab.x, ab.y, node.w));
      }

      // Skirt vertices drop by the node's skirt depth.
      // Shadow passes get no skirt: skirt walls in the shadow map drew dark lines along node borders (seen at a 14 degree
      // sun), and the surface itself is watertight. They move away from the light instead (`casterDrop`).
      if (withNormal) return dir.mul(h.add(R).sub(grid.z.mul(lod.z).mul(skirtScale))).add(origin);
      const push = casterDrop.mul(tslMax(dot(casterLight, dir), 0));
      return dir.mul(h.add(R)).sub(casterLight.mul(push)).add(origin);
    })();

  // Face coordinates of a fragment: (a, b, face) from the vertex stage. They are linear over a grid quad, so the
  // interpolated value is the face coordinate of the fragment (no face select and no atan per fragment).
  const fragmentFace = (): { face: TslNode; u: TslNode; v: TslNode; n: TslNode } => {
    const face = int(faceABVarying.z.add(0.5)).toVar();
    const fr = twin.frame(face);
    return { face, n: vec3(fr.n).toVar(), u: vec3(fr.u).toVar(), v: vec3(fr.v).toVar() };
  };

  // Far field: beyond FAR_NORMAL_M the grid is coarser than the height texels (level 4 and up, 6 m and more between
  // vertices against 3 m texels), so the vertex normal blurs the relief. There the normal comes per fragment from the
  // slope of H_base at the mip level whose texel is about one pixel. Near ground keeps the vertex normal, which also
  // carries the procedural craters.
  const farNormal = (): TslNode =>
    Fn(() => {
      const vertexNormal = normalize(normalVarying).toVar();
      const a = faceABVarying.x;
      const b = faceABVarying.y;
      // Height texels per pixel from the screen-space change of the face coordinates (derivatives stay outside the branch).
      const texelsPerPixel = tslMax(fwidth(a), fwidth(b)).mul(twin.faceSize / 2);
      // Fractional level; the middle half of each step blends into the next level (no rings crawling over slopes, F3).
      const lf = clamp(log2(tslMax(texelsPerPixel, 1e-6)), 0, twin.farLevels).toVar();
      const level = int(floor(lf)).toVar();
      const blend = smoothstep(0.25, 0.75, lf.sub(floor(lf))).toVar();
      const w = smoothstep(
        FAR_NORMAL_M[0] * fadeScale,
        FAR_NORMAL_M[1] * fadeScale,
        length(positionWorld.sub(cameraPosition)),
      ).toVar();
      const result = vec3(vertexNormal).toVar();
      If(w.greaterThan(0), () => {
        const c = fragmentFace();
        const g = twin.farSlope(c.face, a, b, level).toVar();
        If(blend.greaterThan(0), () => {
          g.assign(mix(g, twin.farSlope(c.face, a, b, level.add(1)), blend));
        });
        const ta = tan(a.mul(QUARTER_PI)).toVar();
        const tb = tan(b.mul(QUARTER_PI)).toVar();
        const q = c.n.add(c.u.mul(ta)).add(c.v.mul(tb)).toVar();
        const qLen = length(q).toVar();
        const up = q.div(qLen).toVar();
        const dqa = c.u.mul(ta.mul(ta).add(1).mul(QUARTER_PI)).toVar();
        const dqb = c.v.mul(tb.mul(tb).add(1).mul(QUARTER_PI)).toVar();
        const dDirA = dqa.sub(up.mul(dot(up, dqa))).div(qLen);
        const dDirB = dqb.sub(up.mul(dot(up, dqb))).div(qLen);
        const radius = g.z.add(R);
        const tangentA = dDirA.mul(radius).add(up.mul(g.x));
        const tangentB = dDirB.mul(radius).add(up.mul(g.y));
        result.assign(normalize(mix(vertexNormal, normalize(cross(tangentA, tangentB)), w)));
      });
      return result;
    })();

  // Far-occluder (horizon map) visibility of the key light, rendering-pipeline 5.2: the baked horizon elevation at
  // the key's azimuth, in the local (north, east) frame of the bake, against the key's elevation at the fragment.
  // 1 = lit, 0 = behind far terrain. Two RGBA8 array textures hold the eight azimuths (0..3 and 4..7).
  const buildHorizon = (): TerrainHorizon => {
    const keyDirection = uniform(new Vector3(0, 1, 0));
    const enabled = uniform(0);
    const softnessDeg = uniform(0.55);
    const minAngleDeg = uniform(-16);
    const spanDeg = uniform(76);
    const texA = texture(createHorizonPlaceholder());
    const texB = texture(createHorizonPlaceholder());
    const placeholders = [texA.value as DataArrayTexture, texB.value as DataArrayTexture];
    const node = Fn(() => {
      const visible = float(1).toVar();
      If(enabled.greaterThan(0), () => {
        const p = normalize(positionWorld.sub(center)).toVar();
        const sinEl = clamp(dot(keyDirection, p), -1, 1);
        const elevation = asin(sinEl)
          .mul(180 / Math.PI)
          .toVar();
        // east = normalize(cross(Y, p)) = (pz, 0, -px); at the poles east := (0, 0, -1), as the bake.
        const e = vec3(p.z, 0, p.x.negate()).toVar();
        const eLen = length(e).toVar();
        const east = select(eLen.greaterThan(1e-5), e.div(tslMax(eLen, 1e-5)), vec3(0, 0, -1)).toVar();
        const north = cross(p, east);
        // Channel coordinate 0..8: azimuth from north toward east in steps of 45 degrees.
        const tt = atan(dot(keyDirection, east), dot(keyDirection, north))
          .mul(8 / (2 * Math.PI))
          .add(8)
          .mod(8)
          .toVar();
        const face = int(faceABVarying.z.add(0.5));
        const uv = faceABVarying.xy.mul(0.5).add(0.5);
        const hA = texA.sample(uv).level(0).depth(face);
        const hB = texB.sample(uv).level(0).depth(face);
        // Piecewise-linear weights over the eight channels, wrapping 7 -> 0.
        const weights = (first: number): TslNode => {
          const d = abs(vec4(first, first + 1, first + 2, first + 3).sub(tt)).toVar();
          return vec4(1).sub(tslMin(tslMin(d, vec4(8).sub(d)), vec4(1)));
        };
        const horizon = dot(hA, weights(0))
          .add(dot(hB, weights(4)))
          .mul(spanDeg)
          .add(minAngleDeg)
          .toVar();
        visible.assign(smoothstep(horizon.sub(softnessDeg), horizon.add(softnessDeg), elevation));
      });
      return visible;
    })();
    return {
      node,
      keyDirection,
      enabled,
      softnessDeg,
      setTextures(a, b, minDeg, maxDeg) {
        texA.value = a;
        texB.value = b;
        minAngleDeg.value = minDeg;
        spanDeg.value = maxDeg - minDeg;
        enabled.value = 1;
      },
      dispose() {
        for (const item of placeholders) item.dispose();
      },
    };
  };

  return {
    positionNode: build(true),
    shadowPositionNode: build(false),
    normalWorld: options.farNormals === false ? normalize(normalVarying) : farNormal(),
    faceAB: faceABVarying,
    horizon: options.horizon === false ? null : buildHorizon(),
    uniforms: {
      lodCamera,
      lodRadius,
      origin,
      rootRange,
      skirtScale,
      casterDrop,
      casterLight,
      casterRangeScale,
      center,
    },
  };
}

/** Makes `material` a terrain surface: its vertices become the CDLOD surface in every pass. */
export function applyTerrainSurface(material: NodeMaterial, surface: TerrainSurface): void {
  material.positionNode = surface.positionNode;
  material.castShadowPositionNode = surface.shadowPositionNode;
  // The key light's cascade node multiplies this in (min of the cascades and the horizon map).
  if (surface.horizon !== null) material.userData[HORIZON_VISIBILITY_KEY] = surface.horizon.node;
}
