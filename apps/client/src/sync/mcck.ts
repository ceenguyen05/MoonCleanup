// Client side of the MCCK checkpoint package (layout: @moon-cleanup/shared save/checkpoint-package v1.1). The server has
// its own reader in apps/server/src/api/checkpoints/mcck.ts; this one builds upload packages and reads download pages.
// Pure and bounded: every length is checked against the buffer before it is read and nothing is allocated from a
// declared length (chunk bytes are views into the input). Candidate to move into packages/protocol (byte-only code).
//
// Accepted versions: layout v1 (CHECKPOINT_PACKAGE_VERSION 1) at shared contract v1.0 (raw chunk size <= 256 KiB) and
// v1.1 (<= 421,959 B): a reader limited to 421,959 B accepts both; anything above is refused.

import {
  CHECKPOINT_CHUNK_COUNT_BYTES,
  CHECKPOINT_CHUNK_ENTRY_FIXED_BYTES,
  CHECKPOINT_PACKAGE_FIXED_BYTES,
  CHECKPOINT_PACKAGE_MAGIC,
  CHECKPOINT_PACKAGE_VERSION,
  CHECKPOINT_PART_MAX_BYTES,
  CHECKPOINT_TRAILER_BYTES,
  POLE_CHUNK_ID,
} from "@moon-cleanup/shared";
import { CHUNK_RAW_MAX_BYTES } from "./limits";
import { crc32 } from "./crc32";

export interface McckChunk {
  readonly chunkId: number;
  /** Advisory on upload (the server picks the slot); the load rule's choice on download. */
  readonly ver: 0 | 1;
  /** Uncompressed payload size and CRC32 (unsigned). */
  readonly rawSize: number;
  readonly crc32: number;
  /** Deflate bytes (a view into the input on decode). */
  readonly bytes: Uint8Array;
}

export interface McckPackage {
  /** Lower-case canonical UUID. */
  readonly contractId: string;
  readonly generation: number;
  readonly baseGeneration: number;
  /** The gzip header envelope; empty on download continuation pages. */
  readonly header: Uint8Array;
  readonly chunks: readonly McckChunk[];
}

export type McckError =
  "truncated" | "bad_magic" | "bad_version" | "bad_crc" | "bad_length" | "bad_chunk" | "too_large";
export type McckDecode =
  { readonly ok: true; readonly value: McckPackage } | { readonly ok: false; readonly error: McckError };

const fail = (error: McckError): McckDecode => ({ ok: false, error });

function setU64(v: DataView, at: number, value: number): void {
  v.setUint32(at, value % 0x1_0000_0000, true);
  v.setUint32(at + 4, Math.floor(value / 0x1_0000_0000), true);
}
function getU64(v: DataView, at: number): number | null {
  const high = v.getUint32(at + 4, true);
  return high > 0x1f_ffff ? null : v.getUint32(at, true) + high * 0x1_0000_0000;
}

