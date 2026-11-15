// Migration tests (M0-W1-T03). Two suites:
// 1. PGlite (real PostgreSQL compiled to WASM, in-process, no server): always runs. It applies the committed SQL
//    through drizzle's pglite migrator into a throwaway schema; it does not exercise postgres.js/TLS/retry, only the
//    SQL and the journal behaviour.
// 2. A real server: runs only when DATABASE_URL points at a LOCAL or throwaway test database; it creates and drops the
//    schema `_a3` and touches nothing else. Without DATABASE_URL it is skipped, not failed.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { migrate as migratePglite } from "drizzle-orm/pglite/migrator";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildClientOptions } from "./connection.ts";
import { DEFAULT_MIGRATIONS_FOLDER, MIGRATIONS_TABLE, runMigrations } from "./migrate.ts";

const url = process.env.DATABASE_URL;
const TEST_SCHEMA = "_a3";
const MIGRATION_COUNT = 4;
const EXPECTED_TABLES = [
  "__drizzle_migrations",
  "contract_dust_chunks",
  "contract_members",
  "contract_saves",
  "contracts",
  "identities",
  "ops_usage_daily",
  "players",
  "profiles",
  "refresh_tokens",
];

describe.skipIf(url === undefined || url === "")("migrations against a real PostgreSQL schema", () => {
  const config = { url: url ?? "", caCert: process.env.DATABASE_CA_CERT || undefined, schema: TEST_SCHEMA, poolMax: 1 };
  const sql = postgres(config.url, buildClientOptions(config));

  beforeAll(async () => {
    await sql`drop schema if exists ${sql(TEST_SCHEMA)} cascade`;
  });
  afterAll(async () => {
    await sql`drop schema if exists ${sql(TEST_SCHEMA)} cascade`;
    await sql.end({ timeout: 5 });
  });

  it("creates the schema and ops_usage_daily from an empty database, and a second run is a no-op", async () => {
    await runMigrations(config);
    await runMigrations(config);
    const tables = await sql<{ table_name: string }[]>`
      select table_name from information_schema.tables where table_schema = ${TEST_SCHEMA} order by table_name`;
    expect(tables.map((t) => t.table_name)).toEqual(EXPECTED_TABLES);
    const journal = await sql<
      { n: string }[]
    >`select count(*)::text as n from ${sql(TEST_SCHEMA)}."__drizzle_migrations"`;
    expect(journal[0]?.n).toBe(String(MIGRATION_COUNT));
  });

  it("accepts an upsert row with defaults", async () => {
    await sql`insert into ${sql(TEST_SCHEMA)}.ops_usage_daily (day) values ('2026-01-01') on conflict (day) do nothing`;
    const rows = await sql<{ bytes_out: string }[]>`select bytes_out::text from ${sql(TEST_SCHEMA)}.ops_usage_daily`;
    expect(rows[0]?.bytes_out).toBe("0");
  });
});

