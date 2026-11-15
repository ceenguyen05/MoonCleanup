// The PostgreSQL room repository against PGlite (real PostgreSQL compiled to WASM) with the generated migrations applied,
// running the same conformance suite as the memory repository. NOT covered: postgres.js, TLS, Neon cold starts and true
// multi-session row-lock contention (PGlite is single-session).
import { crc32, deflateSync } from "node:zlib";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEFAULT_MIGRATIONS_FOLDER, MIGRATIONS_TABLE } from "../migrate.ts";
import * as schema from "../schema/index.ts";
import { uuidv7 } from "../ids.ts";
import { createPostgresRepository, type PgDb } from "./postgres.ts";
import { createPostgresRoomRepository } from "./room-postgres.ts";
import { RoomSaveCorruptError, type LeaseOwner } from "./room-types.ts";
import { runRoomSuite } from "./room-suite.ts";

const SCHEMA = "_a6";
let pg: PGlite;
let db: PgDb;
let now = 0;
let counter = 9000;
const hex = (): string => (counter++).toString(16).padStart(64, "0");

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

async function newContract(): Promise<string> {
  const moon = createPostgresRepository(db, { clock: () => new Date(now) });
  const playerId = uuidv7();
  await moon.createGuest({
    playerId,
    displayName: "Room Saver",
    recoveryHash: hex(),
    token: { id: uuidv7(), hash: hex(), expiresAt: new Date(now + 86_400_000), familyId: uuidv7() },
  });
  const id = uuidv7();
  await moon.createContract({
    id,
    ownerPlayerId: playerId,
    name: "Room Moon",
    shiftType: "private",
    maxPlayers: 4,
    gridM: 128,
    plotCount: 163842,
    seed: "1",
    inviteCode: `R${counter++}`,
    ownedQuota: 3,
  });
  return id;
}

const harness = async () => {
  await pg.exec("truncate table players cascade; truncate table ops_usage_daily");
  now = 0;
  return {
    repo: createPostgresRoomRepository(db, { clock: () => new Date(now), gameDataVersion: "1.3" }),
    setNow: (ms: number) => {
      now = ms;
    },
    now: () => now,
    newContract,
  };
};

runRoomSuite("postgres (PGlite)", { create: harness });

