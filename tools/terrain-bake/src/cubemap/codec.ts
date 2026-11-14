// Container for shipped terrain binaries: 32-byte header + deflate-raw payload of row-delta, byte-planar data.
// deflate-raw is decodable in browsers via DecompressionStream("deflate-raw") (Brotli has no DecompressionStream).
// Cube file raw size is 12.6 MB, above the 10 MiB CI per-file limit (ADR-0017), hence the compressed container.
//
// Height cube header (little endian):
//   0 "CTMH"  4 u16 version(1)  6 u16 faceSize  8 u16 gutter  10 u16 codec(1 = deflate-raw)
//   12 u32 rawBytes  16 f64 offsetM  24 f64 scaleM
// Payload (before deflate): for each face (+X,-X,+Y,-Y,+Z,-Z) the padded (faceSize+2)^2 uint16 values, row-delta coded
// (first value of a row against the first value of the previous row, wrapping), split into a high-byte plane then a low-byte plane.
//
// Horizon map header: 0 "CTMW"  4 u16 version(1)  6 u16 faceSize  8 u16 azimuths(8)  10 u16 codec(1)
//   12 u32 rawBytes  16 f32 minAngleDeg  20 f32 maxAngleDeg  24 f32 minOccluderM  28 f32 reserved
// Payload: for each face, for each azimuth channel k (azimuth k * 45 degrees from local north toward east), a
// faceSize^2 uint8 plane, row-delta coded (wrapping).

import { deflateRawSync, inflateRawSync } from "node:zlib";

export const HEIGHT_MAGIC = "CTMH";
export const HORIZON_MAGIC = "CTMW";
export const HEADER_BYTES = 32;
export const CODEC_DEFLATE_RAW = 1;

export interface HeightCubeFile {
  readonly faceSize: number;
  readonly gutter: number;
  readonly offsetM: number;
  readonly scaleM: number;
  readonly data: Uint16Array;
}

function writeMagic(view: DataView, magic: string): void {
  for (let i = 0; i < 4; i++) view.setUint8(i, magic.charCodeAt(i));
}

function readMagic(view: DataView): string {
  return String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3));
}

/** Uncompressed transform output of a height cube (also what `rawSha256` in the manifest hashes). */
export function transformHeightCube(data: Uint16Array, faceSize: number): Uint8Array {
  const p = faceSize + 2;
  const plane = p * p;
  const out = new Uint8Array(data.length * 2);
  for (let face = 0; face < 6; face++) {
    const src = face * plane;
    const hi = face * plane * 2;
    const lo = hi + plane;
    for (let j = 0; j < p; j++) {
      for (let i = 0; i < p; i++) {
        const here = data[src + j * p + i] ?? 0;
        const ref = i === 0 ? (j === 0 ? 0 : (data[src + (j - 1) * p] ?? 0)) : (data[src + j * p + i - 1] ?? 0);
        const delta = (here - ref) & 0xffff;
        out[hi + j * p + i] = delta >> 8;
        out[lo + j * p + i] = delta & 0xff;
      }
    }
  }
  return out;
}

export function untransformHeightCube(raw: Uint8Array, faceSize: number): Uint16Array {
  const p = faceSize + 2;
  const plane = p * p;
  const data = new Uint16Array(raw.length / 2);
  for (let face = 0; face < 6; face++) {
    const dst = face * plane;
    const hi = face * plane * 2;
    const lo = hi + plane;
    for (let j = 0; j < p; j++) {
      for (let i = 0; i < p; i++) {
        const delta = ((raw[hi + j * p + i] ?? 0) << 8) | (raw[lo + j * p + i] ?? 0);
        const ref = i === 0 ? (j === 0 ? 0 : (data[dst + (j - 1) * p] ?? 0)) : (data[dst + j * p + i - 1] ?? 0);
        data[dst + j * p + i] = (ref + delta) & 0xffff;
      }
    }
  }
  return data;
}

export interface EncodedFile {
  readonly bytes: Uint8Array;
  readonly rawBytes: number;
  readonly rawTransformed: Uint8Array;
}

