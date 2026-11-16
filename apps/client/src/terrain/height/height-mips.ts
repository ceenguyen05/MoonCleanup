// Mip levels of the height cube for the far-field normal (M1-W2-T01). Pure CPU code, no three: box-filtered levels with
// a 1-texel gutter copied from the neighbouring faces, the same layout as level 0 (`HeightCube.padded`). With the gutter
// the slope of a mip stays continuous across cube-face edges (without it the clamped border read gave a flat slope over
// the last texel, a lighting seam along every cube edge in the far and orbit views).

import { CUBE_FACE_BASIS, type HeightCube } from "@moon-cleanup/world";

const QUARTER_PI = Math.PI / 4;
const FOUR_OVER_PI = 4 / Math.PI;

/** One mip level: `size` texels per face edge, `(size + 2)^2` padded uint16 texels per face, 6 faces. */
export interface HeightMipLevel {
  readonly size: number;
  readonly data: Uint16Array;
}

/** Bilinear sample of an unpadded level (`size`^2 per face) at face coordinates, clamped to the face's texel centres. */
function sampleLevel(src: Uint16Array, size: number, face: number, a: number, b: number): number {
  const x = Math.min(Math.max(((a + 1) / 2) * size - 0.5, 0), size - 1);
  const y = Math.min(Math.max(((b + 1) / 2) * size - 0.5, 0), size - 1);
  const x0 = Math.min(Math.floor(x), size - 2);
  const y0 = Math.min(Math.floor(y), size - 2);
  const fx = x - x0;
  const fy = y - y0;
  const o = face * size * size + y0 * size + x0;
  const top = src[o]! * (1 - fx) + src[o + 1]! * fx;
  const bottom = src[o + size]! * (1 - fx) + src[o + size + 1]! * fx;
  return top * (1 - fy) + bottom * fy;
}

/** Pads an unpadded level with a 1-texel gutter read from the face each gutter texel's direction falls on. */
export function padHeightLevel(src: Uint16Array, size: number): Uint16Array {
  const p = size + 2;
  const out = new Uint16Array(6 * p * p);
  const B = CUBE_FACE_BASIS;
  for (let face = 0; face < 6; face++) {
    const o = face * 9;
    for (let gy = -1; gy <= size; gy++) {
      for (let gx = -1; gx <= size; gx++) {
        const dst = face * p * p + (gy + 1) * p + (gx + 1);
        if (gx >= 0 && gy >= 0 && gx < size && gy < size) {
          out[dst] = src[face * size * size + gy * size + gx]!;
          continue;
        }
        // Direction of the gutter texel centre (just beyond the face), then the face and coordinates it lies on.
        const ta = Math.tan((((gx + 0.5) / size) * 2 - 1) * QUARTER_PI);
        const tb = Math.tan((((gy + 0.5) / size) * 2 - 1) * QUARTER_PI);
        const x = B[o]! + ta * B[o + 3]! + tb * B[o + 6]!;
        const y = B[o + 1]! + ta * B[o + 4]! + tb * B[o + 7]!;
        const z = B[o + 2]! + ta * B[o + 5]! + tb * B[o + 8]!;
        const ax = Math.abs(x);
        const ay = Math.abs(y);
        const az = Math.abs(z);
        let other: number;
        if (ax >= ay && ax >= az) other = x >= 0 ? 0 : 1;
        else if (ay >= az) other = y >= 0 ? 2 : 3;
        else other = z >= 0 ? 4 : 5;
        const q = other * 9;
        const major = x * B[q]! + y * B[q + 1]! + z * B[q + 2]!;
        const a = Math.atan((x * B[q + 3]! + y * B[q + 4]! + z * B[q + 5]!) / major) * FOUR_OVER_PI;
        const b = Math.atan((x * B[q + 6]! + y * B[q + 7]! + z * B[q + 8]!) / major) * FOUR_OVER_PI;
        out[dst] = Math.round(sampleLevel(src, size, other, a, b));
      }
    }
  }
  return out;
}

/**
 * Mip levels 1..count of the cube (512 / 256 / 128 for the shipped 1024 cube): each texel the mean of 2 x 2 of the level
 * above (interior only), then padded with the neighbouring faces.
 */
export function buildHeightMips(cube: HeightCube, count = 3): HeightMipLevel[] {
  const out: HeightMipLevel[] = [];
  let size = cube.faceSize;
  const p = cube.padded;
  let previous = new Uint16Array(6 * size * size);
  for (let face = 0; face < 6; face++) {
    for (let y = 0; y < size; y++) {
      const from = face * p * p + (y + 1) * p + 1;
      previous.set(cube.data.subarray(from, from + size), (face * size + y) * size);
    }
  }
  for (let level = 1; level <= count && size >= 4; level++) {
    const half = size >> 1;
    const next = new Uint16Array(6 * half * half);
    for (let face = 0; face < 6; face++) {
      for (let y = 0; y < half; y++) {
        for (let x = 0; x < half; x++) {
          const k = (face * size + y * 2) * size + x * 2;
          next[(face * half + y) * half + x] =
            (previous[k]! + previous[k + 1]! + previous[k + size]! + previous[k + size + 1]! + 2) >> 2;
        }
      }
    }
    out.push({ size: half, data: padHeightLevel(next, half) });
    previous = next;
    size = half;
  }
  return out;
}
