// Equal-angle ("tangent") spherified cube mapping, layout v1 (WDS section 3.4; same layout as tools/terrain-bake
// src/cubemap/mapping.ts, which proposed moving it here so the CDLOD vertex stage and the TSL twin share one source).
// World frame (WDS section 1): +Y north, +X = lat 0 / lon 0, -Z = lon 90E, +Z = lon 90W.
//
// Face order +X, -X, +Y, -Y, +Z, -Z. Direction = normalise(n + tan(pi/4 a) u + tan(pi/4 b) v), a, b in [-1, 1];
// the face of a direction is its major axis (ties resolve X, then Y, then Z). Texel row index = b, column = a.
// The height function is not under the WDS section 1 determinism rule (its tolerance is +-2 cm), so atan/tan are used.

export const CUBE_FACE_COUNT = 6;
const FOUR_OVER_PI = 4 / Math.PI;
const QUARTER_PI = Math.PI / 4;

/** Per face: normal n, a-axis u, b-axis v, flattened as 9 numbers [nx, ny, nz, ux, uy, uz, vx, vy, vz]. */
export const CUBE_FACE_BASIS: Float64Array = new Float64Array([
  // +X
  1, 0, 0, 0, 0, -1, 0, 1, 0,
  // -X
  -1, 0, 0, 0, 0, 1, 0, 1, 0,
  // +Y
  0, 1, 0, 1, 0, 0, 0, 0, -1,
  // -Y
  0, -1, 0, 1, 0, 0, 0, 0, 1,
  // +Z
  0, 0, 1, 1, 0, 0, 0, 1, 0,
  // -Z
  0, 0, -1, -1, 0, 0, 0, 1, 0,
]);

/** Writable face coordinates. */
export interface CubeFaceAB {
  face: number;
  a: number;
  b: number;
}

/** Face index of the major axis of (x, y, z) (ties: X, then Y, then Z). */
export function cubeFaceOf(x: number, y: number, z: number): number {
  const ax = Math.abs(x);
  const ay = Math.abs(y);
  const az = Math.abs(z);
  if (ax >= ay && ax >= az) return x >= 0 ? 0 : 1;
  if (ay >= az) return y >= 0 ? 2 : 3;
  return z >= 0 ? 4 : 5;
}

/** Equal-angle (a, b) of (x, y, z) on `face` (valid beyond [-1, 1] for directions in that face's hemisphere). */
export function cubeABOnFace(face: number, x: number, y: number, z: number, out: CubeFaceAB): CubeFaceAB {
  const o = face * 9;
  const B = CUBE_FACE_BASIS;
  const major = x * (B[o] ?? 0) + y * (B[o + 1] ?? 0) + z * (B[o + 2] ?? 0);
  out.face = face;
  out.a = Math.atan((x * (B[o + 3] ?? 0) + y * (B[o + 4] ?? 0) + z * (B[o + 5] ?? 0)) / major) * FOUR_OVER_PI;
  out.b = Math.atan((x * (B[o + 6] ?? 0) + y * (B[o + 7] ?? 0) + z * (B[o + 8] ?? 0)) / major) * FOUR_OVER_PI;
  return out;
}

/** Face by major axis and its equal-angle coordinates. */
export function cubeFaceAndAB(x: number, y: number, z: number, out: CubeFaceAB): CubeFaceAB {
  return cubeABOnFace(cubeFaceOf(x, y, z), x, y, z, out);
}

/** Unit direction of face coordinates (a, b). Writes `out`. */
export function cubeDirectionFromAB(
  face: number,
  a: number,
  b: number,
  out: { x: number; y: number; z: number },
): { x: number; y: number; z: number } {
  const o = face * 9;
  const B = CUBE_FACE_BASIS;
  const ta = Math.tan(a * QUARTER_PI);
  const tb = Math.tan(b * QUARTER_PI);
  const x = (B[o] ?? 0) + ta * (B[o + 3] ?? 0) + tb * (B[o + 6] ?? 0);
  const y = (B[o + 1] ?? 0) + ta * (B[o + 4] ?? 0) + tb * (B[o + 7] ?? 0);
  const z = (B[o + 2] ?? 0) + ta * (B[o + 5] ?? 0) + tb * (B[o + 8] ?? 0);
  const len = Math.sqrt(x * x + y * y + z * z);
  out.x = x / len;
  out.y = y / len;
  out.z = z / len;
  return out;
}

/**
 * Face across an edge of `face`: edge 0 = a > 1 (toward +u), 1 = a < -1 (-u), 2 = b > 1 (+v), 3 = b < -1 (-v).
 * Table built from the basis: the neighbour across +u has normal u.
 */
export const CUBE_FACE_ACROSS: Int8Array = (() => {
  const out = new Int8Array(CUBE_FACE_COUNT * 4);
  const B = CUBE_FACE_BASIS;
  const faceOfAxis = (x: number, y: number, z: number): number => cubeFaceOf(x, y, z);
  for (let f = 0; f < CUBE_FACE_COUNT; f++) {
    const o = f * 9;
    const ux = B[o + 3] ?? 0;
    const uy = B[o + 4] ?? 0;
    const uz = B[o + 5] ?? 0;
    const vx = B[o + 6] ?? 0;
    const vy = B[o + 7] ?? 0;
    const vz = B[o + 8] ?? 0;
    out[f * 4] = faceOfAxis(ux, uy, uz);
    out[f * 4 + 1] = faceOfAxis(-ux, -uy, -uz);
    out[f * 4 + 2] = faceOfAxis(vx, vy, vz);
    out[f * 4 + 3] = faceOfAxis(-vx, -vy, -vz);
  }
  return out;
})();
