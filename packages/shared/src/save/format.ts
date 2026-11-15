// @contract save/format v1.1
// @consumers apps/server/src/persistence (envelope encode/decode, compression, slot writes), apps/client/src/sim-host
//   (local checkpoints, CompressionStream), packages/sim (envelope codec; writes and reads the header sections it
//   owns), packages/world and apps/server/src/world (dust chunk payloads, via ./dust-chunk), packages/db (row metadata
//   columns), apps/server/src/api (solo upload verification), tools/bots (save fixtures v1)
//
// v1.1 (M1-W0-T08, 2026-11-14; envelope layout unchanged, SAVE_FORMAT_VERSION stays 1): DUST_CHUNK_PAYLOAD_MAX_BYTES
// rises from 262,144 B to the dust chunk v1 layout maximum, 421,959 B (derived from ./dust-chunk). Widening only:
// nothing valid before is rejected now. A server still on the old limit answers `size_limit` to a larger chunk; no
// data migration. Consumers: apps/server/src/api/checkpoints (comments citing 256 KiB), packages/world (tests).
//
// Save format: layout of the header envelope stored in the two alternating slots A/B of `contract_saves` (and in the
// local IndexedDB checkpoints of Solo, ADR-0031), plus the row-level constants of `contract_dust_chunks`.
// Specification: docs/architecture/data-model.md sections 3.7, 3.7b, 3.7c and 6 (canonical save layout); the dust
// chunk payload is ./dust-chunk (world-and-dust-simulation.md section 6); the upload package is
// ./checkpoint-package.
//
// Header envelope v1, little-endian (the same byte order as the network protocol):
//   offset  size  field
//   0       4     magic "MCSV" (ASCII)
//   4       2     saveFormatVersion u16
//   6       2     gridM u16             grid frequency (128 Standard)
//   8       2     radiusM u16           moon radius in metres
//   10      4     plotCount u32         10 * gridM^2 + 2
//   14      32    bakeHash              terrain + grid golden hash (SHA-256)
//   46      2     dustModelVersion u16  DUST_MODEL_VERSION of the writer (world/dust)
//   48      8     simTick u64           tick at capture (decoded as a safe integer)
//   56      8     generation u64        save generation = save_seq (ADR-0031), >= 1
//   64      8     parentGeneration u64  generation this state descends from, < generation (0 for the first save)
//   72      1     originKind u8         0 room (server room checkpoint), 1 solo (local-first checkpoint)
//   73      1     reserved u8           must be 0
//   74      16    originId              device id (solo) or instance boot uuid (room), raw bytes
//   90      2     sectionCount u16
//   92      8*n   section table: per section id u16, version u16, length u32
//   ...           section bodies, contiguous, in table order
//   end-4   4     CRC32 (IEEE, as zlib) of every byte before it
// The whole envelope is then gzip-compressed (SAVE_HEADER_CODEC) before it is stored. Readers skip unknown section
// ids. There is no PLOTS or LEDGERS section: per-plot dust data lives only in the dust chunk rows.
//
// Versioning (data-model.md section 6): a loader upgrades older envelopes in memory vN -> vN+1 -> ... -> current; a
// server never reads an envelope whose saveFormatVersion is newer than its own (close 4108). A breaking change to
// this file bumps SAVE_FORMAT_VERSION, adds a migration note here and a golden fixture per historical version.
// Changing one section's layout bumps only that section's version (owned by the package that writes the section).
//
// Migration v0 -> v1 (this wave). v1 grows the fixed header from 58 to 92 bytes: generation, parentGeneration,
// originKind, a reserved byte and originId are inserted between simTick and sectionCount; everything before simTick
// is unchanged, the section table, bodies and trailer follow unchanged (the CRC is recomputed over the new bytes).
// Upgrade rule for a v0 envelope: generation = save_seq of its slot row, parentGeneration = save_seq - 1,
// originKind = "room", originId = 16 zero bytes (SAVE_V0_TO_V1_DEFAULTS); the loader keeps every section unchanged.
// No v0 save has ever been persisted (v0 existed only as a contract and in fixtures), so this migration is
// exercised only by SAVE_HEADER_V0_GOLDEN_VECTORS; there is nothing to back up or soak.
//
// Section ids and their section versions are unchanged in v1. The dust chunk payload has its own version
// (DUST_CHUNK_PAYLOAD_VERSION in ./dust-chunk); it is not bumped by this header change.
//
// Generation rule (data-model.md 3.7c): every checkpoint on any host has generation = parentGeneration + 1 on that
// host; a conflict-overwrite upload uses generation = max(local, server) + 1 with its local parentGeneration, so the
// only enforced relation is generation > parentGeneration. A server room writes newest + 1.

