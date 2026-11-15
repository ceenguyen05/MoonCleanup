// Ground height function g(u) = R + H(u), H = H_base + H_detail (WDS section 3.5). Shared by client and server; the TSL
// twin in apps/client/src/terrain must reproduce this code within +-2 cm (GPU readback test at 10,000 seeded points).
//
// H_detail:
//   craters  3 bands of hashed jittered-grid craters in equal-angle face space, measured in metres along the face
//            (s = a * pi/4 * R, t = b * pi/4 * R). One crater candidate per cell; the 3 x 3 cells around the point are
//            visited per band (the largest crater reach is below one cell). Profile with x = distance / radius:
//              x <  1:            rim + depth * (x^2 - 1)       (parabolic bowl, floor = rim - depth)
//              1 <= x < ejecta:   rim * smoothstep(ejecta, 1, x)  (raised rim falling off to zero)
//            depth = 0.12 r, rim = 0.04 r, ejecta = 1.6 (WDS section 3.5).
//            Seams: a crater belongs to the face whose square contains its centre (in that face's coordinates) and is
//            always evaluated in that face's space. Points within the largest reach of a face edge also evaluate the
//            1 or 2 neighbouring faces, so H_detail is continuous across cube edges and corners.
//   noise    value noise per octave on a 3D integer lattice in moon-centred metres (point on the R sphere divided by
//            the wavelength), smoothstep-weighted trilinear. 3D instead of face space so it has no cube seams.
//   hash     PCG-style 32-bit integer hash (pcgHash); identical in JS (Math.imul) and TSL (uint ops).
//   pads     detail amplitude x 0 within the outpost pad radius, smoothstep over the blend ring.
// Detail numbers are [R] defaults (look owned by technical-artist); they are data, passed in, never hard-coded at call
// sites.

import type { UnitDirection } from "@moon-cleanup/shared";
import { CUBE_FACE_ACROSS, CUBE_FACE_BASIS } from "./cube-mapping";
import type { HeightCube } from "./height-cube";

export interface CraterBand {
  /** Jittered-grid cell edge in face-space metres. */
  readonly cellM: number;
  readonly radiusMinM: number;
  readonly radiusMaxM: number;
  /** Probability that a cell holds a crater, 0..1. */
  readonly probability: number;
}

export interface NoiseOctave {
  readonly wavelengthM: number;
  /** Peak amplitude in metres (value noise spans -amplitude .. +amplitude). */
  readonly amplitudeM: number;
}

export interface HeightDetailParams {
  readonly craterBands: readonly CraterBand[];
  /** Bowl depth below the rim, as a fraction of the crater radius. */
  readonly bowlDepth: number;
  /** Rim height above the reference, as a fraction of the crater radius. */
  readonly rimHeight: number;
  /** Ejecta reach as a multiple of the radius (> 1). */
  readonly ejectaReach: number;
  readonly noise: readonly NoiseOctave[];
  /** Seed mixed into every hash (change it to re-roll the procedural detail). */
  readonly seed: number;
}

/** WDS section 3.5 defaults [R]. */
export const DEFAULT_HEIGHT_DETAIL: HeightDetailParams = {
  craterBands: [
    { cellM: 4, radiusMinM: 0.5, radiusMaxM: 2, probability: 0.35 },
    { cellM: 12, radiusMinM: 2, radiusMaxM: 6, probability: 0.25 },
    { cellM: 40, radiusMinM: 6, radiusMaxM: 15, probability: 0.15 },
  ],
  bowlDepth: 0.12,
  rimHeight: 0.04,
  ejectaReach: 1.6,
  noise: [
    { wavelengthM: 1.5, amplitudeM: 0.12 },
    { wavelengthM: 0.4, amplitudeM: 0.03 },
  ],
  seed: 0x1d2c3b4a,
};

/** Outpost pad mask (terrain manifest `parameters.pads`: radius 60 m, blend 20 m, 4 sites). */
export interface PadMask {
  readonly dir: UnitDirection;
  readonly radiusM: number;
  readonly blendM: number;
}

/** PCG-style 32-bit hash (PCG RXS-M-XS output on one LCG step). uint32 in, uint32 out. */
export function pcgHash(v: number): number {
  const state = (Math.imul(v >>> 0, 747796405) + 2891336453) >>> 0;
  const word = Math.imul(((state >>> ((state >>> 28) + 4)) ^ state) >>> 0, 277803737) >>> 0;
  return ((word >>> 22) ^ word) >>> 0;
}

