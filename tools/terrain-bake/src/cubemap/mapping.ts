// Equal-angle ("tangent") spherified cube mapping, layout v1 (world-and-dust-simulation 3.4).
// World frame (section 1): +Y north, +X = lat 0 / lon 0, -Z = lon 90E, +Z = lon 90W.
// This is the mapping the packages/world height sampler (M1-W1-T01), the CDLOD vertex stage and the TSL twin must share.

export const FACE_COUNT = 6;
export const QUARTER_PI = Math.PI / 4;
export const FOUR_OVER_PI = 4 / Math.PI;

/** Face order: +X, -X, +Y, -Y, +Z, -Z. Direction = normalize(n + tan(pi/4 a) u + tan(pi/4 b) v). */
export const FACE_NAMES = ["px", "nx", "py", "ny", "pz", "nz"] as const;

interface FaceBasis {
  readonly n: readonly [number, number, number];
  readonly u: readonly [number, number, number];
  readonly v: readonly [number, number, number];
}

export const FACE_BASIS: readonly FaceBasis[] = [
  { n: [1, 0, 0], u: [0, 0, -1], v: [0, 1, 0] },
  { n: [-1, 0, 0], u: [0, 0, 1], v: [0, 1, 0] },
  { n: [0, 1, 0], u: [1, 0, 0], v: [0, 0, -1] },
  { n: [0, -1, 0], u: [1, 0, 0], v: [0, 0, 1] },
  { n: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0] },
  { n: [0, 0, -1], u: [-1, 0, 0], v: [0, 1, 0] },
];

/** Texel-centre coordinate along one axis (a or b) for index i in [-gutter, size + gutter). */
export function axisCoord(i: number, size: number): number {
  return -1 + ((i + 0.5) * 2) / size;
}

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** Face (a, b) in [-1, 1] (gutter values slightly beyond) to a unit direction. Writes `out`. */
export function directionFromFaceAB(face: number, a: number, b: number, out: Vec3): Vec3 {
  const f = FACE_BASIS[face];
  if (!f) throw new RangeError(`face ${face}`);
  return directionFromTan(face, Math.tan(a * QUARTER_PI), Math.tan(b * QUARTER_PI), out);
}

/** Same as above with the tangents already computed (hot loops use tables of tan values). */
export function directionFromTan(face: number, ta: number, tb: number, out: Vec3): Vec3 {
  const f = FACE_BASIS[face];
  if (!f) throw new RangeError(`face ${face}`);
  const x = f.n[0] + ta * f.u[0] + tb * f.v[0];
  const y = f.n[1] + ta * f.u[1] + tb * f.v[1];
  const z = f.n[2] + ta * f.u[2] + tb * f.v[2];
  const inv = 1 / Math.sqrt(x * x + y * y + z * z);
  out.x = x * inv;
  out.y = y * inv;
  out.z = z * inv;
  return out;
}

export interface FaceAB {
  face: number;
  a: number;
  b: number;
}

/** Face by major axis (ties resolve X, then Y, then Z) and the equal-angle coordinates on that face. */
export function faceAndAB(x: number, y: number, z: number, out: FaceAB): FaceAB {
  const ax = Math.abs(x);
  const ay = Math.abs(y);
  const az = Math.abs(z);
  let face: number;
  if (ax >= ay && ax >= az) face = x >= 0 ? 0 : 1;
  else if (ay >= az) face = y >= 0 ? 2 : 3;
  else face = z >= 0 ? 4 : 5;
  return abOnFace(face, x, y, z, out);
}

/** (a, b) of a direction on a chosen face plane (valid slightly outside [-1, 1] for gutter checks). */
export function abOnFace(face: number, x: number, y: number, z: number, out: FaceAB): FaceAB {
  const f = FACE_BASIS[face];
  if (!f) throw new RangeError(`face ${face}`);
  const major = x * f.n[0] + y * f.n[1] + z * f.n[2];
  out.face = face;
  out.a = Math.atan((x * f.u[0] + y * f.u[1] + z * f.u[2]) / major) * FOUR_OVER_PI;
  out.b = Math.atan((x * f.v[0] + y * f.v[1] + z * f.v[2]) / major) * FOUR_OVER_PI;
  return out;
}
