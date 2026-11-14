// Reference height sampler over the padded cube (world-and-dust-simulation 3.4/3.5): face by major axis, equal-angle
// (a, b), manual bilinear over 4 texels of the 1-texel-gutter face. The packages/world sampler and the TSL twin must
// reproduce these numbers (golden samples are written from this function).

import { abOnFace, faceAndAB, type FaceAB } from "./mapping.js";

export interface CubeSampleSource {
  readonly faceSize: number;
  readonly padded: number;
  readonly data: ArrayLike<number>;
  readonly offsetM: number;
  readonly scaleM: number;
}

const scratch: FaceAB = { face: 0, a: 0, b: 0 };

function bilinear(cube: CubeSampleSource, face: number, a: number, b: number): number {
  const n = cube.faceSize;
  const p = cube.padded;
  const maxIndex = p - 1.000001;
  let x = ((a + 1) / 2) * n - 0.5 + 1;
  let y = ((b + 1) / 2) * n - 0.5 + 1;
  x = x < 0 ? 0 : x > maxIndex ? maxIndex : x;
  y = y < 0 ? 0 : y > maxIndex ? maxIndex : y;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const base = face * p * p + y0 * p + x0;
  const d = cube.data;
  const top = (d[base] ?? 0) * (1 - fx) + (d[base + 1] ?? 0) * fx;
  const bottom = (d[base + p] ?? 0) * (1 - fx) + (d[base + p + 1] ?? 0) * fx;
  return cube.offsetM + (top * (1 - fy) + bottom * fy) * cube.scaleM;
}

/** Height in game metres above the R sphere at a unit direction (face chosen by major axis). */
export function sampleCubeHeight(cube: CubeSampleSource, x: number, y: number, z: number): number {
  faceAndAB(x, y, z, scratch);
  return bilinear(cube, scratch.face, scratch.a, scratch.b);
}

/** Same, but forcing a face (used to measure agreement across a cube edge through the gutter). */
export function sampleCubeHeightOnFace(cube: CubeSampleSource, face: number, x: number, y: number, z: number): number {
  abOnFace(face, x, y, z, scratch);
  const limit = 1 + 2 / cube.faceSize;
  if (Math.abs(scratch.a) > limit || Math.abs(scratch.b) > limit) {
    throw new RangeError("direction is outside the gutter of the requested face");
  }
  return bilinear(cube, face, scratch.a, scratch.b);
}
