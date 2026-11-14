// Step 6 validation and accuracy measurements: slope acceptance (world-and-dust-simulation 3.3), cube-seam agreement,
// reprojection accuracy against the source, golden samples for the JS/TSL twin test.

import { sampleEquirect, type EquirectField } from "../lola/ldem.js";
import { GUTTER, type FloatCube, type PadSite } from "./bake.js";
import { abOnFace, axisCoord, directionFromTan, FACE_COUNT, QUARTER_PI, type FaceAB, type Vec3 } from "./mapping.js";
import { sampleCubeHeight, sampleCubeHeightOnFace, type CubeSampleSource } from "./sample.js";

export interface SlopeReport {
  readonly texels: number;
  readonly fractionAbove30: number;
  readonly fractionAbove45: number;
  readonly fractionAbove50: number;
  readonly maxDeg: number;
  readonly meanDeg: number;
  readonly p99Deg: number;
  readonly padMaxDeg: number;
  readonly padRingMaxDeg: number;
  readonly pass: boolean;
}

/** Slope acceptance: <= 5 % above 30 deg, <= 1 % above 45 deg, pads <= 3 deg (rims are not masked: conservative). */
export function slopeReport(
  slopes: Float32Array,
  faceSize: number,
  radiusM: number,
  sites: readonly PadSite[],
  padRadiusM: number,
  padOuterM: number,
): SlopeReport {
  const n = faceSize;
  const table = new Float64Array(n);
  for (let i = 0; i < n; i++) table[i] = Math.tan(axisCoord(i, n) * QUARTER_PI);
  const histogram = new Float64Array(91);
  const tmp: Vec3 = { x: 0, y: 0, z: 0 };
  let above30 = 0;
  let above45 = 0;
  let above50 = 0;
  let max = 0;
  let sum = 0;
  let padMax = 0;
  let ringMax = 0;
  const cosLimit = Math.cos((padOuterM * 1.2) / radiusM);
  for (let face = 0; face < FACE_COUNT; face++) {
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const s = slopes[face * n * n + j * n + i] ?? 0;
        histogram[Math.min(90, Math.floor(s))]! += 1;
        if (s > 30) above30++;
        if (s > 45) above45++;
        if (s > 50) above50++;
        if (s > max) max = s;
        sum += s;
        directionFromTan(face, table[i] ?? 0, table[j] ?? 0, tmp);
        for (const site of sites) {
          const dot = tmp.x * site.dir[0] + tmp.y * site.dir[1] + tmp.z * site.dir[2];
          if (dot < cosLimit) continue;
          const dx = tmp.x - site.dir[0];
          const dy = tmp.y - site.dir[1];
          const dz = tmp.z - site.dir[2];
          const d = 2 * radiusM * Math.asin(Math.min(1, Math.sqrt(dx * dx + dy * dy + dz * dz) / 2));
          if (d <= padRadiusM) padMax = Math.max(padMax, s);
          else if (d <= padOuterM) ringMax = Math.max(ringMax, s);
        }
      }
    }
  }
  const total = FACE_COUNT * n * n;
  let acc = 0;
  let p99 = 90;
  for (let b = 0; b <= 90; b++) {
    acc += histogram[b] ?? 0;
    if (acc >= total * 0.99) {
      p99 = b + 1;
      break;
    }
  }
  const f30 = above30 / total;
  const f45 = above45 / total;
  return {
    texels: total,
    fractionAbove30: f30,
    fractionAbove45: f45,
    fractionAbove50: above50 / total,
    maxDeg: max,
    meanDeg: sum / total,
    p99Deg: p99,
    padMaxDeg: padMax,
    padRingMaxDeg: ringMax,
    pass: f30 <= 0.05 && f45 <= 0.01 && padMax <= 3,
  };
}

