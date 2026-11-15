// PostgreSQL RoomSaveRepository + UsageRepository (M1-W5-T01): the Contract lease CAS (data-model.md 3.5), the room
// checkpoint transaction (3.7: older header slot guarded by a compare-and-set, older chunk versions, Contract mirrors),
// the crash-safe load rule (3.7b) and the ops_usage_daily upsert (3.12). Works with any drizzle pg driver (postgres.js in
// production, PGlite in tests). Time comes from the DATABASE clock (`now()`) unless a test injects `clock`. No
// string-built SQL: identifiers and values go through drizzle operators and bound parameters.
//
// Interim room header: the A/B header slot of a room checkpoint carries codec `room-v0` and a 0 or 32 byte blob (the
// bake hash). The full MCSV header envelope (wallet, gear, ...) is not persisted by rooms yet; it replaces this blob
// without a migration. Chunk rows use the same zlib `deflate` codec as the solo checkpoint upload, so rows written by
// either host are loadable by the other (a Contract can move between solo and private).

import { crc32, deflateSync, inflateSync } from "node:zlib";
import { and, eq, isNull, lt, ne, or, sql } from "drizzle-orm";
import { DUST_CHUNK_PAYLOAD_MAX_BYTES, SAVE_FORMAT_VERSION } from "@moon-cleanup/shared";
import { contractDustChunks, contractSaves, contracts, opsUsageDaily } from "../schema/index.ts";
import type { PgDb } from "./postgres.ts";
import { fromSignedCrc, pickOlderSlot, pickOlderVersion, toSignedCrc } from "./save-rules.ts";
import {
  BAKE_HASH_HEX_RE,
  LEASE_TTL_MS,
  ROOM_HEADER_CODEC,
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
import type { SaveSlotName } from "./types.ts";

type Tx = Parameters<Parameters<PgDb["transaction"]>[0]>[0];
type Executor = PgDb | Tx;

export interface PostgresRoomRepositoryOptions {
  /** Test seam only. Production omits it, so the database clock decides every time-based rule. */
  readonly clock?: () => Date;
  /** `save_format_version` written to the room header row. Default `SAVE_FORMAT_VERSION`. */
  readonly saveFormatVersion?: number;
  /** `game_data_version` written to the header row and the Contract mirror. Default "" (unknown). */
  readonly gameDataVersion?: string;
}

class LeaseLost extends Error {
  constructor() {
    super("lease lost");
  }
}

const asBytes = (value: Uint8Array): Buffer => Buffer.from(value.buffer, value.byteOffset, value.byteLength);
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH_RE = /^\d{4}-\d{2}$/;
const hexOf = (bytes: Uint8Array): string =>
  Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString("hex");

export function createPostgresRoomRepository(
  db: PgDb,
  options: PostgresRoomRepositoryOptions = {},
): RoomSaveRepository & UsageRepository {
  const clock = options.clock;
  const saveFormatVersion = options.saveFormatVersion ?? SAVE_FORMAT_VERSION;
  const gameDataVersion = options.gameDataVersion ?? "";

  /** The database clock as a SQL fragment (a bound ISO string when a test clock is injected). */
  const nowSql = () => (clock === undefined ? sql`now()` : sql`${clock().toISOString()}::timestamptz`);

  const nowDate = async (executor: Executor): Promise<Date> => {
    if (clock !== undefined) return clock();
    const [row] = await executor
      .select({ ms: sql<number>`floor(extract(epoch from now()) * 1000)::float8` })
      .from(sql`(select 1) as clock_row`);
    return new Date(Number(row?.ms ?? Date.now()));
  };

  /**
   * Data-model 3.5 statement, shared by acquire and renew: sets the lease when the Contract is unleased, the lease has
   * expired, or the caller already holds it (instance AND room). Zero rows = someone else owns it (or the Contract is
   * gone or deleted, which no room may own).
   */
  const claim = async (owner: LeaseOwner): Promise<boolean> => {
    const rows = await db
      .update(contracts)
      .set({
        leaseInstance: owner.instance,
        leaseRoomId: owner.roomId,
        leaseExpiresAt: sql`${nowSql()} + ${`${LEASE_TTL_MS} milliseconds`}::interval`,
      })
      .where(
        and(
          eq(contracts.id, owner.contractId),
          ne(contracts.status, "deleted"),
          or(
            isNull(contracts.leaseInstance),
            isNull(contracts.leaseExpiresAt),
            lt(contracts.leaseExpiresAt, nowSql()),
            and(eq(contracts.leaseInstance, owner.instance), eq(contracts.leaseRoomId, owner.roomId)),
          ),
        ),
      )
      .returning({ id: contracts.id });
    return rows.length > 0;
  };

  const decodeChunk = (row: {
    chunkId: number;
    codec: string;
    rawSize: number;
    checksum: number;
    blob: Uint8Array;
  }): Uint8Array | null => {
    if (row.codec !== "deflate" || row.rawSize > DUST_CHUNK_PAYLOAD_MAX_BYTES) return null;
    try {
      const raw = inflateSync(row.blob, { maxOutputLength: DUST_CHUNK_PAYLOAD_MAX_BYTES });
      if (raw.byteLength !== row.rawSize || crc32(raw) !== fromSignedCrc(row.checksum)) return null;
      return new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength);
    } catch {
      return null;
    }
  };

  return {
    async acquireLease(owner): Promise<AcquireLeaseResult> {
      return (await claim(owner)) ? "acquired" : "busy";
    },

    async renewLease(owner): Promise<RenewLeaseResult> {
      return (await claim(owner)) ? "renewed" : "lost";
    },

    async releaseLease(owner): Promise<void> {
      await db
        .update(contracts)
        .set({ leaseInstance: null, leaseRoomId: null, leaseExpiresAt: null })
        .where(and(eq(contracts.id, owner.contractId), eq(contracts.leaseRoomId, owner.roomId)));
    },

    async loadRoomSave(contractId): Promise<RoomSnapshot | null> {
      const slots = await db
        .select({
          slot: contractSaves.slot,
          saveSeq: contractSaves.saveSeq,
          simTick: contractSaves.simTick,
          codec: contractSaves.codec,
          rawSize: contractSaves.rawSize,
          checksum: contractSaves.checksum,
        })
        .from(contractSaves)
        .where(eq(contractSaves.contractId, contractId));
      const head = slots.reduce<(typeof slots)[number] | undefined>(
        (best, s) => (best === undefined || s.saveSeq > best.saveSeq ? s : best),
        undefined,
      );
      if (head === undefined) return null;

      let bakeHash: string | null = null;
      if (head.codec === ROOM_HEADER_CODEC) {
        const [header] = await db
          .select({ blob: contractSaves.blob })
          .from(contractSaves)
          .where(and(eq(contractSaves.contractId, contractId), eq(contractSaves.slot, head.slot)));
        const blob = header?.blob;
        if (
          blob === undefined ||
          (blob.byteLength !== 0 && blob.byteLength !== 32) ||
          blob.byteLength !== head.rawSize ||
          crc32(blob) !== fromSignedCrc(head.checksum)
        ) {
          throw new RoomSaveCorruptError("room header failed its checksum");
        }
        bakeHash = blob.byteLength === 32 ? hexOf(blob) : null;
      }

      const rows = await db.select().from(contractDustChunks).where(eq(contractDustChunks.contractId, contractId));
      const byChunk = new Map<number, typeof rows>();
      for (const row of rows) {
        // Data-model 3.7b rule 2: versions newer than the chosen header belong to a failed checkpoint and are ignored.
        if (row.saveSeq > head.saveSeq) continue;
        const list = byChunk.get(row.chunkId) ?? [];
        list.push(row);
        byChunk.set(row.chunkId, list);
      }
      const chunks: RoomChunk[] = [];
      for (const [chunkId, versions] of byChunk) {
        versions.sort((a, b) => b.saveSeq - a.saveSeq);
        let payload: Uint8Array | null = null;
        for (const v of versions) {
          payload = decodeChunk(v);
          if (payload !== null) break; // a failed newest version falls back to the other one, never forward
        }
        if (payload === null) throw new RoomSaveCorruptError(`chunk ${chunkId} has no valid version`);
        chunks.push({ chunkId, payload });
      }
      chunks.sort((a, b) => a.chunkId - b.chunkId);
      return { generation: head.saveSeq, simTick: head.simTick, chunks, bakeHash };
    },

    async commitRoomCheckpoint(input: RoomCheckpointInput): Promise<RoomCheckpointResult> {
      if (input.bakeHash !== undefined && !BAKE_HASH_HEX_RE.test(input.bakeHash)) {
        throw new RangeError("bakeHash must be 64 lower-case hex characters");
      }
      try {
        return await db.transaction(async (tx): Promise<RoomCheckpointResult> => {
          const at = await nowDate(tx);
          const [contract] = await tx
            .select({
              status: contracts.status,
              leaseInstance: contracts.leaseInstance,
              leaseRoomId: contracts.leaseRoomId,
            })
            .from(contracts)
            .where(eq(contracts.id, input.owner.contractId))
            .for("update");
          // The lease guard is part of the write: a lease that is ours passes even past its expiry (nobody took it).
          if (
            contract === undefined ||
            contract.status === "deleted" ||
            contract.leaseInstance !== input.owner.instance ||
            contract.leaseRoomId !== input.owner.roomId
          ) {
            return { kind: "lease_lost" };
          }

          const slots = await tx
            .select({ slot: contractSaves.slot, saveSeq: contractSaves.saveSeq })
            .from(contractSaves)
            .where(eq(contractSaves.contractId, input.owner.contractId));
          const newestSeq = slots.reduce((max, s) => Math.max(max, s.saveSeq), 0);
          const generation = newestSeq + 1;

          // Header first: the OLDER slot only, compare-and-set on that slot's save_seq (data-model 3.7 steps 2-3).
          const target = pickOlderSlot(slots.map((s) => ({ slot: s.slot as SaveSlotName, saveSeq: s.saveSeq })));
          const headerBlob = input.bakeHash === undefined ? new Uint8Array(0) : Buffer.from(input.bakeHash, "hex");
          const slotValues = {
            saveFormatVersion,
            gameDataVersion,
            codec: ROOM_HEADER_CODEC,
            rawSize: headerBlob.byteLength,
            blobSize: headerBlob.byteLength,
            checksum: toSignedCrc(crc32(headerBlob)),
            blob: asBytes(headerBlob),
            saveSeq: generation,
            parentSeq: newestSeq,
            originKind: "room",
            simTick: input.simTick,
            savedAt: at,
            savedBy: input.owner.instance,
          };
          const written =
            target.expectedSeq === null
              ? await tx
                  .insert(contractSaves)
                  .values({ contractId: input.owner.contractId, slot: target.slot, ...slotValues })
                  .onConflictDoNothing()
                  .returning({ slot: contractSaves.slot })
              : await tx
                  .update(contractSaves)
                  .set(slotValues)
                  .where(
                    and(
                      eq(contractSaves.contractId, input.owner.contractId),
                      eq(contractSaves.slot, target.slot),
                      eq(contractSaves.saveSeq, target.expectedSeq),
                    ),
                  )
                  .returning({ slot: contractSaves.slot });
          if (written.length === 0) throw new LeaseLost(); // zero rows: another writer owns the Contract (rollback, 4108)

          if (input.chunks.length > 0) {
            const existing = await tx
              .select({
                chunkId: contractDustChunks.chunkId,
                ver: contractDustChunks.ver,
                saveSeq: contractDustChunks.saveSeq,
              })
              .from(contractDustChunks)
              .where(eq(contractDustChunks.contractId, input.owner.contractId));
            const byChunk = new Map<number, { ver: 0 | 1; saveSeq: number }[]>();
            for (const row of existing) {
              const list = byChunk.get(row.chunkId) ?? [];
              list.push({ ver: row.ver === 1 ? 1 : 0, saveSeq: row.saveSeq });
              byChunk.set(row.chunkId, list);
            }
            const values = input.chunks.map((c) => {
              if (!Number.isInteger(c.chunkId) || c.chunkId < 0 || c.chunkId > 640) {
                throw new RangeError(`chunk id ${c.chunkId} outside 0..640`);
              }
              const z = deflateSync(c.payload);
              return {
                contractId: input.owner.contractId,
                chunkId: c.chunkId,
                ver: pickOlderVersion(byChunk.get(c.chunkId) ?? []),
                saveSeq: generation,
                codec: "deflate",
                rawSize: c.payload.byteLength,
                blobSize: z.byteLength,
                checksum: toSignedCrc(crc32(c.payload)),
                blob: asBytes(z),
                savedAt: at,
              };
            });
            await tx
              .insert(contractDustChunks)
              .values(values)
              .onConflictDoUpdate({
                target: [contractDustChunks.contractId, contractDustChunks.chunkId, contractDustChunks.ver],
                set: {
                  saveSeq: sql`excluded.save_seq`,
                  codec: sql`excluded.codec`,
                  rawSize: sql`excluded.raw_size`,
                  blobSize: sql`excluded.blob_size`,
                  checksum: sql`excluded.checksum`,
                  blob: sql`excluded.blob`,
                  savedAt: sql`excluded.saved_at`,
                },
              });
          }

          const [headerBytes] = await tx
            .select({ n: sql<number>`coalesce(sum(${contractSaves.blobSize}), 0)::int` })
            .from(contractSaves)
            .where(eq(contractSaves.contractId, input.owner.contractId));
          const [chunkBytes] = await tx
            .select({ n: sql<number>`coalesce(sum(${contractDustChunks.blobSize}), 0)::int` })
            .from(contractDustChunks)
            .where(eq(contractDustChunks.contractId, input.owner.contractId));
          const storedBytes = (headerBytes?.n ?? 0) + (chunkBytes?.n ?? 0);
          await tx
            .update(contracts)
            .set({
              lastPlayedAt: at,
              storedBytes,
              ...(gameDataVersion === "" ? {} : { gameDataVersion }),
            })
            .where(eq(contracts.id, input.owner.contractId));
          return { kind: "saved", generation, storedBytes };
        });
      } catch (error) {
        if (error instanceof LeaseLost) return { kind: "lease_lost" };
        throw error;
      }
    },

    async addEgress(day, bytesOut): Promise<void> {
      if (!DAY_RE.test(day)) throw new RangeError("day must be YYYY-MM-DD");
      const add = Math.max(0, Math.floor(Number.isFinite(bytesOut) ? bytesOut : 0));
      await db
        .insert(opsUsageDaily)
        .values({ day, bytesOut: add })
        .onConflictDoUpdate({
          target: opsUsageDaily.day,
          set: { bytesOut: sql`${opsUsageDaily.bytesOut} + excluded.bytes_out`, updatedAt: sql`now()` },
        });
    },

    async monthEgress(month): Promise<number> {
      if (!MONTH_RE.test(month)) throw new RangeError("month must be YYYY-MM");
      const [y, m] = month.split("-").map(Number) as [number, number];
      const next = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
      const [row] = await db
        .select({ n: sql<number>`coalesce(sum(${opsUsageDaily.bytesOut}), 0)::float8` })
        .from(opsUsageDaily)
        .where(and(sql`${opsUsageDaily.day} >= ${`${month}-01`}::date`, sql`${opsUsageDaily.day} < ${next}::date`));
      return Number(row?.n ?? 0);
    },
  };
}
