// Local checkpoint storage of Solo Shifts (ADR-0031; data-model section 3.7c). One record per Contract holds the
// newest checkpoint; each write is one IndexedDB readwrite transaction, so a tab kill leaves either the old or the new
// record, never a torn one. Everything is wrapped: without IndexedDB (private mode, blocked storage, Node tests) the
// memory store keeps play going and the host keeps a copy for crash reboots.
//
// Dust (data-model section 3.7): the header record holds no per-plot dust. Dust chunk payloads are rows of their own,
// one per (Contract, chunk id), and a checkpoint writes the header and its changed chunks in the SAME transaction, so
// header and chunks always belong to one checkpoint. Because that transaction is atomic, one row per chunk is enough
// here; the two alternating versions of section 3.7b guard the server's rows and are added by the upload path.

import type { ContractId } from "@moon-cleanup/shared";

export interface StoredCheckpoint {
  readonly contractId: ContractId;
  readonly generation: number;
  readonly parentGeneration: number;
  readonly simTick: number;
  readonly savedAtMs: number;
  /** `gzip`: SAVE_HEADER_CODEC applied; `raw`: no CompressionStream on this platform. */
  readonly codec: "gzip" | "raw";
  readonly bytes: ArrayBuffer;
}

/** One stored dust chunk payload (WDS section 6 layout, encoded by packages/world). */
export interface StoredDustChunk {
  /** 0 .. 640. */
  readonly chunkId: number;
  /** Generation of the checkpoint that wrote this row (never above the stored header's generation). */
  readonly generation: number;
  /** `deflate`: DUST_CHUNK_CODEC applied; `raw`: no CompressionStream on this platform. */
  readonly codec: "deflate" | "raw";
  /** Payload size before compression. */
  readonly rawSize: number;
  readonly bytes: ArrayBuffer;
  /** CRC32 (IEEE) of the uncompressed payload, when the writer recorded it (rows of older builds have none). */
  readonly crc32?: number;
}

/** The dust part of one checkpoint. */
export interface DustChunkWrite {
  /**
   * True: these chunks are the whole dust state, every other row of the Contract is deleted (first checkpoint of a
   * game that did not come out of this store, so rows of an older, unreadable save cannot leak into it).
   * False: only the chunks that changed since the previous checkpoint; other rows stay.
   */
  readonly replaceAll: boolean;
  readonly chunks: readonly StoredDustChunk[];
}

export interface CheckpointStore {
  readonly kind: "indexeddb" | "memory";
  load(contractId: ContractId): Promise<StoredCheckpoint | null>;
  /** Dust chunk rows of the Contract by ascending chunk id (empty when none). */
  loadDustChunks(contractId: ContractId): Promise<StoredDustChunk[]>;
  /**
   * Replaces the newest record of the Contract and, in the same transaction, writes its dust chunks. Rejects on
   * quota / storage errors (then nothing was written).
   */
  save(record: StoredCheckpoint, dust?: DustChunkWrite): Promise<void>;
  close(): void;
}

export class MemoryCheckpointStore implements CheckpointStore {
  readonly kind = "memory" as const;
  private readonly records = new Map<string, StoredCheckpoint>();
  private readonly dust = new Map<string, Map<number, StoredDustChunk>>();

  load(contractId: ContractId): Promise<StoredCheckpoint | null> {
    return Promise.resolve(this.records.get(contractId) ?? null);
  }

  loadDustChunks(contractId: ContractId): Promise<StoredDustChunk[]> {
    const rows = [...(this.dust.get(contractId)?.values() ?? [])];
    return Promise.resolve(rows.sort((a, b) => a.chunkId - b.chunkId));
  }

  save(record: StoredCheckpoint, dust?: DustChunkWrite): Promise<void> {
    this.records.set(record.contractId, record);
    if (dust) {
      let rows = this.dust.get(record.contractId);
      if (!rows || dust.replaceAll) this.dust.set(record.contractId, (rows = new Map()));
      for (const c of dust.chunks) rows.set(c.chunkId, c);
    }
    return Promise.resolve();
  }