describe("migrations against PGlite (real PostgreSQL in WASM)", () => {
  const schema = "_a3";
  let db: PGlite;

  beforeAll(async () => {
    db = new PGlite();
    await db.waitReady;
  }, 60_000); // WASM boot takes a few seconds on a loaded laptop
  afterAll(async () => {
    await db.close();
  });

  async function tables(): Promise<string[]> {
    const result = await db.query<{ table_name: string }>(
      "select table_name from information_schema.tables where table_schema = $1 order by table_name",
      [schema],
    );
    return result.rows.map((row) => row.table_name);
  }

  it("creates the schema, applies every migration from an empty database, and a second run is a no-op", async () => {
    await db.exec(`create schema if not exists "${schema}"; set search_path to "${schema}"`);
    const options = {
      migrationsFolder: DEFAULT_MIGRATIONS_FOLDER,
      migrationsSchema: schema,
      migrationsTable: MIGRATIONS_TABLE,
    };
    await migratePglite(drizzlePglite(db), options);
    await migratePglite(drizzlePglite(db), options);
    expect(await tables()).toEqual(EXPECTED_TABLES);
    const journal = await db.query<{ n: string }>(`select count(*)::text as n from "${schema}"."${MIGRATIONS_TABLE}"`);
    expect(journal.rows[0]?.n).toBe(String(MIGRATION_COUNT));
  });

  it("applies column defaults and the primary-key upsert", async () => {
    await db.exec(`insert into ops_usage_daily (day) values ('2026-01-01') on conflict (day) do nothing`);
    await db.exec(`insert into ops_usage_daily (day) values ('2026-01-01') on conflict (day) do nothing`);
    const rows = await db.query<{ bytes_out: string; contracts_by_tier: unknown }>(
      "select bytes_out::text, contracts_by_tier from ops_usage_daily",
    );
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]?.bytes_out).toBe("0");
    expect(rows.rows[0]?.contracts_by_tier).toEqual({});
  });

  it("rolls the migration SQL back inside a transaction, and dropping the schema removes everything", async () => {
    const sqlText = readFileSync(join(DEFAULT_MIGRATIONS_FOLDER, "0000_ops_usage_daily.sql"), "utf8");
    await db.exec(`create schema "_rollback"`);
    const rolledBack = await db.query<{ exists: boolean }>(
      "select to_regclass('_rollback.ops_usage_daily') is not null as exists",
    );
    expect(rolledBack.rows[0]?.exists).toBe(false);
    await db.transaction(async (tx) => {
      await tx.exec(`set local search_path to "_rollback"`);
      await tx.exec(sqlText);
      const inside = await tx.query<{ exists: boolean }>(
        "select to_regclass('_rollback.ops_usage_daily') is not null as exists",
      );
      expect(inside.rows[0]?.exists).toBe(true);
      tx.rollback();
    });
    const after = await db.query<{ exists: boolean }>(
      "select to_regclass('_rollback.ops_usage_daily') is not null as exists",
    );
    expect(after.rows[0]?.exists).toBe(false);
    await db.exec(`drop schema "${schema}" cascade; drop schema "_rollback" cascade`);
    expect(await tables()).toEqual([]);
  });
});

describe("migration files", () => {
  const files = readdirSync(DEFAULT_MIGRATIONS_FOLDER).filter((f) => f.endsWith(".sql"));

  it("are numbered sequentially and match the journal", () => {
    expect(files.map((f) => f.slice(0, 4))).toEqual(files.map((_, i) => String(i).padStart(4, "0")));
    const journal = JSON.parse(readFileSync(join(DEFAULT_MIGRATIONS_FOLDER, "meta", "_journal.json"), "utf8")) as {
      entries: { tag: string }[];
    };
    expect(journal.entries.map((e) => `${e.tag}.sql`)).toEqual(files);
    expect(files).toHaveLength(MIGRATION_COUNT);
  });

  it("never hard-code the public schema (they must follow search_path)", () => {
    for (const file of files) {
      const text = readFileSync(join(DEFAULT_MIGRATIONS_FOLDER, file), "utf8");
      const code = text
        .split(/\r?\n/)
        .filter((line) => !line.startsWith("--"))
        .join(" ");
      expect(code, file).not.toMatch(/"public"|[^a-z_]public\./);
    }
  });
});

describe("migration retry through a cold start", () => {
  it("logs the wake line, backs off and retries an unreachable database, then fails after the last attempt", async () => {
    const lines: string[] = [];
    const sleeps: number[] = [];
    // Port 1 on loopback refuses connections immediately (stands in for a compute that is still waking).
    const config = { url: "postgres://u:p@127.0.0.1:1/d", schema: "_a3", poolMax: 1 };
    await expect(
      runMigrations(config, {
        maxAttempts: 3,
        sleep: (ms) => {
          sleeps.push(ms);
          return Promise.resolve();
        },
        log: (line) => lines.push(line),
      }),
    ).rejects.toBeDefined();
    expect(sleeps).toEqual([1000, 2000]);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain("[db] waking database…");
    expect(lines.join("\n")).not.toContain("127.0.0.1");
  }, 30_000);
});
