// Admin surface over the room save archives (migration 0004): list what `archiveRoomSave` moved aside and copy one archive
// back to the live tables. NOT part of the game server's request path; only the restore CLI (restore-archive-cli.ts)
// uses it. Dry-run is the default: nothing is written unless `apply` is true.
//
// Restore is the reverse copy of archiveRoomSave: header slots and dust chunk rows go back verbatim in ONE transaction,
// under a row lock on the Contract. The archive rows are KEPT (nothing is ever deleted), so a restore can be repeated or
// undone by archiving again. Refusals (nothing written): unknown Contract or archive, a deleted Contract, a live room
// holding the lease, or live save rows already present (unless `replaceLive`, which first archives them under reason
// `pre_restore` in the same transaction). Runs under Node type stripping: erasable syntax, sibling imports only.

import { and, desc, eq, sql } from "drizzle-orm";
import { uuidv7 } from "../ids.ts";
import {
  contractDustChunkArchives,
  contractDustChunks,
  contractSaveArchives,
  contractSaves,
  contracts,
} from "../schema/index.ts";
import type { PgDb } from "./postgres.ts";

/** Rows per INSERT (11 bound parameters each: far below the 65535 limit). */
const INSERT_BATCH = 200;
export const PRE_RESTORE_REASON = "pre_restore";

export interface RoomArchiveSummary {
  readonly archiveId: string;
  readonly archivedAt: Date;
  readonly archiveReason: string;
  /** Header slots archived (1 or 2). */
  readonly headerSlots: number;
  /** Highest `save_seq` of the archived headers. */
  readonly generation: number;
  readonly chunkRows: number;
  /** Sum of `blob_size` over headers and chunks (what a restore adds back to the live save). */
  readonly blobBytes: number;
}

export type RestoreArchiveResult =
  | { readonly kind: "dry_run"; readonly plan: RestorePlan }
  | { readonly kind: "restored"; readonly plan: RestorePlan; readonly storedBytes: number }
  | {
      readonly kind: "refused";
      readonly reason:
        "contract_missing" | "contract_deleted" | "archive_not_found" | "lease_active" | "live_save_present";
      readonly plan?: RestorePlan;
    };

export interface RestorePlan {
  readonly archiveId: string;
  readonly headerSlots: number;
  readonly chunkRows: number;
  readonly blobBytes: number;
  /** Live rows (headers + chunks) that exist now; with `replaceLive` they are archived first. */
  readonly liveRows: number;
  readonly replaceLive: boolean;
}

export interface RestoreArchiveInput {
  readonly contractId: string;
  readonly archiveId: string;
  /** Default false: dry run. */
  readonly apply?: boolean;
  /** Default false: refuse when live save rows exist. */
  readonly replaceLive?: boolean;
}

export interface RoomArchiveAdminOptions {
  /** Test seam only; production uses the database clock. */
  readonly clock?: () => Date;
}

export interface RoomArchiveAdmin {
  listArchives(contractId: string): Promise<readonly RoomArchiveSummary[]>;
  restoreArchive(input: RestoreArchiveInput): Promise<RestoreArchiveResult>;
}