describe("postgres room repository specifics", () => {
  const T0 = Date.parse("2026-11-14T12:00:00.000Z");
  const lease = (contractId: string): LeaseOwner => ({ contractId, instance: "a", roomId: contractId });
  const fill = (n: number, size = 32): Uint8Array => new Uint8Array(size).fill(n);

  it("mirrors stored_bytes and last_played_at on the Contract and uses the older A/B header slot", async () => {
    const h = await harness();
    h.setNow(T0);
    const contractId = await newContract();
    await h.repo.acquireLease(lease(contractId));
    for (let i = 1; i <= 3; i++) {
      h.setNow(T0 + i * 30_000);
      await h.repo.commitRoomCheckpoint({
        owner: lease(contractId),
        simTick: i,
        chunks: [{ chunkId: 1, payload: fill(i, 512) }],
      });
    }
    const slots = await pg.query<{
      slot: string;
      save_seq: number;
      origin_kind: string;
      saved_by: string;
      codec: string;
    }>(
      "select slot, save_seq::int as save_seq, origin_kind, saved_by, codec from contract_saves where contract_id = $1 order by slot",
      [contractId],
    );
    expect(slots.rows).toEqual([
      { slot: "A", save_seq: 3, origin_kind: "room", saved_by: "a", codec: "room-v0" },
      { slot: "B", save_seq: 2, origin_kind: "room", saved_by: "a", codec: "room-v0" },
    ]);
    const chunks = await pg.query<{ ver: number; save_seq: number }>(
      "select ver, save_seq::int as save_seq from contract_dust_chunks where contract_id = $1 order by ver",
      [contractId],
    );
    expect(chunks.rows).toEqual([
      { ver: 0, save_seq: 3 },
      { ver: 1, save_seq: 2 },
    ]);
    const c = await pg.query<{ stored_bytes: number; last_played_at: Date; game_data_version: string }>(
      "select stored_bytes, last_played_at, game_data_version from contracts where id = $1",
      [contractId],
    );
    expect(c.rows[0]!.stored_bytes).toBeGreaterThan(0);
    expect(c.rows[0]!.last_played_at.getTime()).toBe(T0 + 90_000);
    expect(c.rows[0]!.game_data_version).toBe("1.3");
  });

  it("ignores chunk versions newer than the header and falls back to the older valid version on bit rot", async () => {
    const h = await harness();
    h.setNow(T0);
    const contractId = await newContract();
    await h.repo.acquireLease(lease(contractId));
    await h.repo.commitRoomCheckpoint({
      owner: lease(contractId),
      simTick: 1,
      chunks: [{ chunkId: 5, payload: fill(1) }],
    });
    await h.repo.commitRoomCheckpoint({
      owner: lease(contractId),
      simTick: 2,
      chunks: [{ chunkId: 5, payload: fill(2) }],
    });
    // Bit rot in the newest version: the older one (save_seq 1 <= header 2) is used.
    await pg.query("update contract_dust_chunks set blob = $2 where contract_id = $1 and save_seq = 2", [
      contractId,
      Buffer.from([0, 0]),
    ]);
    const snapshot = await h.repo.loadRoomSave(contractId);
    expect(Array.from(snapshot!.chunks[0]!.payload)).toEqual(Array.from(fill(1)));
    // A version written by a transaction whose header never validated (save_seq 3 > header 2) is ignored.
    const z = deflateSync(fill(9));
    await pg.query(
      "insert into contract_dust_chunks (contract_id, chunk_id, ver, save_seq, codec, raw_size, blob_size, checksum, blob) values ($1, 6, 0, 3, 'deflate', 32, $2, $3, $4)",
      [contractId, z.byteLength, crc32(fill(9)) | 0, z],
    );
    expect((await h.repo.loadRoomSave(contractId))!.chunks.map((c) => c.chunkId)).toEqual([5]);
  });

  it("rejects a save whose every qualifying chunk version is corrupt, and a corrupt room header", async () => {
    const h = await harness();
    h.setNow(T0);
    const contractId = await newContract();
    await h.repo.acquireLease(lease(contractId));
    await h.repo.commitRoomCheckpoint({
      owner: lease(contractId),
      simTick: 1,
      chunks: [{ chunkId: 5, payload: fill(1) }],
      bakeHash: "cd".repeat(32),
    });
    await pg.query("update contract_dust_chunks set checksum = checksum + 1 where contract_id = $1", [contractId]);
    await expect(h.repo.loadRoomSave(contractId)).rejects.toBeInstanceOf(RoomSaveCorruptError);
    await pg.exec("truncate table contract_dust_chunks");
    await pg.query("update contract_saves set checksum = checksum + 1 where contract_id = $1", [contractId]);
    await expect(h.repo.loadRoomSave(contractId)).rejects.toBeInstanceOf(RoomSaveCorruptError);
  });

  it("refuses leases on a deleted Contract and on one that does not exist", async () => {
    const h = await harness();
    h.setNow(T0);
    const contractId = await newContract();
    await pg.query("update contracts set status = 'deleted' where id = $1", [contractId]);
    expect(await h.repo.acquireLease(lease(contractId))).toBe("busy");
    const ghost = uuidv7();
    expect(await h.repo.acquireLease(lease(ghost))).toBe("busy");
    expect((await h.repo.commitRoomCheckpoint({ owner: lease(ghost), simTick: 1, chunks: [] })).kind).toBe(
      "lease_lost",
    );
  });

  it("validates inputs and rolls a failed checkpoint back completely", async () => {
    const h = await harness();
    const contractId = await newContract();
    await h.repo.acquireLease(lease(contractId));
    await expect(
      h.repo.commitRoomCheckpoint({ owner: lease(contractId), simTick: 1, chunks: [], bakeHash: "XYZ" }),
    ).rejects.toBeInstanceOf(RangeError);
    await expect(
      h.repo.commitRoomCheckpoint({
        owner: lease(contractId),
        simTick: 1,
        chunks: [{ chunkId: 641, payload: fill(4, 4) }],
      }),
    ).rejects.toBeInstanceOf(RangeError);
    await expect(h.repo.addEgress("11/03/2026", 1)).rejects.toBeInstanceOf(RangeError);
    expect(await h.repo.loadRoomSave(contractId)).toBeNull(); // the header insert was rolled back with the failed chunk
  });

  it("uses the database clock when no test clock is injected", async () => {
    await pg.exec("truncate table players cascade");
    const real = createPostgresRoomRepository(db);
    const contractId = await newContract();
    expect(await real.acquireLease(lease(contractId))).toBe("acquired");
    expect(await real.acquireLease({ ...lease(contractId), instance: "b" })).toBe("busy");
    const row = await pg.query<{ lease_expires_at: Date }>("select lease_expires_at from contracts where id = $1", [
      contractId,
    ]);
    const ahead = row.rows[0]!.lease_expires_at.getTime() - Date.now();
    expect(ahead).toBeGreaterThan(30_000);
    expect(ahead).toBeLessThan(36_000);
    await real.releaseLease(lease(contractId));
  });
});
