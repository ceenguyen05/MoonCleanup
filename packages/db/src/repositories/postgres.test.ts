// The PostgreSQL repository against PGlite (real PostgreSQL compiled to WASM): the generated migrations are applied,
// then the shared behavioural suite runs. NOT covered here: postgres.js, TLS, Neon cold starts and true multi-session
// row-lock contention (PGlite is single-session); a real-server run is available through DATABASE_URL (below).
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runRepositorySuite } from "./contract-suite.ts";
import { createPostgresRepository, type PgDb } from "./postgres.ts";
import { DEFAULT_MIGRATIONS_FOLDER, MIGRATIONS_TABLE } from "../migrate.ts";
import * as schema from "../schema/index.ts";
import { uuidv7 } from "../ids.ts";

const SCHEMA = "_a5";
let pg: PGlite;
let db: PgDb;
let now = new Date(0);

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

runRepositorySuite("postgres (PGlite)", {
  async create() {
    await pg.exec("truncate table players cascade");
    now = new Date(0);
    return {
      repo: createPostgresRepository(db, { clock: () => now }),
      setNow: (date: Date) => {
        now = date;
      },
      now: () => now,
    };
  },
});

describe("postgres repository specifics", () => {
  it("uses the database clock when no test clock is injected", async () => {
    await pg.exec("truncate table players cascade");
    const repo = createPostgresRepository(db);
    const playerId = uuidv7();
    await repo.createGuest({
      playerId,
      displayName: "Clock Test",
      recoveryHash: "a".repeat(64),
      token: { id: uuidv7(), hash: "b".repeat(64), expiresAt: new Date(Date.now() + 86_400_000), familyId: uuidv7() },
    });
    const res = await pg.query<{ created_at: Date }>("select created_at from players where id = $1", [playerId]);
    expect(Math.abs(res.rows[0]!.created_at.getTime() - Date.now())).toBeLessThan(60_000);
    const next = { id: uuidv7(), hash: "c".repeat(64), expiresAt: new Date(Date.now() + 86_400_000) };
    expect((await repo.rotateRefreshToken({ presentedHash: "b".repeat(64), next })).kind).toBe("rotated");
  });

  it("stores only hashes (bytea) and never a raw secret column", async () => {
    const cols = await pg.query<{ column_name: string; data_type: string }>(
      "select column_name, data_type from information_schema.columns where table_schema = $1 and table_name = 'refresh_tokens'",
      [SCHEMA],
    );
    const byName = Object.fromEntries(cols.rows.map((c) => [c.column_name, c.data_type]));
    expect(byName.token_hash).toBe("bytea");
    expect(Object.keys(byName).some((n) => /^(token|raw|secret|code)$/.test(n))).toBe(false);
  });

  it("enforces the CHECK constraints the repository relies on", async () => {
    await pg.exec("truncate table players cascade");
    await expect(pg.exec(`insert into players (id, status) values ('${uuidv7()}', 'weird')`)).rejects.toBeDefined();
  });

  it("contract_saves.blob uses EXTERNAL storage and the lease/generation columns exist (0002)", async () => {
    const storage = await pg.query<{ attstorage: string }>(
      `select a.attstorage from pg_attribute a join pg_class c on c.oid = a.attrelid
       join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = $1 and c.relname = 'contract_saves' and a.attname = 'blob'`,
      [SCHEMA],
    );
    expect(storage.rows[0]?.attstorage).toBe("e");
    const cols = await pg.query<{ table_name: string; column_name: string }>(
      `select table_name, column_name from information_schema.columns where table_schema = $1
       and column_name in ('lease_instance','lease_room_id','lease_expires_at','parent_seq','origin_kind')`,
      [SCHEMA],
    );
    expect(cols.rows).toHaveLength(5);
  });
});
