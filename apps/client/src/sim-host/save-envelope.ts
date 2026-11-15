// Save header envelope v1 codec (layout: @moon-cleanup/shared save/format, golden vectors: save/vectors) plus the
// gzip step, for local Solo checkpoints (ADR-0031). Pure; the gzip helpers use CompressionStream when present.
// Candidate to move into packages/sim (the package that owns the META/PLAYERS sections) once its codec lands; the
// layout is the shared contract, so moving it changes no bytes.

import {
  SAVE_FORMAT_VERSION,
  SAVE_HEADER_FIXED_BYTES,
  SAVE_HEADER_LAYOUT,
  SAVE_MAGIC,
  SAVE_ORIGIN_KIND_CODE,
  SAVE_SECTION_ENTRY_BYTES,
  SAVE_TRAILER_BYTES,
  type SaveHeader,
  type SaveSectionEntry,
} from "@moon-cleanup/shared";

// ---- CRC32 (IEEE 802.3, as zlib) ----------------------------------------------------------------------------------

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(bytes: Uint8Array, start = 0, end = bytes.length): number {
  let c = 0xffffffff;
  for (let i = start; i < end; i++) c = (CRC_TABLE[(c ^ (bytes[i] ?? 0)) & 0xff] ?? 0) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// ---- envelope -----------------------------------------------------------------------------------------------------

const L = SAVE_HEADER_LAYOUT;

function hexToBytes(hex: string, out: Uint8Array, at: number, len: number): void {
  for (let i = 0; i < len; i++) out[at + i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16) & 0xff;
}

function bytesToHex(b: Uint8Array, at: number, len: number): string {
  let s = "";
  for (let i = 0; i < len; i++) s += (b[at + i] ?? 0).toString(16).padStart(2, "0");
  return s;
}

function setU64(v: DataView, at: number, value: number): void {
  v.setUint32(at, value % 0x1_0000_0000, true);
  v.setUint32(at + 4, Math.floor(value / 0x1_0000_0000), true);
}

function getU64(v: DataView, at: number): number {
  return v.getUint32(at, true) + v.getUint32(at + 4, true) * 0x1_0000_0000;
}

/** Encodes header + bodies (table order; `header.sections[i].length` must equal `bodies[i].length`). */
export function encodeSaveEnvelope(header: SaveHeader, bodies: readonly Uint8Array[]): Uint8Array {
  if (bodies.length !== header.sections.length) throw new RangeError("one body per section");
  let total = SAVE_HEADER_FIXED_BYTES + header.sections.length * SAVE_SECTION_ENTRY_BYTES + SAVE_TRAILER_BYTES;
  for (let i = 0; i < bodies.length; i++) {
    const len = bodies[i]!.length;
    if (len !== header.sections[i]!.length) throw new RangeError(`section ${i} length mismatch`);
    total += len;
  }
  const out = new Uint8Array(total);
  const v = new DataView(out.buffer);
  for (let i = 0; i < 4; i++) out[i] = SAVE_MAGIC.charCodeAt(i);
  v.setUint16(L.saveFormatVersion.offset, header.saveFormatVersion, true);
  v.setUint16(L.gridM.offset, header.gridM, true);
  v.setUint16(L.radiusM.offset, header.radiusM, true);
  v.setUint32(L.plotCount.offset, header.plotCount, true);
  hexToBytes(header.bakeHash, out, L.bakeHash.offset, 32);
  v.setUint16(L.dustModelVersion.offset, header.dustModelVersion, true);
  setU64(v, L.simTick.offset, header.simTick);
  setU64(v, L.generation.offset, header.generation);
  setU64(v, L.parentGeneration.offset, header.parentGeneration);
  out[L.originKind.offset] = SAVE_ORIGIN_KIND_CODE[header.originKind];
  out[L.reserved.offset] = 0;
  hexToBytes(header.originId, out, L.originId.offset, 16);
  v.setUint16(L.sectionCount.offset, header.sections.length, true);
  let at = SAVE_HEADER_FIXED_BYTES;
  for (const s of header.sections) {
    v.setUint16(at, s.id, true);
    v.setUint16(at + 2, s.version, true);
    v.setUint32(at + 4, s.length, true);
    at += SAVE_SECTION_ENTRY_BYTES;
  }
  for (const b of bodies) {
    out.set(b, at);
    at += b.length;
  }
  v.setUint32(at, crc32(out, 0, at), true);
  return out;
}

export interface DecodedSaveEnvelope {
  readonly header: SaveHeader;
  /** Section bodies in table order (views into the input). */
  readonly bodies: readonly Uint8Array[];
}

export class SaveEnvelopeError extends Error {
  override readonly name = "SaveEnvelopeError";
}

/** Decodes and verifies (magic, version, CRC, lengths) an uncompressed v1 envelope. Throws SaveEnvelopeError. */
export function decodeSaveEnvelope(bytes: Uint8Array): DecodedSaveEnvelope {
  if (bytes.length < SAVE_HEADER_FIXED_BYTES + SAVE_TRAILER_BYTES) throw new SaveEnvelopeError("truncated");
  for (let i = 0; i < 4; i++) if (bytes[i] !== SAVE_MAGIC.charCodeAt(i)) throw new SaveEnvelopeError("bad magic");
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const end = bytes.length - SAVE_TRAILER_BYTES;
  if (v.getUint32(end, true) !== crc32(bytes, 0, end)) throw new SaveEnvelopeError("bad crc");
  const version = v.getUint16(L.saveFormatVersion.offset, true);
  if (version !== SAVE_FORMAT_VERSION) throw new SaveEnvelopeError(`unsupported saveFormatVersion ${version}`);
  const originCode = bytes[L.originKind.offset];
  const count = v.getUint16(L.sectionCount.offset, true);
  const sections: SaveSectionEntry[] = [];
  let at = SAVE_HEADER_FIXED_BYTES;
  for (let i = 0; i < count; i++) {
    if (at + SAVE_SECTION_ENTRY_BYTES > end) throw new SaveEnvelopeError("truncated section table");
    sections.push({ id: v.getUint16(at, true), version: v.getUint16(at + 2, true), length: v.getUint32(at + 4, true) });
    at += SAVE_SECTION_ENTRY_BYTES;
  }
  const bodies: Uint8Array[] = [];
  for (const s of sections) {
    if (at + s.length > end) throw new SaveEnvelopeError("truncated section body");
    bodies.push(bytes.subarray(at, at + s.length));
    at += s.length;
  }
  if (at !== end) throw new SaveEnvelopeError("trailing bytes");
  const header: SaveHeader = {
    saveFormatVersion: version,
    gridM: v.getUint16(L.gridM.offset, true),
    radiusM: v.getUint16(L.radiusM.offset, true),
    plotCount: v.getUint32(L.plotCount.offset, true),
    bakeHash: bytesToHex(bytes, L.bakeHash.offset, 32),
    dustModelVersion: v.getUint16(L.dustModelVersion.offset, true),
    simTick: getU64(v, L.simTick.offset),
    generation: getU64(v, L.generation.offset),
    parentGeneration: getU64(v, L.parentGeneration.offset),
    originKind: originCode === SAVE_ORIGIN_KIND_CODE.solo ? "solo" : "room",
    originId: bytesToHex(bytes, L.originId.offset, 16),
    sections,
  };
  return { header, bodies };
}

// ---- gzip (SAVE_HEADER_CODEC) -------------------------------------------------------------------------------------

/** True when the platform has CompressionStream / DecompressionStream (every target browser, Node 18+). */
export function hasCompressionStreams(): boolean {
  return typeof CompressionStream === "function" && typeof DecompressionStream === "function";
}

async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const body = new Blob([bytes as Uint8Array<ArrayBuffer>]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(body).arrayBuffer());
}

