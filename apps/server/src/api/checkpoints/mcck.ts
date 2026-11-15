// MCCK checkpoint package and header-envelope readers/writers for the server (shared/save/checkpoint-package.ts and
// shared/save/format.ts are the layout contracts). Pure and bounded: every length is checked against the buffer before it
// is read, nothing here trusts a client-declared size beyond the limits of the contract.

import { crc32 } from "node:zlib";
import {
  CHECKPOINT_CHUNK_COUNT_BYTES,
  CHECKPOINT_CHUNK_ENTRY_FIXED_BYTES,
  CHECKPOINT_PACKAGE_FIXED_BYTES,
  CHECKPOINT_PACKAGE_MAGIC,
  CHECKPOINT_PACKAGE_VERSION,
  CHECKPOINT_PART_MAX_BYTES,
  CHECKPOINT_TRAILER_BYTES,
  DUST_CHUNK_PAYLOAD_MAX_BYTES,
  POLE_CHUNK_ID,
  SAVE_HEADER_FIXED_BYTES,
  SAVE_HEADER_LAYOUT,
  SAVE_MAGIC,
  SAVE_SECTION_ENTRY_BYTES,
  SAVE_TRAILER_BYTES,
  type CheckpointRejectReason,
} from "@moon-cleanup/shared";

export interface PackageChunk {
  readonly chunkId: number;
  readonly ver: 0 | 1;
  /** Uncompressed payload size and CRC32 (unsigned). */
  readonly rawSize: number;
  readonly crc32: number;
  /** Deflate bytes (a view into the package buffer on decode). */
  readonly bytes: Uint8Array;
}

export interface DecodedPackage {
  readonly contractId: string;
  readonly generation: number;
  readonly baseGeneration: number;
  readonly header: Uint8Array;
  readonly chunks: readonly PackageChunk[];
}

export type Decoded<T> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly reason: CheckpointRejectReason };
const bad = (reason: CheckpointRejectReason): { ok: false; reason: CheckpointRejectReason } => ({ ok: false, reason });

const view = (bytes: Uint8Array): DataView => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

/** u64 little-endian as a safe integer; `null` when it does not fit. */
function getU64(v: DataView, at: number): number | null {
  const high = v.getUint32(at + 4, true);
  if (high > 0x1f_ffff) return null;
  return v.getUint32(at, true) + high * 0x1_0000_0000;
}
function setU64(v: DataView, at: number, value: number): void {
  v.setUint32(at, value % 0x1_0000_0000, true);
  v.setUint32(at + 4, Math.floor(value / 0x1_0000_0000), true);
}

const hexOf = (bytes: Uint8Array): string =>
  Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString("hex");

export const uuidToBytes = (uuid: string): Buffer => Buffer.from(uuid.replaceAll("-", ""), "hex");
export const bytesToUuid = (bytes: Uint8Array): string => {
  const h = hexOf(bytes);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
};

/** Decodes and bounds-checks one MCCK package (single upload request). Does NOT inflate anything. */
export function decodePackage(bytes: Uint8Array): Decoded<DecodedPackage> {
  const minimum = CHECKPOINT_PACKAGE_FIXED_BYTES + CHECKPOINT_CHUNK_COUNT_BYTES + CHECKPOINT_TRAILER_BYTES;
  if (bytes.byteLength < minimum) return bad("bad_envelope");
  const v = view(bytes);
  for (let i = 0; i < 4; i += 1) if (bytes[i] !== CHECKPOINT_PACKAGE_MAGIC.charCodeAt(i)) return bad("bad_envelope");
  if (v.getUint16(4, true) !== CHECKPOINT_PACKAGE_VERSION) return bad("bad_envelope");
  const end = bytes.byteLength - CHECKPOINT_TRAILER_BYTES;
  if (crc32(bytes.subarray(0, end)) !== v.getUint32(end, true)) return bad("bad_crc");
  const generation = getU64(v, 22);
  const baseGeneration = getU64(v, 30);
  if (generation === null || baseGeneration === null || generation < 1) return bad("bad_envelope");
  const headerLen = v.getUint32(38, true);
  if (headerLen > CHECKPOINT_PART_MAX_BYTES) return bad("size_limit");
  let at = CHECKPOINT_PACKAGE_FIXED_BYTES;
  if (at + headerLen + CHECKPOINT_CHUNK_COUNT_BYTES > end) return bad("bad_envelope");
  const header = bytes.subarray(at, at + headerLen);
  at += headerLen;
  const chunkCount = v.getUint16(at, true);
  at += CHECKPOINT_CHUNK_COUNT_BYTES;
  if (chunkCount > POLE_CHUNK_ID + 1) return bad("chunk_id_out_of_range");
  const chunks: PackageChunk[] = [];
  const seen = new Set<number>();
  for (let i = 0; i < chunkCount; i += 1) {
    if (at + CHECKPOINT_CHUNK_ENTRY_FIXED_BYTES > end) return bad("bad_envelope");
    const chunkId = v.getUint16(at, true);
    const ver = bytes[at + 2];
    const rawSize = v.getUint32(at + 3, true);
    const crc = v.getUint32(at + 7, true);
    const len = v.getUint32(at + 11, true);
    at += CHECKPOINT_CHUNK_ENTRY_FIXED_BYTES;
    if (chunkId > POLE_CHUNK_ID) return bad("chunk_id_out_of_range");
    if (ver !== 0 && ver !== 1) return bad("bad_envelope");
    if (rawSize > DUST_CHUNK_PAYLOAD_MAX_BYTES) return bad("size_limit");
    if (seen.has(chunkId)) return bad("bad_envelope");
    if (len > end - at) return bad("bad_envelope");
    seen.add(chunkId);
    chunks.push({ chunkId, ver, rawSize, crc32: crc, bytes: bytes.subarray(at, at + len) });
    at += len;
  }
  if (at !== end) return bad("bad_envelope");
  return {
    ok: true,
    value: { contractId: bytesToUuid(bytes.subarray(6, 22)), generation, baseGeneration, header, chunks },
  };
}

