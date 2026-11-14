// Steps 3-7 of world-and-dust-simulation 3.2: reproject to 6 equal-angle cube faces with supersampling, exaggerate,
// edit outpost pads, relax steep texels, quantise. Heights in this file are game metres above the R = 2000 m sphere.

import { equirectFromLdem, sampleEquirect, type EquirectField, type Ldem } from "../lola/ldem.js";
import { lowpassEquirect } from "./lowpass.js";
import { axisCoord, directionFromTan, FACE_COUNT, QUARTER_PI, type Vec3 } from "./mapping.js";

export interface PadSite {
  readonly id: string;
  /** Unit direction in the world frame. */
  readonly dir: readonly [number, number, number];
}

/** Placeholder outpost sites (GDD: Boreal N pole, Austral S pole, Dawnside 90E, Duskside 90W on the equator). */
export const OUTPOST_SITES: readonly PadSite[] = [
  { id: "boreal", dir: [0, 1, 0] },
  { id: "austral", dir: [0, -1, 0] },
  { id: "dawnside", dir: [0, 0, -1] },
  { id: "duskside", dir: [0, 0, 1] },
];

export interface BakeParams {
  readonly radiusM: number;
  readonly eLow: number;
  readonly eHigh: number;
  /** Low-pass sigma in real (source) metres. */
  readonly sigmaRealM: number;
  readonly supersample: number;
  readonly padRadiusM: number;
  readonly padBlendM: number;
  readonly maxSlopeDeg: number;
  readonly sites: readonly PadSite[];
}

export const DEFAULT_PARAMS: BakeParams = {
  radiusM: 2000,
  eLow: 6,
  /** Spec starts at 3; stepped down 3 -> 2.5 -> 2 by the 3.3 slope acceptance (see sweep.ts and the T05 report). */
  eHigh: 2,
  sigmaRealM: 30_000,
  supersample: 4,
  padRadiusM: 60,
  padBlendM: 20,
  maxSlopeDeg: 50,
  sites: OUTPOST_SITES,
};

/** Six padded faces (1-texel gutter) of float heights, game metres. */
export interface FloatCube {
  readonly faceSize: number;
  readonly padded: number;
  readonly data: Float32Array;
}

export const GUTTER = 1;

export function paddedSize(faceSize: number): number {
  return faceSize + 2 * GUTTER;
}

/** Game height field (equirect, game metres): s * (E_low * low + E_high * (h - low)), linear in (h, low). */
export function composeGameField(ldem: Ldem, params: BakeParams): { field: EquirectField; lowRealM: Float32Array } {
  const label = ldem.label;
  const pixelMetresAtEquator = (2 * Math.PI * label.referenceRadiusM) / (360 * label.pixelsPerDegree);
  const low = lowpassEquirect(ldem.heightsM, label.lineSamples, label.lines, {
    sigmaM: params.sigmaRealM,
    pixelMetresAtEquator,
  });
  const s = params.radiusM / label.referenceRadiusM;
  const out = new Float32Array(ldem.heightsM.length);
  const kHigh = s * params.eHigh;
  const kLow = s * (params.eLow - params.eHigh);
  for (let i = 0; i < out.length; i++) out[i] = kHigh * (ldem.heightsM[i] ?? 0) + kLow * (low[i] ?? 0);
  return { field: equirectFromLdem(ldem, out), lowRealM: low };
}

function tanTable(faceSize: number, sub: number): Float64Array {
  const p = paddedSize(faceSize);
  const table = new Float64Array(p * sub);
  const step = 2 / faceSize;
  for (let i = 0; i < p; i++) {
    const centre = axisCoord(i - GUTTER, faceSize);
    for (let s = 0; s < sub; s++) {
      table[i * sub + s] = Math.tan((centre + (s - (sub - 1) / 2) * (step / sub)) * QUARTER_PI);
    }
  }
  return table;
}

/** Reproject an equirect game field onto the padded cube with sub x sub supersampling per texel. */
export function reprojectToCube(field: EquirectField, faceSize: number, supersample: number): FloatCube {
  const p = paddedSize(faceSize);
  const data = new Float32Array(FACE_COUNT * p * p);
  const table = tanTable(faceSize, supersample);
  const tmp: Vec3 = { x: 0, y: 0, z: 0 };
  const inv = 1 / (supersample * supersample);
  for (let face = 0; face < FACE_COUNT; face++) {
    const base = face * p * p;
    for (let j = 0; j < p; j++) {
      for (let i = 0; i < p; i++) {
        let acc = 0;
        for (let sj = 0; sj < supersample; sj++) {
          const tb = table[j * supersample + sj] ?? 0;
          for (let si = 0; si < supersample; si++) {
            directionFromTan(face, table[i * supersample + si] ?? 0, tb, tmp);
            acc += sampleEquirect(field, tmp.x, tmp.y, tmp.z);
          }
        }
        data[base + j * p + i] = acc * inv;
      }
    }
  }
  return { faceSize, padded: p, data };
}