  close(): void {}
}

const STORE = "checkpoints";
/** Dust chunk rows, key [contractId, chunkId] (database version 2). */
const DUST_STORE = "dustChunks";
/** 1: `checkpoints` only. 2: adds `dustChunks`; existing checkpoint records are kept (they restore without dust). */
const DB_VERSION = 2;
const CHUNK_ID_MAX = 0xffff;

interface DustChunkRow extends StoredDustChunk {
  readonly contractId: ContractId;
}

function dustRange(contractId: ContractId): IDBKeyRange {
  return IDBKeyRange.bound([contractId, 0], [contractId, CHUNK_ID_MAX]);
}

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error ?? new Error("IndexedDB request failed"));
  });
}

export class IdbCheckpointStore implements CheckpointStore {
  readonly kind = "indexeddb" as const;

  private constructor(private readonly db: IDBDatabase) {}

  static async open(name: string): Promise<IdbCheckpointStore> {
    const r = indexedDB.open(name, DB_VERSION);
    r.onupgradeneeded = () => {
      if (!r.result.objectStoreNames.contains(STORE)) r.result.createObjectStore(STORE, { keyPath: "contractId" });
      if (!r.result.objectStoreNames.contains(DUST_STORE)) {
        r.result.createObjectStore(DUST_STORE, { keyPath: ["contractId", "chunkId"] });
      }
    };
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error ?? new Error("IndexedDB open failed"));
      r.onblocked = () => reject(new Error("IndexedDB open blocked"));
    });
    // A later build that upgrades the database must not be blocked by this connection.
    db.onversionchange = () => db.close();
    return new IdbCheckpointStore(db);
  }

  async load(contractId: ContractId): Promise<StoredCheckpoint | null> {
    const tx = this.db.transaction(STORE, "readonly");
    const v = (await req(tx.objectStore(STORE).get(contractId))) as StoredCheckpoint | undefined;
    return v ?? null;
  }

  async loadDustChunks(contractId: ContractId): Promise<StoredDustChunk[]> {
    const tx = this.db.transaction(DUST_STORE, "readonly");
    // Key order is [contractId, chunkId], so the rows come back ascending by chunk id.
    return (await req(tx.objectStore(DUST_STORE).getAll(dustRange(contractId)))) as DustChunkRow[];
  }

  save(record: StoredCheckpoint, dust?: DustChunkWrite): Promise<void> {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction([STORE, DUST_STORE], "readwrite", { durability: "strict" });
      tx.objectStore(STORE).put(record);
      if (dust) {
        const rows = tx.objectStore(DUST_STORE);
        if (dust.replaceAll) rows.delete(dustRange(record.contractId));
        for (const c of dust.chunks) {
          const row: DustChunkRow = { contractId: record.contractId, ...c };
          rows.put(row);
        }
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("IndexedDB write failed"));
      tx.onabort = () => reject(tx.error ?? new Error("IndexedDB write aborted"));
    });
  }

  close(): void {
    this.db.close();
  }
}

/** True for a DOMException QuotaExceededError (any engine spelling). */
export function isQuotaError(e: unknown): boolean {
  return (
    typeof e === "object" &&
    e !== null &&
    "name" in e &&
    ((e as { name: unknown }).name === "QuotaExceededError" ||
      (e as { name: unknown }).name === "NS_ERROR_DOM_QUOTA_REACHED")
  );
}

/**
 * Opens the requested store. `auto` and `indexeddb` try IndexedDB first; any failure (missing API, blocked, denied)
 * falls back to memory and reports `unavailable` through `onUnavailable` (never throws).
 */
export async function openCheckpointStore(
  kind: "auto" | "indexeddb" | "memory",
  dbName: string,
  onUnavailable: () => void,
): Promise<CheckpointStore> {
  if (kind === "memory") return new MemoryCheckpointStore();
  try {
    if (typeof indexedDB === "undefined") throw new Error("no IndexedDB");
    return await IdbCheckpointStore.open(dbName);
  } catch {
    onUnavailable();
    return new MemoryCheckpointStore();
  }
}