/** mulberry32: integer-only seeded PRNG. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function randomDirection(rand: () => number, out: Vec3): Vec3 {
  for (;;) {
    const x = rand() * 2 - 1;
    const y = rand() * 2 - 1;
    const z = rand() * 2 - 1;
    const l2 = x * x + y * y + z * z;
    if (l2 > 1e-4 && l2 <= 1) {
      const inv = 1 / Math.sqrt(l2);
      out.x = x * inv;
      out.y = y * inv;
      out.z = z * inv;
      return out;
    }
  }
}

export interface ErrorStats {
  readonly samples: number;
  readonly maxAbsM: number;
  readonly rmsM: number;
  readonly p99AbsM: number;
}

function summarise(errors: Float64Array): ErrorStats {
  const abs = Array.from(errors, Math.abs).sort((a, b) => a - b);
  let sq = 0;
  for (const e of errors) sq += e * e;
  return {
    samples: errors.length,
    maxAbsM: abs[abs.length - 1] ?? 0,
    rmsM: Math.sqrt(sq / errors.length),
    p99AbsM: abs[Math.min(abs.length - 1, Math.floor(abs.length * 0.99))] ?? 0,
  };
}

/** Reprojection accuracy: cube sampler (quantised) vs the source field sampled directly, away from pad edits. */
export function accuracyVsSource(
  cube: CubeSampleSource,
  field: EquirectField,
  sites: readonly PadSite[],
  radiusM: number,
  count: number,
  seed: number,
): ErrorStats {
  const rand = seededRandom(seed);
  const errors = new Float64Array(count);
  const d: Vec3 = { x: 0, y: 0, z: 0 };
  let k = 0;
  const cosKeepOut = Math.cos(120 / radiusM);
  while (k < count) {
    randomDirection(rand, d);
    if (sites.some((s) => d.x * s.dir[0] + d.y * s.dir[1] + d.z * s.dir[2] > cosKeepOut)) continue;
    errors[k++] = sampleCubeHeight(cube, d.x, d.y, d.z) - sampleEquirect(field, d.x, d.y, d.z);
  }
  return summarise(errors);
}

/**
 * Seam agreement: for directions near cube edges, the height from the primary face versus the height read through the
 * neighbouring face's gutter. Differences are what a manual 4-tap bilinear sees at an edge.
 */
export function seamAgreement(cube: CubeSampleSource, count: number, seed: number): ErrorStats & { texelBand: number } {
  const rand = seededRandom(seed);
  const n = cube.faceSize;
  const band = 2 / n;
  const errors: number[] = [];
  const d: Vec3 = { x: 0, y: 0, z: 0 };
  const alt: FaceAB = { face: 0, a: 0, b: 0 };
  while (errors.length < count) {
    randomDirection(rand, d);
    // primary face by major axis
    const ax = Math.abs(d.x);
    const ay = Math.abs(d.y);
    const az = Math.abs(d.z);
    const major = Math.max(ax, ay, az);
    const second = ax === major ? Math.max(ay, az) : ay === major ? Math.max(ax, az) : Math.max(ax, ay);
    // Equal-angle distance to the edge: angle of the major/second ratio from 45 degrees.
    const edge = Math.abs(Math.atan(second / major) - QUARTER_PI) * (4 / Math.PI);
    if (edge > band) continue;
    const primary = ax === major ? (d.x >= 0 ? 0 : 1) : ay === major ? (d.y >= 0 ? 2 : 3) : d.z >= 0 ? 4 : 5;
    // neighbour face = the face of the second-largest axis
    const secondAxis = second === ax ? (d.x >= 0 ? 0 : 1) : second === ay ? (d.y >= 0 ? 2 : 3) : d.z >= 0 ? 4 : 5;
    if (secondAxis === primary) continue;
    abOnFace(secondAxis, d.x, d.y, d.z, alt);
    if (Math.abs(alt.a) > 1 + 2 / n || Math.abs(alt.b) > 1 + 2 / n) continue;
    errors.push(
      sampleCubeHeightOnFace(cube, primary, d.x, d.y, d.z) - sampleCubeHeightOnFace(cube, secondAxis, d.x, d.y, d.z),
    );
  }
  return { ...summarise(Float64Array.from(errors)), texelBand: 1 };
}

export interface GoldenSample {
  readonly label: string;
  readonly dir: readonly [number, number, number];
  readonly face: number;
  readonly a: number;
  readonly b: number;
  readonly heightM: number;
}

