// Minimal PNG writer and reader for the capture path (Node only: zlib). 8-bit, non-interlaced; the reader accepts
// colour types 0 (grey), 2 (RGB), 4 (grey + alpha) and 6 (RGBA) with all five filter types.
import { crc32, deflateSync, inflateSync } from "node:zlib";

const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

function chunk(type: string, data: Uint8Array): Uint8Array {
  const body = new Uint8Array(4 + data.length);
  for (let i = 0; i < 4; i++) body[i] = type.charCodeAt(i);
  body.set(data, 4);
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  out.set(body, 4);
  view.setUint32(8 + data.length, crc32(body));
  return out;
}

/** Encodes tightly packed 8-bit RGB rows as a PNG. */
export function encodePng(rgb: Uint8Array, width: number, height: number): Uint8Array {
  const stride = width * 3;
  const raw = new Uint8Array((stride + 1) * height);
  for (let y = 0; y < height; y++) raw.set(rgb.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  header.set([8, 2, 0, 0, 0], 8);
  const parts = [
    Uint8Array.from(SIGNATURE),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw, { level: 6 })),
    chunk("IEND", new Uint8Array(0)),
  ];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

export interface DecodedPng {
  readonly width: number;
  readonly height: number;
  /** Samples per pixel: 1, 2, 3 or 4. */
  readonly channels: number;
  /** width x height x channels bytes, row-major. */
  readonly data: Uint8Array;
}

/** Decodes an 8-bit non-interlaced PNG. Throws on anything else. */
export function decodePng(bytes: Uint8Array): DecodedPng {
  for (let i = 0; i < 8; i++) if (bytes[i] !== SIGNATURE[i]) throw new Error("not a PNG");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let at = 8;
  let width = 0;
  let height = 0;
  let channels = 0;
  const idat: Uint8Array[] = [];
  while (at + 12 <= bytes.length) {
    const length = view.getUint32(at);
    const type = String.fromCharCode(...bytes.subarray(at + 4, at + 8));
    const data = bytes.subarray(at + 8, at + 8 + length);
    if (type === "IHDR") {
      width = view.getUint32(at + 8);
      height = view.getUint32(at + 12);
      const depth = data[8];
      const colour = data[9] ?? -1;
      if (depth !== 8 || data[12] !== 0) throw new Error("only 8-bit non-interlaced PNG is supported");
      channels = colour === 0 ? 1 : colour === 2 ? 3 : colour === 4 ? 2 : colour === 6 ? 4 : 0;
      if (channels === 0) throw new Error(`unsupported PNG colour type ${colour}`);
    } else if (type === "IDAT") idat.push(data);
    else if (type === "IEND") break;
    at += 12 + length;
  }
  if (width === 0 || height === 0) throw new Error("PNG has no IHDR");
  const packed = new Uint8Array(idat.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const p of idat) {
    packed.set(p, offset);
    offset += p.length;
  }
  const raw = inflateSync(packed);
  const stride = width * channels;
  if (raw.length !== (stride + 1) * height) throw new Error("PNG data has the wrong length");
  const out = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const row = y * stride;
    const src = y * (stride + 1) + 1;
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? (out[row + x - channels] ?? 0) : 0;
      const b = y > 0 ? (out[row - stride + x] ?? 0) : 0;
      const c = x >= channels && y > 0 ? (out[row - stride + x - channels] ?? 0) : 0;
      let predicted = 0;
      if (filter === 1) predicted = a;
      else if (filter === 2) predicted = b;
      else if (filter === 3) predicted = (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        predicted = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      } else if (filter !== 0) throw new Error(`bad PNG filter ${filter}`);
      out[row + x] = ((raw[src + x] ?? 0) + predicted) & 0xff;
    }
  }
  return { width, height, channels, data: out };
}