export interface PadResult {
  readonly id: string;
  readonly padHeightM: number;
  readonly texelsInPad: number;
  readonly texelsEdited: number;
}

export interface PadEdit {
  readonly results: PadResult[];
  /** 1 for every texel (incl. gutter) at or inside the pad radius: relaxation must not touch them. */
  readonly mask: Uint8Array;
}

/** Step 5a: flatten each outpost pad (padRadius) and blend to the terrain over padBlend with a smootherstep (zero slope and curvature at the pad edge). */
export function applyPads(cube: FloatCube, params: BakeParams): PadEdit {
  const { faceSize, padded: p, data } = cube;
  const table = tanTable(faceSize, 1);
  const tmp: Vec3 = { x: 0, y: 0, z: 0 };
  const outer = params.padRadiusM + params.padBlendM;
  const cosLimit = Math.cos((outer * 1.2) / params.radiusM);
  const results: PadResult[] = [];
  const mask = new Uint8Array(data.length);
  for (const site of params.sites) {
    const [sx, sy, sz] = site.dir;
    let sum = 0;
    let count = 0;
    let nearest = Infinity;
    let nearestValue = 0;
    const touched: { index: number; d: number }[] = [];
    for (let face = 0; face < FACE_COUNT; face++) {
      const base = face * p * p;
      for (let j = 0; j < p; j++) {
        for (let i = 0; i < p; i++) {
          directionFromTan(face, table[i] ?? 0, table[j] ?? 0, tmp);
          const dot = tmp.x * sx + tmp.y * sy + tmp.z * sz;
          if (dot < cosLimit) continue;
          const dx = tmp.x - sx;
          const dy = tmp.y - sy;
          const dz = tmp.z - sz;
          const d = 2 * params.radiusM * Math.asin(Math.min(1, Math.sqrt(dx * dx + dy * dy + dz * dz) / 2));
          const index = base + j * p + i;
          touched.push({ index, d });
          const interior = i >= GUTTER && i < p - GUTTER && j >= GUTTER && j < p - GUTTER;
          if (interior && d <= params.padRadiusM) {
            sum += data[index] ?? 0;
            count++;
          }
          if (interior && d < nearest) {
            nearest = d;
            nearestValue = data[index] ?? 0;
          }
        }
      }
    }
    const padHeightM = count > 0 ? sum / count : nearestValue;
    let edited = 0;
    for (const t of touched) {
      if (t.d >= outer) continue;
      if (t.d <= params.padRadiusM) mask[t.index] = 1;
      const u = t.d <= params.padRadiusM ? 0 : (t.d - params.padRadiusM) / params.padBlendM;
      const w = u * u * u * (u * (u * 6 - 15) + 10);
      data[t.index] = padHeightM * (1 - w) + (data[t.index] ?? 0) * w;
      edited++;
    }
    results.push({ id: site.id, padHeightM, texelsInPad: count, texelsEdited: edited });
  }
  return { results, mask };
}

/** Per-texel inverse metric (face-independent by cube symmetry) used for true surface gradients. */
export interface SlopeMetric {
  readonly faceSize: number;
  readonly inv00: Float64Array;
  readonly inv01: Float64Array;
  readonly inv11: Float64Array;
  /** Horizontal distance from the site direction is not stored here; see applyPads. */
}

export function buildSlopeMetric(faceSize: number, radiusM: number): SlopeMetric {
  const n = faceSize;
  const table = tanTable(faceSize, 1);
  const inv00 = new Float64Array(n * n);
  const inv01 = new Float64Array(n * n);
  const inv11 = new Float64Array(n * n);
  const d0: Vec3 = { x: 0, y: 0, z: 0 };
  const d1: Vec3 = { x: 0, y: 0, z: 0 };
  const e = [0, 0, 0, 0, 0, 0];
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      // Tangent per unit index step in a and b, in metres (central difference).
      directionFromTan(0, table[i + 2] ?? 0, table[j + 1] ?? 0, d1);
      directionFromTan(0, table[i] ?? 0, table[j + 1] ?? 0, d0);
      e[0] = ((d1.x - d0.x) * radiusM) / 2;
      e[1] = ((d1.y - d0.y) * radiusM) / 2;
      e[2] = ((d1.z - d0.z) * radiusM) / 2;
      directionFromTan(0, table[i + 1] ?? 0, table[j + 2] ?? 0, d1);
      directionFromTan(0, table[i + 1] ?? 0, table[j] ?? 0, d0);
      e[3] = ((d1.x - d0.x) * radiusM) / 2;
      e[4] = ((d1.y - d0.y) * radiusM) / 2;
      e[5] = ((d1.z - d0.z) * radiusM) / 2;
      const gaa = (e[0] ?? 0) ** 2 + (e[1] ?? 0) ** 2 + (e[2] ?? 0) ** 2;
      const gbb = (e[3] ?? 0) ** 2 + (e[4] ?? 0) ** 2 + (e[5] ?? 0) ** 2;
      const gab = (e[0] ?? 0) * (e[3] ?? 0) + (e[1] ?? 0) * (e[4] ?? 0) + (e[2] ?? 0) * (e[5] ?? 0);
      const det = gaa * gbb - gab * gab;
      const k = j * n + i;
      inv00[k] = gbb / det;
      inv01[k] = -gab / det;
      inv11[k] = gaa / det;
    }
  }
  return { faceSize, inv00, inv01, inv11 };
}

