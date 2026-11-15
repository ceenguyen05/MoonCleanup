// A checkpoint copy as the sync module handles it: the gzip header envelope plus its deflate dust chunks, each chunk
// with the raw size and CRC32 of its UNCOMPRESSED payload (the MCCK fields). Two producers:
//   readLocalCopy   from the local CheckpointStore (what the sim-host worker wrote), for upload and for the backup slot;
//   assembleCopy    from downloaded MCCK pages (or a stored backup), verified: CRCs, sizes, generation, inflate cap.
// CPU work on the main thread is sliced (SLICE_BUDGET_MS) and yields between chunks; inflate itself runs in the
// browser's stream threads. Nothing here is called per frame.

import { SAVE_FORMAT_VERSION } from "@moon-cleanup/shared";
import { compress, decompress, hasCompressionStreams } from "./compress";
import { crc32 } from "./crc32";
import { readEnvelopeFacts, withGeneration, type EnvelopeFacts } from "./envelope";
import {
  CHUNK_RAW_MAX_BYTES,
  DOWNLOAD_MAX_PAGES,
  HEADER_RAW_MAX_BYTES,
  INFLATE_CAP_BYTES,
  SLICE_BUDGET_MS,
} from "./limits";
import { decodeMcck, type McckChunk } from "./mcck";
import { yieldToMain } from "./yield";

// ---- ports (structural: sim-host's CheckpointStore satisfies LocalStoreReader and the install shapes) ------------------

export interface StoredCheckpointLike {
  readonly contractId: string;
  readonly generation: number;
  readonly parentGeneration: number;
  readonly simTick: number;
  readonly savedAtMs: number;
  /** `gzip`: SAVE_HEADER_CODEC applied; `raw`: no CompressionStream on the writing platform. */
  readonly codec: "gzip" | "raw";
  readonly bytes: ArrayBuffer;
}

export interface StoredDustChunkLike {
  readonly chunkId: number;
  /** Generation of the checkpoint that wrote this row. */
  readonly generation: number;
  readonly codec: "deflate" | "raw";
  /** Payload size before compression. */
  readonly rawSize: number;
  readonly bytes: ArrayBuffer;
  /** Optional CRC32 of the uncompressed payload when the writer recorded it (saves the sync module an inflate). */
  readonly crc32?: number;
}

/** Read side of the local checkpoint store. */
export interface LocalStoreReader {
  load(contractId: string): Promise<StoredCheckpointLike | null>;
  loadDustChunks(contractId: string): Promise<StoredDustChunkLike[]>;
}

// ---- copy ----------------------------------------------------------------------------------------------------------

export interface CheckpointCopy {
  readonly contractId: string;
  readonly generation: number;
  readonly parentGeneration: number;
  readonly simTick: number;
  /** gzip header envelope. */
  readonly header: Uint8Array;
  readonly facts: EnvelopeFacts;
  /** Ascending chunk id. */
  readonly chunks: readonly McckChunk[];
  readonly rawTotal: number;
  readonly savedAtMs: number;
}

export type CopyFailure =
  | "no_local_copy"
  | "corrupt"
  | "unsupported"
  | "unstable"
  | "too_large"
  | "format_too_new"
  | "mixed_generation"
  | "wrong_contract";

export type CopyResult =
  { readonly ok: true; readonly copy: CheckpointCopy } | { readonly ok: false; readonly reason: CopyFailure };

export interface CopyEnv {
  /** Monotonic ms (performance.now). */
  readonly now: () => number;
  readonly yieldFn?: () => Promise<void>;
}

class Slicer {
  private start: number;
  constructor(
    private readonly env: CopyEnv,
    private readonly budgetMs = SLICE_BUDGET_MS,
  ) {
    this.start = env.now();
  }
  async maybeYield(): Promise<void> {
    if (this.env.now() - this.start >= this.budgetMs) {
      await (this.env.yieldFn ?? yieldToMain)();
      this.start = this.env.now();
    }
  }
}

/** CRC32 cache of dust rows, keyed by `chunkId:generation` (a row is immutable once written). */
export type CrcCache = Map<string, number>;

