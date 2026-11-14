# M0-W1-T02 + M0-W1-T03 — server ops, health routes, db skeleton, first migration

Status: done locally (real-DB checks BLOCKED, no Postgres) / 2026-11-12 / backend-data-engineer (Sonnet 5.5)

## Done
- **T02 `apps/server/src/ops/`**: zod env schema (canonical list; fails fast with a value-free readable error list; blank = unset;
  rules: SNAPSHOT_HZ divides SIM_TICK_HZ, memory driver only on ENV_NAME=local, postgres needs DATABASE_URL (+CA off local),
  NET_SPIKE=1 refused in production, exact-origin ALLOWED_ORIGINS, BUILD_VERSION derived from RENDER_GIT_COMMIT, `describeEnvForLog`).
  pino 10 logger factory (JSON prod / pino-pretty dev, service/env/build/commit fields), deep redaction (tokens, JWTs, Bearer, PEM,
  URI credentials, secret-named keys), `RoomStats` (ring-buffer p50/p95/max, bytes per message type, CPU % of 0.1 quota,
  event-loop p99 via injectable probe), `BandwidthCounter` (UTC month-to-date, seedable), `StatsReporter` (room line per 60 s,
  10 s under NET_SPIKE; hourly bandwidth line; `sumTickP95Ms` for admission).
- **MAX_CLIENTS default changed 24 -> 12** (owner cap 6 players/room; 12 = two full rooms; MAX_ROOMS 3 stays the hard ceiling).
- **T03 `apps/server/src/api/health.ts`**: `createHealthRoutes(deps): HttpRouteDef[]` (`/healthz` no I/O; `/readyz` db probe cached 10 s,
  coalesced, 200/503, reports `schema` + `dbState`).
- **T03 `packages/db`**: `schema/ops.ts` (`ops_usage_daily`), `drizzle.config.ts`, lazy `createDbConnection` (TLS with CA, `search_path`
  = DB_SCHEMA, pool/idle limits, probe with timeout + 1->30 s backoff gating), `retryWithBackoff`, `runMigrations`
  (creates schema, journal table inside it, lock 5 s / statement 60 s, retries on power-off), `migrate-cli.ts`
  (`node src/migrate-cli.ts`; missing DATABASE_URL fails the build unless PERSISTENCE_DRIVER=memory; zero pending = success).
  Generated migration `migrations/0000_ops_usage_daily.sql` (+ `meta/`), header comment added by hand before merge (justifies the PK index).

## Evidence
- `apps/server`: vitest 46/46 passed (env, redact/logger, stats, health), `tsc` clean, `eslint src` clean.
- `packages/db`: vitest 19 passed, 2 skipped (`migrate.test.ts` needs `DATABASE_URL`; creates/drops schema `_a3`), `tsc` clean, `eslint .` clean.
- `node src/migrate-cli.ts` with `PERSISTENCE_DRIVER=memory` -> skipped exit 0; with nothing set -> exit 1, no secret output.
- BLOCKED: migration apply against real Postgres (`_a3` test written, unrun). No hosted Render/Aiven use.

## Manifest / install
No installs and no lockfile changes: all deps were already present. `packages/db/package.json`: scripts `generate` -> `drizzle-kit generate`,
`migrate` -> `node src/migrate-cli.ts` (Node 26 native type stripping; db sources use `.ts` import extensions, hence
`allowImportingTsExtensions` + `erasableSyntaxOnly` in `packages/db/tsconfig.json`). Removed `.gitkeep` in api/ ops/ db schema.

## Deviations / contract proposals
- `/readyz` body adds `schema` and `dbState` (powered-off | not-configured | error | up) beyond `ReadyResponseSchema`; clients strip them.
  Proposal to contracts-architect: add optional `schema` to `ReadyResponseSchema`. In local memory mode `db:"down"` but `ready:true`.
- `ops_usage_daily` columns follow data-model 3.12 exactly (bigint as JS number; fine below 2^53).
- Staying value-free: `.env.example`, `render.yaml`, HOSTING_GUIDE, environments.md section 9, netcode.md 15, performance-budgets still say
  `MAX_CLIENTS` 24 -> lead/owner of those files should update to 12.
- `runMigrations` is not exported from the db barrel on purpose (it is the build-step CLI, not a server runtime API).

## Handoff to the integrator (M0-W1-T06 composition root)
1. `const env = loadServerEnv()` (catch `EnvValidationError`, print message, exit 1); `createLogger({level: env.logLevel, nodeEnv, envName, buildVersion, gitCommit})`.
2. `const dbConn = createDbConnection(env.databaseUrl ? {url, caCert: env.databaseCaCert, schema: env.dbSchema, poolMax: env.dbPoolMax} : undefined)`; `await dbConn.close()` on SIGTERM.
3. `StatsReporter({logger, probe: createNodeProcessProbe(), netSpike: env.netSpike})`, `.start()`; rooms call `addRoom/removeRoom`,
   `RoomStats.recordTick/recordBytesOut`; log `describeEnvForLog(env)` at boot.
4. `createHealthRoutes({envName, buildVersion, maxRooms, db: dbConn, persistenceDriver, runtime, startedAtMs})` and pass to the net layer's route mounting.
5. Build: `pnpm --filter @moon-cleanup/db run migrate` already matches render.yaml; seed script is still the placeholder.

Commit suggestion: feat(server,db): ops spine, health routes, db package skeleton and ops_usage_daily migration
