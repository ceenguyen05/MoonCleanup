// Archive restore admin against PGlite with the generated migrations applied (same setup as room-postgres.test.ts).
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEFAULT_MIGRATIONS_FOLDER, MIGRATIONS_TABLE } from "../migrate.ts";
import * as schema from "../schema/index.ts";
import { uuidv7 } from "../ids.ts";
import { parseRestoreArgs } from "../restore-archive-args.ts";
import { createPostgresRepository, type PgDb } from "./postgres.ts";
import { createRoomArchiveAdmin } from "./room-archive-admin.ts";
import { createPostgresRoomRepository } from "./room-postgres.ts";
import type { LeaseOwner } from "./room-types.ts";

const SCHEMA = "_a7";
const T0 = Date.parse("2026-11-16T12:00:00.000Z");
let pg: PGlite;
let db: PgDb;
let now = T0;
let counter = 7000;
const hex = (): string => (counter++).toString(16).padStart(64, "0");
const fill = (n: number, size = 64): Uint8Array => new Uint8Array(size).fill(n);
const lease = (contractId: string): LeaseOwner => ({ contractId, instance: "a", roomId: contractId });

beforeAll(async () => {
  pg = new PGlite();
  await pg.waitReady;
  await pg.exec(`create schema "${SCHEMA}"; set search_path to "${SCHEMA}"`);
  const orm = drizzle(pg, { schema });
  await migrate(orm, {
    migrationsFolder: DEFAULT_MIGRATIONS_FOLDER,
    migrationsSchema: SCHEMA,
    migrationsTable: MIGRATIONS_TABLE,
  });
  db = orm as unknown as PgDb;
}, 120_000);

afterAll(async () => {
  await pg.close();
});

async function setup() {
  await pg.exec("truncate table players cascade");
  now = T0;
  const moon = createPostgresRepository(db, { clock: () => new Date(now) });
  const playerId = uuidv7();
  await moon.createGuest({
    playerId,
    displayName: "Archivist",
    recoveryHash: hex(),
    token: { id: uuidv7(), hash: hex(), expiresAt: new Date(now + 86_400_000), familyId: uuidv7() },
  });
  const contractId = uuidv7();
  await moon.createContract({
    id: contractId,
    ownerPlayerId: playerId,
    name: "Archived Moon",
    shiftType: "private",
    maxPlayers: 4,
    gridM: 128,
    plotCount: 163842,
    seed: "1",
    inviteCode: `A${counter++}`,
    ownedQuota: 3,
  });
  const rooms = createPostgresRoomRepository(db, { clock: () => new Date(now), gameDataVersion: "1.3" });
  const admin = createRoomArchiveAdmin(db, { clock: () => new Date(now) });
  await rooms.acquireLease(lease(contractId));
  for (let i = 1; i <= 2; i++) {
    now = T0 + i * 30_000;
    await rooms.commitRoomCheckpoint({
      owner: lease(contractId),
      simTick: i,
      chunks: [
        { chunkId: 1, payload: fill(i) },
        { chunkId: 4, payload: fill(i + 5) },
      ],
      bakeHash: "ab".repeat(32),
      state: { walletLm: i },
    });
  }
  return { contractId, rooms, admin };
}

const liveRows = async (contractId: string) =>
  (
    await pg.query<{ h: number; c: number; bytes: number }>(
      `select (select count(*) from contract_saves where contract_id = $1)::int as h,
              (select count(*) from contract_dust_chunks where contract_id = $1)::int as c,
              (select stored_bytes from contracts where id = $1)::int as bytes`,
      [contractId],
    )
  ).rows[0]!;