export function createRoomArchiveAdmin(db: PgDb, options: RoomArchiveAdminOptions = {}): RoomArchiveAdmin {
  const clock = options.clock;
  const nowSql = () => (clock === undefined ? sql`now()` : sql`${clock().toISOString()}::timestamptz`);

  return {
    async listArchives(contractId) {
      const headers = await db
        .select({
          archiveId: contractSaveArchives.archiveId,
          archivedAt: sql<Date>`max(${contractSaveArchives.archivedAt})`.mapWith(contractSaveArchives.archivedAt),
          archiveReason: sql<string>`max(${contractSaveArchives.archiveReason})`,
          headerSlots: sql<number>`count(*)::int`,
          generation: sql<number>`max(${contractSaveArchives.saveSeq})::float8`,
          blobBytes: sql<number>`coalesce(sum(${contractSaveArchives.blobSize}), 0)::float8`,
        })
        .from(contractSaveArchives)
        .where(eq(contractSaveArchives.contractId, contractId))
        .groupBy(contractSaveArchives.archiveId)
        .orderBy(desc(sql`max(${contractSaveArchives.archivedAt})`));
      const chunks = await db
        .select({
          archiveId: contractDustChunkArchives.archiveId,
          chunkRows: sql<number>`count(*)::int`,
          blobBytes: sql<number>`coalesce(sum(${contractDustChunkArchives.blobSize}), 0)::float8`,
        })
        .from(contractDustChunkArchives)
        .where(eq(contractDustChunkArchives.contractId, contractId))
        .groupBy(contractDustChunkArchives.archiveId);
      const byArchive = new Map(chunks.map((c) => [c.archiveId, c]));
      return headers.map((h) => ({
        archiveId: h.archiveId,
        archivedAt: new Date(h.archivedAt),
        archiveReason: h.archiveReason,
        headerSlots: h.headerSlots,
        generation: Number(h.generation),
        chunkRows: byArchive.get(h.archiveId)?.chunkRows ?? 0,
        blobBytes: Number(h.blobBytes) + Number(byArchive.get(h.archiveId)?.blobBytes ?? 0),
      }));
    },

    async restoreArchive(input): Promise<RestoreArchiveResult> {
      const apply = input.apply === true;
      const replaceLive = input.replaceLive === true;
      return await db.transaction(async (tx): Promise<RestoreArchiveResult> => {
        const [contract] = await tx
          .select({
            status: contracts.status,
            leased: sql<boolean>`${contracts.leaseInstance} is not null and ${contracts.leaseExpiresAt} > ${nowSql()}`,
          })
          .from(contracts)
          .where(eq(contracts.id, input.contractId))
          .for("update");
        if (contract === undefined) return { kind: "refused", reason: "contract_missing" };
        if (contract.status === "deleted") return { kind: "refused", reason: "contract_deleted" };

        const headers = await tx
          .select()
          .from(contractSaveArchives)
          .where(
            and(
              eq(contractSaveArchives.contractId, input.contractId),
              eq(contractSaveArchives.archiveId, input.archiveId),
            ),
          );
        if (headers.length === 0) return { kind: "refused", reason: "archive_not_found" };
        const chunks = await tx
          .select()
          .from(contractDustChunkArchives)
          .where(
            and(
              eq(contractDustChunkArchives.contractId, input.contractId),
              eq(contractDustChunkArchives.archiveId, input.archiveId),
            ),
          );
        const liveHeaders = await tx.select().from(contractSaves).where(eq(contractSaves.contractId, input.contractId));
        const liveChunks = await tx
          .select()
          .from(contractDustChunks)
          .where(eq(contractDustChunks.contractId, input.contractId));

        const plan: RestorePlan = {
          archiveId: input.archiveId,
          headerSlots: headers.length,
          chunkRows: chunks.length,
          blobBytes: headers.reduce((n, h) => n + h.blobSize, 0) + chunks.reduce((n, c) => n + c.blobSize, 0),
          liveRows: liveHeaders.length + liveChunks.length,
          replaceLive,
        };
        // A live room owns the rows and would overwrite or contradict the copy: only restore while the Contract is idle.
        if (contract.leased) return { kind: "refused", reason: "lease_active", plan };
        if (plan.liveRows > 0 && !replaceLive) return { kind: "refused", reason: "live_save_present", plan };
        if (!apply) return { kind: "dry_run", plan };

        if (plan.liveRows > 0) {
          // Keep the replaced world recoverable: archive it verbatim first (same shape as archiveRoomSave).
          const preId = uuidv7();
          const at = new Date(
            clock === undefined
              ? Number(
                  (
                    await tx
                      .select({ ms: sql<number>`floor(extract(epoch from now()) * 1000)::float8` })
                      .from(sql`(select 1) as t`)
                  )[0]?.ms ?? Date.now(),
                )
              : clock().getTime(),
          );
          if (liveHeaders.length > 0) {
            await tx
              .insert(contractSaveArchives)
              .values(
                liveHeaders.map((h) => ({ ...h, archiveId: preId, archivedAt: at, archiveReason: PRE_RESTORE_REASON })),
              );
          }
          for (let i = 0; i < liveChunks.length; i += INSERT_BATCH) {
            await tx
              .insert(contractDustChunkArchives)
              .values(liveChunks.slice(i, i + INSERT_BATCH).map((c) => ({ ...c, archiveId: preId })));
          }
          await tx.delete(contractDustChunks).where(eq(contractDustChunks.contractId, input.contractId));
          await tx.delete(contractSaves).where(eq(contractSaves.contractId, input.contractId));
        }

        // Explicit column lists (not a spread): a column added to the archive tables later must not leak into live rows.
        await tx.insert(contractSaves).values(
          headers.map((h) => ({
            contractId: h.contractId,
            slot: h.slot,
            saveFormatVersion: h.saveFormatVersion,
            gameDataVersion: h.gameDataVersion,
            codec: h.codec,
            rawSize: h.rawSize,
            blobSize: h.blobSize,
            checksum: h.checksum,
            blob: h.blob,
            saveSeq: h.saveSeq,
            simTick: h.simTick,
            savedAt: h.savedAt,
            savedBy: h.savedBy,
            parentSeq: h.parentSeq,
            originKind: h.originKind,
          })),
        );
        for (let i = 0; i < chunks.length; i += INSERT_BATCH) {
          await tx.insert(contractDustChunks).values(
            chunks.slice(i, i + INSERT_BATCH).map((c) => ({
              contractId: c.contractId,
              chunkId: c.chunkId,
              ver: c.ver,
              saveSeq: c.saveSeq,
              codec: c.codec,
              rawSize: c.rawSize,
              blobSize: c.blobSize,
              checksum: c.checksum,
              blob: c.blob,
              savedAt: c.savedAt,
            })),
          );
        }
        const storedBytes = plan.blobBytes;
        await tx.update(contracts).set({ storedBytes }).where(eq(contracts.id, input.contractId));
        return { kind: "restored", plan, storedBytes };
      });
    },
  };
}
