# M0-neon-swap: Aiven -> Neon free Postgres

Status: done (code, tests, docs); first live proof needs Cee's Neon project. Date 2026-11-13. Agent: backend-data-engineer (Sonnet 5.5).

## Neon facts (official docs, fetched 2026-11-13)

| Item | Value | Source |
| --- | --- | --- |
| Free plan | $0 permanent, 100 projects, 1 GB storage per project (20 GB account), 100 CU-hours per project per month (0.25 CU ~ 400 h), autoscaling to 2 CU | neon.com/pricing, /docs/introduction/plans |
| Scale to zero | Always on for Free, 5 min idle, cannot be disabled; compute stays suspended only if the 100 CU-h or 5 GB transfer is exhausted; Free projects are not paused for inactivity | pricing |
| Wake latency | "a few hundred milliseconds" typical (docs measured ~0.75-0.87 s incl. network); docs advise connect timeout ~10 s and retries with backoff | /docs/connect/connection-latency |
| Connections | `max_connections = floor(CU x 450.61)`, min 100: 0.25 CU = 112, 1 CU = 450 | /docs/reference/compatibility |
| Pooler | `-pooler` host = PgBouncer transaction mode, 10 000 client conns; no SET/search_path, no session advisory locks; migrations must use direct; protocol-level prepared statements allowed on PgBouncer 1.22+ | /docs/connect/connection-pooling, /choose-connection |
| TLS | Public CA, `sslmode=require` (+ `channel_binding=require` in the console string); SNI required (postgres.js sends it) | connection-errors |
| Card | None for the Free plan ("no credit card required"; only AI Gateway prepaid credits need one) | pricing |
| Region | `aws-us-east-2` (Ohio) exists; no Free restriction found. The Azure-region 90-day deletion note applies only to deprecated Azure regions | /docs/introduction/regions |

Not verified: exact UI labels in the console (guide says "trust what you see"); the 1-5 s wake window in the guide is deliberately conservative versus the documented few hundred ms.

## Done

- `packages/db`: `DATABASE_CA_CERT` optional. `buildClientOptions` passes `ssl: { rejectUnauthorized: true }` (system CA store) whenever the URL asks for TLS and no CA is set, `ssl: { ca, rejectUnauthorized: true }` when a CA is set, nothing for non-TLS (local). Verification is never disabled (postgres.js would otherwise treat `sslmode=require` as encrypt-only).
- `connect_timeout` 10 -> 15 s (`CONNECT_TIMEOUT_S`); probe timeout 3 -> 5 s; migrate retry (1 s -> 30 s, 12 attempts) now logs `[db] waking database…`; `probe()` logs `[db] waking database…` once per failure streak and `[db] database is up` on recovery (injectable `log`).
- `prepare: false` when the URL host contains `-pooler`. Decision: DIRECT string everywhere. A `-pooler` URL is refused by both `planMigrationFromEnv` and server env validation (our `search_path` startup parameter and migrations need a session), so `prepare:false` is a belt-and-braces guard.
- `apps/server/src/ops/env.ts`: CA no longer required; production URL must contain `sslmode=require|verify-ca|verify-full` (disable/prefer/missing refused, message secret-free); pooled host refused. `migrate` plan applies the same checks when `ENV_NAME` is set.
- Docs: HOSTING_GUIDE (START HERE B, C table, G, section 0, 1, 2, 4, 6, 7, 9; Aiven mentions gone except a historical note), render.yaml comments, `.env.example`, ADR-0002 status note, environments.md (hosted row, section 6, DATABASE_URL/CA rows), SETUP_CHECKLIST, `packages/db/README.md`. Coordinator extras applied: START HERE F uWS paragraph with the three exact `[net] transport=` log lines and the unverified pnpm optional-dependency note, section 7 row closed, `TRANSPORT` in the env table (it was already in `.env.example` and environments.md).

## Evidence (Node 26.13.1, Windows, this file state)

- `packages/db`: tsc clean, eslint clean, vitest 4 files / 29 passed + 2 skipped (real-server suite skips without `DATABASE_URL`; PGlite migration test passes). New tests: system-CA TLS options, `-pooler` => `prepare:false`, URL helpers, Neon-style URL accepted, non-TLS and pooled refused, wake log lines, migrate retry/backoff with `[db] waking database…` and no host in log.
- `apps/server`: tsc clean, eslint (`src/ops`) clean, vitest 14 files / 139 passed. New env tests: Neon URL with no CA OK in production; no TLS / `sslmode=disable` / `prefer` refused; pooled host refused; no secret in messages.
- `prettier --check` on edited md/yaml/db files: pass (`.env.example` has no prettier parser).
- No installs, no git, no accounts contacted.

## Next / requests

- `TRANSPORT` NOT added to `ServerEnv`: `app/index.ts` reads it through `net/loadTransportMode()` and adding it to `env.ts` would require edits in `app/**` (out of scope); transport owner can adopt later.
- Cee: create the Neon project per HOSTING_GUIDE checklist B, paste the direct string into Render `DATABASE_URL`, leave `DATABASE_CA_CERT` empty; read the first build log for `[db:migrate] migrations applied`. Optionally run the real-server migration test with a throwaway Neon branch via `DATABASE_URL` (creates/drops schema `_a3` only).
- Existing Render env: if `DATABASE_CA_CERT` is still set from Aiven, clear it.

Files: `packages/db/src/{config,connection,migrate,backoff,index}.ts` + `config.test.ts`, `connection.test.ts`, `migrate.test.ts`, `packages/db/{package.json,README.md}`, `apps/server/src/ops/env.ts` + `env.test.ts`, `apps/server/.env.example`, `render.yaml`, `docs/{HOSTING_GUIDE,SETUP_CHECKLIST}.md`, `docs/adr/0002-hosting-topology-free-tier.md`, `docs/architecture/environments.md`.

Commit suggestion: feat(db): switch free Postgres to Neon with system-CA TLS and cold-start retry
