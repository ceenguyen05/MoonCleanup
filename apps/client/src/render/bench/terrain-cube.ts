// Baked terrain on the CPU for bench v1 (M0-W3-T07): decoders for the CTMH height cube and the CTMW horizon map of
// tools/terrain-bake (container: 32-byte header + deflate-raw payload, row-delta coded byte planes; format doc in
// tools/terrain-bake/src/cubemap/codec.ts) and their bilinear samplers (layout v1, world-and-dust-simulation.md 3.4).
// Pure: no three, no DOM beyond `DecompressionStream` (browser, Node 18+). The production sampler of M1-W1-T01 replaces
// this; the bench only needs "height above the 2 km sphere at a direction" and "horizon elevation per azimuth".

const FOUR_OVER_PI = 4 / Math.PI;

/** Cube faces +X, -X, +Y, -Y, +Z, -Z: normal n and in-face axes u, v (tools/terrain-bake/src/cubemap/mapping.ts). */
const FACE_N = [1, 0, 0, -1, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 1, 0, 0, -1] as const;
const FACE_U = [0, 0, -1, 0, 0, 1, 1, 0, 0, 1, 0, 0, 1, 0, 0, -1, 0, 0] as const;
const FACE_V = [0, 1, 0, 0, 1, 0, 0, 0, -1, 0, 0, 1, 0, 1, 0, 0, 1, 0] as const;

/** Decoded height cube: 6 faces of `padded`^2 uint16 (1-texel gutter), height = offsetM + value * scaleM. */
export interface HeightCube {
  readonly faceSize: number;
  readonly padded: number;
  readonly data: Uint16Array;
  readonly offsetM: number;
  readonly scaleM: number;
}

/** Decoded horizon map: per face, 8 azimuth planes of `faceSize`^2 uint8 over [minAngleDeg, maxAngleDeg]. */
export interface HorizonCube {
  readonly faceSize: number;
  readonly planes: Uint8Array;
  readonly minAngleDeg: number;
  readonly maxAngleDeg: number;
}

/** Inflates a raw-deflate payload. The browser implementation is `inflateRaw` below; tests may inject another. */
export type Inflate = (payload: Uint8Array) => Promise<Uint8Array>;

export const inflateRaw: Inflate = async (payload) => {
  const stream = new Blob([payload as BlobPart]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
};

const HEADER_BYTES = 32;

function magicOf(view: DataView): string {
  return String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3));
}

export interface Decoded<T> {
  readonly value: T;
  /** The inflated payload (what the manifest's `rawSha256` hashes); released after use unless the caller keeps it. */
  readonly raw: Uint8Array;
}

/** Decodes a CTMH file. */
export async function decodeHeightCube(bytes: Uint8Array, inflate: Inflate = inflateRaw): Promise<Decoded<HeightCube>> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (magicOf(view) !== "CTMH" || view.getUint16(4, true) !== 1) throw new Error("not a CTMH v1 height cube");
  if (view.getUint16(10, true) !== 1) throw new Error("unsupported height cube codec");
  const n = view.getUint16(6, true);
  const raw = await inflate(bytes.subarray(HEADER_BYTES));
  const p = n + 2;
  const plane = p * p;
  if (raw.length !== 6 * plane * 2)
    throw new Error(`height cube payload is ${String(raw.length)} bytes, expected ${String(6 * plane * 2)}`);
  const data = new Uint16Array(6 * plane);
  for (let face = 0; face < 6; face++) {
    const dst = face * plane;
    const hi = face * plane * 2;
    const lo = hi + plane;
    for (let j = 0; j < p; j++) {
      const row = j * p;
      let ref = j === 0 ? 0 : (data[dst + (j - 1) * p] ?? 0);
      for (let i = 0; i < p; i++) {
        ref = (ref + (((raw[hi + row + i] ?? 0) << 8) | (raw[lo + row + i] ?? 0))) & 0xffff;
        data[dst + row + i] = ref;
      }
    }
  }
  return {
    value: { faceSize: n, padded: p, data, offsetM: view.getFloat64(16, true), scaleM: view.getFloat64(24, true) },
    raw,
  };
}

