// Public barrel of @moon-cleanup/db (server-only persistence). The client never imports this package.
export {
  DB_SCHEMAS,
  POOLER_URL_PROBLEM,
  SAFE_SCHEMA_RE,
  hostOfUrl,
  isDbSchemaName,
  isPoolerUrl,
  planMigrationFromEnv,
  sslModeOf,
  urlRequestsTls,
  type DbConfig,
  type DbSchemaName,
  type MigrateEnvPlan,
} from "./config.ts";
export {
  CONNECT_TIMEOUT_S,
  buildClientOptions,
  createDbConnection,
  type ConnectionDeps,
  type Database,
  type DbConnection,
  type DbReachability,
  type ProbeClient,
} from "./connection.ts";
export { DbNotConfiguredError, errorCodeForLog, isUnreachableError } from "./errors.ts";
export { DEFAULT_BACKOFF, backoffDelayMs, retryWithBackoff, type BackoffPolicy, type RetryOptions } from "./backoff.ts";
// runMigrations lives in ./migrate.ts (run by the migrate CLI / Render build, intentionally not in the server barrel).
export { opsUsageDaily, type OpsUsageDailyRow } from "./schema/index.ts";
export { uuidv7 } from "./ids.ts";
export * from "./repositories/index.ts";
export {
  contractMembers,
  contractSaves,
  contracts,
  identities,
  players,
  profiles,
  refreshTokens,
} from "./schema/index.ts";