export function uuidToBytes(uuid: string, out: Uint8Array, at: number): void {
  const hex = uuid.replaceAll("-", "");
  for (let i = 0; i < 16; i++) out[at + i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
}
export function bytesToUuid(bytes: Uint8Array, at: number): string {
  let h = "";
  for (let i = 0; i < 16; i++) h += (bytes[at + i] as number).toString(16).padStart(2, "0");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** Bytes a package with `headerBytes` of header and these chunk byte lengths occupies. */
export function mcckSize(headerBytes: number, chunkLens: readonly number[]): number {
  let total = CHECKPOINT_PACKAGE_FIXED_BYTES + headerBytes + CHECKPOINT_CHUNK_COUNT_BYTES + CHECKPOINT_TRAILER_BYTES;
  for (const len of chunkLens) total += CHECKPOINT_CHUNK_ENTRY_FIXED_BYTES + len;
  return total;
}

/** Encodes one package. Throws RangeError for values outside the contract (a programming error of the caller). */
export function encodeMcck(pkg: McckPackage): Uint8Array {
  if (pkg.header.byteLength > CHECKPOINT_PART_MAX_BYTES) throw new RangeError("header exceeds the part limit");
  if (pkg.chunks.length > POLE_CHUNK_ID + 1) throw new RangeError("too many chunks");
  const out = new Uint8Array(
    mcckSize(
      pkg.header.byteLength,
      pkg.chunks.map((c) => c.bytes.byteLength),
    ),
  );
  const v = new DataView(out.buffer);
  for (let i = 0; i < 4; i++) out[i] = CHECKPOINT_PACKAGE_MAGIC.charCodeAt(i);
  v.setUint16(4, CHECKPOINT_PACKAGE_VERSION, true);
  uuidToBytes(pkg.contractId, out, 6);
  setU64(v, 22, pkg.generation);
  setU64(v, 30, pkg.baseGeneration);
  v.setUint32(38, pkg.header.byteLength, true);
  let at = CHECKPOINT_PACKAGE_FIXED_BYTES;
  out.set(pkg.header, at);
  at += pkg.header.byteLength;
  v.setUint16(at, pkg.chunks.length, true);
  at += CHECKPOINT_CHUNK_COUNT_BYTES;
  for (const c of pkg.chunks) {
    if (c.chunkId < 0 || c.chunkId > POLE_CHUNK_ID) throw new RangeError("chunk id out of range");
    if (c.rawSize > CHUNK_RAW_MAX_BYTES) throw new RangeError("chunk payload too large");
    v.setUint16(at, c.chunkId, true);
    out[at + 2] = c.ver;
    v.setUint32(at + 3, c.rawSize, true);
    v.setUint32(at + 7, c.crc32, true);
    v.setUint32(at + 11, c.bytes.byteLength, true);
    at += CHECKPOINT_CHUNK_ENTRY_FIXED_BYTES;
    out.set(c.bytes, at);
    at += c.bytes.byteLength;
  }
  v.setUint32(at, crc32(out, 0, at), true);
  return out;
}

/** CRC32 trailer of an encoded or received package (the `packageCrc32` of the upload metadata). */
export function mcckTrailerCrc(pkg: Uint8Array): number {
  return new DataView(pkg.buffer, pkg.byteOffset, pkg.byteLength).getUint32(
    pkg.byteLength - CHECKPOINT_TRAILER_BYTES,
    true,
  );
}

/** Decodes and bounds-checks one package or download page. Never throws, never inflates anything. */
export function decodeMcck(bytes: Uint8Array): McckDecode {
  const minimum = CHECKPOINT_PACKAGE_FIXED_BYTES + CHECKPOINT_CHUNK_COUNT_BYTES + CHECKPOINT_TRAILER_BYTES;
  if (bytes.byteLength < minimum) return fail("truncated");
  if (bytes.byteLength > CHECKPOINT_PART_MAX_BYTES) return fail("too_large");
  for (let i = 0; i < 4; i++) if (bytes[i] !== CHECKPOINT_PACKAGE_MAGIC.charCodeAt(i)) return fail("bad_magic");
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (v.getUint16(4, true) !== CHECKPOINT_PACKAGE_VERSION) return fail("bad_version");
  const end = bytes.byteLength - CHECKPOINT_TRAILER_BYTES;
  if (crc32(bytes, 0, end) !== v.getUint32(end, true)) return fail("bad_crc");
  const generation = getU64(v, 22);
  const baseGeneration = getU64(v, 30);
  if (generation === null || baseGeneration === null || generation < 1) return fail("bad_length");
  const headerLen = v.getUint32(38, true);
  let at = CHECKPOINT_PACKAGE_FIXED_BYTES;
  if (headerLen > end - at - CHECKPOINT_CHUNK_COUNT_BYTES) return fail("bad_length");
  const header = bytes.subarray(at, at + headerLen);
  at += headerLen;
  const chunkCount = v.getUint16(at, true);
  at += CHECKPOINT_CHUNK_COUNT_BYTES;
  if (chunkCount > POLE_CHUNK_ID + 1) return fail("bad_chunk");
  const chunks: McckChunk[] = [];
  const seen = new Set<number>();
  for (let i = 0; i < chunkCount; i++) {
    if (at + CHECKPOINT_CHUNK_ENTRY_FIXED_BYTES > end) return fail("truncated");
    const chunkId = v.getUint16(at, true);
    const ver = bytes[at + 2];
    const rawSize = v.getUint32(at + 3, true);
    const crc = v.getUint32(at + 7, true);
    const len = v.getUint32(at + 11, true);
    at += CHECKPOINT_CHUNK_ENTRY_FIXED_BYTES;
    if (chunkId > POLE_CHUNK_ID || (ver !== 0 && ver !== 1) || seen.has(chunkId)) return fail("bad_chunk");
    if (rawSize > CHUNK_RAW_MAX_BYTES) return fail("bad_chunk");
    if (len > end - at) return fail("truncated");
    seen.add(chunkId);
    chunks.push({ chunkId, ver, rawSize, crc32: crc, bytes: bytes.subarray(at, at + len) });
    at += len;
  }
  if (at !== end) return fail("bad_length");
  return { ok: true, value: { contractId: bytesToUuid(bytes, 6), generation, baseGeneration, header, chunks } };
}

/**
 * Splits a header plus chunks into packages of at most `CHECKPOINT_PART_MAX_BYTES` (the download page rule: page 0
 * carries the header, later pages have headerLen 0). Used for the local backup slot, which has no single-request limit.
 */
export function packPages(
  contractId: string,
  generation: number,
  baseGeneration: number,
  header: Uint8Array,
  chunks: readonly McckChunk[],
): Uint8Array[] {
  const groups: McckChunk[][] = [[]];
  let size = mcckSize(header.byteLength, []);
  for (const chunk of chunks) {
    const add = CHECKPOINT_CHUNK_ENTRY_FIXED_BYTES + chunk.bytes.byteLength;
    const current = groups[groups.length - 1] as McckChunk[];
    if (size + add > CHECKPOINT_PART_MAX_BYTES && current.length > 0) {
      groups.push([chunk]);
      size = mcckSize(0, [chunk.bytes.byteLength]);
    } else {
      current.push(chunk);
      size += add;
    }
  }
  return groups.map((group, i) =>
    encodeMcck({ contractId, generation, baseGeneration, header: i === 0 ? header : new Uint8Array(0), chunks: group }),
  );
}
