// @contract save/checkpoint-package v1.1
// @consumers apps/client/src/sim-host (builds the package from a local checkpoint), apps/client/src/net (uploads,
//   downloads, restores), apps/server/src/api and apps/server/src/persistence (verify, split into slot + chunk rows),
//   packages/sim and packages/world (decode of the header and chunk payloads inside), tools/bots (fixtures)
//
// v1.1 (M1-W0-T08, 2026-11-14; layout unchanged, CHECKPOINT_PACKAGE_VERSION stays 1): `rawSize` is bounded by the
// raised DUST_CHUNK_PAYLOAD_MAX_BYTES (421,959 B, the dust chunk layout maximum). Carrier check: one maximum chunk
// deflates to at most about 422 KB (stored-block worst case), so a download page holding it alone (42 + 2 + 15 + bytes
// + 4) stays well inside CHECKPOINT_PART_MAX_BYTES; upload parts are plain slices and need no change. Part, session
// and header limits are unchanged; the server's 32 MiB per-package inflate budget is unchanged.
//
// `MCCK` checkpoint package: the binary body of a Solo checkpoint upload and of a save download (ADR-0031,
// data-model.md section 3.7c). One package = one header envelope (gzip, as stored in a slot) plus the dust chunk
// payloads (deflate, as stored in chunk rows) that changed (upload) or that the load rule chose (download).
// Compression is applied BEFORE packing, so the package is not compressed again and CRC32s are those of the
// uncompressed data where noted.
//
// Layout v1, little-endian:
//   offset  size  field
//   0       4     magic "MCCK" (ASCII)
//   4       2     version u16            CHECKPOINT_PACKAGE_VERSION
//   6       16    contractId             raw UUID bytes (RFC 9562, network order)
//   22      8     generation u64         the checkpoint generation, >= 1 (equals the header envelope's generation)
//   30      8     baseGeneration u64     newest generation the sender knows the server has (0 = none)
//   38      4     headerLen u32          length of the gzip header envelope (<= CHECKPOINT_PART_MAX_BYTES)
//   42      L     header                 the gzip header envelope of save/format (SAVE_HEADER_CODEC)
//   42+L    2     chunkCount u16
//   ...           per chunk (CHECKPOINT_CHUNK_ENTRY_FIXED_BYTES = 15, then bytes):
//                   chunkId u16 (0 .. 640) | ver u8 (0 or 1) | rawSize u32 | crc32 u32 | len u32 | len bytes
//                   (rawSize and crc32 describe the UNCOMPRESSED dust chunk payload; the bytes are deflate)
//   end-4   4     CRC32 (IEEE) of every byte before it
//
// Rules:
//   - chunkIds are unique within a package. On upload `ver` is advisory: the server writes each chunk to its older
//     version (data-model.md 3.7b); on download it is the version the load rule chose.
//   - Download pages (`GET /v1/contracts/:id/save?page=n`) are each a standalone MCCK package of at most
//     CHECKPOINT_PART_MAX_BYTES; page 1 carries the header, later pages carry headerLen 0 and further chunks. [R]
//     (the page protocol is bound by api/rest in M1-W0-T02).
//   - Upload parts (`PUT .../parts/:n`) are plain byte slices of ONE complete package, at most
//     CHECKPOINT_PART_MAX_BYTES each and CHECKPOINT_SESSION_MAX_BYTES in total; the begin request's `packageCrc32` is
//     the CRC32 of the whole concatenated package.
//   - Limits per verify step (data-model.md 3.7c step 3): rawSize <= DUST_CHUNK_PAYLOAD_MAX_BYTES, chunk ids 0 .. 640,
//     header envelope <= SAVE_HEADER_MAX_BYTES after gunzip.

import { z } from "zod";
import { POLE_CHUNK_ID } from "../world";
import { DUST_CHUNK_PAYLOAD_MAX_BYTES, DUST_CHUNK_VERSIONS } from "./format";

/** Version of the package layout. */
export const CHECKPOINT_PACKAGE_VERSION = 1;

/** Magic bytes at offset 0, as ASCII text. */
export const CHECKPOINT_PACKAGE_MAGIC = "MCCK";

/** One request or one download page carries at most this many bytes (1 MiB). */
export const CHECKPOINT_PART_MAX_BYTES = 1024 * 1024;

/** A whole upload package is at most this many bytes (4 MiB), staged in server memory (<= 4 parts). */
export const CHECKPOINT_SESSION_MAX_BYTES = 4 * 1024 * 1024;

/** Parts per upload session. */
export const CHECKPOINT_MAX_PARTS = CHECKPOINT_SESSION_MAX_BYTES / CHECKPOINT_PART_MAX_BYTES;

/** Byte offsets of the fixed prefix, up to (excluding) the header bytes. */
export const CHECKPOINT_PACKAGE_LAYOUT = {
  magic: { offset: 0, bytes: 4 },
  version: { offset: 4, bytes: 2 },
  contractId: { offset: 6, bytes: 16 },
  generation: { offset: 22, bytes: 8 },
  baseGeneration: { offset: 30, bytes: 8 },
  headerLen: { offset: 38, bytes: 4 },
} as const;

/** Bytes before the header: 42. */
export const CHECKPOINT_PACKAGE_FIXED_BYTES = 42;

/** Bytes of `chunkCount`. */
export const CHECKPOINT_CHUNK_COUNT_BYTES = 2;

/** Fixed bytes of a chunk entry before its bytes: chunkId u16, ver u8, rawSize u32, crc32 u32, len u32. */
export const CHECKPOINT_CHUNK_ENTRY_FIXED_BYTES = 15;

/** Bytes of the CRC32 trailer. */
export const CHECKPOINT_TRAILER_BYTES = 4;

const U32 = z.int().min(0).max(0xffff_ffff);

/** One dust chunk of a package: deflate bytes plus the raw size and CRC32 of the uncompressed payload. */
export const CheckpointChunkSchema = z.object({
  chunkId: z.int().min(0).max(POLE_CHUNK_ID),
  ver: z.union([z.literal(DUST_CHUNK_VERSIONS[0]), z.literal(DUST_CHUNK_VERSIONS[1])]),
  rawSize: z.int().min(0).max(DUST_CHUNK_PAYLOAD_MAX_BYTES),
  crc32: U32,
  bytes: z.instanceof(Uint8Array),
});
export type CheckpointChunk = z.infer<typeof CheckpointChunkSchema>;

/** Decoded package. `header` is the gzip envelope (empty only on download continuation pages). */
export const CheckpointPackageSchema = z
  .object({
    contractId: z.uuid(),
    generation: z.int().min(1),
    baseGeneration: z.int().min(0),
    header: z.instanceof(Uint8Array),
    chunks: z.array(CheckpointChunkSchema).max(POLE_CHUNK_ID + 1),
  })
  .refine((pkg) => new Set(pkg.chunks.map((c) => c.chunkId)).size === pkg.chunks.length, {
    message: "chunk ids must be unique within a package",
    path: ["chunks"],
  })
  .refine((pkg) => pkg.header.length <= CHECKPOINT_PART_MAX_BYTES, {
    message: "header exceeds the part limit",
    path: ["header"],
  });
export type CheckpointPackage = z.infer<typeof CheckpointPackageSchema>;
