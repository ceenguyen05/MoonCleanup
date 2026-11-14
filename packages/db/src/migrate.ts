// Programmatic migrator (data-model.md section 8). The Render build command runs `pnpm --filter @moon-cleanup/db run
// migrate`, which executes migrate-cli.ts; the drizzle-kit CLI is deliberately not used because only this path sets
// the session limits below and the target schema.
//
// Behaviour:
// - Creates the target schema (DB_SCHEMA) if missing, then applies pending migrations from ./migrations with the
//   connection search_path set to that schema, so the unqualified generated SQL lands inside it.
// - The migration journal table lives in the same schema, so `prod` and `staging` never share bookkeeping.
// - lock_timeout 5 s and statement_timeout 60 s protect the live instance from long locks.
// - A sleeping database (Neon scale-to-zero wakes in 1-5 s; each connect waits up to 15 s) is retried with backoff
//   (1 s -> 30 s) for up to `maxAttempts` tries (default 12, ~4 min), logging `[db] waking database…`.
// - Migrations must use the DIRECT connection string (not the `-pooler` host): they need a session and search_path.
// - Zero pending migrations is success.

import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { fileURLToPath } from "node:url";
import { retryWithBackoff } from "./backoff.ts";
import { buildClientOptions } from "./connection.ts";
import { SAFE_SCHEMA_RE, type DbConfig } from "./config.ts";
import { errorCodeForLog, isUnreachableError } from "./errors.ts";

export const DEFAULT_MIGRATIONS_FOLDER = fileURLToPath(new URL("../migrations", import.meta.url));
export const MIGRATIONS_TABLE = "__drizzle_migrations";

export interface RunMigrationsOptions {
  readonly migrationsFolder?: string;
  readonly maxAttempts?: number;
  readonly sleep?: (ms: number) => Promise<void>;
  /** Progress lines (no secrets are ever passed). */
  readonly log?: (line: string) => void;
}

/** Applies pending migrations to `config.schema`. Throws on failure (the build must fail). */
export async function runMigrations(config: DbConfig, options: RunMigrationsOptions = {}): Promise<void> {
  const log = options.log ?? (() => undefined);
  if (!SAFE_SCHEMA_RE.test(config.schema)) throw new Error("invalid schema name");
  const migrationsFolder = options.migrationsFolder ?? DEFAULT_MIGRATIONS_FOLDER;

  const maxAttempts = options.maxAttempts ?? 12;

  await retryWithBackoff(
    async () => {
      const sql = postgres(
        config.url,
        buildClientOptions({ ...config, poolMax: 1 }, { lock_timeout: "5s", statement_timeout: "60s" }),
      );
      try {
        // Identifier is escaped by postgres.js; the value is additionally restricted to prod | staging.
        await sql`create schema if not exists ${sql(config.schema)}`;
        await migrate(drizzle(sql), {
          migrationsFolder,
          migrationsSchema: config.schema,
          migrationsTable: MIGRATIONS_TABLE,
        });
      } finally {
        await sql.end({ timeout: 5 });
      }
    },
    {
      maxAttempts,
      isRetryable: isUnreachableError,
      ...(options.sleep !== undefined ? { sleep: options.sleep } : {}),
      onRetry: ({ attempt, delayMs, error }) =>
        log(
          `[db] waking database… (unreachable: ${errorCodeForLog(error)}); retry ${attempt} of ${maxAttempts - 1} in ${delayMs} ms`,
        ),
    },
  );
  log(`migrations applied to schema "${config.schema}" (zero pending is success)`);
}