/** Slope angle in degrees for every interior texel (6 * N * N, face-major). Neighbours come from the gutter. */
export function slopeFieldDeg(cube: FloatCube, metric: SlopeMetric): Float32Array {
  const n = cube.faceSize;
  const p = cube.padded;
  const out = new Float32Array(FACE_COUNT * n * n);
  const toDeg = 180 / Math.PI;
  for (let face = 0; face < FACE_COUNT; face++) {
    const base = face * p * p;
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const c = base + (j + GUTTER) * p + (i + GUTTER);
        const ha = ((cube.data[c + 1] ?? 0) - (cube.data[c - 1] ?? 0)) / 2;
        const hb = ((cube.data[c + p] ?? 0) - (cube.data[c - p] ?? 0)) / 2;
        const k = j * n + i;
        const g2 =
          (metric.inv00[k] ?? 0) * ha * ha + 2 * (metric.inv01[k] ?? 0) * ha * hb + (metric.inv11[k] ?? 0) * hb * hb;
        out[face * n * n + k] = Math.atan(Math.sqrt(Math.max(0, g2))) * toDeg;
      }
    }
  }
  return out;
}

export interface RelaxResult {
  readonly iterations: number;
  readonly texelsRelaxedFirstPass: number;
  readonly texelsAboveAfter: number;
}

/**
 * Step 5b: iterative averaging of texels steeper than maxSlopeDeg. Each pass averages every steep texel and its four
 * neighbours (dilation, so the steep face actually softens instead of only its crest). Pad texels are never touched.
 */
export function relaxSteepTexels(
  cube: FloatCube,
  metric: SlopeMetric,
  maxSlopeDeg: number,
  padMask: Uint8Array,
  maxIterations = 200,
): RelaxResult {
  const n = cube.faceSize;
  const p = cube.padded;
  let first = 0;
  let iterations = 0;
  const marked = new Uint8Array(cube.data.length);
  for (; iterations < maxIterations; iterations++) {
    const slopes = slopeFieldDeg(cube, metric);
    marked.fill(0);
    let count = 0;
    for (let face = 0; face < FACE_COUNT; face++) {
      for (let j = 0; j < n; j++) {
        for (let i = 0; i < n; i++) {
          if ((slopes[face * n * n + j * n + i] ?? 0) <= maxSlopeDeg) continue;
          const c = face * p * p + (j + GUTTER) * p + (i + GUTTER);
          marked[c] = 1;
          marked[c - 1] = 1;
          marked[c + 1] = 1;
          marked[c - p] = 1;
          marked[c + p] = 1;
          count++;
        }
      }
    }
    if (iterations === 0) first = count;
    if (count === 0) break;
    const copy = cube.data.slice();
    for (let face = 0; face < FACE_COUNT; face++) {
      for (let j = 0; j < n; j++) {
        for (let i = 0; i < n; i++) {
          const c = face * p * p + (j + GUTTER) * p + (i + GUTTER);
          if (marked[c] === 0 || padMask[c] === 1) continue;
          cube.data[c] =
            ((copy[c] ?? 0) + (copy[c - 1] ?? 0) + (copy[c + 1] ?? 0) + (copy[c - p] ?? 0) + (copy[c + p] ?? 0)) / 5;
        }
      }
    }
  }
  const after = slopeFieldDeg(cube, metric);
  let above = 0;
  for (const s of after) if (s > maxSlopeDeg) above++;
  return { iterations, texelsRelaxedFirstPass: first, texelsAboveAfter: above };
}

export interface QuantisedCube {
  readonly faceSize: number;
  readonly padded: number;
  readonly data: Uint16Array;
  /** height (game metres above R) = offsetM + value * scaleM */
  readonly offsetM: number;
  readonly scaleM: number;
  readonly minM: number;
  readonly maxM: number;
}

/** Step 7: uint16 quantisation, scale = (max - min) / 65535. */
export function quantiseCube(cube: FloatCube): QuantisedCube {
  let min = Infinity;
  let max = -Infinity;
  for (const v of cube.data) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  const scaleM = (max - min) / 65535;
  const data = new Uint16Array(cube.data.length);
  for (let i = 0; i < data.length; i++) data[i] = Math.round(((cube.data[i] ?? 0) - min) / scaleM);
  return { faceSize: cube.faceSize, padded: cube.padded, data, offsetM: min, scaleM, minM: min, maxM: max };
}
