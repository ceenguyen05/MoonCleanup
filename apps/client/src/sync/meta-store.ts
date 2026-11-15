// Persistent sync state of the Solo checkpoint sync (ADR-0031, data-model.md section 3.7c "Local store"): per Contract the
// `baseGeneration`, the pending-upload marker, the last summaries and the backup slot; per browser the device id.
// It is a database of its own (the checkpoint store belongs to the sim-host worker), so the two never contend for a
// transaction. Without IndexedDB (private mode, Node tests) the memory store keeps the session going; the next session
// then re-derives the pending marker from the local generation versus the server head.

import type { ProfileDelta, SoloCheckpointSummary } from "@moon-cleanup/shared";

/** The newest local checkpoint that the server does not have yet (newest only: an older marker is replaced). */
export interface PendingCheckpoint {
  readonly generation: number;
  readonly parentGeneration: number;
  readonly simTick: number;
  readonly savedAtMs: number;
  /** `savedAtMs` of the OLDEST unsynced checkpoint of the run (the `saveSync.pendingSinceMs` value). */
  readonly sinceMs: number;
  /** Summary captured when the checkpoint was written (what the "Which copy?" prompt shows for this device). */
  readonly summary: SoloCheckpointSummary;
  readonly profileDelta: ProfileDelta;
}

export interface ContractSyncMeta {
  readonly contractId: string;
  /** Newest server generation this device saw (accepted upload, head or download); 0 = the server has none. */
  readonly baseGeneration: number;
  /** The server knows the Contract (created there, or registered with `clientContractId`). */
  readonly registered: boolean;
  /** How to register a Contract that was created locally; null when it was created through the server. */
  readonly registration: { readonly name: string; readonly seed: string } | null;
  readonly pending: PendingCheckpoint | null;
  /** The server copy's summary at the last head / accepted upload / download. */
  readonly serverSummary: SoloCheckpointSummary | null;
  readonly lastSyncedAtMs: number | null;
}

export interface BackupRecord {
  readonly contractId: string;
  readonly generation: number;
  readonly summary: SoloCheckpointSummary;
  readonly storedAtMs: number;
  readonly expiresAtMs: number;
  /** MCCK pages (page 0 has the header), as `packPages` writes them. */
  readonly pages: readonly ArrayBuffer[];
}

export interface SyncMetaStore {
  readonly kind: "indexeddb" | "memory";
  getMeta(contractId: string): Promise<ContractSyncMeta | null>;
  putMeta(meta: ContractSyncMeta): Promise<void>;
  getBackup(contractId: string): Promise<BackupRecord | null>;
  putBackup(backup: BackupRecord): Promise<void>;
  deleteBackup(contractId: string): Promise<void>;
  /** Random per-browser install id (`saved_by = solo:<deviceId>`); created on first use. */
  getDeviceId(): Promise<string>;
  close(): void;
}

export function emptyMeta(contractId: string, registration: ContractSyncMeta["registration"] = null): ContractSyncMeta {
  return {
    contractId,
    baseGeneration: 0,
    registered: registration === null,
    registration,
    pending: null,
    serverSummary: null,
    lastSyncedAtMs: null,
  };
}

export class MemorySyncMetaStore implements SyncMetaStore {
  readonly kind = "memory" as const;
  private readonly metas = new Map<string, ContractSyncMeta>();
  private readonly backups = new Map<string, BackupRecord>();
  private device: string | undefined;

  getMeta(contractId: string): Promise<ContractSyncMeta | null> {
    return Promise.resolve(this.metas.get(contractId) ?? null);
  }
  putMeta(meta: ContractSyncMeta): Promise<void> {
    this.metas.set(meta.contractId, meta);
    return Promise.resolve();
  }
  getBackup(contractId: string): Promise<BackupRecord | null> {
    return Promise.resolve(this.backups.get(contractId) ?? null);
  }
  putBackup(backup: BackupRecord): Promise<void> {
    this.backups.set(backup.contractId, backup);
    return Promise.resolve();
  }
  deleteBackup(contractId: string): Promise<void> {
    this.backups.delete(contractId);
    return Promise.resolve();
  }
  getDeviceId(): Promise<string> {
    return Promise.resolve((this.device ??= crypto.randomUUID()));
  }
  close(): void {}
}