export function encodeHeightCube(file: HeightCubeFile): EncodedFile {
  const raw = transformHeightCube(file.data, file.faceSize);
  const payload = deflateRawSync(raw, { level: 9 });
  const bytes = new Uint8Array(HEADER_BYTES + payload.byteLength);
  const view = new DataView(bytes.buffer);
  writeMagic(view, HEIGHT_MAGIC);
  view.setUint16(4, 1, true);
  view.setUint16(6, file.faceSize, true);
  view.setUint16(8, file.gutter, true);
  view.setUint16(10, CODEC_DEFLATE_RAW, true);
  view.setUint32(12, raw.byteLength, true);
  view.setFloat64(16, file.offsetM, true);
  view.setFloat64(24, file.scaleM, true);
  bytes.set(payload, HEADER_BYTES);
  return { bytes, rawBytes: raw.byteLength, rawTransformed: raw };
}

export function decodeHeightCube(bytes: Uint8Array): HeightCubeFile {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (readMagic(view) !== HEIGHT_MAGIC || view.getUint16(4, true) !== 1) throw new Error("not a CTMH v1 file");
  if (view.getUint16(10, true) !== CODEC_DEFLATE_RAW) throw new Error("unknown codec");
  const faceSize = view.getUint16(6, true);
  const rawBytes = view.getUint32(12, true);
  const raw = inflateRawSync(bytes.subarray(HEADER_BYTES));
  if (raw.byteLength !== rawBytes) throw new Error("CTMH payload size mismatch");
  return {
    faceSize,
    gutter: view.getUint16(8, true),
    offsetM: view.getFloat64(16, true),
    scaleM: view.getFloat64(24, true),
    data: untransformHeightCube(raw, faceSize),
  };
}

export interface HorizonFile {
  readonly faceSize: number;
  readonly azimuths: number;
  readonly minAngleDeg: number;
  readonly maxAngleDeg: number;
  readonly minOccluderM: number;
  /** face-major, then azimuth channel, then row-major faceSize^2 uint8 */
  readonly planes: Uint8Array;
}

export function encodeHorizon(file: HorizonFile): EncodedFile {
  const n = file.faceSize;
  const raw = new Uint8Array(file.planes.length);
  const planeCount = file.planes.length / (n * n);
  for (let k = 0; k < planeCount; k++) {
    const base = k * n * n;
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const here = file.planes[base + j * n + i] ?? 0;
        const ref =
          i === 0 ? (j === 0 ? 0 : (file.planes[base + (j - 1) * n] ?? 0)) : (file.planes[base + j * n + i - 1] ?? 0);
        raw[base + j * n + i] = (here - ref) & 0xff;
      }
    }
  }
  const payload = deflateRawSync(raw, { level: 9 });
  const bytes = new Uint8Array(HEADER_BYTES + payload.byteLength);
  const view = new DataView(bytes.buffer);
  writeMagic(view, HORIZON_MAGIC);
  view.setUint16(4, 1, true);
  view.setUint16(6, n, true);
  view.setUint16(8, file.azimuths, true);
  view.setUint16(10, CODEC_DEFLATE_RAW, true);
  view.setUint32(12, raw.byteLength, true);
  view.setFloat32(16, file.minAngleDeg, true);
  view.setFloat32(20, file.maxAngleDeg, true);
  view.setFloat32(24, file.minOccluderM, true);
  bytes.set(payload, HEADER_BYTES);
  return { bytes, rawBytes: raw.byteLength, rawTransformed: raw };
}

export function decodeHorizon(bytes: Uint8Array): HorizonFile {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (readMagic(view) !== HORIZON_MAGIC || view.getUint16(4, true) !== 1) throw new Error("not a CTMW v1 file");
  const n = view.getUint16(6, true);
  const raw = inflateRawSync(bytes.subarray(HEADER_BYTES));
  if (raw.byteLength !== view.getUint32(12, true)) throw new Error("CTMW payload size mismatch");
  const planes = new Uint8Array(raw.byteLength);
  const planeCount = raw.byteLength / (n * n);
  for (let k = 0; k < planeCount; k++) {
    const base = k * n * n;
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const delta = raw[base + j * n + i] ?? 0;
        const ref = i === 0 ? (j === 0 ? 0 : (planes[base + (j - 1) * n] ?? 0)) : (planes[base + j * n + i - 1] ?? 0);
        planes[base + j * n + i] = (ref + delta) & 0xff;
      }
    }
  }
  return {
    faceSize: n,
    azimuths: view.getUint16(8, true),
    minAngleDeg: view.getFloat32(16, true),
    maxAngleDeg: view.getFloat32(20, true),
    minOccluderM: view.getFloat32(24, true),
    planes,
  };
}
