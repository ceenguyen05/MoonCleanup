# M1-W4-T05 - DB schema v1, guest auth, contracts/profile REST (backend-data-engineer)

Task / status: in-review / 2026-11-14 / backend-data-engineer / Sonnet 5.5
Done: schema v1 + migrations 0001 (identity, Contracts, members, A/B saves) and 0002 (W5-T07 lease + save-generation columns, no logic uses them yet); `MoonRepository` interface with postgres (drizzle) and in-memory drivers passing ONE shared behavioural suite; guest create / refresh (60 s grace, reuse detection) / recover / logout; profile GET/PATCH (optimistic version); contracts list / create (idempotent `clientContractId`, quota 3, 507 when storage full) / get / patch / join-code / invite rotate / members; HS256 `jose` 15-min JWT (`aud mc-<ENV_NAME>`, `JWT_SECRET_PREVIOUS`), peppered HMAC-SHA256 hashes, rate limits per security 5; `verifyToken` export.
Next (lead, `apps/server/src/app/**`): see wiring below. Not built here: `POST /v1/contracts/:id/join` (needs matchmaker/join ticket), checkpoint/save routes (W5-T07), seed script.

## Wiring edit for the lead (app/server.ts)
```ts
import { createMoonRepository } from "@moon-cleanup/db";
import { createAccountApi } from "../api";
const repo = createMoonRepository(env.persistenceDriver === "memory" ? { driver: "memory" } : { driver: "postgres", connection: db });
const account = createAccountApi({ repo, envName: env.envName, jwtSecret: env.jwtSecret, jwtSecretPrevious: env.jwtSecretPrevious,
  refreshTokenPepper: env.refreshTokenPepper, logger, storage: () => "ok" });
const routes = [...createHealthRoutes({...}), ...account.routes];   // pass `account.verifyToken` into the room onAuth
```
Note: `mountHttpRoutes` already handles GET/POST/PATCH; CORS allows PATCH and Authorization. Hourly purge: call `repo.purgeRefreshTokens()` from the daily job. Optional deps: `online(contractId)`, `blockedNames`.

## Evidence (Node 26.13.1, Windows, this file state)
- packages/db: tsc, eslint, prettier clean; vitest 6 files, 78 passed, 2 skipped (real-server suite needs DATABASE_URL).
- apps/server: tsc, eslint, prettier clean; vitest full 186 passed (api: 43 new tests across auth/contracts/health).
- Same behavioural suite (21 cases: rotation incl. grace/reuse/superseded/expiry, recovery, purge, quota, idempotent ids, full u64 seed range, invite codes, patch, members) PASS on memory and on PGlite (real PostgreSQL WASM, schema `_a5`, generated migrations applied from empty). Migration files tested: sequential, match journal, no hard-coded `public` schema.
- Auth edge cases PASS: expired access (15 min) and refresh (180 d), reused refresh (family revoked + audit), grace retry, TOKEN_SUPERSEDED, wrong pepper, wrong secret / other env audience / alg none, previous-secret acceptance, uniform 401, no secret in logs, DB-unreachable to 503, other errors to bare 500.
- NOT RUN: postgres.js against a real server (needs DATABASE_URL; migrate.test real-server suite still skipped), multi-session row-lock contention (PGlite is single session), API-over-PGlite (pglite not a server dependency), Neon TLS/cold start.

## Decisions and requests
1. Migration 0001 was hand-amended after `drizzle-kit generate`: removed `"public".` FK qualifiers (so it follows search_path) and added `ALTER ... blob SET STORAGE EXTERNAL`. 0002 only adds header comments. Never edit after merge.
2. Contract DTO gaps (contracts-architect): `PATCH /v1/me` stale version needs a 409 code (now `409 BAD_REQUEST`, proposal `VERSION_CONFLICT`); `GET /v1/contracts/:id` cannot show the Holder the current invite code (only create/rotate return it).
3. `abuse_events` table is not in this card: audit kinds are logged (`audit` hook), not persisted. Recovery global lock and per-IP limits are in memory.
4. Seed is stored as the same 64 bits in signed bigint (converted in the repository); CRC32 columns are signed int32 (convert in W5-T07).
5. Profanity list is empty by default (`blockedNames`); reserved names are enforced.

Files: `packages/db/{migrations/0001_*,0002_*,meta/*, src/{ids,index,migrate.test}.ts, src/schema/{types,identity,contracts,index}.ts, src/repositories/{types,rotation,memory,postgres,factory,index,contract-suite,memory.test,postgres.test}.ts}`; `apps/server/src/api/{crypto,tokens,rate-limits,http,accounts,contracts,service,index,test-harness,auth.test,contracts.test}.ts`.
Commit suggestion: feat(db,api): schema v1, guest auth with rotating refresh tokens, profile and contracts REST
