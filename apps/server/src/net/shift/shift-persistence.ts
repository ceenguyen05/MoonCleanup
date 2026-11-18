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
import { backoffDelayMs, ROOM_WALLET_MAX_LM } from "@moon-cleanup/db";
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

/** The sim's META save section (`MoonRoomSim.captureCheckpoint().meta`), stored opaquely in the room header. */
export interface ShiftSimMeta {
  readonly version: number;
  readonly bytes: Uint8Array;
}

/** Small shared room state persisted in the room header blob next to the dust chunks (interim "room-v3" header). */
export interface ShiftRoomState {
  /** Shared Shift wallet in lumens. */
  readonly walletLm: number;
  /**
   * Collected Near Parcels (bit k = parcel k). The room always writes it. Undefined only when a store returns a legacy
   * "room-v1" header that never stored it: `restore` then SKIPS the wallet (review B1: a wallet restored without the
   * mask lets leave/rejoin re-collect the parcels for Lumens forever).
   */
  readonly nearParcelsMask?: number;
  /**
   * The sim META section (Standard Issue tools, suit gear, Promotions Board levels, Roosts, wallet, parcels; review N1),
   * captured at write time. Its bytes carry the tick and day phase, so they are NOT compared raw: `metaSignature`
   * blanks those fields and the room is dirty when the signature changed (review N7: a META-only change such as a free
   * purchase or a holster swap is then written with the next checkpoint, not only with the next chunk / wallet change).
   *
   * N6 (note, no migration): a SIM_CHECKPOINT_META_VERSION bump makes `restoreSharedMeta` refuse every stored section
   * (`unsupported_version`), which silently drops all purchased gear while the header wallet is kept. The room logs it
   * (shift-room.ts). Bumping the version needs a META reader for the old layout first.
   */
  readonly simMeta?: ShiftSimMeta;
}

/** META v1 layout (packages/sim room/checkpoint.ts): u16 tickHz, u8 toolCount, u8 dayPhase, u32 hash, u32 tickLo, u32 tickHi. */
const META_V1_DAY_PHASE_AT = 3;
const META_V1_TICK_AT = 8;
const META_V1_TICK_END = 16;
/** A META probe (a capture that allocates) runs at most this often while nothing else is dirty. */
export const SHIFT_META_PROBE_INTERVAL_MS = 5000;

/**
 * The META bytes without the fields that change by themselves (next tick, day phase), or `null` for a layout version
 * this build does not know (the META-only dirty check is then off; wallet / chunk changes still write). A test pins the
 * offsets against the real sim (shift-persistence-hardening.test.ts).
 */
export function metaSignature(meta: ShiftSimMeta | undefined): Uint8Array | null {
  if (meta === undefined || meta.version !== 1 || meta.bytes.byteLength < META_V1_TICK_END) return null;
  const sig = meta.bytes.slice();
  sig[META_V1_DAY_PHASE_AT] = 0;
  sig.fill(0, META_V1_TICK_AT, META_V1_TICK_END);
  return sig;
}