/** Decodes a CTMW file. */
export async function decodeHorizonMap(
  bytes: Uint8Array,
  inflate: Inflate = inflateRaw,
): Promise<Decoded<HorizonCube>> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (magicOf(view) !== "CTMW" || view.getUint16(4, true) !== 1) throw new Error("not a CTMW v1 horizon map");
  if (view.getUint16(10, true) !== 1 || view.getUint16(8, true) !== 8) throw new Error("unsupported horizon map");
  const m = view.getUint16(6, true);
  const raw = await inflate(bytes.subarray(HEADER_BYTES));
  if (raw.length !== 6 * 8 * m * m)
    throw new Error(`horizon payload is ${String(raw.length)} bytes, expected ${String(6 * 8 * m * m)}`);
  const planes = new Uint8Array(raw.length);
  for (let k = 0; k < 6 * 8; k++) {
    const base = k * m * m;
    for (let j = 0; j < m; j++) {
      const row = base + j * m;
      let ref = j === 0 ? 0 : (planes[base + (j - 1) * m] ?? 0);
      for (let i = 0; i < m; i++) {
        ref = (ref + (raw[row + i] ?? 0)) & 0xff;
        planes[row + i] = ref;
      }
    }
  }
  return {
    value: { faceSize: m, planes, minAngleDeg: view.getFloat32(16, true), maxAngleDeg: view.getFloat32(20, true) },
    raw,
  };
}

// ---- Sampling -------------------------------------------------------------------------------------------------------

interface FaceAB {
  face: number;
  a: number;
  b: number;
}

const _ab: FaceAB = { face: 0, a: 0, b: 0 };

/** Face index and equal-angle face coordinates a, b in [-1, 1] of a direction (not necessarily unit). */
export function faceAB(x: number, y: number, z: number, out: FaceAB = _ab): FaceAB {
  const ax = Math.abs(x);
  const ay = Math.abs(y);
  const az = Math.abs(z);
  const face = ax >= ay && ax >= az ? (x >= 0 ? 0 : 1) : ay >= az ? (y >= 0 ? 2 : 3) : z >= 0 ? 4 : 5;
  const o = face * 3;
  const major = x * (FACE_N[o] ?? 0) + y * (FACE_N[o + 1] ?? 0) + z * (FACE_N[o + 2] ?? 0);
  out.face = face;
  out.a =
    Math.atan((x * (FACE_U[o] ?? 0) + y * (FACE_U[o + 1] ?? 0) + z * (FACE_U[o + 2] ?? 0)) / major) * FOUR_OVER_PI;
  out.b =
    Math.atan((x * (FACE_V[o] ?? 0) + y * (FACE_V[o + 1] ?? 0) + z * (FACE_V[o + 2] ?? 0)) / major) * FOUR_OVER_PI;
  return out;
}

/** Height above the 2 km sphere (metres) at a direction: bilinear over the padded face, like the bake's reference sampler. */
export function sampleHeight(cube: HeightCube, x: number, y: number, z: number): number {
  faceAB(x, y, z, _ab);
  const n = cube.faceSize;
  const p = cube.padded;
  const max = p - 1.000001;
  const fx = Math.min(max, Math.max(0, ((_ab.a + 1) / 2) * n + 0.5));
  const fy = Math.min(max, Math.max(0, ((_ab.b + 1) / 2) * n + 0.5));
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const tx = fx - x0;
  const ty = fy - y0;
  const base = _ab.face * p * p + y0 * p + x0;
  const d = cube.data;
  const top = (d[base] ?? 0) * (1 - tx) + (d[base + 1] ?? 0) * tx;
  const bottom = (d[base + p] ?? 0) * (1 - tx) + (d[base + p + 1] ?? 0) * tx;
  return cube.offsetM + (top * (1 - ty) + bottom * ty) * cube.scaleM;
}

/** Horizon elevation (degrees) of the eight azimuth channels (k * 45 degrees from local north toward east). Writes `out[0..7]`. */
export function sampleHorizon(cube: HorizonCube, x: number, y: number, z: number, out: Float32Array): void {
  faceAB(x, y, z, _ab);
  const n = cube.faceSize;
  const fx = Math.min(n - 1.0001, Math.max(0, ((_ab.a + 1) / 2) * n - 0.5));
  const fy = Math.min(n - 1.0001, Math.max(0, ((_ab.b + 1) / 2) * n - 0.5));
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const tx = fx - x0;
  const ty = fy - y0;
  const span = cube.maxAngleDeg - cube.minAngleDeg;
  const q = cube.planes;
  for (let k = 0; k < 8; k++) {
    const base = (_ab.face * 8 + k) * n * n + y0 * n + x0;
    const top = (q[base] ?? 0) * (1 - tx) + (q[base + 1] ?? 0) * tx;
    const bottom = (q[base + n] ?? 0) * (1 - tx) + (q[base + n + 1] ?? 0) * tx;
    out[k] = cube.minAngleDeg + ((top * (1 - ty) + bottom * ty) / 255) * span;
  }
}

/** Texel size of a face in metres on a sphere of radius `radiusM` (equal-angle, at the face centre). */
export function cubeTexelM(faceSize: number, radiusM: number): number {
  return (radiusM * Math.PI) / 2 / faceSize;
}