export interface ReadLocalOptions extends CopyEnv {
  /** Only chunks written after this generation (the server's newest known generation); ignored when `full`. */
  readonly sinceGeneration: number;
  /** Every chunk, regardless of generation (explicit overwrite, backup slot). */
  readonly full: boolean;
  /** Rewrites the header's generation and parent (the "Keep this device" overwrite, "restore backup"). */
  readonly generationOverride?: { readonly generation: number; readonly parentGeneration: number };
  readonly crcCache: CrcCache;
}

const MAX_READ_ATTEMPTS = 3;
const toBytes = (b: ArrayBuffer): Uint8Array => new Uint8Array(b);

export async function readLocalCopy(
  store: LocalStoreReader,
  contractId: string,
  options: ReadLocalOptions,
): Promise<CopyResult> {
  const slicer = new Slicer(options);
  for (let attempt = 0; attempt < MAX_READ_ATTEMPTS; attempt++) {
    const rec = await store.load(contractId);
    if (rec === null) return { ok: false, reason: "no_local_copy" };
    const rows = await store.loadDustChunks(contractId);
    const again = await store.load(contractId);
    // The worker writes header and chunk rows in one transaction, but this reads them in three: a checkpoint landing
    // in between would pair a new header with old rows (or the reverse). Re-read until the three agree.
    if (again === null || again.generation !== rec.generation || rows.some((r) => r.generation > rec.generation)) {
      await (options.yieldFn ?? yieldToMain)();
      continue;
    }

    // Header: keep the stored gzip bytes unless the generation is rewritten or the platform stored it uncompressed.
    let rawHeader: Uint8Array;
    try {
      rawHeader =
        rec.codec === "gzip" ? await decompress(toBytes(rec.bytes), "gzip", HEADER_RAW_MAX_BYTES) : toBytes(rec.bytes);
    } catch {
      return { ok: false, reason: "corrupt" };
    }
    let facts = readEnvelopeFacts(rawHeader);
    if (facts === null) return { ok: false, reason: "corrupt" };
    if (facts.saveFormatVersion !== SAVE_FORMAT_VERSION) return { ok: false, reason: "unsupported" };
    let header = toBytes(rec.bytes);
    const override = options.generationOverride;
    if (override !== undefined || rec.codec === "raw") {
      if (!hasCompressionStreams()) return { ok: false, reason: "unsupported" };
      if (override !== undefined) {
        rawHeader = withGeneration(rawHeader, override.generation, override.parentGeneration);
        facts = readEnvelopeFacts(rawHeader) as EnvelopeFacts;
      }
      header = await compress(rawHeader, "gzip");
    }

    const chunks: McckChunk[] = [];
    let rawTotal = 0;
    for (const row of rows) {
      if (!options.full && row.generation <= options.sinceGeneration) continue;
      if (row.rawSize > CHUNK_RAW_MAX_BYTES) return { ok: false, reason: "too_large" };
      rawTotal += row.rawSize;
      if (rawTotal > INFLATE_CAP_BYTES) return { ok: false, reason: "too_large" };
      const key = `${row.chunkId}:${row.generation}`;
      let bytes: Uint8Array = toBytes(row.bytes);
      let crc = row.crc32 ?? options.crcCache.get(key);
      if (row.codec === "raw") {
        if (!hasCompressionStreams()) return { ok: false, reason: "unsupported" };
        crc ??= crc32(bytes);
        bytes = await compress(bytes, "deflate");
      } else if (crc === undefined) {
        try {
          const payload = await decompress(bytes, "deflate", row.rawSize);
          if (payload.byteLength !== row.rawSize) return { ok: false, reason: "corrupt" };
          crc = crc32(payload);
        } catch {
          return { ok: false, reason: "corrupt" };
        }
      }
      options.crcCache.set(key, crc);
      chunks.push({ chunkId: row.chunkId, ver: 0, rawSize: row.rawSize, crc32: crc, bytes });
      await slicer.maybeYield();
    }
    chunks.sort((a, b) => a.chunkId - b.chunkId);
    return {
      ok: true,
      copy: {
        contractId,
        generation: facts.generation,
        parentGeneration: facts.parentGeneration,
        simTick: facts.simTick,
        header,
        facts,
        chunks,
        rawTotal,
        savedAtMs: rec.savedAtMs,
      },
    };
  }
  return { ok: false, reason: "unstable" };
}