function sameSignature(a: Uint8Array | null, b: Uint8Array | null): boolean {
  if (a === null || b === null) return a === b;
  if (a.byteLength !== b.byteLength) return false;
  for (let i = 0; i < a.byteLength; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** Restored-wallet ceiling: the codec and sim-checkpoint bound (no game-data wallet cap exists yet; see the report). */
export const SHIFT_RESTORED_WALLET_MAX_LM = ROOM_WALLET_MAX_LM;

function sameState(a: ShiftRoomState, b: ShiftRoomState): boolean {
  return a.walletLm === b.walletLm && (a.nearParcelsMask ?? 0) === (b.nearParcelsMask ?? 0);
}

function copyState(s: ShiftRoomState): ShiftRoomState {
  if (s.nearParcelsMask === undefined) return { walletLm: s.walletLm };
  return s.simMeta === undefined
    ? { walletLm: s.walletLm, nearParcelsMask: s.nearParcelsMask }
    : { walletLm: s.walletLm, nearParcelsMask: s.nearParcelsMask, simMeta: s.simMeta };
}

/** Port of the room's dust storage. Implementations must not throw synchronously; rejected promises are logged. */
export interface ShiftDustStore {
  /** Every stored chunk of the Contract (newest version), or an empty list. */
  load(contractId: string): Promise<readonly StoredDustChunk[]>;
  /** Replaces the given chunks of the Contract. `simTick` is the room tick the chunks reflect. */
  save(contractId: string, chunks: readonly StoredDustChunk[], simTick: number, state?: ShiftRoomState): Promise<void>;
  /** Room state of the newest stored header (wallet), or `null`. Called after `load`, so a durable store reads it once. */
  loadState?(contractId: string): Promise<ShiftRoomState | null>;
  /** One-shot, after `load`: true when that load archived a save of another terrain bake and started fresh. */
  takeArchived?(contractId: string): Promise<boolean>;
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
  private readonly states = new Map<string, ShiftRoomState>();
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

  loadState(contractId: string): Promise<ShiftRoomState | null> {
    return Promise.resolve(this.states.get(contractId) ?? null);
  }

  save(contractId: string, chunks: readonly StoredDustChunk[], simTick: number, state?: ShiftRoomState): Promise<void> {
    void simTick;
    if (state !== undefined) this.states.set(contractId, copyState(state));
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
  /** Room state read from the store's newest header by `restore` (null: none stored). Read it before building the sim. */
  restoredState: ShiftRoomState | null = null;
  /** The store archived a save of another terrain bake during `restore` (the room tells the first client in HELLO). */
  archivedOnRestore = false;
  /** The header state exactly as stored (before `admitState`); the dirty baseline. */
  private storedState: ShiftRoomState | null = null;
  private stateProvider: (() => ShiftRoomState) | undefined;
  private metaProvider: (() => ShiftSimMeta | undefined) | undefined;
  private savedState: ShiftRoomState | null = null;
  /** `metaSignature` of the META last written (or, before the first write, the META the room started with). */
  private savedMetaSig: Uint8Array | null = null;
  private metaDirty = false;
  private lastMetaProbeMs = Number.NEGATIVE_INFINITY;

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

  /**
   * Gives the persistence the room state to write with each checkpoint (read at write time; call after `restore`). A
   * state that differs from the last stored one makes the room dirty even with no dirty chunk: a header-only checkpoint is written.
   */
  setStateProvider(provider: () => ShiftRoomState, metaProvider?: () => ShiftSimMeta | undefined): void {
    this.stateProvider = provider;
    this.metaProvider = metaProvider;
    // Baseline: what is stored, or (a Contract never saved) the state the room starts with, so an untouched wallet never
    // makes a pristine room write a header.
    // A skipped legacy wallet keeps the stored header as the baseline, so the next checkpoint rewrites it as room-v2.
    this.savedState = this.storedState ?? this.restoredState ?? copyState(provider());
    // META baseline: the sim was just built from the stored state (or fresh), so its META now IS the saved one for the
    // dirty check (a refused or absent stored META must not make a pristine room write a header).
    this.savedMetaSig = metaProvider === undefined ? null : this.captureMetaSignature();
    this.metaDirty = false;
  }

  /** The current META signature; a throwing provider is logged and counts as "unknown" (never throws on the tick path). */
  private captureMetaSignature(): Uint8Array | null {
    try {
      return metaSignature(this.metaProvider?.());
    } catch (err) {
      this.logger?.warn({ code: codeOf(err) }, "shift room META capture failed; META change check skipped");
      return null;
    }
  }

  /** Re-checks the META signature (throttled unless `force`); sets `metaDirty` when it differs from the saved one. */
  private probeMeta(nowMs: number, force: boolean): void {
    if (this.metaProvider === undefined || this.metaDirty) return;
    if (!force && nowMs - this.lastMetaProbeMs < SHIFT_META_PROBE_INTERVAL_MS) return;
    this.lastMetaProbeMs = nowMs;
    const sig = this.captureMetaSignature();
    if (sig !== null && !sameSignature(sig, this.savedMetaSig)) this.metaDirty = true;
  }

  private stateDirty(): boolean {
    if (this.metaDirty) return true;
    const now = this.stateProvider?.();
    return now !== undefined && (this.savedState === null || !sameState(now, this.savedState));
  }

  /**
   * What the room may restore from a stored header: the wallet (clamped to SHIFT_RESTORED_WALLET_MAX_LM) and the parcel
   * mask, or `null` for a legacy header without the mask (wallet skipped, logged). Never silent about dropped data.
   */
  private admitState(stored: ShiftRoomState | null): ShiftRoomState | null {
    if (stored === null) return null;
    if (stored.nearParcelsMask === undefined) {
      this.logger?.warn(
        { walletLm: stored.walletLm },
        "shift room header has a wallet but no Near Parcel mask (legacy room-v1); wallet restore skipped (review B1)",
      );
      return null;
    }
    let walletLm = stored.walletLm;
    if (!(walletLm >= 0)) walletLm = 0;
    if (walletLm > SHIFT_RESTORED_WALLET_MAX_LM) {
      this.logger?.warn({ walletLm }, "shift room header wallet above the ceiling; clamped");
      walletLm = SHIFT_RESTORED_WALLET_MAX_LM;
    }
    const nearParcelsMask = stored.nearParcelsMask & 0xff;
    return stored.simMeta === undefined
      ? { walletLm, nearParcelsMask }
      : { walletLm, nearParcelsMask, simMeta: stored.simMeta };
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
    try {
      this.archivedOnRestore = (await this.store.takeArchived?.(this.contractId)) === true;
    } catch {
      this.archivedOnRestore = false;
    }
    try {
      this.storedState = (await this.store.loadState?.(this.contractId)) ?? null;
    } catch (err) {
      if (this.store.strict === true) throw err;
      this.storedState = null;
    }
    this.restoredState = this.admitState(this.storedState);
    this.savedState = this.storedState;
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
    this.probeMeta(nowMs, false);
    if (this.ledger.dirtyChunkCount === 0 && !this.stateDirty()) return;
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
    this.probeMeta(nowMs, true); // a final / explicit save never trusts the throttled flag
    if (l.dirtyChunkCount === 0 && !this.stateDirty()) return this.saving ?? Promise.resolve();
    const previous = this.saving;
    this.inFlight = true;
    const onFailure = (err: unknown, chunks: readonly StoredDustChunk[], msg: string): void => {
      this.counters.saveFailures++;
      this.consecutiveFailures++;
      this.retryAtMs = this.lastNowMs + backoffDelayMs(this.consecutiveFailures);
      for (const c of chunks) l.setChunkDirty(c.chunkId);
      this.logger?.warn({ code: codeOf(err), failures: this.consecutiveFailures }, msg);
    };
    const run = (previous === null ? this.encodeSliced() : previous.then(() => this.encodeSliced()))
      .then(({ chunks, state }) => {
        const sig = metaSignature(state?.simMeta);
        const stateChanged =
          state !== undefined &&
          (this.savedState === null ||
            !sameState(state, this.savedState) ||
            (sig !== null && !sameSignature(sig, this.savedMetaSig)));
        if (chunks.length === 0 && !stateChanged) return;
        let written: Promise<void>;
        try {
          written = this.store.save(this.contractId, chunks, simTick, state);
        } catch (err) {
          written = Promise.reject(err instanceof Error ? err : new Error("store.save threw"));
        }
        return written.then(
          () => {
            if (state !== undefined) this.savedState = copyState(state);
            if (sig !== null) this.savedMetaSig = sig;
            this.metaDirty = false;
            this.counters.saves++;
            this.counters.chunksWritten += chunks.length;
            this.consecutiveFailures = 0;
          },
          (err: unknown) => {
            onFailure(err, chunks, "shift dust save failed; chunks stay dirty, retrying with backoff");
          },
        );
      })
      // Review N8: an encode / capture throw (encodeSliced re-marked its chunks) is logged and counted like a failed
      // write; the next checkpoint retries. Without this the rejection is unhandled and kills the process.
      .catch((err: unknown) => {
        onFailure(err, [], "shift dust checkpoint encode failed; chunks stay dirty, retrying with backoff");
      })
      .finally(() => {
        if (this.saving === run) this.inFlight = false;
      });
    this.saving = run;
    return run;
  }

  /**
   * The header state is captured BEFORE the first chunk is encoded (same macrotask, no tick in between). Chunks encoded
   * in later slices can only be newer than it, so a crash between saves can lose a payout but never store a wallet that
   * already holds the Stamp / sale of dust the stored chunks still show (which a restart would pay again).
   */
  private async encodeSliced(): Promise<{ chunks: StoredDustChunk[]; state: ShiftRoomState | undefined }> {
    const l = this.ledger;
    const out: StoredDustChunk[] = [];
    const base = this.stateProvider?.();
    const meta = base === undefined || base.nearParcelsMask === undefined ? undefined : this.metaProvider?.();
    const state = base === undefined || meta === undefined ? base : { ...base, simMeta: meta };
    let spentMs = 0;
    let sliceStart = performance.now();
    this.counters.encodeSlices++;
    try {
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
    } catch (err) {
      for (const c of out) l.setChunkDirty(c.chunkId); // encoded but never written: dirty again
      throw err;
    }
    this.counters.encodeMs = spentMs + (performance.now() - sliceStart);
    return { chunks: out, state };
  }
}

function codeOf(err: unknown): string {
  if (typeof err === "object" && err !== null && "code" in err && typeof err.code === "string") return err.code;
  return err instanceof Error ? err.name : "unknown";
}