import { z } from "zod";
import { DUST_CHUNK_PAYLOAD_LAYOUT_MAX_BYTES } from "./dust-chunk";

/** Version of the header envelope layout. */
export const SAVE_FORMAT_VERSION = 1;

/** Magic bytes at offset 0, as ASCII text. */
export const SAVE_MAGIC = "MCSV";

/** Byte offsets and sizes of the fixed part of the v1 header envelope. */
export const SAVE_HEADER_LAYOUT = {
  magic: { offset: 0, bytes: 4 },
  saveFormatVersion: { offset: 4, bytes: 2 },
  gridM: { offset: 6, bytes: 2 },
  radiusM: { offset: 8, bytes: 2 },
  plotCount: { offset: 10, bytes: 4 },
  bakeHash: { offset: 14, bytes: 32 },
  dustModelVersion: { offset: 46, bytes: 2 },
  simTick: { offset: 48, bytes: 8 },
  generation: { offset: 56, bytes: 8 },
  parentGeneration: { offset: 64, bytes: 8 },
  originKind: { offset: 72, bytes: 1 },
  reserved: { offset: 73, bytes: 1 },
  originId: { offset: 74, bytes: 16 },
  sectionCount: { offset: 90, bytes: 2 },
} as const;

/** Size of the fixed part; the section table starts here. */
export const SAVE_HEADER_FIXED_BYTES = 92;

/** Byte offsets of the v0 fixed header (historical; for the v0 -> v1 loader step and the v0 fixture). */
export const SAVE_HEADER_LAYOUT_V0 = {
  magic: { offset: 0, bytes: 4 },
  saveFormatVersion: { offset: 4, bytes: 2 },
  gridM: { offset: 6, bytes: 2 },
  radiusM: { offset: 8, bytes: 2 },
  plotCount: { offset: 10, bytes: 4 },
  bakeHash: { offset: 14, bytes: 32 },
  dustModelVersion: { offset: 46, bytes: 2 },
  simTick: { offset: 48, bytes: 8 },
  sectionCount: { offset: 56, bytes: 2 },
} as const;

/** Size of the v0 fixed part. */
export const SAVE_HEADER_FIXED_BYTES_V0 = 58;

/** Size of one section table entry (id u16, version u16, length u32). */
export const SAVE_SECTION_ENTRY_BYTES = 8;

/** Size of the CRC32 trailer. */
export const SAVE_TRAILER_BYTES = 4;

/** Size of the bake hash in bytes. */
export const BAKE_HASH_BYTES = 32;

/** Size of `originId` in bytes. */
export const SAVE_ORIGIN_ID_BYTES = 16;

/** Who wrote a checkpoint: a server room or a local-first Solo host (ADR-0031). Index = the `originKind` byte. */
export const SAVE_ORIGIN_KINDS = ["room", "solo"] as const;
export type SaveOriginKind = (typeof SAVE_ORIGIN_KINDS)[number];

/** `originKind` byte codes. */
export const SAVE_ORIGIN_KIND_CODE = { room: 0, solo: 1 } as const satisfies Record<SaveOriginKind, number>;

/** `originId` as lower-case hex (32 characters = 16 bytes). */
export const SaveOriginIdSchema = z.string().regex(/^[0-9a-f]{32}$/);

/** Values a v0 envelope receives on upgrade to v1 (see the migration note above). */
export const SAVE_V0_TO_V1_DEFAULTS = {
  originKind: "room",
  originId: "00000000000000000000000000000000",
} as const satisfies { originKind: SaveOriginKind; originId: string };

/**
 * `bakeHash` as lower-case hex of the 32-byte SHA-256 over the terrain bake and the golden grid hash (the Contract's
 * world identity). The server and client refuse a save whose bakeHash differs from their build's manifest (REST
 * reject reason `bake_mismatch`); `gridM`, `radiusM` and `plotCount` must agree as well.
 */
export const BakeHashSchema = z.string().regex(/^[0-9a-f]{64}$/);

/**
 * Header section ids (data-model.md section 6). Owners: META and PLAYERS ... PUCKS are written by packages/sim;
 * a later section that belongs to the world gets a new id. Ids are never reused.
 */