const INV_2_32 = 1 / 4294967296;
const QUARTER_PI = Math.PI / 4;
const FOUR_OVER_PI = 4 / Math.PI;

export interface GroundHeightOptions {
  /** Moon radius R in metres (2,000 Standard). */
  readonly radiusM: number;
  /** Procedural near-field detail; `null` disables H_detail (H = H_base). Default DEFAULT_HEIGHT_DETAIL. */
  readonly detail?: HeightDetailParams | null;
  /** Outpost pads where detail fades to zero. */
  readonly pads?: readonly PadMask[];
}

// Scratch layout of GroundHeight.w. Hot path: values travel through this Float64Array instead of double arguments or
// return values of internal calls (V8 boxes those when it does not inline the call), so heightAt allocates nothing.
const W_X = 0;
const W_Y = 1;
const W_Z = 2;
const W_S = 3; // face-space metres on the face being evaluated
const W_T = 4;
const W_OUT = 5; // result
const W_DETAIL = 6; // H_detail accumulator
const W_MASK = 7; // pad weight

export class GroundHeight {
  readonly cube: HeightCube;
  readonly radiusM: number;
  readonly detail: HeightDetailParams | null;
  private readonly pads: Float64Array; // per pad: x, y, z, radius, blend
  private readonly faceHalfM: number;
  private readonly marginAB: number;
  /** Flattened crater bands: cell, rMin, rMax, probability, bandSeed. */
  private readonly bands: Float64Array;
  /** Flattened noise octaves: R / wavelength, amplitude, octave seed. */
  private readonly octaves: Float64Array;
  private readonly w = new Float64Array(8);
  /** Noise lattice corner values (scratch). */
  private readonly corners = new Float64Array(8);

  constructor(cube: HeightCube, options: GroundHeightOptions) {
    if (!(options.radiusM > 0)) throw new RangeError("radiusM must be > 0");
    this.cube = cube;
    this.radiusM = options.radiusM;
    this.detail = options.detail === undefined ? DEFAULT_HEIGHT_DETAIL : options.detail;
    const pads = options.pads ?? [];
    this.pads = new Float64Array(pads.length * 5);
    pads.forEach((p, k) => {
      this.pads[k * 5] = p.dir.x;
      this.pads[k * 5 + 1] = p.dir.y;
      this.pads[k * 5 + 2] = p.dir.z;
      this.pads[k * 5 + 3] = p.radiusM;
      this.pads[k * 5 + 4] = p.blendM;
    });
    this.faceHalfM = QUARTER_PI * this.radiusM;
    const detail = this.detail;
    this.bands = new Float64Array((detail?.craterBands.length ?? 0) * 5);
    this.octaves = new Float64Array((detail?.noise.length ?? 0) * 3);
    let reach = 0;
    if (detail) {
      if (!(detail.ejectaReach > 1)) throw new RangeError("ejectaReach must be > 1");
      const seed = detail.seed >>> 0;
      detail.craterBands.forEach((band, bi) => {
        if (band.radiusMaxM * detail.ejectaReach >= band.cellM) {
          throw new RangeError(`crater band cell ${band.cellM} m is smaller than its reach (3 x 3 cells would cut it)`);
        }
        reach = Math.max(reach, band.radiusMaxM * detail.ejectaReach);
        this.bands[bi * 5] = band.cellM;
        this.bands[bi * 5 + 1] = band.radiusMinM;
        this.bands[bi * 5 + 2] = band.radiusMaxM;
        this.bands[bi * 5 + 3] = band.probability;
        this.bands[bi * 5 + 4] = pcgHash((seed + Math.imul(bi + 1, 0x9e3779b9)) >>> 0);
      });
      detail.noise.forEach((oct, oi) => {
        this.octaves[oi * 3] = this.radiusM / oct.wavelengthM;
        this.octaves[oi * 3 + 1] = oct.amplitudeM;
        this.octaves[oi * 3 + 2] = pcgHash((seed + Math.imul(oi, 0x85ebca6b)) >>> 0);
      });
    }
    this.marginAB = reach / this.faceHalfM;
  }