const META = "meta";
const BACKUP = "backup";
const KV = "kv";
const DEVICE_KEY = "deviceId";
const DB_VERSION = 1;

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error ?? new Error("IndexedDB request failed"));
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("IndexedDB write failed"));
    tx.onabort = () => reject(tx.error ?? new Error("IndexedDB write aborted"));
  });
}

export class IdbSyncMetaStore implements SyncMetaStore {
  readonly kind = "indexeddb" as const;
  private constructor(private readonly db: IDBDatabase) {}

  static async open(name: string): Promise<IdbSyncMetaStore> {
    const r = indexedDB.open(name, DB_VERSION);
    r.onupgradeneeded = () => {
      const db = r.result;
      if (!db.objectStoreNames.contains(META)) db.createObjectStore(META, { keyPath: "contractId" });
      if (!db.objectStoreNames.contains(BACKUP)) db.createObjectStore(BACKUP, { keyPath: "contractId" });
      if (!db.objectStoreNames.contains(KV)) db.createObjectStore(KV);
    };
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error ?? new Error("IndexedDB open failed"));
      r.onblocked = () => reject(new Error("IndexedDB open blocked"));
    });
    db.onversionchange = () => db.close();
    return new IdbSyncMetaStore(db);
  }

  async getMeta(contractId: string): Promise<ContractSyncMeta | null> {
    const v = (await req(this.db.transaction(META, "readonly").objectStore(META).get(contractId))) as
      ContractSyncMeta | undefined;
    return v ?? null;
  }
  async putMeta(meta: ContractSyncMeta): Promise<void> {
    const tx = this.db.transaction(META, "readwrite");
    tx.objectStore(META).put(meta);
    await done(tx);
  }
  async getBackup(contractId: string): Promise<BackupRecord | null> {
    const v = (await req(this.db.transaction(BACKUP, "readonly").objectStore(BACKUP).get(contractId))) as
      BackupRecord | undefined;
    return v ?? null;
  }
  async putBackup(backup: BackupRecord): Promise<void> {
    const tx = this.db.transaction(BACKUP, "readwrite", { durability: "strict" });
    tx.objectStore(BACKUP).put(backup);
    await done(tx);
  }
  async deleteBackup(contractId: string): Promise<void> {
    const tx = this.db.transaction(BACKUP, "readwrite");
    tx.objectStore(BACKUP).delete(contractId);
    await done(tx);
  }
  async getDeviceId(): Promise<string> {
    const existing = (await req(this.db.transaction(KV, "readonly").objectStore(KV).get(DEVICE_KEY))) as
      string | undefined;
    if (existing !== undefined) return existing;
    const created = crypto.randomUUID();
    const tx = this.db.transaction(KV, "readwrite");
    tx.objectStore(KV).add(created, DEVICE_KEY);
    try {
      await done(tx);
      return created;
    } catch {
      // Another tab created it first (add fails on an existing key): read the winner.
      return (await req(this.db.transaction(KV, "readonly").objectStore(KV).get(DEVICE_KEY))) as string;
    }
  }
  close(): void {
    this.db.close();
  }
}

/** Opens the requested store; any IndexedDB failure falls back to memory and reports through `onUnavailable` (never throws). */
export async function openSyncMetaStore(
  kind: "auto" | "indexeddb" | "memory",
  dbName: string,
  onUnavailable: () => void,
): Promise<SyncMetaStore> {
  if (kind === "memory") return new MemorySyncMetaStore();
  try {
    if (typeof indexedDB === "undefined") throw new Error("no IndexedDB");
    return await IdbSyncMetaStore.open(dbName);
  } catch {
    onUnavailable();
    return new MemorySyncMetaStore();
  }
}