describe("room save archive admin", () => {
  it("lists archives newest first with row and byte counts", async () => {
    const { contractId, rooms, admin } = await setup();
    now = T0 + 100_000;
    const first = await rooms.archiveRoomSave(lease(contractId), "bake_mismatch");
    await rooms.commitRoomCheckpoint({
      owner: lease(contractId),
      simTick: 1,
      chunks: [{ chunkId: 2, payload: fill(3) }],
    });
    now = T0 + 200_000;
    const second = await rooms.archiveRoomSave(lease(contractId), "bake_mismatch");
    const list = await admin.listArchives(contractId);
    expect(list.map((a) => a.archiveId)).toEqual([
      (second as { archiveId: string }).archiveId,
      (first as { archiveId: string }).archiveId,
    ]);
    expect(list[1]).toMatchObject({ archiveReason: "bake_mismatch", headerSlots: 2, generation: 2, chunkRows: 4 });
    expect(list[1]!.blobBytes).toBeGreaterThan(0);
    expect(list[1]!.archivedAt.getTime()).toBe(T0 + 100_000);
    expect(await admin.listArchives(uuidv7())).toEqual([]);
  });

  it("dry run is the default and writes nothing; apply restores verbatim and keeps the archive", async () => {
    const { contractId, rooms, admin } = await setup();
    const before = {
      headers: (await pg.query("select * from contract_saves where contract_id = $1 order by slot", [contractId])).rows,
      chunks: (
        await pg.query("select * from contract_dust_chunks where contract_id = $1 order by chunk_id, ver", [contractId])
      ).rows,
      bytes: (await liveRows(contractId)).bytes,
    };
    const archived = (await rooms.archiveRoomSave(lease(contractId), "bake_mismatch")) as { archiveId: string };
    await rooms.releaseLease(lease(contractId));
    expect(await liveRows(contractId)).toEqual({ h: 0, c: 0, bytes: 0 });

    const input = { contractId, archiveId: archived.archiveId };
    const dry = await admin.restoreArchive(input);
    expect(dry).toMatchObject({ kind: "dry_run", plan: { headerSlots: 2, chunkRows: 4, liveRows: 0 } });
    expect(await liveRows(contractId)).toEqual({ h: 0, c: 0, bytes: 0 });

    const done = await admin.restoreArchive({ ...input, apply: true });
    expect(done).toMatchObject({ kind: "restored", storedBytes: before.bytes });
    const after = {
      headers: (await pg.query("select * from contract_saves where contract_id = $1 order by slot", [contractId])).rows,
      chunks: (
        await pg.query("select * from contract_dust_chunks where contract_id = $1 order by chunk_id, ver", [contractId])
      ).rows,
    };
    expect(after.headers).toEqual(before.headers);
    expect(after.chunks).toEqual(before.chunks);
    expect((await liveRows(contractId)).bytes).toBe(before.bytes);
    const snapshot = await rooms.loadRoomSave(contractId);
    expect(snapshot).toMatchObject({ generation: 2, simTick: 2, state: { walletLm: 2 } });
    expect(snapshot!.chunks.map((c) => c.chunkId)).toEqual([1, 4]);
    expect((await admin.listArchives(contractId)).length).toBe(1); // nothing deleted
  });

  it("refuses unknown archives, other Contracts' archives, a live lease and a live save", async () => {
    const { contractId, rooms, admin } = await setup();
    const archived = (await rooms.archiveRoomSave(lease(contractId), "bake_mismatch")) as { archiveId: string };
    const input = { contractId, archiveId: archived.archiveId, apply: true };

    // the room still holds a live lease (re-claiming renews it against the test clock)
    await rooms.acquireLease(lease(contractId));
    expect(await admin.restoreArchive(input)).toMatchObject({ kind: "refused", reason: "lease_active" });
    await rooms.releaseLease(lease(contractId));

    expect(await admin.restoreArchive({ ...input, archiveId: uuidv7() })).toMatchObject({
      kind: "refused",
      reason: "archive_not_found",
    });
    expect(await admin.restoreArchive({ ...input, contractId: uuidv7() })).toMatchObject({
      kind: "refused",
      reason: "contract_missing",
    });

    // a fresh save exists: refuse, even with --apply, unless replaceLive
    await rooms.acquireLease(lease(contractId));
    await rooms.commitRoomCheckpoint({
      owner: lease(contractId),
      simTick: 1,
      chunks: [{ chunkId: 9, payload: fill(9) }],
    });
    await rooms.releaseLease(lease(contractId));
    expect(await admin.restoreArchive(input)).toMatchObject({ kind: "refused", reason: "live_save_present" });
    expect((await liveRows(contractId)).h).toBe(1);

    await pg.query("update contracts set status = 'deleted' where id = $1", [contractId]);
    expect(await admin.restoreArchive({ ...input, replaceLive: true })).toMatchObject({
      kind: "refused",
      reason: "contract_deleted",
    });
  });

  it("replaceLive archives the current live save as pre_restore in the same transaction", async () => {
    const { contractId, rooms, admin } = await setup();
    const archived = (await rooms.archiveRoomSave(lease(contractId), "bake_mismatch")) as { archiveId: string };
    await rooms.commitRoomCheckpoint({
      owner: lease(contractId),
      simTick: 1,
      chunks: [{ chunkId: 9, payload: fill(9) }],
    });
    await rooms.releaseLease(lease(contractId));

    const result = await admin.restoreArchive({
      contractId,
      archiveId: archived.archiveId,
      apply: true,
      replaceLive: true,
    });
    expect(result).toMatchObject({ kind: "restored", plan: { liveRows: 2, replaceLive: true } });
    const snapshot = await rooms.loadRoomSave(contractId);
    expect(snapshot!.chunks.map((c) => c.chunkId)).toEqual([1, 4]); // the old world is back, chunk 9 is gone
    const list = await admin.listArchives(contractId);
    expect(list.map((a) => a.archiveReason).sort()).toEqual(["bake_mismatch", "pre_restore"]);
    const pre = list.find((a) => a.archiveReason === "pre_restore")!;
    expect(pre).toMatchObject({ headerSlots: 1, chunkRows: 1 });
  });

  it("a restore can be repeated by archiving again (round trip keeps every archive)", async () => {
    const { contractId, rooms, admin } = await setup();
    const a1 = (await rooms.archiveRoomSave(lease(contractId), "bake_mismatch")) as { archiveId: string };
    await rooms.releaseLease(lease(contractId));
    await admin.restoreArchive({ contractId, archiveId: a1.archiveId, apply: true });
    await rooms.acquireLease(lease(contractId));
    const a2 = (await rooms.archiveRoomSave(lease(contractId), "bake_mismatch")) as { archiveId: string };
    await rooms.releaseLease(lease(contractId));
    expect(a2.archiveId).not.toBe(a1.archiveId);
    await admin.restoreArchive({ contractId, archiveId: a2.archiveId, apply: true });
    expect((await rooms.loadRoomSave(contractId))!.generation).toBe(2);
    expect((await admin.listArchives(contractId)).length).toBe(2);
  });
});