/** >= 20 directions: 6 face centres, 12 edge midpoints, 8 corners, 4 pad sites, then seeded random points. */
export function goldenSamples(
  cube: CubeSampleSource,
  sites: readonly PadSite[],
  randomCount: number,
  seed: number,
): GoldenSample[] {
  const dirs: { label: string; v: [number, number, number] }[] = [];
  const names = ["px", "nx", "py", "ny", "pz", "nz"];
  const axes: [number, number, number][] = [
    [1, 0, 0],
    [-1, 0, 0],
    [0, 1, 0],
    [0, -1, 0],
    [0, 0, 1],
    [0, 0, -1],
  ];
  axes.forEach((v, i) => dirs.push({ label: `face-centre-${names[i]}`, v }));
  for (let i = 0; i < 6; i++) {
    for (let j = i + 1; j < 6; j++) {
      const u = axes[i]!;
      const w = axes[j]!;
      if (u[0] + w[0] === 0 && u[1] + w[1] === 0 && u[2] + w[2] === 0) continue;
      dirs.push({ label: `edge-${names[i]}-${names[j]}`, v: [u[0] + w[0], u[1] + w[1], u[2] + w[2]] });
    }
  }
  for (const sx of [1, -1]) {
    for (const sy of [1, -1]) {
      for (const sz of [1, -1])
        dirs.push({
          label: `corner-${sx > 0 ? "p" : "n"}x${sy > 0 ? "p" : "n"}y${sz > 0 ? "p" : "n"}z`,
          v: [sx, sy, sz],
        });
    }
  }
  for (const s of sites) dirs.push({ label: `outpost-${s.id}`, v: [s.dir[0], s.dir[1], s.dir[2]] });
  const rand = seededRandom(seed);
  const tmp: Vec3 = { x: 0, y: 0, z: 0 };
  for (let i = 0; i < randomCount; i++) {
    randomDirection(rand, tmp);
    dirs.push({ label: `seeded-${i}`, v: [tmp.x, tmp.y, tmp.z] });
  }
  const ab: FaceAB = { face: 0, a: 0, b: 0 };
  return dirs.map(({ label, v }) => {
    const l = Math.hypot(v[0], v[1], v[2]);
    const x = v[0] / l;
    const y = v[1] / l;
    const z = v[2] / l;
    const heightM = sampleCubeHeight(cube, x, y, z);
    // face/a/b from the same function the sampler used
    const ax = Math.abs(x);
    const ay = Math.abs(y);
    const az = Math.abs(z);
    const face = ax >= ay && ax >= az ? (x >= 0 ? 0 : 1) : ay >= az ? (y >= 0 ? 2 : 3) : z >= 0 ? 4 : 5;
    abOnFace(face, x, y, z, ab);
    return { label, dir: [x, y, z] as const, face, a: ab.a, b: ab.b, heightM };
  });
}

/** Hillshade (sun azimuth 315, elevation 35 degrees) of one padded float face as 8-bit grey, with vertical exaggeration z. */
export function hillshadeFace(cube: FloatCube, face: number, zFactor: number, texelMetres: number): Uint8Array {
  const n = cube.faceSize;
  const p = cube.padded;
  const out = new Uint8Array(n * n);
  const az = (315 * Math.PI) / 180;
  const alt = (35 * Math.PI) / 180;
  const base = face * p * p;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const c = base + (j + GUTTER) * p + (i + GUTTER);
      const dzdx = (((cube.data[c + 1] ?? 0) - (cube.data[c - 1] ?? 0)) * zFactor) / (2 * texelMetres);
      const dzdy = (((cube.data[c + p] ?? 0) - (cube.data[c - p] ?? 0)) * zFactor) / (2 * texelMetres);
      const slope = Math.atan(Math.hypot(dzdx, dzdy));
      const aspect = Math.atan2(dzdy, -dzdx);
      const shade = Math.sin(alt) * Math.cos(slope) + Math.cos(alt) * Math.sin(slope) * Math.cos(az - aspect);
      out[(n - 1 - j) * n + i] = Math.max(0, Math.min(255, Math.round(shade * 255)));
    }
  }
  return out;
}
