// Shift room dust persistence (M1-W4-T06): the room's WorldDustLedger survives a room restart.
//
// The room restores the ledger from a `ShiftDustStore` when it is created (before the loop starts) and writes the
// dirty chunks back every SHIFT_CHECKPOINT_INTERVAL_S (when dirty) and when it is disposed (room empty, shutdown).
// Chunks use the shared dust chunk payload (packages/world chunk-codec, the same bytes the Solo host saves), so a
// database-backed store (W5-T01, `contract_dust_chunks`) can implement the port without a format change.
//
// Default store: `MemoryShiftDustStore`, process memory. It survives a room being disposed and re-created inside one
// server process; it does NOT survive a process restart (Render free sleeps after 15 min idle). The durable store
// needs a room-checkpoint write in packages/db (commitSoloCheckpoint refuses non-solo Contracts): W5-T01.
//
// Cost: encoding runs on the event loop every 30 s, only for dirty chunks, in SHIFT_ENCODE_SLICE_BUDGET_MS slices with
// a macrotask yield between them (event time, not the tick path). The restore
// runs in DUST_RESTORE_SLICE_BUDGET_MS slices with a macrotask yield between them, so other rooms keep ticking.

import { deflateRawSync, inflateRawSync } from "node:zlib";
import { backoffDelayMs } from "@moon-cleanup/db";
import { DUST_CHUNK_PAYLOAD_MAX_BYTES } from "@moon-cleanup/shared";
import {
  DUST_RESTORE_SLICE_BUDGET_MS,
  DustChunkEncoder,
  DustRestoreJob,
  type DustRestoreResult,
  type WorldDustLedger,
} from "@moon-cleanup/world";

/** Write period while dirty (WDS section 6: every <= 30 s, on room empty and on SIGTERM). */
export const SHIFT_CHECKPOINT_INTERVAL_S = 30;

/**
 * Time budget of one encode slice (WDS section 6: the checkpoint encode is sliced so a save never costs one long
 * tick). The encoder yields a macrotask between slices; at least one chunk is encoded per slice.
 */
export const SHIFT_ENCODE_SLICE_BUDGET_MS = 1.5;

/** One stored chunk: the raw dust chunk payload (not deflated; the store decides its own encoding). */
export interface StoredDustChunk {
  readonly chunkId: number;
  readonly payload: Uint8Array;
}

/** Port of the room's dust storage. Implementations must not throw synchronously; rejected promises are logged. */
export interface ShiftDustStore {
  /** Every stored chunk of the Contract (newest version), or an empty list. */
  load(contractId: string): Promise<readonly StoredDustChunk[]>;
  /** Replaces the given chunks of the Contract. `simTick` is the room tick the chunks reflect. */
  save(contractId: string, chunks: readonly StoredDustChunk[], simTick: number): Promise<void>;
  /**
   * Durable stores set this: a failed `load` then REFUSES the room (restore rethrows) instead of starting from a
   * pristine moon, which the next checkpoint would write over the real save.
   */
  readonly strict?: boolean;
  /**
   * Join preflight: takes (or confirms) the Contract lease before a room is created. Rejects with an error whose
   * `reason` is `busy` (another instance or room owns the Contract: 409) or anything else (storage down: 503).
   */
  ensureLease?(contractId: string): Promise<void>;
  /** Called after the room's final save (room empty, shutdown): clears the Contract lease. Never throws. */
  release?(contractId: string): Promise<void>;
  /** The room asks to be told when it lost the Contract (it then closes with 4108). Returns the unsubscribe. */
  onLeaseLost?(contractId: string, listener: () => void): () => void;
}

/** Process-memory store; chunks are kept deflated (a touched chunk is mostly repetitive texel bytes). */
export class MemoryShiftDustStore implements ShiftDustStore {
  private readonly contracts = new Map<string, Map<number, Uint8Array>>();
  saves = 0;

  load(contractId: string): Promise<readonly StoredDustChunk[]> {
    const chunks = this.contracts.get(contractId);
    const out: StoredDustChunk[] = [];
    if (chunks !== undefined) {
      for (const [chunkId, z] of chunks) {
        out.push({ chunkId, payload: inflateRawSync(z, { maxOutputLength: DUST_CHUNK_PAYLOAD_MAX_BYTES }) });
      }
    }
    out.sort((a, b) => a.chunkId - b.chunkId);
    return Promise.resolve(out);
  }