export function gzip(bytes: Uint8Array): Promise<Uint8Array> {
  return pipe(bytes, new CompressionStream("gzip"));
}

export function gunzip(bytes: Uint8Array): Promise<Uint8Array> {
  return pipe(bytes, new DecompressionStream("gzip"));
}

// ---- deflate (DUST_CHUNK_CODEC) -----------------------------------------------------------------------------------

/** zlib-wrapped deflate (RFC 1950) of one dust chunk payload. */
export function deflate(bytes: Uint8Array): Promise<Uint8Array> {
  return pipe(bytes, new CompressionStream("deflate"));
}

/**
 * Inflates a stored dust chunk, giving up as soon as the output passes `maxBytes` (the bytes come from the player's
 * disk and are not trusted: a tiny stream may expand without bound). Throws on a bad stream or an oversize result.
 */
export async function inflateCapped(bytes: Uint8Array, maxBytes: number): Promise<Uint8Array> {
  const body = new Blob([bytes as Uint8Array<ArrayBuffer>]).stream().pipeThrough(new DecompressionStream("deflate"));
  const reader = body.getReader();
  const parts: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > maxBytes) {
      await reader.cancel();
      throw new RangeError(`inflated data exceeds ${maxBytes} bytes`);
    }
    parts.push(value);
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}
