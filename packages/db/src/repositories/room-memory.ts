// In-memory RoomSaveRepository + UsageRepository: PERSISTENCE_DRIVER=memory and every durability test. It models the
// parts of the SQL that matter to callers: lease CAS on a (fake) database clock with a 35 s expiry, a monotonic save
// generation, one stored version per chunk, and an `offline` switch that makes every call reject like a powered-off
// Neon compute. It does not survive a process restart (memory), which is the documented limit of the memory driver.
// room-suite.ts runs the same behavioural suite against this and against the PostgreSQL implementation.

import { deflateSync, inflateSync } from "node:zlib";
import { DUST_CHUNK_PAYLOAD_MAX_BYTES } from "@moon-cleanup/shared";
import {
  LEASE_TTL_MS,
  RoomSaveCorruptError,
  type AcquireLeaseResult,
  type LeaseOwner,
  type RenewLeaseResult,
  type RoomCheckpointInput,
  type RoomCheckpointResult,
  type RoomChunk,
  type RoomSaveRepository,
  type RoomSnapshot,
  type UsageRepository,
} from "./room-types.ts";

interface Lease {
  instance: string;
  roomId: string;
  expiresAtMs: number;
}

interface StoredContract {
  lease: Lease | null;
  generation: number;
  simTick: number;
  bakeHash: string | null;
  chunks: Map<number, Uint8Array>;
}

export interface MemoryRoomRepositoryOptions {
  /** The "database clock" (epoch ms). Default `Date.now`. */
  readonly now?: () => number;
}

function unreachable(): Error {
  return Object.assign(new Error("database unreachable (memory repository offline)"), { code: "ECONNREFUSED" });
}

export class MemoryRoomSaveRepository implements RoomSaveRepository, UsageRepository {
  private readonly contracts = new Map<string, StoredContract>();
  private readonly egress = new Map<string, number>();
  private readonly now: () => number;
  /** When true every call rejects (DB powered off). */
  offline = false;
  /** Number of commits that wrote rows (tests). */
  commits = 0;

  constructor(options: MemoryRoomRepositoryOptions = {}) {
    this.now = options.now ?? Date.now;
  }

  private entry(contractId: string): StoredContract {
    let c = this.contracts.get(contractId);
    if (c === undefined) {
      c = { lease: null, generation: 0, simTick: 0, bakeHash: null, chunks: new Map() };
      this.contracts.set(contractId, c);
    }
    return c;
  }

  private check(): void {
    if (this.offline) throw unreachable();
  }

  private holds(c: StoredContract, o: LeaseOwner): boolean {
    return c.lease !== null && c.lease.instance === o.instance && c.lease.roomId === o.roomId;
  }

  private claim(owner: LeaseOwner): boolean {
    const c = this.entry(owner.contractId);
    const free = c.lease === null || c.lease.expiresAtMs < this.now();
    if (!free && !this.holds(c, owner)) return false;
    c.lease = { instance: owner.instance, roomId: owner.roomId, expiresAtMs: this.now() + LEASE_TTL_MS };
    return true;
  }

  acquireLease(owner: LeaseOwner): Promise<AcquireLeaseResult> {
    try {
      this.check();
    } catch (e) {
      return Promise.reject(e as Error);
    }
    return Promise.resolve(this.claim(owner) ? "acquired" : "busy");
  }

  renewLease(owner: LeaseOwner): Promise<RenewLeaseResult> {
    try {
      this.check();
    } catch (e) {
      return Promise.reject(e as Error);
    }
    // Same statement as acquire: an expired lease nobody took is renewable by its old owner.
    return Promise.resolve(this.claim(owner) ? "renewed" : "lost");
  }

  releaseLease(owner: LeaseOwner): Promise<void> {
    try {
      this.check();
    } catch (e) {
      return Promise.reject(e as Error);
    }
    const c = this.entry(owner.contractId);
    if (c.lease !== null && c.lease.roomId === owner.roomId) c.lease = null;
    return Promise.resolve();
  }

  loadRoomSave(contractId: string): Promise<RoomSnapshot | null> {
    try {
      this.check();
    } catch (e) {
      return Promise.reject(e as Error);
    }
    const c = this.contracts.get(contractId);
    if (c === undefined || c.generation === 0) return Promise.resolve(null);
    const chunks: RoomChunk[] = [];
    try {
      for (const [chunkId, z] of c.chunks) {
        chunks.push({ chunkId, payload: inflateSync(z, { maxOutputLength: DUST_CHUNK_PAYLOAD_MAX_BYTES }) });
      }
    } catch (e) {
      return Promise.reject(new RoomSaveCorruptError(`chunk does not inflate: ${(e as Error).message}`));
    }
    chunks.sort((a, b) => a.chunkId - b.chunkId);
    return Promise.resolve({ generation: c.generation, simTick: c.simTick, chunks, bakeHash: c.bakeHash });
  }

  commitRoomCheckpoint(input: RoomCheckpointInput): Promise<RoomCheckpointResult> {
    try {
      this.check();
    } catch (e) {
      return Promise.reject(e as Error);
    }
    const c = this.entry(input.owner.contractId);
    // Data-model 3.7 step 3: the lease guard is part of the write. A lease that is ours (even past its expiry, nobody
    // took it) passes; anyone else's, or none, means nothing is written.
    if (!this.holds(c, input.owner)) return Promise.resolve({ kind: "lease_lost" });
    for (const chunk of input.chunks) c.chunks.set(chunk.chunkId, deflateSync(chunk.payload));
    c.generation++;
    c.simTick = input.simTick;
    c.bakeHash = input.bakeHash ?? null;
    this.commits++;
    return Promise.resolve({
      kind: "saved",
      generation: c.generation,
      storedBytes: this.storedBytes(input.owner.contractId),
    });
  }

  /** Deflated bytes stored for a Contract (tests, size reports). */
  storedBytes(contractId: string): number {
    let n = 0;
    for (const z of this.contracts.get(contractId)?.chunks.values() ?? []) n += z.byteLength;
    return n;
  }

  leaseHolder(contractId: string): { instance: string; roomId: string } | null {
    const l = this.contracts.get(contractId)?.lease;
    return l === undefined || l === null || l.expiresAtMs < this.now()
      ? null
      : { instance: l.instance, roomId: l.roomId };
  }

  addEgress(day: string, bytesOut: number): Promise<void> {
    try {
      this.check();
    } catch (e) {
      return Promise.reject(e as Error);
    }
    const add = Math.max(0, Math.floor(Number.isFinite(bytesOut) ? bytesOut : 0));
    this.egress.set(day, (this.egress.get(day) ?? 0) + add);
    return Promise.resolve();
  }

  monthEgress(month: string): Promise<number> {
    try {
      this.check();
    } catch (e) {
      return Promise.reject(e as Error);
    }
    let sum = 0;
    for (const [day, bytes] of this.egress) if (day.startsWith(`${month}-`)) sum += bytes;
    return Promise.resolve(sum);
  }
}