export const SAVE_SECTION_ID = {
  /** Wallet, shared upgrades, suit gear, beacons, visited outposts, Temp permissions, collectible sets, Shine mirror, stats. */
  META: 1,
  /** Per member: tools, equipped tool, Holster loadout, Dust Cell levels and fill, mg accumulator, last pose, vehicles. */
  PLAYERS: 2,
  VEHICLES: 3,
  /** Type, Roost/Nest, state, cargo, pose, current lane plan. */
  ROBOTS: 4,
  STRUCTURES: 5,
  RAILS: 6,
  MACHINES: 7,
  /** Loose pucks (capped count). */
  PUCKS: 8,
} as const;
export type SaveSectionId = (typeof SAVE_SECTION_ID)[keyof typeof SAVE_SECTION_ID];
export type SaveSectionName = keyof typeof SAVE_SECTION_ID;

const U16 = z.int().min(0).max(0xffff);
const U32 = z.int().min(0).max(0xffff_ffff);

/** One entry of the section table. `id` may be unknown to the reader (then the section is skipped). */
export const SaveSectionEntrySchema = z.object({
  id: U16,
  version: U16,
  /** Body length in bytes. */
  length: U32,
});
export type SaveSectionEntry = z.infer<typeof SaveSectionEntrySchema>;

/** The decoded fixed header plus its section table (bodies are decoded by their owning packages). */
export const SaveHeaderSchema = z
  .object({
    saveFormatVersion: U16,
    gridM: z.int().min(1).max(0xffff),
    radiusM: z.int().min(1).max(0xffff),
    plotCount: U32,
    /** Lower-case hex of the 32-byte bake hash. */
    bakeHash: BakeHashSchema,
    dustModelVersion: U16,
    /** u64 on disk; a safe integer here (2^53 ticks at 20 Hz is about 14 million years). */
    simTick: z.int().min(0),
    /** u64 on disk; the save generation (= `save_seq`), at least 1. */
    generation: z.int().min(1),
    /** u64 on disk; the generation this state descends from; 0 for the first save. Always below `generation`. */
    parentGeneration: z.int().min(0),
    originKind: z.enum(SAVE_ORIGIN_KINDS),
    originId: SaveOriginIdSchema,
    sections: z.array(SaveSectionEntrySchema).max(0xffff),
  })
  .refine((header) => header.plotCount === 10 * header.gridM * header.gridM + 2, {
    message: "plotCount must equal 10 * gridM^2 + 2",
    path: ["plotCount"],
  })
  .refine((header) => header.generation > header.parentGeneration, {
    message: "generation must be greater than parentGeneration",
    path: ["generation"],
  });
export type SaveHeader = z.infer<typeof SaveHeaderSchema>;

/** The v0 decoded header (no generation fields). Only the v0 -> v1 loader step and the v0 fixture use it. */
export const SaveHeaderV0Schema = z
  .object({
    saveFormatVersion: z.literal(0),
    gridM: z.int().min(1).max(0xffff),
    radiusM: z.int().min(1).max(0xffff),
    plotCount: U32,
    bakeHash: BakeHashSchema,
    dustModelVersion: U16,
    simTick: z.int().min(0),
    sections: z.array(SaveSectionEntrySchema).max(0xffff),
  })
  .refine((header) => header.plotCount === 10 * header.gridM * header.gridM + 2, {
    message: "plotCount must equal 10 * gridM^2 + 2",
    path: ["plotCount"],
  });
export type SaveHeaderV0 = z.infer<typeof SaveHeaderV0Schema>;

// ---- Row-level constants (contract_saves, contract_dust_chunks) ---------------------------------------------------

/** The two alternating header slots. */
export const SAVE_SLOTS = ["A", "B"] as const;
export type SaveSlot = (typeof SAVE_SLOTS)[number];

/** Compression of the whole header envelope (RFC 1952). */
export const SAVE_HEADER_CODEC = "gzip";

/** Compression of each dust chunk payload. */
export const DUST_CHUNK_CODEC = "deflate";

/** Validate-before-write limit for the uncompressed header envelope (data-model.md sections 5.1 and 6). */
export const SAVE_HEADER_MAX_BYTES = 1024 * 1024;

/**
 * Validate-before-write and upload limit for one uncompressed dust chunk payload: the v1 layout maximum
 * (DUST_CHUNK_PAYLOAD_LAYOUT_MAX_BYTES of ./dust-chunk, 421,959 B), so every legal payload fits. Was 262,144 B before
 * v1.1, which rejected a legal chunk with all 256 plots touched. The per-package inflate budget of the upload verifier
 * (32 MiB, apps/server/src/api) is separate and unchanged.
 */
export const DUST_CHUNK_PAYLOAD_MAX_BYTES = DUST_CHUNK_PAYLOAD_LAYOUT_MAX_BYTES;

/** Two alternating versions per dust chunk row (`ver`). */
export const DUST_CHUNK_VERSIONS = [0, 1] as const;
