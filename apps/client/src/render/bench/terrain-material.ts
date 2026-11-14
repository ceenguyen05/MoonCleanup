// Worst-case terrain shader STUB of bench v0 (M0-W2-T02): a TSL node material with the full fetch and ALU count of the
// dust layer shading (world-and-dust-simulation.md section 7.7) and the terrain line of rendering-pipeline.md section 7,
// so the bench measures the cost of the real shader before it exists. It is a cost model, not the look: the look is
// owned by technical-artist and replaces the colour logic at M0-W3-T07 (the swap point is `createTerrainStub`).
//
// What one fragment does (each fetch goes through `tap`, which counts it, so the number reported is the built one):
//   3 detail layers, stochastic anti-tiling (2 taps each)                 6 fetches
//   ring tap + atlas tap + ring direction + atlas direction               4 fetches
//   berm normals: 4 ring taps of the berm channel                         4 fetches
//   horizon map: 2 taps (8 azimuths in 2 x RGBA8)                         2 fetches
//   plot lookup: id, 2 neighbour texels, 7 centres, plot table            11 fetches
//   ALU: 3 octaves of value noise, mask / thinning, lane stripes, sparkle, 7 dot products, horizon smoothstep
// Reversed-Z, shadows (CSM through the standard light path) and the camera-only velocity are not part of the stub's
// colour logic: they come from the renderer, the lights and the pipeline.
//
// TSL node typing in @types/three is strict per value type (float / vec2 / vec4), and this stub mixes them freely
// in one expression graph. The graph is built once at start-up, never per frame, so it is typed loosely on purpose.
/* eslint-disable @typescript-eslint/no-explicit-any */
type TslNode = any;

// Calibration of the grey-scale: clean ground 0.34 and grime 0.085 linear (art-direction section 3.2, quoted by
// world-and-dust-simulation.md section 7.7).

