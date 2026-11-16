// Durable ShiftDustStore over a RoomSaveRepository (M1-W5-T01): the room's dust chunks, the Contract lease and the
// outage policy of netcode.md sections 9.3, 9.4 and 16.
//
// Lease. The room owns a Contract only while it holds the database lease (CAS on the database clock, 35 s, renewed every
// 10 s). `ensureLease` is called by the join preflight (so a busy Contract answers 409 CONTRACT_BUSY before a room is
// created) and again by `load` on room creation. The lease key is (instance, contractId): the in-process registry allows
// ONE room per Contract per process, so the Contract id stands in for the Colyseus room id (the room id is not known
// before the room exists). A renewal that comes back `lost` (CAS found another owner) or a checkpoint that finds the
// lease gone stops all writes and fires `onLeaseLost`, which closes the room with 4108. A renewal that cannot reach the
// database is NOT a loss: running rooms keep going and keep retrying (the lease may well still be ours).
//
// Outage. Every call goes through the StorageLink: bounded by a timeout, failures back off 1 -> 30 s. While the link is
// down and its backoff has not elapsed, `ensureLease` refuses new rooms without touching the database.
//
// Restore never starts from a pristine moon when the database could not be read: `strict` makes the room refuse to
// start instead (`ShiftDustPersistence.restore` rethrows), so a transient outage can never overwrite a real save.

import { randomUUID } from "node:crypto";
import { DUST_CHUNK_PAYLOAD_MAX_BYTES } from "@moon-cleanup/shared";
import type { ShiftDustStore, ShiftRoomState, StoredDustChunk } from "../net/shift/shift-persistence";
import {
  ContractUnavailableError,
  RoomSaveCorruptError,
  type LeaseOwner,
  type RoomChunk,
  type RoomSaveRepository,
} from "./ports";
import { STORAGE_WAKE_TIMEOUT_MS, StorageLink } from "./storage-link";

/** Lease renewal period (data-model 3.5). */
export const LEASE_RENEW_INTERVAL_MS = 10_000;

export interface DurableStoreLogger {
  info(obj: object, msg: string): void;
  warn(obj: object, msg: string): void;
  error(obj: object, msg: string): void;
}

export interface DurableShiftDustStoreOptions {
  readonly repo: RoomSaveRepository;
  /** `<ENV_NAME>:<BUILD_VERSION>:<boot uuid>`; default is a fresh `local::<uuid>`. */
  readonly instance?: string;
  readonly link?: StorageLink;
  readonly logger?: DurableStoreLogger;
  /** Renewal period; tests shorten it. */
  readonly renewIntervalMs?: number;
  /** Bound of load and lease calls (they may wake the database). */
  readonly wakeTimeoutMs?: number;
  /**
   * Lower-case hex SHA-256 of this build's world bake. Written with every checkpoint; a stored save that recorded a
   * different one is archived (kept recoverable) and the room starts fresh (owner decision 2026-11-16; a header this
   * build cannot read, whose bake is unknowable, is still refused with `save_corrupt`, 4108). Absent until the server
   * world is baked (then nothing is checked).
   */
  readonly bakeHash?: string;
}

interface Held {
  readonly owner: LeaseOwner;
  timer: ReturnType<typeof setInterval> | undefined;
  renewing: boolean;
  lost: boolean;
  readonly listeners: Set<() => void>;
}

export class DurableShiftDustStore implements ShiftDustStore {
  /** Restore failures must refuse the room, never start clean. */
  readonly strict = true;
  readonly link: StorageLink;
  readonly instance: string;
  private readonly repo: RoomSaveRepository;
  private readonly logger: DurableStoreLogger | undefined;
  private readonly renewMs: number;
  private readonly wakeMs: number;
  private readonly bakeHash: string | undefined;
  private readonly loadedStates = new Map<string, ShiftRoomState>();
  private readonly held = new Map<string, Held>();
  private readonly acquiring = new Map<string, Promise<Held>>();
  readonly counters = {
    leaseAcquired: 0,
    leaseBusy: 0,
    leaseLost: 0,
    renewFailures: 0,
    saves: 0,
    loads: 0,
    archives: 0,
  };

  constructor(options: DurableShiftDustStoreOptions) {
    this.repo = options.repo;
    this.instance = options.instance ?? `local::${randomUUID()}`;
    this.logger = options.logger;
    this.renewMs = options.renewIntervalMs ?? LEASE_RENEW_INTERVAL_MS;
    this.wakeMs = options.wakeTimeoutMs ?? STORAGE_WAKE_TIMEOUT_MS;
    this.bakeHash = options.bakeHash;
    const logger = this.logger;
    this.link =
      options.link ??
      new StorageLink({
        onStateChange: (state, info) =>
          state === "down"
            ? logger?.warn({ failures: info.failures, code: info.code }, "database unreachable: checkpoints will retry")
            : logger?.info({ failures: info.failures }, "database reachable again"),
      });
  }

