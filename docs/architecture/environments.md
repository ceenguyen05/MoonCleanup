# Environments — Clean The Moon!

Owner: devops-engineer for config/env parsing. See [ADR-0029](../adr/0029-single-deploy-branch-main.md) and
[WORKFLOW](../handoff/WORKFLOW.md). Local development continues without a commit, remote CI, deploy or cloud credential.
Owner walkthrough: [HOSTING_GUIDE](../HOSTING_GUIDE.md); localhost commands: [README](../../README.md#run-on-localhost).

## 1. Overview

| Environment | Client | Server/data |
| --- | --- | --- |
| Local | Vite `http://localhost:5173+N` | `http://localhost:2567+N`; memory or isolated local Postgres |
| Hosted | Vercel production branch `main` | One Render Free service `moon-cleanup-server`, branch `main`; Aiven Postgres, schema `prod` |

No release branch, permanent staging service, branch-promotion flow or Vercel deploy-hook workflow.
Keep stable technical identifiers; displayed game title is Clean The Moon!.

## 2. Local development

Use `.nvmrc`, `package.json` and the per-command fnm prefix from active recovery notes. Copy `.env.example` templates to
ignored local env files. `ENV_NAME=local`, `VITE_ENV=local`; memory persistence is local-only. Never point destructive tests
at hosted saved games. Only one installer/config writer; coordinate affected consumers. No machine-wide config changes.

## 3. Test environment

Run long bot/network/soak/restart tests locally with deterministic seeds and isolated data. Tools refuse the live URL via
`PROD_SERVER_HTTP_URL`. A hosted measurement requires Cee-authorized access and an isolated/test-only window, bounded run,
fresh test data and an explicit safe endpoint; never silently disable live-data protections. Missing access is BLOCKED evidence,
not a whole-project stop. `NET_SPIKE=0` by default; enable only for that window and restore afterward. No second service setup.

## 4. Hosted configuration

`render.yaml` defines one free service on `main`, `autoDeployTrigger: checksPass`, `ENV_NAME=production`, `DB_SCHEMA=prod`.
`vercel.json` builds the static client; Cee sets Production Branch to `main`. Cee decides when to push/publish the tested work.
Provide secrets only through ignored local files/provider dashboards. Client `VITE_*` values are public build-time data.

### 4.1 `render.yaml`

Preserve its resource/admission values and migration/build commands; implement real scripts before claiming it deploys.
Bind HTTP to `0.0.0.0` and injected `PORT`. Health/version and readiness must reflect actual protocol/build/DB status.

### 4.2 `vercel.json`

Use repository-root workspace build/output settings, immutable hashed-asset caching, revalidated HTML and security headers.
Exact client HTTPS origin belongs in Render `ALLOWED_ORIGINS`. Previews need explicitly allowed origins and safe test data.

### 4.3 Independent client/server updates

No release-client workflow or deployment hook secret. Client/server can update at different times; reject incompatible
protocol versions cleanly with an updating/retry UI. Check deployed health/version read-only when available. Missing hosted
proof stays explicit; it does not block writing local features. Cee chooses rollback/fix-forward/publication actions.

## 5. Provider budgets

Keep the $0 topology and declared CPU/memory/egress budgets. Record real usage; do not add paid services or an uptime pinger
automatically. Before provider changes verify current limits against [platform research](../research/tech/platform-limits.md).
Budget long tests locally and short agreed hosted spikes separately. Cold starts and quota suspension remain known constraints.

## 6. Database reconnect and migrations

One Aiven connection target, application schema `prod` (dedicated DB/user if available; defaultdb fallback). Validate CA/TLS,
small pools, bounded retry/backoff after sleep and truthful readiness. Run versioned migrations with the hosted build using
the configured schema; do not reset live data. Persistence tests use isolated local/test databases. See data-model/netcode
for atomic saves, leases, idempotency and reconnect behavior. Credentials/CA values stay out of tracked files and output.

## 7. Environment values

Canonical keys below are retained for implementation; `.env.example` provides placeholders, not proof values are configured.
Local: local URLs, `ENV_NAME=local`, `VITE_ENV=local`, memory or isolated Postgres. Hosted: HTTPS/WSS Render URL,
`ENV_NAME=production`, `VITE_ENV=production`, `PERSISTENCE_DRIVER=postgres`, `DB_SCHEMA=prod`, `NET_SPIKE=0`.
Empty Sentry DSNs disable optional observability. Build-only auth tokens must never use the public `VITE_` prefix.

### 7.1 Client

Use public `VITE_*` keys from the canonical table; build credentials remain unprefixed and private.

### 7.2 Server

Validate the canonical server keys at boot. Keep secrets private, local/test data isolated and readiness truthful.

## 8. Actual external inputs

Request database/hosting access, final origins/URLs and region only when used. Cee supplies secrets through dashboards.
Record BLOCKED/provisional results for absent services/devices; continue independent work. No repeated setup approval gate.

## 9. Canonical env var list

| Variable | Service | Required | Secret | Description | Value comes from |
| --- | --- | --- | --- | --- | --- |
| `VITE_SERVER_HTTP_URL` | client (Vercel) | yes | no | Base HTTPS URL of the game server for REST and `/healthz` | Vercel dashboard (Production = main), copied from the Render service URL |
| `VITE_SERVER_WS_URL` | client | yes | no | Base `wss://` URL for Colyseus | Vercel dashboard, Render URL with `wss://` |
| `VITE_SENTRY_DSN` | client | no | no (public DSN) | Browser Sentry project DSN; empty disables Sentry | Sentry project settings → Vercel dashboard |
| `VITE_BUILD_VERSION` | client | yes | no | Build identifier shown in UI, sent as `clientBuild`, Sentry release | Vercel build command from `VERCEL_GIT_COMMIT_SHA`; `dev` locally |
| `VITE_ENV` | client | yes | no | `local` · `preview` · `production` (staging remains a reserved internal value) | Vercel dashboard (per environment/branch) |
| `VITE_OFFLINE_SOLO` | client | no | no | Run `RoomSim` in a Web Worker without a server (dev flag; v1.0 feature) | `.env.local` / Vercel dashboard |
| `SENTRY_AUTH_TOKEN` | client build (Vercel) | for source maps | **yes** | Uploads source maps during the build | Sentry → Vercel dashboard (not `VITE_`) |
| `SENTRY_ORG` | client build | for source maps | no | Sentry organisation slug | Sentry → Vercel dashboard |
| `SENTRY_PROJECT` | client build | for source maps | no | Sentry client project slug | Sentry → Vercel dashboard |
| `VERCEL_GIT_COMMIT_SHA` | client build | auto | no | Commit SHA (system variable) | Provided by Vercel |
| `NODE_ENV` | server (Render) | yes | no | `production` on Render, `development` locally | Render dashboard / `render.yaml` |
| `PORT` | server | yes | no | HTTP/WS listen port | Injected by Render (10000); `2567+N` locally |
| `ENV_NAME` | server | yes | no | `local` · `staging` · `production`; used in JWT `aud`, logs, Sentry environment, lease ids | `render.yaml` value |
| `DATABASE_URL` | server | if `postgres` | **yes** | Postgres connection URL for this environment's DB and role | Aiven console → Overview → Connection information (host/port) + per-env DB/role created in the console → Render dashboard |
| `DB_SCHEMA` | server | no (default `prod`) | no | Schema for repositories/migrations: `prod` on the one hosted service. Use an isolated local database/schema for test data | `render.yaml` / `.env.example` |
| `DATABASE_CA_CERT` | server | if not local | no (public cert) | Aiven project CA certificate, full PEM text incl. BEGIN/END lines | Aiven console → Overview → CA certificate → Download → paste into Render dashboard |
| `PERSISTENCE_DRIVER` | server | yes | no | `postgres` or `memory` (memory = local only, refused when `ENV_NAME` ≠ `local`) | `render.yaml` / `.env` |
| `DB_POOL_MAX` | server | no (default 4) | no | Max DB connections from this instance | `render.yaml` |
| `JWT_SECRET` | server | yes | **yes** | HS256 signing key for access JWTs (≥ 32 random bytes, base64) | `render.yaml` `generateValue: true`, unique per environment |
| `JWT_SECRET_PREVIOUS` | server | no | **yes** | Previous signing key accepted for verification during rotation | Render dashboard, temporary |
| `REFRESH_TOKEN_PEPPER` | server | yes | **yes** | HMAC key for refresh-token, recovery-code, join-ticket and IP hashes (≥ 32 random bytes) | `render.yaml` `generateValue: true` (Render generates it once per service), unique per environment |
| `ALLOWED_ORIGINS` | server | yes | no | Comma-separated exact origins for CORS and WebSocket `Origin` checks | Render dashboard, from the Vercel URLs |
| `SENTRY_DSN` | server | no | no | Node Sentry project DSN; empty disables | Sentry → Render dashboard |
| `SENTRY_TRACES_SAMPLE_RATE` | server | no (default 0.01) | no | REST trace sampling; never per tick | `render.yaml` |
| `LOG_LEVEL` | server | no (default `info`) | no | pino level | `render.yaml` |
| `SIM_TICK_HZ` | server | no (default 20) | no | Fixed simulation rate (20 free tier; 30 supported on a paid instance) | `render.yaml` |
| `SNAPSHOT_HZ` | server | no (default 10) | no | Frame and Schema patch rate (10 free tier; 15 with `SIM_TICK_HZ=30`); must divide `SIM_TICK_HZ` (boot refuses otherwise) | `render.yaml` |
| `MAX_ROOMS` | server | no (default 3) | no | **Hard ceiling** on live rooms per instance; admission is decided by the measured tick budget below it ([netcode.md §15](netcode.md)) | `render.yaml` |
| `TICK_BUDGET_MS` | server | no (default 3.5) | no | Admission budget: Σ room tick p95 + new-room estimate must stay ≤ this (70 % of a 20 Hz tick) | `render.yaml` |
| `CLIENT_IP_HEADER` | server | no (default `true-client-ip`) | no | The single Render-documented client-IP header used for per-IP limits; `x-forwarded-for` means "right-most entry only" ([security.md §5](security.md#5-rate-limiting)) | `render.yaml` |
| `MAX_CLIENTS` | server | no (default 24) | no | Admission limit for connected clients per instance | `render.yaml` |
| `CHECKPOINT_INTERVAL_S` | server | no (default 30) | no | Max seconds between checkpoints of a dirty room (≤ 30 per tech-stack) | `render.yaml` |
| `SEAT_HOLD_S` | server | no (default 60) | no | Reconnection seat-hold window | `render.yaml` |
| `BUILD_VERSION` | server | no | no | Build identifier in `/healthz`, logs, Sentry release, lease ids; derived from `RENDER_GIT_COMMIT` when unset | Render (derived) / `.env` |
| `RENDER_GIT_COMMIT` | server | auto | no | Deployed commit SHA (system variable) | Provided by Render |
| `NODE_OPTIONS` | server | yes on Render | no | `--max-old-space-size=384` heap cap | `render.yaml` |
| `PROD_SERVER_HTTP_URL` | Local/test tools (`tools/bots`, `tools/perf`, e2e), as a **deny** value | yes | no | Live Render HTTPS URL; automated test tools refuse it. Hosted measurement requires explicit isolated/test-only setup | Ignored local/test tool environment |
| `NET_SPIKE` | server | no (default 0) | no | Enables test spike rooms only in an agreed isolated test window; restore 0 afterward | local/test env; Render dashboard only when authorized |