  /** H = H_base + H_detail in metres above the reference sphere. Allocation-free. */
  heightAt(dir: UnitDirection): number {
    const w = this.w;
    w[W_X] = dir.x;
    w[W_Y] = dir.y;
    w[W_Z] = dir.z;
    this.evaluate(true);
    return w[W_OUT]!;
  }

  /** Ground radius g = R + H at `dir`. */
  radiusAt(dir: UnitDirection): number {
    return this.radiusM + this.heightAt(dir);
  }

  /** Same as `heightAt` with the direction as numbers. */
  heightAtXYZ(x: number, y: number, z: number): number {
    const w = this.w;
    w[W_X] = x;
    w[W_Y] = y;
    w[W_Z] = z;
    this.evaluate(true);
    return w[W_OUT]!;
  }

  /**
   * Batched `heightAtXYZ` (additive, M1-W5-T04): out[i] = H at unit direction dirs[3i .. 3i + 2] for i < n, bit-identical
   * to `heightAtXYZ`. One call per batch with typed-array I/O, so callers whose call site is not inlined do not box a
   * double per sample. Allocation-free.
   */
  heightsAt(dirs: Float64Array, out: Float64Array, n: number): void {
    const w = this.w;
    for (let i = 0; i < n; i++) {
      const o = i * 3;
      w[W_X] = dirs[o]!;
      w[W_Y] = dirs[o + 1]!;
      w[W_Z] = dirs[o + 2]!;
      this.evaluate(true);
      out[i] = w[W_OUT]!;
    }
  }

  /** H_base only. */
  baseAtXYZ(x: number, y: number, z: number): number {
    return this.cube.sampleXYZ(x, y, z);
  }

  /** H_detail only (0 when detail is disabled). */
  detailAtXYZ(x: number, y: number, z: number): number {
    const w = this.w;
    w[W_X] = x;
    w[W_Y] = y;
    w[W_Z] = z;
    this.evaluate(false);
    return w[W_OUT]!;
  }

  /** w[X..Z] -> w[OUT] = (withBase ? H_base : 0) + H_detail. */
  private evaluate(withBase: boolean): void {
    const w = this.w;
    const x = w[W_X]!;
    const y = w[W_Y]!;
    const z = w[W_Z]!;
    const ax = Math.abs(x);
    const ay = Math.abs(y);
    const az = Math.abs(z);
    let face: number;
    if (ax >= ay && ax >= az) face = x >= 0 ? 0 : 1;
    else if (ay >= az) face = y >= 0 ? 2 : 3;
    else face = z >= 0 ? 4 : 5;
    const B = CUBE_FACE_BASIS;
    const o = face * 9;
    const major = x * B[o]! + y * B[o + 1]! + z * B[o + 2]!;
    const a = Math.atan((x * B[o + 3]! + y * B[o + 4]! + z * B[o + 5]!) / major) * FOUR_OVER_PI;
    const b = Math.atan((x * B[o + 6]! + y * B[o + 7]! + z * B[o + 8]!) / major) * FOUR_OVER_PI;
    let h = 0;
    if (withBase) {
      const io = this.cube.io;
      io[4] = a;
      io[5] = b;
      this.cube.bilinearIO(face);
      h = io[3]!;
    }
    if (this.detail) {
      this.padWeight();
      const mask = w[W_MASK]!;
      if (mask > 0) {
        w[W_DETAIL] = 0;
        const k = this.faceHalfM;
        w[W_S] = a * k;
        w[W_T] = b * k;
        this.craters(face);
        const margin = 1 - this.marginAB;
        if (a > margin) this.cratersAcross(face, 0);
        else if (a < -margin) this.cratersAcross(face, 1);
        if (b > margin) this.cratersAcross(face, 2);
        else if (b < -margin) this.cratersAcross(face, 3);
        this.noise();
        h += w[W_DETAIL]! * mask;
      }
    }
    w[W_OUT] = h;
  }

  /** Craters of the face across `edge` of `face` (0 = +a, 1 = -a, 2 = +b, 3 = -b), in that face's coordinates. */
  private cratersAcross(face: number, edge: number): void {
    const other = CUBE_FACE_ACROSS[face * 4 + edge]!;
    const w = this.w;
    const x = w[W_X]!;
    const y = w[W_Y]!;
    const z = w[W_Z]!;
    const B = CUBE_FACE_BASIS;
    const o = other * 9;
    const major = x * B[o]! + y * B[o + 1]! + z * B[o + 2]!;
    const a = Math.atan((x * B[o + 3]! + y * B[o + 4]! + z * B[o + 5]!) / major) * FOUR_OVER_PI;
    const b = Math.atan((x * B[o + 6]! + y * B[o + 7]! + z * B[o + 8]!) / major) * FOUR_OVER_PI;
    const k = this.faceHalfM;
    w[W_S] = a * k;
    w[W_T] = b * k;
    this.craters(other);
  }