/**
 * Verifies and merges downloaded (or backed-up) MCCK pages into one copy. Every page must belong to `contractId` and
 * carry the same generation (an upload may commit between two page requests, so mixed pages are refused), page 0 holds
 * the header, chunk ids are unique, the declared inflated total stays under INFLATE_CAP_BYTES, and every chunk is
 * inflated (capped at its declared size), compared with the declared size and CRC32.
 */
export async function assembleCopy(
  pages: readonly Uint8Array[],
  contractId: string,
  env: CopyEnv,
  savedAtMs: number,
): Promise<CopyResult> {
  if (pages.length === 0 || pages.length > DOWNLOAD_MAX_PAGES) return { ok: false, reason: "corrupt" };
  let generation = -1;
  let header: Uint8Array | null = null;
  const chunks: McckChunk[] = [];
  const seen = new Set<number>();
  let rawTotal = 0;
  for (let i = 0; i < pages.length; i++) {
    const decoded = decodeMcck(pages[i] as Uint8Array);
    if (!decoded.ok) return { ok: false, reason: "corrupt" };
    const page = decoded.value;
    if (page.contractId !== contractId) return { ok: false, reason: "wrong_contract" };
    if (generation === -1) generation = page.generation;
    else if (page.generation !== generation) return { ok: false, reason: "mixed_generation" };
    if (i === 0) {
      if (page.header.byteLength === 0) return { ok: false, reason: "corrupt" };
      header = page.header;
    } else if (page.header.byteLength !== 0) return { ok: false, reason: "corrupt" };
    for (const c of page.chunks) {
      if (seen.has(c.chunkId)) return { ok: false, reason: "corrupt" };
      seen.add(c.chunkId);
      rawTotal += c.rawSize;
      if (rawTotal > INFLATE_CAP_BYTES) return { ok: false, reason: "too_large" };
      chunks.push(c);
    }
  }
  if (header === null) return { ok: false, reason: "corrupt" };

  let rawHeader: Uint8Array;
  try {
    rawHeader = await decompress(header, "gzip", HEADER_RAW_MAX_BYTES);
  } catch {
    return { ok: false, reason: "corrupt" };
  }
  const facts = readEnvelopeFacts(rawHeader);
  if (facts === null) return { ok: false, reason: "corrupt" };
  if (facts.saveFormatVersion > SAVE_FORMAT_VERSION) return { ok: false, reason: "format_too_new" };
  if (facts.saveFormatVersion !== SAVE_FORMAT_VERSION) return { ok: false, reason: "unsupported" };
  if (facts.generation !== generation) return { ok: false, reason: "corrupt" };

  const slicer = new Slicer(env);
  for (const c of chunks) {
    try {
      const payload = await decompress(c.bytes, "deflate", c.rawSize);
      if (payload.byteLength !== c.rawSize || crc32(payload) !== c.crc32) return { ok: false, reason: "corrupt" };
    } catch {
      return { ok: false, reason: "corrupt" };
    }
    await slicer.maybeYield();
  }
  chunks.sort((a, b) => a.chunkId - b.chunkId);
  return {
    ok: true,
    copy: {
      contractId,
      generation: facts.generation,
      parentGeneration: facts.parentGeneration,
      simTick: facts.simTick,
      header,
      facts,
      chunks,
      rawTotal,
      savedAtMs,
    },
  };
}

// ---- install shapes -----------------------------------------------------------------------------------------------

export interface InstallDust {
  /** Always true: an installed copy replaces every dust row of the Contract. */
  readonly replaceAll: true;
  readonly chunks: readonly StoredDustChunkLike[];
}

/** The local store shapes of a copy (own, exactly-sized buffers: a structured clone of a view would copy its whole backing buffer). */
export function copyToStoreShapes(copy: CheckpointCopy): { record: StoredCheckpointLike; dust: InstallDust } {
  return {
    record: {
      contractId: copy.contractId,
      generation: copy.generation,
      parentGeneration: copy.parentGeneration,
      simTick: copy.simTick,
      savedAtMs: copy.savedAtMs,
      codec: "gzip",
      bytes: copy.header.slice().buffer,
    },
    dust: {
      replaceAll: true,
      chunks: copy.chunks.map((c) => ({
        chunkId: c.chunkId,
        generation: copy.generation,
        codec: "deflate" as const,
        rawSize: c.rawSize,
        bytes: c.bytes.slice().buffer,
        crc32: c.crc32,
      })),
    },
  };
}