describe("restore CLI argument parsing", () => {
  const C = "0190c1a0-0000-7000-8000-000000000001";
  const A = "0190c1a0-0000-7000-8000-000000000002";
  it("defaults to a dry run and requires a matching --confirm for --apply", () => {
    expect(parseRestoreArgs(["restore", "--contract", C, "--archive", A])).toEqual({
      kind: "restore",
      contractId: C,
      archiveId: A,
      apply: false,
      replaceLive: false,
    });
    expect(parseRestoreArgs(["restore", "--contract", C, "--archive", A, "--apply"]).kind).toBe("invalid");
    expect(parseRestoreArgs(["restore", "--contract", C, "--archive", A, "--apply", "--confirm", C]).kind).toBe(
      "invalid",
    );
    expect(
      parseRestoreArgs(["restore", "--contract", C, "--archive", A, "--replace-live", "--apply", "--confirm", A]),
    ).toMatchObject({ kind: "restore", apply: true, replaceLive: true });
  });
  it("rejects bad ids, unknown flags and a stray --confirm; list and help work", () => {
    expect(parseRestoreArgs(["restore", "--contract", "nope", "--archive", A]).kind).toBe("invalid");
    expect(parseRestoreArgs(["restore", "--contract", C, "--archive", A, "--wat"]).kind).toBe("invalid");
    expect(parseRestoreArgs(["restore", "--contract", C, "--archive", A, "--confirm", A]).kind).toBe("invalid");
    expect(parseRestoreArgs(["list", "--contract", C])).toEqual({ kind: "list", contractId: C });
    expect(parseRestoreArgs(["list", "--contract", C, "--apply"]).kind).toBe("invalid");
    expect(parseRestoreArgs([])).toEqual({ kind: "help" });
    expect(parseRestoreArgs(["drop"]).kind).toBe("invalid");
  });
});