import {
  cameraPosition,
  cameraViewMatrix,
  clamp,
  cos,
  dFdx,
  dFdy,
  dot,
  float,
  floor,
  fract,
  fwidth,
  length,
  max,
  mix,
  mod,
  normalWorld,
  normalize,
  positionWorld,
  select,
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
import { MeshStandardNodeMaterial, type Texture } from "three/webgpu";
import {
  ATLAS_HALF_EXTENT_M,
  HORIZON_HALF_EXTENT_M,
  RING_HALF_EXTENT_M,
  RING_SIZE,
  type BenchTextures,
} from "./bench-textures";
import {
  MOON_RADIUS_M,
  PLOT_ID_HALF_EXTENT_M,
  PLOT_PACK_HEIGHT,
  PLOT_PACK_WIDTH,
  PLOT_ROW_CENTRES,
  PLOT_ROW_NEIGHBOURS,
  PLOT_ROW_TABLE,
  PLOT_TABLE_WIDTH,
} from "./terrain-data";

/** Albedo values of clean and dusty ground (linear), art-direction section 3.2. */
export const ALBEDO_CLEAN = 0.34;
export const ALBEDO_GRIME = 0.085;

export interface TerrainStub {
  readonly material: MeshStandardNodeMaterial;
  /** Texture fetches one terrain fragment performs, counted while the graph was built. */
  readonly fetchCount: number;
  /**
   * Distinct textures the fragment stage samples. Hard limit: 16 sampled textures per fragment stage (WebGPU default,
   * also the usual WebGL2 unit count); CSM cascades, environment probe and lamp shadow share it. Target <= 12.
   */
  readonly textureBindings: number;
  /** Sun azimuth (radians, from +x toward +z) and elevation (degrees) the horizon-map term reads. */
  readonly sunAzimuthRad: { value: number };
  readonly sunElevationDeg: { value: number };
  dispose(): void;
}

const hash21 = (p: TslNode): TslNode => fract(sin(dot(p, vec2(127.1, 311.7))).mul(43758.5453));

/** Value noise, one octave: four hashes and a smooth blend. */
const valueNoise = (p: TslNode): TslNode => {
  const i: TslNode = floor(p);
  const f: TslNode = fract(p);
  const u: TslNode = f.mul(f).mul(f.mul(-2).add(3));
  const a = hash21(i);
  const b = hash21(i.add(vec2(1, 0)));
  const c = hash21(i.add(vec2(0, 1)));
  const d = hash21(i.add(vec2(1, 1)));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
};

/**
 * `debugView` (0 = the look) picks one intermediate value as a grey image: 1 remaining dust, 2 plot table R, 3 plot index,
 * 4 atlas R, 5 ring R, 6 horizon term, 7 detail relief. Chosen at build time, so the normal view pays nothing.
 */
export function createTerrainStub(textures: BenchTextures, debugView = 0): TerrainStub {
  let fetchCount = 0;
  const bound = new Set<Texture>();
  const tap = (tex: Texture, uvNode: TslNode) => {
    fetchCount += 1;
    bound.add(tex);
    return texture(tex, uvNode);
  };

  const sunAzimuth = uniform(0.6);
  const sunElevation = uniform(40);
  const ringCenter = uniform(vec2(0, 0));
  const moonCenter = vec3(0, -MOON_RADIUS_M, 0);

  const material = new MeshStandardNodeMaterial();
  material.name = "mc:bench-terrain-stub";
  material.metalness = 0;

  const build = (): void => {
    const xz = positionWorld.xz;

    // ---- 3 detail layers, 2 stochastic taps each (anti-tiling) ---------------------------------------------------
    const stochastic = (tex: Texture, scale: number, seed: number): TslNode => {
      const uvA = xz.mul(scale);
      const cell = floor(uvA.mul(0.5));
      const offA = vec2(hash21(cell.add(seed)), hash21(cell.add(seed + 19.19)));
      const offB = vec2(hash21(cell.add(seed + 7.7)), hash21(cell.add(seed + 3.3)));
      const a = tap(tex, uvA.add(offA));
      const b = tap(tex, uvA.mul(0.63).add(offB));
      const w = smoothstep(0.25, 0.75, valueNoise(uvA.mul(0.37)));
      return mix(a, b, w);
    };
    const layer1 = stochastic(textures.detail, 1.3, 0);
    const layer2 = stochastic(textures.detail, 0.31, 40);
    const layer3 = stochastic(textures.detail, 5.7, 80);
    // Normalised 1-5 cm relief height (peaks clean first) from the three layers.
    const reliefH = layer1.r.mul(0.5).add(layer2.g.mul(0.3)).add(layer3.b.mul(0.2));

    // ---- ALU: noise octaves (crater bands + mid-scale breakup) -------------------------------------------------
    const octaves = valueNoise(xz.mul(0.07))
      .mul(0.5)
      .add(valueNoise(xz.mul(0.31)).mul(0.3))
      .add(valueNoise(xz.mul(1.9)).mul(0.2));

    // ---- Plot lookup: plot-ID texel, neighbour table, 7 centre dot products, plot table ------------------------
    const idTexel = tap(textures.plotId, xz.div(2 * PLOT_ID_HALF_EXTENT_M).add(0.5));
    const lo = floor(idTexel.r.mul(255).add(0.5));
    const hi = floor(idTexel.g.mul(255).add(0.5));
    const plotIndex = lo.add(hi.mul(256));
    // One packed plot texture (128 x 192): centres rows 0-63, neighbours 64-127 (2 texels per plot), table 128-191.
    const packedUv = (index: TslNode, xTexel: TslNode | number, rowOffset: number, xScale: number): TslNode =>
      vec2(
        mod(index, PLOT_TABLE_WIDTH).mul(xScale).add(xTexel).add(0.5).div(PLOT_PACK_WIDTH),
        floor(index.div(PLOT_TABLE_WIDTH))
          .add(rowOffset + 0.5)
          .div(PLOT_PACK_HEIGHT),
      );
    const tableUv = (index: TslNode): TslNode => packedUv(index, 0, PLOT_ROW_CENTRES, 1);
    const tableRowUv = (index: TslNode): TslNode => packedUv(index, 0, PLOT_ROW_TABLE, 1);
    const nbrUv = (index: TslNode, texel: number): TslNode => packedUv(index, texel, PLOT_ROW_NEIGHBOURS, 2);
    const nbr0 = tap(textures.plotData, nbrUv(plotIndex, 0));
    const nbr1 = tap(textures.plotData, nbrUv(plotIndex, 1));
    const candidates: TslNode[] = [plotIndex, nbr0.x, nbr0.y, nbr0.z, nbr0.w, nbr1.x, nbr1.y];
    const direction = normalize(positionWorld.sub(moonCenter));
    let bestDot: TslNode = float(-2);
    let bestIndex: TslNode = plotIndex;
    for (const candidate of candidates) {
      const centre = tap(textures.plotData, tableUv(candidate)).xyz;
      const d = dot(direction, centre);
      bestIndex = select(d.greaterThan(bestDot), candidate, bestIndex);
      bestDot = max(bestDot, d);
    }
    const plot = tap(textures.plotData, tableRowUv(bestIndex));

    // ---- Dust: ring + atlas + both direction textures ----------------------------------------------------------
    const ringUv = xz
      .sub(ringCenter)
      .div(2 * RING_HALF_EXTENT_M)
      .add(0.5);
    const atlasUv = xz.div(2 * ATLAS_HALF_EXTENT_M).add(0.5);
    const ringSample = tap(textures.ring, ringUv);
    const atlasSample = tap(textures.atlas, atlasUv);
    const ringDir = tap(textures.ringDirection, ringUv).r;
    const atlasDir = tap(textures.atlasDirection, atlasUv).r;
    const edge = (p: TslNode, half: number): TslNode => smoothstep(half - 2, half, max(p.x.abs(), p.y.abs()));
    const ringWeight = float(1).sub(edge(xz.sub(ringCenter), RING_HALF_EXTENT_M));
    const atlasWeight = float(1).sub(edge(xz, ATLAS_HALF_EXTENT_M));
    const farDust = vec4(plot.r, 1, 1, 0);
    const dust = mix(mix(farDust, atlasSample, atlasWeight), ringSample, ringWeight);
    const headingNode = mix(atlasDir, ringDir, ringWeight);

    // ---- Berm normals: 4 extra ring taps of the berm channel ---------------------------------------------------
    const e = 1 / RING_SIZE;
    const bermX = tap(textures.ring, ringUv.add(vec2(e, 0))).a.sub(tap(textures.ring, ringUv.sub(vec2(e, 0))).a);
    const bermZ = tap(textures.ring, ringUv.add(vec2(0, e))).a.sub(tap(textures.ring, ringUv.sub(vec2(0, e))).a);

    // ---- Presence mask with crisp noisy edges, progressive thinning (section 7.7) ------------------------------
    const remaining = dust.r;
    const subPixel = smoothstep(0.5, 2.0, length(fwidth(xz.mul(1.3))).mul(40));
    const hEff = mix(reliefH.add(octaves.mul(0.25)).mul(0.8), float(0.5), subPixel);
    const tau = hEff.mul(0.08).add(0.04);
    const w = max(fwidth(remaining), 0.02);
    const mask = smoothstep(tau.sub(w), tau.add(w), remaining);
    const thickness = mask.mul(remaining.mul(0.65).add(0.35));

    // ---- Lane stripes from the stroke heading (clean ground only) ----------------------------------------------
    const angle = headingNode.mul(Math.PI * 2);
    const across = dot(xz, vec2(sin(angle).negate(), cos(angle)));
    const stripe = smoothstep(0.3, 0.7, fract(across.mul(4.0)).sub(0.5).abs().mul(2));
    const polish = dust.g.mul(stripe.mul(0.5).add(0.5));

    // ---- Sparkle on clean ground: 2 cm cells fading out 8-12 m ------------------------------------------------
    const cellRandom = hash21(floor(xz.mul(50)));
    const viewDistance = positionWorld.sub(cameraPosition).length();
    const sparkleFade = float(1).sub(smoothstep(8, 12, viewDistance));
    const sparkle = step(0.9965, cellRandom).mul(sparkleFade).mul(float(1).sub(thickness)).mul(0.5);

    // ---- Horizon-map term: 2 taps, 8 azimuths, smoothstep against the sun elevation ----------------------------
    const horizonUv = xz.div(2 * HORIZON_HALF_EXTENT_M).add(0.5);
    // Both halves of one texture: azimuths 0-3 left, 4-7 right (u clamped so the halves never bleed).
    const hu = clamp(horizonUv.x, 0.004, 0.996);
    const hzA = tap(textures.horizon, vec2(hu.mul(0.5), horizonUv.y));
    const hzB = tap(textures.horizon, vec2(hu.mul(0.5).add(0.5), horizonUv.y));
    const slot = fract(sunAzimuth.div(Math.PI * 2)).mul(8);
    const i0 = floor(slot);
    const frac = fract(slot);
    const pick = (index: TslNode): TslNode =>
      select(
        index.lessThan(0.5),
        hzA.x,
        select(
          index.lessThan(1.5),
          hzA.y,
          select(
            index.lessThan(2.5),
            hzA.z,
            select(
              index.lessThan(3.5),
              hzA.w,
              select(
                index.lessThan(4.5),
                hzB.x,
                select(index.lessThan(5.5), hzB.y, select(index.lessThan(6.5), hzB.z, hzB.w)),
              ),
            ),
          ),
        ),
      );
    const horizonDeg = mix(pick(i0), pick(mod(i0.add(1), 8)), frac).mul(45);
    const horizonTerm = smoothstep(horizonDeg.sub(0.7), horizonDeg.add(0.7), sunElevation);

    // ---- Colour and surface -------------------------------------------------------------------------------------
    const clean = vec3(0.94, 0.97, 1.0).mul(ALBEDO_CLEAN).mul(layer3.r.mul(0.16).add(0.92));
    const grime = vec3(1.0, 0.93, 0.82).mul(ALBEDO_GRIME).mul(layer1.g.mul(0.5).add(0.75));
    const plotTint = float(1).add(hash21(bestIndex.mul(0.37)).sub(0.5).mul(0.06));
    const albedo = mix(clean, grime, thickness).mul(plotTint).add(vec3(sparkle)).mul(horizonTerm);
    const debugValues: TslNode[] = [
      remaining,
      plot.r,
      bestIndex.div(3000),
      atlasSample.r,
      ringSample.r,
      horizonTerm,
      reliefH,
    ];
    const debugged = debugView >= 1 ? debugValues[debugView - 1] : undefined;
    material.colorNode = debugged === undefined ? vec4(albedo, 1) : vec4(vec3(debugged), 1);
    material.roughnessNode = mix(mix(float(0.82), float(0.62), polish), float(0.95), thickness);

    // Normal: geometry normal tilted by the berm gradient and a cheap relief term (detail height derivatives).
    const relief = vec3(dFdx(reliefH).mul(8), 0, dFdy(reliefH).mul(8));
    const tilted = normalize(normalWorld.add(vec3(bermX.negate().mul(3), 0, bermZ.negate().mul(3))).add(relief));
    // `transformNormalToView` expects a LOCAL normal; this one is WORLD space (M0-W3-T04 finding): view-matrix direction.
    material.normalNode = normalize(transformDirection(tilted, cameraViewMatrix));
  };
  build();

  return {
    material,
    fetchCount,
    textureBindings: bound.size,
    sunAzimuthRad: sunAzimuth,
    sunElevationDeg: sunElevation,
    dispose() {
      material.dispose();
    },
  };
}