  /** Adds the craters owned by `face` around face-space metres (w[S], w[T]) to w[DETAIL]. */
  private craters(face: number): void {
    const p = this.detail;
    if (!p) return;
    const w = this.w;
    const sm = w[W_S]!;
    const tm = w[W_T]!;
    const half = this.faceHalfM;
    const ejecta = p.ejectaReach;
    const bowl = p.bowlDepth;
    const rimK = p.rimHeight;
    const bands = this.bands;
    let h = 0;
    for (let bo = 0; bo < bands.length; bo += 5) {
      const cell = bands[bo]!;
      const rMin = bands[bo + 1]!;
      const rMax = bands[bo + 2]!;
      const prob = bands[bo + 3]!;
      const faceSeed = pcgHash((bands[bo + 4]! ^ face) >>> 0);
      const cx0 = Math.floor(sm / cell);
      const cy0 = Math.floor(tm / cell);
      for (let dy = -1; dy <= 1; dy++) {
        const cy = cy0 + dy;
        const rowSeed = pcgHash((faceSeed + cy) >>> 0);
        for (let dx = -1; dx <= 1; dx++) {
          const cx = cx0 + dx;
          const h0 = pcgHash((rowSeed + cx) >>> 0);
          if (h0 * INV_2_32 >= prob) continue;
          const h1 = pcgHash(h0);
          const h2 = pcgHash(h1);
          const h3 = pcgHash(h2);
          const ccs = (cx + h1 * INV_2_32) * cell;
          const cct = (cy + h2 * INV_2_32) * cell;
          if (ccs < -half || ccs >= half || cct < -half || cct >= half) continue; // owned by another face
          const r = rMin + (rMax - rMin) * h3 * INV_2_32;
          const ds = sm - ccs;
          const dt = tm - cct;
          const d2 = ds * ds + dt * dt;
          const reach = ejecta * r;
          if (d2 >= reach * reach) continue;
          const xr = Math.sqrt(d2) / r;
          const rim = rimK * r;
          if (xr < 1) {
            h += rim + bowl * r * (xr * xr - 1);
          } else {
            const t = Math.min(Math.max((ejecta - xr) / (ejecta - 1), 0), 1);
            h += rim * (t * t * (3 - 2 * t));
          }
        }
      }
    }
    w[W_DETAIL] = w[W_DETAIL]! + h;
  }

  /** Adds the value-noise octaves at w[X..Z] to w[DETAIL] (same arithmetic as the exported `valueNoise3`). */
  private noise(): void {
    const w = this.w;
    const x = w[W_X]!;
    const y = w[W_Y]!;
    const z = w[W_Z]!;
    const oct = this.octaves;
    let h = 0;
    for (let oo = 0; oo < oct.length; oo += 3) {
      const inv = oct[oo]!;
      const seed = oct[oo + 2]!;
      const px = x * inv;
      const py = y * inv;
      const pz = z * inv;
      const ix = Math.floor(px);
      const iy = Math.floor(py);
      const iz = Math.floor(pz);
      const fx = px - ix;
      const fy = py - iy;
      const fz = pz - iz;
      const ux = fx * fx * (3 - 2 * fx);
      const uy = fy * fy * (3 - 2 * fy);
      const uz = fz * fz * (3 - 2 * fz);
      // 8 lattice corners: v = pcg(pcg(pcg(seed + cx) + cy) + cz), the same chain as `valueNoise3`. The PCG step is
      // written inline: 14+ out-of-line pcgHash calls exceed V8's inlining budget, and a uint32 returned from a call
      // that is not inlined is boxed (measured 129 B per heightAt before this change).
      const cv = this.corners;
      for (let corner = 0; corner < 8; corner++) {
        let v = (seed + ix + (corner & 1)) >>> 0;
        for (let round = 0; round < 3; round++) {
          const state = (Math.imul(v, 747796405) + 2891336453) >>> 0;
          const word = Math.imul(((state >>> ((state >>> 28) + 4)) ^ state) >>> 0, 277803737) >>> 0;
          v = ((word >>> 22) ^ word) >>> 0;
          if (round === 0) v = (v + iy + ((corner >> 1) & 1)) >>> 0;
          else if (round === 1) v = (v + iz + (corner >> 2)) >>> 0;
        }
        cv[corner] = v * (2 * INV_2_32) - 1;
      }
      const c000 = cv[0]!;
      const c100 = cv[1]!;
      const c010 = cv[2]!;
      const c110 = cv[3]!;
      const c001 = cv[4]!;
      const c101 = cv[5]!;
      const c011 = cv[6]!;
      const c111 = cv[7]!;
      const x00 = c000 + (c100 - c000) * ux;
      const x10 = c010 + (c110 - c010) * ux;
      const x01 = c001 + (c101 - c001) * ux;
      const x11 = c011 + (c111 - c011) * ux;
      const y0 = x00 + (x10 - x00) * uy;
      const y1 = x01 + (x11 - x01) * uy;
      h += oct[oo + 1]! * (y0 + (y1 - y0) * uz);
    }
    w[W_DETAIL] = w[W_DETAIL]! + h;
  }

