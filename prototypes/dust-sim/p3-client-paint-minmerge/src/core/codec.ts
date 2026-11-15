// Tile codecs shared by server and client.
//  - Full tile: mode byte (0 = nibble RLE, 1 = raw packed 2,048 B), whichever is smaller. RLE token = value << 4 | n,
//    n 0..14 = run of n + 1, n 15 = run of 16 + varint.
//  - Sparse delta body: varint texel count, varint (gap - 1) per texel in ascending index order, then the new levels
//    as a nibble stream. The plot id is written by the caller.
import { ByteReader, ByteWriter } from "./bytes";
import { LEVEL_MAX, TILE_PACKED_BYTES, TILE_TEXELS } from "./constants";

export const getNib = (packed: Uint8Array, i: number): number => ((packed[i >> 1] ?? 0) >> ((i & 1) << 2)) & 15;

export function setNib(packed: Uint8Array, i: number, v: number): void {
  const sh = (i & 1) << 2;
  packed[i >> 1] = ((packed[i >> 1] ?? 0) & ~(15 << sh)) | (v << sh);
}

export function encodeFull(w: ByteWriter, packed: Uint8Array): void {
  const start = w.pos;
  w.u8(0);
  let run = 1;
  let cur = getNib(packed, 0);
  for (let i = 1; i <= TILE_TEXELS; i++) {
    const v = i < TILE_TEXELS ? getNib(packed, i) : -1;
    if (v === cur) {
      run++;
      continue;
    }
    if (run <= 15) w.u8((cur << 4) | (run - 1));
    else {
      w.u8((cur << 4) | 15);
      w.varint(run - 16);
    }
    cur = v;
    run = 1;
    if (w.pos - start > TILE_PACKED_BYTES) break;
  }
  if (w.pos - start > TILE_PACKED_BYTES) {
    w.pos = start;
    w.u8(1);
    w.bytes(packed, 0, TILE_PACKED_BYTES);
  }
}

/** Encoding of an untouched tile (every texel at LEVEL_MAX). */
export function encodeBlank(w: ByteWriter): void {
  w.u8(0);
  w.u8((LEVEL_MAX << 4) | 15);
  w.varint(TILE_TEXELS - 16);
}

/** Decodes a full tile into one level per byte. False when the data is malformed. */
export function decodeFull(r: ByteReader, out: Uint8Array): boolean {
  const mode = r.u8();
  if (mode === 1) {
    if (r.remaining < TILE_PACKED_BYTES) return false;
    for (let i = 0; i < TILE_TEXELS; i++) out[i] = getNib(r.buf, r.pos * 2 + i);
    r.skip(TILE_PACKED_BYTES);
    return true;
  }
  if (mode !== 0) return false;
  let i = 0;
  while (i < TILE_TEXELS) {
    const t = r.u8();
    if (r.bad) return false;
    let run = (t & 15) + 1;
    if (run === 16) run = 16 + r.varint();
    if (i + run > TILE_TEXELS) return false;
    const v = t >> 4;
    for (let k = 0; k < run; k++) out[i + k] = v;
    i += run;
  }
  return true;
}

/** Reads `count` ascending texel indices of a delta body into `idx`. False when malformed. */
export function readGaps(r: ByteReader, count: number, idx: Uint16Array): boolean {
  let prev = -1;
  for (let k = 0; k < count; k++) {
    prev += r.varint() + 1;
    if (prev >= TILE_TEXELS || r.bad) return false;
    idx[k] = prev;
  }
  return true;
}

export function writeZigzag(w: ByteWriter, v: number): void {
  w.varint(v < 0 ? -2 * v - 1 : 2 * v);
}

export function readZigzag(r: ByteReader): number {
  const z = r.varint();
  return z & 1 ? -((z + 1) >> 1) : z >> 1;
}

/** Lowest set bit index of a non-zero 32-bit word. */
export const lowBit = (w: number): number => 31 - Math.clz32(w & -w);