  save(contractId: string, chunks: readonly StoredDustChunk[], simTick: number): Promise<void> {
    void simTick;
    let map = this.contracts.get(contractId);
    if (map === undefined) {
      map = new Map();
      this.contracts.set(contractId, map);
    }
    for (const c of chunks) map.set(c.chunkId, deflateRawSync(c.payload));
    this.saves++;
    return Promise.resolve();
  }

  /** Stored bytes (deflated) of a Contract (tests, ops). */
  storedBytes(contractId: string): number {
    let n = 0;
    for (const z of this.contracts.get(contractId)?.values() ?? []) n += z.byteLength;
    return n;
  }
}

export interface ShiftDustPersistenceLogger {
  warn(obj: object, msg: string): void;
}

const yieldMacrotask = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

/** Restore + periodic / final save of one room's ledger. */
export class ShiftDustPersistence {
  private readonly store: ShiftDustStore;
  private readonly ledger: WorldDustLedger;
  private readonly contractId: string;
  private readonly bakeCheck: number;
  private readonly logger: ShiftDustPersistenceLogger | undefined;
  private saving: Promise<void> | null = null;
  private lastSaveMs: number;
  private lastNowMs: number;
  private inFlight = false;
  private consecutiveFailures = 0;
  private retryAtMs = 0;
  private unsubscribe: (() => void) | undefined;
  private readonly encoder = new DustChunkEncoder();
  private readonly encodeSliceBudgetMs: number;
  readonly counters = { saves: 0, saveFailures: 0, chunksWritten: 0, restoreMs: 0, encodeMs: 0, encodeSlices: 0 };
  lastRestore: DustRestoreResult | null = null;

  constructor(
    store: ShiftDustStore,
    ledger: WorldDustLedger,
    contractId: string,
    bakeCheck: number,
    nowMs: number,
    logger?: ShiftDustPersistenceLogger,
    encodeSliceBudgetMs: number = SHIFT_ENCODE_SLICE_BUDGET_MS,
  ) {
    this.encodeSliceBudgetMs = encodeSliceBudgetMs;
    this.store = store;
    this.ledger = ledger;
    this.contractId = contractId;
    this.bakeCheck = bakeCheck;
    this.lastSaveMs = nowMs;
    this.lastNowMs = nowMs;
    this.logger = logger;
  }

  /** Restores the stored chunks into the (fresh) ledger in time-budgeted slices. Never throws; a failure starts clean. */
  async restore(): Promise<DustRestoreResult | null> {
    let chunks: readonly StoredDustChunk[];
    try {
      chunks = await this.store.load(this.contractId);
    } catch (err) {
      if (this.store.strict === true) {
        this.logger?.warn({ code: codeOf(err) }, "shift dust load failed; refusing the room (not starting pristine)");
        throw err;
      }
      this.logger?.warn({ code: codeOf(err) }, "shift dust load failed; starting from a pristine ledger");
      return null;
    }
    if (chunks.length === 0) return null;
    const start = performance.now();
    const job = new DustRestoreJob(
      this.ledger,
      chunks.map((c) => c.payload),
      this.bakeCheck,
    );
    while (!job.done) {
      job.run(DUST_RESTORE_SLICE_BUDGET_MS);
      if (!job.done) await yieldMacrotask();
    }
    // A restore queues no Stamp / Opened events and leaves only repaired chunks dirty; the L0 changes are not news.
    this.ledger.truncateEventQueues(0, 0);
    this.ledger.clearDirtyPlots();
    this.counters.restoreMs = performance.now() - start;
    this.lastRestore = job.result;
    if (!job.result.ok) {
      this.logger?.warn(
        { rejected: job.result.chunksRejected, error: job.result.firstError?.code ?? null },
        "shift dust restore rejected chunks",
      );
      // data-model 3.7b / netcode 16: a save that fails to decode refuses the room (4108), rows stay untouched.
      if (this.store.strict === true) throw Object.assign(new Error("save failed to decode"), { code: "SAVE_CORRUPT" });
    }
    return job.result;
  }

