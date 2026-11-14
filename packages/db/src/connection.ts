// Lazy PostgreSQL connection factory (postgres.js + Drizzle). Nothing connects until first use. TLS always verifies the
// server certificate: against DATABASE_CA_CERT when set, otherwise against Node's system CA store (Neon Free uses a
// publicly trusted CA, so no certificate has to be pasted). The pool is small (free tier) and idle connections close
// after 20 s so Neon can scale the compute to zero after 5 idle minutes. The target schema is applied through the
// connection `search_path` startup parameter, which is why the DIRECT Neon string is used (the `-pooler` PgBouncer
// endpoint rejects it). The first connection after a suspend takes about 1-5 s: connect_timeout is 15 s and callers
// retry with backoff (migrate.ts; probe() below). Plain Postgres only, no Neon SDK.
//
// Readiness probing never blocks the event loop for long: `probe()` has a hard timeout, and after a failure the next
// attempts are gated by exponential backoff (1 s -> 30 s) so a sleeping database is not hammered.

import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { DEFAULT_BACKOFF, backoffDelayMs, type BackoffPolicy } from "./backoff.ts";
import type { DbConfig } from "./config.ts";
import { isPoolerUrl, sslModeOf } from "./config.ts";
import { DbNotConfiguredError, isUnreachableError } from "./errors.ts";
import * as schema from "./schema/index.ts";

export type DbReachability = "up" | "powered-off" | "not-configured" | "error";
export type Database = PostgresJsDatabase<typeof schema>;

/** The slice of postgres.js the probe needs; a fake implements it in tests. */
export interface ProbeClient {
  (strings: TemplateStringsArray): PromiseLike<unknown>;
  end(options?: { timeout?: number }): Promise<void>;
}

export interface ConnectionDeps {
  readonly now?: () => number;
  readonly backoff?: BackoffPolicy;
  /** Hard cap for one probe query, ms. */
  readonly probeTimeoutMs?: number;
  /** Test seam replacing the real postgres.js client factory. */
  readonly createClient?: (config: DbConfig) => ProbeClient;
  /** Receives secret-free progress lines such as `[db] waking database…` (default: console.log). */
  readonly log?: (line: string) => void;
}

export interface DbConnection {
  /** `null` when no database is configured. */
  readonly schema: string | null;
  /** Drizzle handle (connects lazily). Throws `DbNotConfiguredError` in memory mode. */
  db(): Database;
  /** Cheap reachability check with timeout and backoff gating. Never throws. */
  probe(): Promise<DbReachability>;
  /** Closes the pool (SIGTERM). */
  close(): Promise<void>;
}

/**
 * First-connect budget in seconds. Neon scale-to-zero wakes in about 1-5 s (docs: a few hundred ms plus network), so
 * 15 s leaves room; the callers add retries with backoff on top.
 */
export const CONNECT_TIMEOUT_S = 15;

/**
 * TLS options. postgres.js treats a bare `sslmode=require` as encrypt-only (`rejectUnauthorized: false`), so whenever
 * the URL asks for TLS we pass an explicit verifying `ssl` object, which takes precedence over the URL: with a custom
 * CA it trusts that CA, without one it uses Node's system store. Verification is never disabled. A URL without TLS
 * (local Postgres) is left alone; server env validation refuses that outside ENV_NAME=local.
 */
function sslOptions(config: DbConfig): { ssl?: { ca?: string; rejectUnauthorized: true } } {
  if (config.caCert !== undefined) return { ssl: { ca: config.caCert, rejectUnauthorized: true } };
  const mode = sslModeOf(config.url);
  if (mode !== undefined && mode !== "disable" && mode !== "allow" && mode !== "prefer") {
    return { ssl: { rejectUnauthorized: true } };
  }
  return {};
}

/** Builds the postgres.js options for a config (exported for tests; never log the result). */
export function buildClientOptions(
  config: DbConfig,
  extra: Record<string, string> = {},
): postgres.Options<Record<string, never>> {
  return {
    max: config.poolMax,
    idle_timeout: 20,
    connect_timeout: CONNECT_TIMEOUT_S,
    max_lifetime: 60 * 30,
    onnotice: () => undefined,
    ...sslOptions(config),
    // PgBouncer transaction mode cannot reuse named prepared statements across server connections.
    ...(isPoolerUrl(config.url) ? { prepare: false } : {}),
    connection: { search_path: config.schema, application_name: "moon-cleanup", ...extra },
  };
}

function createRealClient(config: DbConfig): postgres.Sql {
  return postgres(config.url, buildClientOptions(config));
}

export function createDbConnection(config: DbConfig | undefined, deps: ConnectionDeps = {}): DbConnection {
  if (config === undefined) {
    return {
      schema: null,
      db() {
        throw new DbNotConfiguredError();
      },
      probe: () => Promise.resolve("not-configured"),
      close: () => Promise.resolve(),
    };
  }

  const now = deps.now ?? Date.now;
  const policy = deps.backoff ?? DEFAULT_BACKOFF;
  // A cold Neon wake is 1-5 s; the underlying connect keeps going after a timed-out probe, so the next probe is fast.
  const probeTimeoutMs = deps.probeTimeoutMs ?? 5000;
  const log = deps.log ?? ((line: string) => console.log(line));
  let client: ProbeClient | undefined;
  let database: Database | undefined;
  let failures = 0;
  let nextAttemptAt = 0;
  let lastFailure: DbReachability = "powered-off";

  const getClient = (): ProbeClient => {
    client ??=
      deps.createClient !== undefined
        ? deps.createClient(config)
        : (createRealClient(config) as unknown as ProbeClient);
    return client;
  };

  return {
    schema: config.schema,
    db() {
      if (database === undefined) {
        database = drizzle(getClient() as unknown as postgres.Sql, { schema });
      }
      return database;
    },
    async probe() {
      if (failures > 0 && now() < nextAttemptAt) return lastFailure;
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const c = getClient();
        const timeout = new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(Object.assign(new Error("probe timeout"), { code: "PROBE_TIMEOUT" })),
            probeTimeoutMs,
          );
        });
        await Promise.race([c`select 1`, timeout]);
        if (failures > 0) log("[db] database is up");
        failures = 0;
        nextAttemptAt = 0;
        return "up";
      } catch (error) {
        failures += 1;
        nextAttemptAt = now() + backoffDelayMs(failures, policy);
        lastFailure = isUnreachableError(error) ? "powered-off" : "error";
        if (failures === 1 && lastFailure === "powered-off") log("[db] waking database…");
        return lastFailure;
      } finally {
        if (timer !== undefined) clearTimeout(timer);
      }
    },
    async close() {
      const c = client;
      client = undefined;
      database = undefined;
      if (c !== undefined) await c.end({ timeout: 5 });
    },
  };
}