  /** w[MASK] = pad weight at w[X..Z]: 0 inside a pad, smoothstep over the blend ring, 1 elsewhere. */
  private padWeight(): void {
    const w = this.w;
    const x = w[W_X]!;
    const y = w[W_Y]!;
    const z = w[W_Z]!;
    const pads = this.pads;
    let m = 1;
    for (let k = 0; k < pads.length; k += 5) {
      const dx = x - pads[k]!;
      const dy = y - pads[k + 1]!;
      const dz = z - pads[k + 2]!;
      const dist = this.radiusM * Math.sqrt(dx * dx + dy * dy + dz * dz); // chord ~ arc at pad scale
      const radius = pads[k + 3]!;
      const blend = pads[k + 4]!;
      if (dist >= radius + blend) continue;
      if (dist <= radius) {
        m = 0;
        break;
      }
      const t = Math.min(Math.max((dist - radius) / blend, 0), 1);
      const s = t * t * (3 - 2 * t);
      if (s < m) m = s;
    }
    w[W_MASK] = m;
  }
}

/** Lattice value in [-1, 1) for integer corner (ix, iy, iz). */
function latticeValue(ix: number, iy: number, iz: number, seed: number): number {
  const h = pcgHash((pcgHash((pcgHash((seed + ix) >>> 0) + iy) >>> 0) + iz) >>> 0);
  return h * (2 * INV_2_32) - 1;
}

/** Smoothstep-weighted trilinear value noise, -1 .. 1. */
export function valueNoise3(x: number, y: number, z: number, seed: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fy = y - iy;
  const fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const uz = fz * fz * (3 - 2 * fz);
  const c000 = latticeValue(ix, iy, iz, seed);
  const c100 = latticeValue(ix + 1, iy, iz, seed);
  const c010 = latticeValue(ix, iy + 1, iz, seed);
  const c110 = latticeValue(ix + 1, iy + 1, iz, seed);
  const c001 = latticeValue(ix, iy, iz + 1, seed);
  const c101 = latticeValue(ix + 1, iy, iz + 1, seed);
  const c011 = latticeValue(ix, iy + 1, iz + 1, seed);
  const c111 = latticeValue(ix + 1, iy + 1, iz + 1, seed);
  const x00 = c000 + (c100 - c000) * ux;
  const x10 = c010 + (c110 - c010) * ux;
  const x01 = c001 + (c101 - c001) * ux;
  const x11 = c011 + (c111 - c011) * ux;
  const y0 = x00 + (x10 - x00) * uy;
  const y1 = x01 + (x11 - x01) * uy;
  return y0 + (y1 - y0) * uz;
}

/** Pad masks from the terrain manifest `parameters.pads` block. */
export function padMasksFromManifest(pads: {
  readonly radiusM: number;
  readonly blendM: number;
  readonly sites: readonly { readonly dir: readonly number[] }[];
}): PadMask[] {
  return pads.sites.map((site) => ({
    dir: { x: site.dir[0] ?? 0, y: site.dir[1] ?? 0, z: site.dir[2] ?? 0 },
    radiusM: pads.radiusM,
    blendM: pads.blendM,
  }));
}