  /**
   * Saves the dirty chunks when the interval has passed (call once per second or so). Never piles up writes: nothing
   * starts while the previous write is still in flight. After a failed write the retry waits 1, 2, 4 ... 30 s
   * (netcode.md section 16) instead of the full interval; the dirty marks stay, so no progress is dropped.
   */
  maybeSave(nowMs: number, simTick: number): void {
    if (this.inFlight) return;
    if (this.consecutiveFailures > 0) {
      if (nowMs < this.retryAtMs) return;
    } else if (nowMs - this.lastSaveMs < SHIFT_CHECKPOINT_INTERVAL_S * 1000) {
      return;
    }
    void this.save(nowMs, simTick);
  }

  /** Final checkpoint (room empty, SIGTERM), then the store releases the Contract lease. Never throws. */
  async close(nowMs: number, simTick: number): Promise<void> {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    try {
      await this.save(nowMs, simTick);
    } finally {
      try {
        await this.store.release?.(this.contractId);
      } catch {
        // release is best effort; the lease expires on its own
      }
    }
  }

  /** The room failed to start: releases the lease WITHOUT writing anything (the stored rows stay untouched). */
  async abort(): Promise<void> {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    try {
      await this.store.release?.(this.contractId);
    } catch {
      // best effort
    }
  }

  /** Subscribes `listener` to a lost Contract lease (durable stores only). */
  watchLease(listener: () => void): void {
    this.unsubscribe = this.store.onLeaseLost?.(this.contractId, listener);
  }

  /**
   * Encodes the dirty chunks in time-budgeted slices (the first slice runs synchronously, the rest after a macrotask
   * yield; each chunk's dirty mark is cleared as it is encoded, so a later stroke re-marks its chunk) and writes them.
   * A failed write re-marks the chunks for the next attempt. Overlapping calls chain.
   */
  save(nowMs: number, simTick: number): Promise<void> {
    this.lastSaveMs = nowMs;
    this.lastNowMs = nowMs;
    const l = this.ledger;
    if (l.dirtyChunkCount === 0) return this.saving ?? Promise.resolve();
    const previous = this.saving;
    this.inFlight = true;
    const run = (previous === null ? this.encodeSliced() : previous.then(() => this.encodeSliced()))
      .then((chunks) => {
        if (chunks.length === 0) return;
        return this.store.save(this.contractId, chunks, simTick).then(
          () => {
            this.counters.saves++;
            this.counters.chunksWritten += chunks.length;
            this.consecutiveFailures = 0;
          },
          (err: unknown) => {
            this.counters.saveFailures++;
            this.consecutiveFailures++;
            this.retryAtMs = this.lastNowMs + backoffDelayMs(this.consecutiveFailures);
            for (const c of chunks) l.setChunkDirty(c.chunkId);
            this.logger?.warn(
              { code: codeOf(err), failures: this.consecutiveFailures },
              "shift dust save failed; chunks stay dirty, retrying with backoff",
            );
          },
        );
      })
      .finally(() => {
        if (this.saving === run) this.inFlight = false;
      });
    this.saving = run;
    return run;
  }

  private async encodeSliced(): Promise<StoredDustChunk[]> {
    const l = this.ledger;
    const out: StoredDustChunk[] = [];
    let spentMs = 0;
    let sliceStart = performance.now();
    this.counters.encodeSlices++;
    for (let chunk = 0; chunk < l.chunkCount; chunk++) {
      if (!l.isChunkDirty(chunk)) continue;
      const view = this.encoder.encode(l, chunk, this.bakeCheck);
      out.push({ chunkId: chunk, payload: view.slice() });
      l.clearChunkDirty(chunk);
      if (l.dirtyChunkCount > 0 && performance.now() - sliceStart >= this.encodeSliceBudgetMs) {
        spentMs += performance.now() - sliceStart;
        await yieldMacrotask();
        this.counters.encodeSlices++;
        sliceStart = performance.now();
      }
    }
    this.counters.encodeMs = spentMs + (performance.now() - sliceStart);
    return out;
  }
}

function codeOf(err: unknown): string {
  if (typeof err === "object" && err !== null && "code" in err && typeof err.code === "string") return err.code;
  return err instanceof Error ? err.name : "unknown";
}