  /** Number of Contract leases this process holds (ops). */
  get leasesHeld(): number {
    return this.held.size;
  }

  holdsLease(contractId: string): boolean {
    const h = this.held.get(contractId);
    return h !== undefined && !h.lost;
  }

  /**
   * Takes (or confirms) the lease of a Contract. Throws ContractUnavailableError: `busy` (409 CONTRACT_BUSY) when
   * another instance or room holds it, `storage_down` (503) when the database is down. Idempotent and race-safe.
   */
  async ensureLease(contractId: string): Promise<void> {
    const existing = this.held.get(contractId);
    if (existing !== undefined && !existing.lost) return;
    const pending = this.acquiring.get(contractId);
    if (pending !== undefined) {
      await pending;
      return;
    }
    if (!this.link.canAttempt()) throw new ContractUnavailableError("storage_down");
    const run = this.acquire(contractId);
    this.acquiring.set(contractId, run);
    try {
      await run;
    } finally {
      this.acquiring.delete(contractId);
    }
  }

  private async acquire(contractId: string): Promise<Held> {
    const owner: LeaseOwner = { contractId, instance: this.instance, roomId: contractId };
    let verdict: "acquired" | "busy";
    try {
      verdict = await this.link.run(() => this.repo.acquireLease(owner), this.wakeMs);
    } catch (error) {
      if (error instanceof ContractUnavailableError) throw error;
      throw new ContractUnavailableError("storage_down");
    }
    if (verdict === "busy") {
      this.counters.leaseBusy++;
      throw new ContractUnavailableError("busy");
    }
    this.counters.leaseAcquired++;
    const stale = this.held.get(contractId);
    if (stale?.timer !== undefined) clearInterval(stale.timer);
    const held: Held = { owner, timer: undefined, renewing: false, lost: false, listeners: new Set() };
    held.timer = setInterval(() => void this.renew(held), this.renewMs);
    held.timer.unref?.();
    this.held.set(contractId, held);
    return held;
  }

  private async renew(held: Held): Promise<void> {
    if (held.lost || held.renewing) return;
    if (!this.link.canAttempt()) return; // honour the backoff while the database is down
    held.renewing = true;
    try {
      const verdict = await this.link.run(() => this.repo.renewLease(held.owner));
      if (verdict === "lost") this.markLost(held, "renewal found another owner");
    } catch {
      // Unreachable is not a loss (the lease may still be ours); the link already counted it and backs off.
      this.counters.renewFailures++;
    } finally {
      held.renewing = false;
    }
  }

  private markLost(held: Held, why: string): void {
    if (held.lost) return;
    held.lost = true;
    this.counters.leaseLost++;
    if (held.timer !== undefined) clearInterval(held.timer);
    held.timer = undefined;
    this.logger?.error({ contractId: held.owner.contractId, why }, "contract lease lost: room will close (4108)");
    for (const listener of [...held.listeners]) {
      try {
        listener();
      } catch {
        // a listener must not stop the others
      }
    }
  }

  /**
   * Registers a callback for a lost lease (the room closes with 4108). Call after `load` (the lease exists then); with
   * no lease held it fires at once. Returns the unsubscribe.
   */
  onLeaseLost(contractId: string, listener: () => void): () => void {
    const held = this.held.get(contractId);
    if (held === undefined || held.lost) {
      listener();
      return () => undefined;
    }
    held.listeners.add(listener);
    return () => held.listeners.delete(listener);
  }