export function encodePackage(pkg: DecodedPackage): Buffer {
  let total =
    CHECKPOINT_PACKAGE_FIXED_BYTES + pkg.header.byteLength + CHECKPOINT_CHUNK_COUNT_BYTES + CHECKPOINT_TRAILER_BYTES;
  for (const c of pkg.chunks) total += CHECKPOINT_CHUNK_ENTRY_FIXED_BYTES + c.bytes.byteLength;
  const out = Buffer.alloc(total);
  const v = view(out);
  out.write(CHECKPOINT_PACKAGE_MAGIC, 0, "ascii");
  v.setUint16(4, CHECKPOINT_PACKAGE_VERSION, true);
  uuidToBytes(pkg.contractId).copy(out, 6);
  setU64(v, 22, pkg.generation);
  setU64(v, 30, pkg.baseGeneration);
  v.setUint32(38, pkg.header.byteLength, true);
  let at = CHECKPOINT_PACKAGE_FIXED_BYTES;
  out.set(pkg.header, at);
  at += pkg.header.byteLength;
  v.setUint16(at, pkg.chunks.length, true);
  at += CHECKPOINT_CHUNK_COUNT_BYTES;
  for (const c of pkg.chunks) {
    v.setUint16(at, c.chunkId, true);
    out[at + 2] = c.ver;
    v.setUint32(at + 3, c.rawSize, true);
    v.setUint32(at + 7, c.crc32, true);
    v.setUint32(at + 11, c.bytes.byteLength, true);
    at += CHECKPOINT_CHUNK_ENTRY_FIXED_BYTES;
    out.set(c.bytes, at);
    at += c.bytes.byteLength;
  }
  v.setUint32(at, crc32(out.subarray(0, at)), true);
  return out;
}

/** Bytes a page with `headerBytes` of header and these chunk byte lengths occupies. */
export const pageSize = (headerBytes: number, chunkLens: readonly number[]): number =>
  CHECKPOINT_PACKAGE_FIXED_BYTES +
  headerBytes +
  CHECKPOINT_CHUNK_COUNT_BYTES +
  CHECKPOINT_TRAILER_BYTES +
  chunkLens.reduce((sum, len) => sum + CHECKPOINT_CHUNK_ENTRY_FIXED_BYTES + len, 0);

export interface EnvelopeInfo {
  readonly saveFormatVersion: number;
  readonly gridM: number;
  readonly radiusM: number;
  readonly plotCount: number;
  readonly bakeHash: string;
  readonly simTick: number;
  readonly generation: number;
  readonly parentGeneration: number;
  readonly originKind: "room" | "solo";
  readonly sectionCount: number;
}

const L = SAVE_HEADER_LAYOUT;

/**
 * Reads the fixed header and checks the section table and trailer CRC of a gunzipped v1 envelope. Section bodies are never
 * interpreted (that is the sim's job); the server only checks they add up and that the CRC matches.
 */
export function decodeEnvelope(raw: Uint8Array): Decoded<EnvelopeInfo> {
  if (raw.byteLength < SAVE_HEADER_FIXED_BYTES + SAVE_TRAILER_BYTES) return bad("bad_envelope");
  const v = view(raw);
  for (let i = 0; i < 4; i += 1) if (raw[i] !== SAVE_MAGIC.charCodeAt(i)) return bad("bad_envelope");
  const saveFormatVersion = v.getUint16(L.saveFormatVersion.offset, true);
  const sectionCount = v.getUint16(L.sectionCount.offset, true);
  const tableEnd = SAVE_HEADER_FIXED_BYTES + sectionCount * SAVE_SECTION_ENTRY_BYTES;
  const end = raw.byteLength - SAVE_TRAILER_BYTES;
  if (tableEnd > end) return bad("bad_envelope");
  let bodies = 0;
  for (let i = 0; i < sectionCount; i += 1) {
    bodies += v.getUint32(SAVE_HEADER_FIXED_BYTES + i * SAVE_SECTION_ENTRY_BYTES + 4, true);
  }
  if (tableEnd + bodies !== end) return bad("bad_envelope");
  if (crc32(raw.subarray(0, end)) !== v.getUint32(end, true)) return bad("bad_crc");
  const simTick = getU64(v, L.simTick.offset);
  const generation = getU64(v, L.generation.offset);
  const parentGeneration = getU64(v, L.parentGeneration.offset);
  if (simTick === null || generation === null || parentGeneration === null || generation < 1)
    return bad("bad_envelope");
  const originByte = raw[L.originKind.offset];
  if ((originByte !== 0 && originByte !== 1) || raw[L.reserved.offset] !== 0) return bad("bad_envelope");
  return {
    ok: true,
    value: {
      saveFormatVersion,
      gridM: v.getUint16(L.gridM.offset, true),
      radiusM: v.getUint16(L.radiusM.offset, true),
      plotCount: v.getUint32(L.plotCount.offset, true),
      bakeHash: hexOf(raw.subarray(L.bakeHash.offset, L.bakeHash.offset + L.bakeHash.bytes)),
      simTick,
      generation,
      parentGeneration,
      originKind: originByte === 1 ? "solo" : "room",
      sectionCount,
    },
  };
}
