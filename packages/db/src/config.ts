// Database configuration shared by the lazy connection factory and the migrate CLI. This package has no zod
// dependency and must run under plain Node type stripping (migrate step in the Render build), so validation is manual.

export const DB_SCHEMAS = ["prod", "staging"] as const;
export type DbSchemaName = (typeof DB_SCHEMAS)[number];

export interface DbConfig {
  /** Postgres connection URL. Secret: never log it. */
  readonly url: string;
  /**
   * Optional custom CA certificate (PEM) for a provider whose certificate is not publicly trusted. Absent = verify the
   * server certificate against Node's system CA store (Neon uses a publicly trusted CA), see `buildClientOptions`.
   */
  readonly caCert?: string | undefined;
  /**
   * Target Postgres schema, applied through the connection search_path. Production values are `DbSchemaName`
   * (prod | staging); isolated tests pass a schema-suffixed name such as `_a3` (SAFE_SCHEMA_RE).
   */
  readonly schema: string;
  /** Maximum pool size (free tier: 4 hosted, 2 local). */
  readonly poolMax: number;
}

/** Identifier shape accepted for any schema name; keeps the value safe even though postgres.js escapes identifiers. */
export const SAFE_SCHEMA_RE = /^[a-z_][a-z0-9_]{0,40}$/;

export function isDbSchemaName(value: unknown): value is DbSchemaName {
  return typeof value === "string" && (DB_SCHEMAS as readonly string[]).includes(value);
}

/** The `sslmode` query value of a connection URL, lower-cased (`undefined` when absent). */
export function sslModeOf(url: string): string | undefined {
  const match = /[?&]sslmode=([^&#]*)/i.exec(url);
  return match?.[1]?.toLowerCase();
}

/** True when the URL demands TLS: sslmode require | verify-ca | verify-full. Missing, disable, allow or prefer is false. */
export function urlRequestsTls(url: string): boolean {
  const mode = sslModeOf(url);
  return mode === "require" || mode === "verify-ca" || mode === "verify-full";
}

/** Host part of a postgres URL (no port, no credentials); `undefined` when it cannot be read. */
export function hostOfUrl(url: string): string | undefined {
  const match = /^postgres(?:ql)?:\/\/(?:[^/?#]*@)?(\[[^\]]+\]|[^/?#:@]+)/i.exec(url);
  return match?.[1]?.toLowerCase();
}

/** True for a Neon pooled (PgBouncer transaction mode) endpoint: the first host label ends in `-pooler`. */
export function isPoolerUrl(url: string): boolean {
  const host = hostOfUrl(url);
  return host !== undefined && /-pooler(\.|$)/.test(host);
}

/** Shared message: a pooled endpoint cannot carry our `search_path` / lock_timeout startup parameters or migrations. */
export const POOLER_URL_PROBLEM =
  "DATABASE_URL: use the DIRECT connection string (host without -pooler); the pooled endpoint rejects the search_path startup parameter and migrations need a session";

export type MigrateEnvPlan =
  | { readonly kind: "run"; readonly config: DbConfig }
  | { readonly kind: "skip"; readonly reason: string }
  | { readonly kind: "invalid"; readonly problems: readonly string[] };

const blank = (value: string | undefined): string | undefined =>
  value === undefined || value.trim() === "" ? undefined : value;

/**
 * Decides what the migrate CLI does for an environment: run against DATABASE_URL, skip (explicit memory mode only),
 * or fail. A missing DATABASE_URL must NOT silently pass the Render build, so skipping requires
 * PERSISTENCE_DRIVER=memory.
 */
export function planMigrationFromEnv(env: Readonly<Record<string, string | undefined>>): MigrateEnvPlan {
  const url = blank(env.DATABASE_URL);
  const driver = blank(env.PERSISTENCE_DRIVER);
  const schema = blank(env.DB_SCHEMA) ?? "prod";
  const problems: string[] = [];

  if (!isDbSchemaName(schema)) problems.push("DB_SCHEMA: must be prod or staging");
  if (url === undefined) {
    if (driver === "memory") return { kind: "skip", reason: "PERSISTENCE_DRIVER=memory: no database to migrate" };
    problems.push("DATABASE_URL: required (set PERSISTENCE_DRIVER=memory to skip migrations locally)");
  } else if (!/^postgres(ql)?:\/\//i.test(url)) {
    problems.push("DATABASE_URL: must be a postgres:// or postgresql:// URL");
  } else {
    if (isPoolerUrl(url)) problems.push(POOLER_URL_PROBLEM);
    // Fail closed (review N10): an unset ENV_NAME is NOT local. Only ENV_NAME=local may use a non-TLS URL. A custom
    // DATABASE_CA_CERT is optional: without it the server certificate is verified against the system CA store
    // (see connection.ts `sslOptions`), never left unverified.
    if (blank(env.ENV_NAME) !== "local" && !urlRequestsTls(url)) {
      problems.push("DATABASE_URL: must include sslmode=require (TLS is mandatory unless ENV_NAME=local)");
    }
  }
  if (problems.length > 0 || url === undefined || !isDbSchemaName(schema)) return { kind: "invalid", problems };

  return { kind: "run", config: { url, caCert: blank(env.DATABASE_CA_CERT), schema, poolMax: 1 } };
}