  async load(contractId: string): Promise<readonly StoredDustChunk[]> {
    await this.ensureLease(contractId);
    this.counters.loads++;
    try {
      const snapshot = await this.link.run(async () => {
        try {
          return await this.repo.loadRoomSave(contractId);
        } catch (error) {
          // The database answered; the rows are bad. A verdict about this Contract, not an outage of the link.
          if (error instanceof RoomSaveCorruptError) throw new ContractUnavailableError("save_corrupt", error.message);
          throw error;
        }
      }, this.wakeMs);
      this.loadedStates.delete(contractId);
      if (snapshot === null) return [];
      // World identity (data-model 3.7 / format.ts bakeHash): a save written for another terrain bake never loads.
      // Owner decision 2026-11-16: no migration. The old save is ARCHIVED (moved verbatim, never deleted, recoverable)
      // and the room starts fresh; the next checkpoint writes the new bake's stamp.
      if (this.bakeHash !== undefined && snapshot.bakeHash !== null && snapshot.bakeHash !== this.bakeHash) {
        const owner = this.held.get(contractId)?.owner;
        if (owner === undefined) throw new ContractUnavailableError("lease_lost");
        const archived = await this.link.run(() => this.repo.archiveRoomSave(owner, "bake_mismatch"), this.wakeMs);
        if (archived.kind === "lease_lost") {
          const held = this.held.get(contractId);
          if (held !== undefined) this.markLost(held, "archive found another owner");
          throw new ContractUnavailableError("lease_lost");
        }
        this.counters.archives++;
        this.logger?.warn(
          {
            contractId,
            archiveId: archived.kind === "archived" ? archived.archiveId : null,
            generation: snapshot.generation,
            savedBake: snapshot.bakeHash,
            currentBake: this.bakeHash,
          },
          "room save belongs to another terrain bake: archived (kept recoverable), starting a fresh room",
        );
        return [];
      }
      if (snapshot.ignoredHeaderCodec != null) {
        // Rollback (reviews N3, N5): a newer build wrote a header this build cannot read, so the bake hash inside it is
        // unknown too. A build that stamps saves (bakeHash set) must not load a world it cannot identify, and the next
        // checkpoint would overwrite the newer header: fail closed. The rows stay untouched until the newer build runs
        // again (roll forward). A build without a bake hash checks nothing by design and keeps the N3 behaviour: dust
        // loads, header state (wallet, parcels, gear) starts fresh, logged.
        if (this.bakeHash !== undefined) {
          this.logger?.error(
            { contractId, codec: snapshot.ignoredHeaderCodec, generation: snapshot.generation },
            "room header codec not readable by this build and its bake hash cannot be checked; room refused (roll forward)",
          );
          throw new ContractUnavailableError(
            "save_corrupt",
            "bake_unverifiable: the save header is newer than this build",
          );
        }
        this.logger?.warn(
          { contractId, codec: snapshot.ignoredHeaderCodec, generation: snapshot.generation },
          "room header codec not readable by this build; dust restored, header state reset",
        );
      }
      if (snapshot.state !== null) this.loadedStates.set(contractId, snapshot.state);
      return snapshot.chunks.map((c: RoomChunk) => {
        if (c.payload.byteLength > DUST_CHUNK_PAYLOAD_MAX_BYTES) throw new ContractUnavailableError("save_corrupt");
        return { chunkId: c.chunkId, payload: c.payload };
      });
    } catch (error) {
      await this.release(contractId); // a room that cannot start must not hold the lease for 35 s
      if (error instanceof ContractUnavailableError) throw error;
      throw new ContractUnavailableError("storage_down");
    }
  }

  /** Room state of the header `load` just read (one-shot: the entry is consumed). */
  loadState(contractId: string): Promise<ShiftRoomState | null> {
    const state = this.loadedStates.get(contractId) ?? null;
    this.loadedStates.delete(contractId);
    return Promise.resolve(state);
  }

  async save(
    contractId: string,
    chunks: readonly StoredDustChunk[],
    simTick: number,
    state?: ShiftRoomState,
  ): Promise<void> {
    const held = this.held.get(contractId);
    if (held === undefined || held.lost) throw new ContractUnavailableError("lease_lost");
    const result = await this.link.run(() =>
      this.repo.commitRoomCheckpoint({
        owner: held.owner,
        simTick,
        chunks,
        ...(state === undefined
          ? {}
          : {
              state:
                state.nearParcelsMask === undefined
                  ? { walletLm: state.walletLm }
                  : state.simMeta === undefined
                    ? { walletLm: state.walletLm, nearParcelsMask: state.nearParcelsMask }
                    : { walletLm: state.walletLm, nearParcelsMask: state.nearParcelsMask, simMeta: state.simMeta },
            }),
        ...(this.bakeHash === undefined ? {} : { bakeHash: this.bakeHash }),
      }),
    );
    if (result.kind === "lease_lost") {
      this.markLost(held, "checkpoint found another owner");
      throw new ContractUnavailableError("lease_lost");
    }
    this.counters.saves++;
  }

  /** Clears the lease after the room's final checkpoint (best effort: an unreachable database leaves it to expire). */
  async release(contractId: string): Promise<void> {
    const held = this.held.get(contractId);
    if (held === undefined) return;
    this.held.delete(contractId);
    if (held.timer !== undefined) clearInterval(held.timer);
    held.timer = undefined;
    if (held.lost) return; // not ours any more: never clear someone else's lease
    if (!this.link.canAttempt()) return;
    try {
      await this.link.run(() => this.repo.releaseLease(held.owner));
    } catch {
      this.logger?.warn({ contractId }, "lease release failed; it expires on its own within 35 s");
    }
  }

  /** Stops every renewal timer (process shutdown after rooms were released). */
  dispose(): void {
    for (const held of this.held.values()) if (held.timer !== undefined) clearInterval(held.timer);
  }
}
