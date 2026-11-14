// H_base (WDS sections 3.4 and 3.5): bilinear sample of the baked uint16 height cube map.
//
// Input is the decoded padded cube as an ArrayBuffer (the caller loads and inflates the asset; packages/world does no
// file or network I/O): 6 faces (+X, -X, +Y, -Y, +Z, -Z), each (faceSize + 2)^2 uint16 little-endian texels,
// row-major (row = b, column = a), 1-texel gutter. Height in metres = offsetM + value * scaleM (manifest fields).
// Numerics match the bake's reference sampler (tools/terrain-bake src/cubemap/sample.ts), so the golden samples of
// assets/terrain/fixtures hold to well under their 0.02 m tolerance.

import type { UnitDirection } from "@moon-cleanup/shared";
import { CUBE_FACE_BASIS, CUBE_FACE_COUNT } from "./cube-mapping";

const FOUR_OVER_PI = 4 / Math.PI;

/** Layout of a decoded height cube (the `faceSize` / `offsetM` / `scaleM` fields of the terrain manifest). */
export interface HeightCubeLayout {
  /** Texels per face edge without the gutter (1024 shipped, 64 for the test fixture). */
  readonly faceSize: number;
  /** Height of value 0, metres above the reference sphere. */
  readonly offsetM: number;
  /** Metres per uint16 step. */
  readonly scaleM: number;
}

const HOST_LITTLE_ENDIAN = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1;

export class HeightCube {
  readonly faceSize: number;
  /** faceSize + 2 (1-texel gutter on every side). */
  readonly padded: number;
  readonly offsetM: number;
  readonly scaleM: number;
  /** Padded texels of all 6 faces. Shared, treat as read-only. */
  readonly data: Uint16Array;
  /** Lowest and highest representable H_base (metres). */
  readonly minHeightM: number;
  readonly maxHeightM: number;

  private readonly maxIndex: number;

  /**
   * @param buffer decoded cube bytes (the view is kept, not copied, when aligned and the host is little-endian)
   * @param byteOffset start of the cube inside `buffer`
   */
  constructor(buffer: ArrayBufferLike, layout: HeightCubeLayout, byteOffset = 0) {
    const n = layout.faceSize;
    if (!(Number.isInteger(n) && n >= 2)) throw new RangeError(`faceSize ${n}`);
    if (!(Number.isFinite(layout.offsetM) && Number.isFinite(layout.scaleM) && layout.scaleM > 0)) {
      throw new RangeError("offsetM / scaleM must be finite, scaleM > 0");
    }
    const padded = n + 2;
    const texels = CUBE_FACE_COUNT * padded * padded;
    if (buffer.byteLength - byteOffset < texels * 2) {
      throw new RangeError(`height cube needs ${texels * 2} bytes, got ${buffer.byteLength - byteOffset}`);
    }
    let data: Uint16Array;
    if (HOST_LITTLE_ENDIAN && byteOffset % 2 === 0) {
      data = new Uint16Array(buffer, byteOffset, texels);
    } else {
      data = new Uint16Array(texels);
      const view = new DataView(buffer, byteOffset, texels * 2);
      for (let k = 0; k < texels; k++) data[k] = view.getUint16(k * 2, true);
    }
    this.faceSize = n;
    this.padded = padded;
    this.offsetM = layout.offsetM;
    this.scaleM = layout.scaleM;
    this.data = data;
    this.minHeightM = layout.offsetM;
    this.maxHeightM = layout.offsetM + 65535 * layout.scaleM;
    this.maxIndex = padded - 1.000001;
  }

  /** H_base in metres above the reference sphere at unit direction `dir`. Allocation-free. */
  sample(dir: UnitDirection): number {
    const io = this.io;
    io[0] = dir.x;
    io[1] = dir.y;
    io[2] = dir.z;
    this.sampleIO();
    return io[3]!;
  }

  /** Same as `sample` with the direction as numbers. */
  sampleXYZ(x: number, y: number, z: number): number {
    const io = this.io;
    io[0] = x;
    io[1] = y;
    io[2] = z;
    this.sampleIO();
    return io[3]!;
  }

  /** Bilinear sample at face coordinates (a, b) (slightly beyond [-1, 1] reads the gutter). */
  sampleFaceAB(face: number, a: number, b: number): number {
    const io = this.io;
    io[4] = a;
    io[5] = b;
    this.bilinearIO(face);
    return io[3]!;
  }

  // Hot path note: values travel through `io` (Float64Array) instead of double arguments / return values of internal
  // calls, which V8 boxes when it does not inline them. Layout: [0..2] direction in, [3] height out, [4] a, [5] b.
  /** @internal scratch shared with GroundHeight; not part of the public contract. */
  readonly io = new Float64Array(6);

  /** Direction io[0..2] -> io[3] (face by major axis, equal-angle a, b). */
  sampleIO(): void {
    const io = this.io;
    const x = io[0]!;
    const y = io[1]!;
    const z = io[2]!;
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
    io[4] = Math.atan((x * B[o + 3]! + y * B[o + 4]! + z * B[o + 5]!) / major) * FOUR_OVER_PI;
    io[5] = Math.atan((x * B[o + 6]! + y * B[o + 7]! + z * B[o + 8]!) / major) * FOUR_OVER_PI;
    this.bilinearIO(face);
  }

  /** (a, b) = io[4], io[5] on `face` -> io[3]. Same numerics as the bake's reference sampler. */
  bilinearIO(face: number): void {
    const io = this.io;
    const n = this.faceSize;
    const p = this.padded;
    const maxIndex = this.maxIndex;
    // Clamp with Math.min/max: the equivalent ternary chain made V8 box two doubles per call (measured 32 B/call).
    const x = Math.min(Math.max(((io[4]! + 1) / 2) * n - 0.5 + 1, 0), maxIndex);
    const y = Math.min(Math.max(((io[5]! + 1) / 2) * n - 0.5 + 1, 0), maxIndex);
    // x, y are clamped to [0, padded - 1), so `| 0` equals Math.floor and keeps the texel index an int32.
    const x0 = x | 0;
    const y0 = y | 0;
    const fx = x - x0;
    const fy = y - y0;
    const base = face * p * p + y0 * p + x0;
    const d = this.data;
    const top = d[base]! * (1 - fx) + d[base + 1]! * fx;
    const bottom = d[base + p]! * (1 - fx) + d[base + p + 1]! * fx;
    io[3] = this.offsetM + (top * (1 - fy) + bottom * fy) * this.scaleM;
  }
}
