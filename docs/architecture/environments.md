# Environments — Moon Cleanup

Status: **Planning baseline (2026-11-12)** · Owner: devops-engineer (`render.yaml`, `vercel.json`, `.env.example` files, `apps/server/src/ops` env parsing) · Git flow: [../handoff/WORKFLOW.md](../handoff/WORKFLOW.md) (`main` → staging, `release` → production; no agent runs git).
Canonical: [tech-stack.md](tech-stack.md), [module-boundaries.md §6](module-boundaries.md) (port offsets). Evidence: [platform-limits.md](../research/tech/platform-limits.md), [data-auth-observability.md §6](../research/tech/data-auth-observability.md).

## 1. Overview

| | Local | Staging | Production |
| --- | --- | --- | --- |
| Git branch | any working tree | `main` | `release` (fast-forward from `main` after `/release-checklist`) |
| Client | Vite dev server `http://localhost:5173+N` | Vercel branch URL of `main`: `https://moon-cleanup-git-main-<scope>.vercel.app` | Vercel production domain (Production Branch = `release`), e.g. `https://moon-cleanup.vercel.app` |
| Server | `node` via Turborepo dev task, `http://localhost:2567+N` | Render Free `moon-cleanup-server-staging` (tracks `main`) | Render Free `moon-cleanup-server` (tracks `release`) |
| Database | none (`PERSISTENCE_DRIVER=memory`) or Docker Postgres | Aiven PG Free, DB `moon_staging` | Aiven PG Free (same service), DB `moon_prod` |
| `ENV_NAME` / `VITE_ENV` | `local` | `staging` | `production` |
| Sentry environment | disabled (empty DSN) | `staging` | `production` |
| Who deploys | developer/agent | Cee merges a PR to `main` → auto deploy | Cee fast-forwards `release` → Render deploys after CI checks pass (`checksPass`); the Vercel production client deploys only after the server reports the commit's protocol version (release gate, §4.3) |
| Vercel previews (`wave/*`, `hotfix/*`) | — | Preview builds point at **staging** server; their exact branch URLs are added to staging `ALLOWED_ORIGINS` only when needed | — |

## 2. Local development

| Item | Value |
| --- | --- |
| Node | 26.13.1 from `.nvmrc` (`engines.node: 26.x`) |
| pnpm | 11.28.9 (pinned in `packageManager`; Node ≥ 25 ships no Corepack → install pnpm explicitly once) |
| Install / run | `pnpm install --frozen-lockfile`; Turborepo `dev` task starts client + server |
| Ports (agent offset `N` = 0–9) | Client `5173+N`, server `2567+N`, Docker Postgres `5432` (one shared container), test DB schema suffix `_aN` ([module-boundaries.md §6](module-boundaries.md)) |
| DB option A (default for agents) | `PERSISTENCE_DRIVER=memory`: in-process repositories, no Postgres, data lost on restart. Auth, Contracts and saves still work |
| DB option B | Docker Postgres pinned to the **same major version** as the Aiven service (read it in the Aiven console); DB `moon_local`; no TLS (`DATABASE_CA_CERT` empty is accepted only when `ENV_NAME=local` and the host is `localhost`). Migrations with the same migrate step as Render; `drizzle-kit push` is allowed **only** here |
| DB option C (Cee only, if Docker is unavailable) | A third logical DB `moon_dev` on the Aiven service, ≤ 50 MB. Never point a local server at `moon_prod` or `moon_staging` |
| Offline Solo (dev flag) | `VITE_OFFLINE_SOLO=true` runs `RoomSim` in a Web Worker with no server and no persistence (for render/sim work; becomes the v1.0 offline Solo Shift) |
| Bots | `tools/bots` against `ws://localhost:2567+N` |
| Secure context | `localhost` counts as secure, so WebGPU works without HTTPS |
| Local `.env` files | `apps/client/.env.local`, `apps/server/.env` — git-ignored; copy from the committed `.env.example` |

Local values: `VITE_SERVER_HTTP_URL=http://localhost:2567+N`, `VITE_SERVER_WS_URL=ws://localhost:2567+N`, `ALLOWED_ORIGINS=http://localhost:5173+N`, `JWT_SECRET` / `REFRESH_TOKEN_PEPPER` = any local random strings.

## 3. Staging

| Item | Value |
| --- | --- |
| Render service | `moon-cleanup-server-staging`, `plan: free`, `branch: main`, `autoDeployTrigger: commit` |
| Vercel | Preview environment, **branch-specific** variables for `main` point to the staging server; other preview branches inherit the same staging values |
| DB | `moon_staging`, role `mc_staging`, pool max 2 |
| Rates | Same as production (`SIM_TICK_HZ=20`, `SNAPSHOT_HZ=10`) so `/bot-test --staging` numbers are representative |
| Log level | `info` (same as production; `debug` only temporarily from the dashboard) |
| Data | Disposable; may be wiped by Cee at any time |
| Sleep | Sleeps after 15 min idle like prod; woken by opening the `main` URL or by `/bot-test --staging` |
| Egress discipline | Staging shares the workspace's 5 GB/month. Staging bot runs are **≤ 5 min** (≈ 30 MB), only for the M0-W2 spike and before releases; 1 h soaks run locally in a CPU-limited container. Bot bytes are recorded in `ops_usage_daily.bot_bytes_out` |
| Production is off-limits to tests | `tools/bots`, `tools/perf` and the Playwright config refuse any server URL equal to the production URL (`PROD_SERVER_HTTP_URL` guard); e2e and bots target local or staging only |

## 4. Production

| Item | Value |
| --- | --- |
| Render service | `moon-cleanup-server`, `plan: free`, `branch: release`, `autoDeployTrigger: checksPass` |
| Vercel | Production Branch = `release`; production domain; **automatic deployment of `release` disabled** (`vercel.json` `git.deploymentEnabled.release = false`), production deploys come from the release gate (§4.3) |
| DB | `moon_prod`, role `mc_prod`, pool max 4 (×2 during deploy overlap) |
| Rates | 20 / 10 Hz default; 30 / 20 only on a paid instance (ADR) |
| Uptime pinger | **None** (a 5-min pinger would keep the instance awake ~744 h/month and exhaust the shared 750 h, [data-auth-observability.md §6.2](../research/tech/data-auth-observability.md)) |

### 4.1 `render.yaml` (Blueprint; devops-engineer writes it)

| Field | Both services |
| --- | --- |
| `type` / `runtime` | `web` / `node` |
| `plan` | `free` — **always explicit** (omitting it creates a paid `0.5c-512mb` service, [platform-limits.md §B5](../research/tech/platform-limits.md)) |
| `region` | The Render region nearest to the Aiven service's assigned region. `render.yaml` carries `oregon` as a **placeholder that Cee must confirm or edit before the first Blueprint apply** (create Aiven first; region is immutable) |
| `rootDir` | repo root (Render hides files outside `rootDir`) |
| `buildFilter.paths` | `apps/server/**`, `packages/**`, `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `turbo.json`, `.nvmrc`, `render.yaml` (client-only changes don't spend build minutes) |
| Build command (ordered steps) | 1 install pinned pnpm · 2 `pnpm install --frozen-lockfile --prod=false --filter @moon-cleanup/server... --filter moon-cleanup` (server, its workspace deps and the root toolchain only — no Playwright, gltf-transform or three; saves build minutes) · 3 Turborepo build filtered to the server · 4 DB migrate (programmatic Drizzle migrator, `pnpm --filter @moon-cleanup/db run migrate`) · 5 achievements seed upsert (`pnpm --filter @moon-cleanup/server run seed`) |
| Start command | Run the built server entry with Node (heap cap via `NODE_OPTIONS`) |
| `healthCheckPath` | `/healthz` — **M0 must verify** that Render's health checks do not count as inbound traffic on Free; if they keep the instance awake, remove `healthCheckPath` from both services (M9) |
| `maxShutdownDelaySeconds` | 30 (support on Free unverified; drain is designed to finish in 25 s) |
| `envVars` | Secrets with `sync: false` (entered once in the dashboard) or `generateValue: true` (`JWT_SECRET`, `REFRESH_TOKEN_PEPPER`); non-secrets with literal `value`. `BUILD_VERSION` is **not** set (derived from `RENDER_GIT_COMMIT`). `render.yaml` is the source of truth for every value in §7.2; this doc mirrors it |

Render environment variables are available during the build, which is what lets the build command migrate the DB.

### 4.2 `vercel.json` (devops-engineer)

| Item | Rule |
| --- | --- |
| Install | Pinned pnpm, `pnpm install --frozen-lockfile --filter @moon-cleanup/client... --filter moon-cleanup` (client, its workspace deps and the root toolchain; never the server's uWS GitHub dependency) |
| Build | `VITE_BUILD_VERSION=$VERCEL_GIT_COMMIT_SHA pnpm exec turbo run build --filter=@moon-cleanup/client`; output `apps/client/dist` |
| Output layout | Vite's own hashed output goes to **`/_app/`** (`build.assetsDir = "_app"` in the client's Vite config). `/assets/` belongs to the asset pipeline and terrain bake, whose files are **content-hashed in the name**; their `manifest.json` is the only unhashed file there. The two never collide |
| Caching | `/_app/*` and `/assets/*` `public, max-age=31536000, immutable`; `/assets/manifest.json`, `/` and `/index.html` `max-age=0, must-revalidate`; `/hub/*` `max-age=3600` |
| SPA rewrite | Only **extension-less paths outside `/_app/`, `/assets/` and `/hub/`** rewrite to `/index.html` (`/((?!_app/|assets/|hub/|.*\\..*).*)`). A missing chunk or asset after a deploy therefore returns 404, never `index.html` with 200 cached for a year |
| Headers | CSP (static header part), COOP, Referrer-Policy, nosniff, Permissions-Policy from [security.md §4.4](security.md); the per-environment `connect-src` comes from the meta CSP the client build injects; `/hub/*` with `Access-Control-Allow-Origin: *` |
| Skip docs-only commits | `ignoreCommand`: `git diff --quiet HEAD^ HEAD -- apps/client packages pnpm-lock.yaml package.json pnpm-workspace.yaml turbo.json vercel.json tsconfig.base.json .nvmrc` (exit 0 = nothing relevant changed = skip the build) |
| Production deploys | `git.deploymentEnabled.release = false`; production builds come only from the release gate (§4.3) |

### 4.3 Release gate (client never ahead of the server)

`.github/workflows/release-client.yml` runs on every push to `release`: it reads `PROTOCOL_VERSION` from `packages/shared/src/protocol/messages.ts`, polls production `GET /healthz` every 30 s for up to 30 min until it reports that `protocolVersion` (a client-only commit passes on the first poll), then POSTs the Vercel production **Deploy Hook** for `release`. If Render's build fails (migration error, Aiven off, build minutes exhausted) the old client stays live and the workflow fails visibly. GitHub configuration (Cee, once): repository secret `VERCEL_PROD_DEPLOY_HOOK_URL` (Vercel → Project → Settings → Git → Deploy Hooks, branch `release`) and repository variable `PROD_SERVER_HTTP_URL`. Manual fallback: `/release-checklist` step "promote client". M0 verifies that a deploy hook still deploys when `deploymentEnabled.release` is false.

## 5. Render free-tier caveats

| Caveat | Consequence for us | Source |
| --- | --- | --- |
| **750 instance-hours/month per workspace**, shared by prod + staging | Budget prod ≤ 600 h, staging ≤ 100 h, 50 h reserve. When exhausted, **all** free services are suspended until next month. The server logs instance-seconds to `ops_usage_daily` (month-to-date on `/status`); Cee also checks the Render dashboard weekly. The wake probe runs only on first title-screen interaction, never for bots/crawlers, so hub visitors who bounce do not wake prod | [platform-limits.md §B2](../research/tech/platform-limits.md) |
| Spins down after 15 min without inbound traffic (WebSocket messages count) | Connected players keep it awake (inputs, 2-s pings); AFK kick after 30 min | §B2 |
| ~1 min cold start; Render may show its own loading page | Client wake probe on first title-screen interaction (assets already streaming); "Waking the moon…" ([system-overview.md §3](system-overview.md#3-boot-and-cold-start-sequence)) | §B2 |
| Restarts "at any time"; every deploy replaces the instance | SIGTERM drain + checkpoint + auto-rejoin ([netcode.md §9.3](netcode.md#93-deploy--restart-sigterm)) | §B1, §B4 |
| 5 GB outbound/month (Hobby workspace, **shared by staging**), no card → suspension | Bandwidth-lean, horizon-aware protocol; hidden tabs get 1 Hz Self-only frames; staging bot runs ≤ 5 min; logged and shown on `/status`, not capped (owner decision) | §B7 |
| No `preDeployCommand` on Free | Migrations run in the build command | §B4 |
| Ephemeral filesystem | Nothing written to disk; all state in PG | §B2 |
| 500 build minutes/month | `buildFilter`, filtered install (server deps only) and fewer server deploys (≈ 3–5 min per build → ≤ ~100 builds/month across both services) | §B2 |
| One public HTTP port, no UDP, one instance | WSS + REST on `PORT`; single process, no Redis | §B1 |
| Logs kept 7 days, ≤ 6,000 lines/min | One stats line per room per minute; never per tick | [data-auth-observability.md §6](../research/tech/data-auth-observability.md) |
| Staging also sleeps | First staging request each session waits ~1 min | — |
| Region immutable | Choose once, next to Aiven | §B3 |

## 6. Aiven PostgreSQL Free: power-off and reconnect

| Fact / risk | Plan |
| --- | --- |
| Region and cloud are assigned by Aiven and may change ([platform-limits.md §B3](../research/tech/platform-limits.md)) | Create the Aiven service first, then pick the Render region. If Aiven moves the service, update `DATABASE_URL` in both Render services |
| Aiven may power off free services with no initial usage within the first hours, or without "continuative activity" (notification first, threshold unstated); power-on is manual in the console | Create the service only when ready to run the first migration. Optional devops task: a weekly scheduled GitHub Actions workflow that calls production `/readyz` (wakes Render ≈ 16 min/week, runs one DB query) to keep the DB "active" |
| Connection behaviour | `postgres` driver pool: `connect_timeout` 10 s, `idle_timeout` 60 s, `max_lifetime` 30 min; the server boots **without** a DB connection (lazy) |
| DB unreachable at runtime | `/readyz` → `db: down`; running rooms keep playing, checkpoints retry with backoff (1 → 30 s) and dirty state stays in memory; new room creation and REST that needs the DB return 503 `DB_UNAVAILABLE`; Sentry alert at most once per 10 min; client shows the records-offline state |
| Recovery runbook (Cee) | Aiven console → service → **Power on** → wait for "Running" → nothing to redeploy; the pool reconnects on the next query. If a build failed because the DB was off, click "Redeploy" in Render |
| TLS | Aiven project CA, copied as PEM into `DATABASE_CA_CERT`; full verification ([security.md §4.3](security.md#43-tls)) |
| Two logical DBs | `moon_prod` / `moon_staging` with separate roles ([data-model.md §9](data-model.md#9-two-logical-databases)); fallback: two schemas in `defaultdb` |
| Storage 1 GB shared | Size alarms in [data-model.md §4](data-model.md#4-size-math-against-1-gb) |

## 7. Environment variables per service

Validation: the server parses all of its variables with a zod schema at boot (`apps/server/src/ops`) and exits non-zero with a list of missing/invalid names; the client validates `VITE_*` at build time. Every name below appears in the matching `.env.example` with a placeholder.

### 7.1 Client — Vercel (all `VITE_*` are public and baked into the bundle)

| Variable | Local | Staging (Preview, branch `main`) | Production |
| --- | --- | --- | --- |
| `VITE_SERVER_HTTP_URL` | `http://localhost:2567+N` | staging Render HTTPS URL | prod Render HTTPS URL |
| `VITE_SERVER_WS_URL` | `ws://localhost:2567+N` | staging Render `wss://` URL | prod Render `wss://` URL |
| `VITE_SENTRY_DSN` | empty | client Sentry DSN | client Sentry DSN |
| `VITE_BUILD_VERSION` | `dev` | set by build command from `VERCEL_GIT_COMMIT_SHA` | same |
| `VITE_ENV` | `local` | `staging` (other preview branches: `preview`) | `production` |
| `VITE_OFFLINE_SOLO` | `false` (opt-in) | `false` | `false` until v1.0 |
| Build-only (not exposed): `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT` | unset | set (source maps) | set |

### 7.2 Server — Render

| Variable | Local | Staging | Production |
| --- | --- | --- | --- |
| `NODE_ENV` | `development` | `production` | `production` |
| `PORT` | `2567+N` | injected by Render (10000) | injected by Render |
| `ENV_NAME` | `local` | `staging` | `production` |
| `DATABASE_URL` | Docker URL or unset (memory) | `moon_staging` URL (role `mc_staging`) | `moon_prod` URL (role `mc_prod`) |
| `DB_SCHEMA` | `prod` (default) | `staging` | `prod` |
| `DATABASE_CA_CERT` | empty | Aiven CA PEM | Aiven CA PEM |
| `PERSISTENCE_DRIVER` | `memory` or `postgres` | `postgres` | `postgres` |
| `DB_POOL_MAX` | 2 | 2 | 4 |
| `JWT_SECRET` | local random | unique random | unique random |
| `JWT_SECRET_PREVIOUS` | unset | unset unless rotating | unset unless rotating |
| `REFRESH_TOKEN_PEPPER` | local random | unique random | unique random |
| `ALLOWED_ORIGINS` | `http://localhost:5173+N` | `main` branch URL + listed previews + localhost dev ports | production origin only |
| `SENTRY_DSN` | empty | server Sentry DSN | server Sentry DSN |
| `SENTRY_TRACES_SAMPLE_RATE` | 0 | 0.01 | 0.01 |
| `LOG_LEVEL` | `debug` | `info` | `info` |
| `SIM_TICK_HZ` | 20 | 20 | 20 |
| `SNAPSHOT_HZ` | 10 | 10 | 10 |
| `MAX_ROOMS` | 3 | 3 | 3 |
| `TICK_BUDGET_MS` | 3.5 | 3.5 | 3.5 |
| `CLIENT_IP_HEADER` | unset (direct socket address locally) | `true-client-ip` (confirm in M0) | `true-client-ip` (confirm in M0) |
| `MAX_CLIENTS` | 24 | 24 | 24 |
| `CHECKPOINT_INTERVAL_S` | 30 | 30 | 30 |
| `SEAT_HOLD_S` | 60 | 60 | 60 |
| `BUILD_VERSION` | `dev` | unset → derived from `RENDER_GIT_COMMIT` (not in `render.yaml`) | same |
| `NODE_OPTIONS` | unset | `--max-old-space-size=384` | `--max-old-space-size=384` |

## 8. Open issues

1. Render Free support for `maxShutdownDelaySeconds`, whether health checks count as traffic (if they do, drop `healthCheckPath`), and the name of Render's documented client-IP header (`CLIENT_IP_HEADER`) are unverified; all three are M0 checks ([platform-limits.md §Contradictions](../research/tech/platform-limits.md)).
2. Aiven Free idle power-off threshold, extra databases/roles and `max_connections` are unverified; the weekly keep-active workflow is a proposal for Cee (it is a scheduled job, which [data-auth-observability.md §6.2](../research/tech/data-auth-observability.md) notes may or may not be acceptable under provider terms).
3. [platform-limits.md](../research/tech/platform-limits.md) recommended pinning Node 24; canonical [tech-stack.md](tech-stack.md) chose Node 26 (`.nvmrc` 26.13.1). Canonical kept; Render honours `.nvmrc` when `NODE_VERSION` is not set — do not set `NODE_VERSION` in the dashboard.
4. Exact production/staging hostnames (Vercel scope slug, Render subdomains) are known only after creation; record them in `docs/SETUP_CHECKLIST.md` and in `ALLOWED_ORIGINS`.

## 9. Canonical env var list

| Variable | Service | Required | Secret | Description | Value comes from |
| --- | --- | --- | --- | --- | --- |
| `VITE_SERVER_HTTP_URL` | client (Vercel) | yes | no | Base HTTPS URL of the game server for REST and `/healthz` | Vercel dashboard (Production / Preview-`main`), copied from the Render service URL |
| `VITE_SERVER_WS_URL` | client | yes | no | Base `wss://` URL for Colyseus | Vercel dashboard, Render URL with `wss://` |
| `VITE_SENTRY_DSN` | client | no | no (public DSN) | Browser Sentry project DSN; empty disables Sentry | Sentry project settings → Vercel dashboard |
| `VITE_BUILD_VERSION` | client | yes | no | Build identifier shown in UI, sent as `clientBuild`, Sentry release | Vercel build command from `VERCEL_GIT_COMMIT_SHA`; `dev` locally |
| `VITE_ENV` | client | yes | no | `local` · `preview` · `staging` · `production` | Vercel dashboard (per environment/branch) |
| `VITE_OFFLINE_SOLO` | client | no | no | Run `RoomSim` in a Web Worker without a server (dev flag; v1.0 feature) | `.env.local` / Vercel dashboard |
| `SENTRY_AUTH_TOKEN` | client build (Vercel) | for source maps | **yes** | Uploads source maps during the build | Sentry → Vercel dashboard (not `VITE_`) |
| `SENTRY_ORG` | client build | for source maps | no | Sentry organisation slug | Sentry → Vercel dashboard |
| `SENTRY_PROJECT` | client build | for source maps | no | Sentry client project slug | Sentry → Vercel dashboard |
| `VERCEL_GIT_COMMIT_SHA` | client build | auto | no | Commit SHA (system variable) | Provided by Vercel |
| `NODE_ENV` | server (Render) | yes | no | `production` on Render, `development` locally | Render dashboard / `render.yaml` |
| `PORT` | server | yes | no | HTTP/WS listen port | Injected by Render (10000); `2567+N` locally |
| `ENV_NAME` | server | yes | no | `local` · `staging` · `production`; used in JWT `aud`, logs, Sentry environment, lease ids | `render.yaml` value |
| `DATABASE_URL` | server | if `postgres` | **yes** | Postgres connection URL for this environment's DB and role | Aiven console → Overview → Connection information (host/port) + per-env DB/role created in the console → Render dashboard |
| `DB_SCHEMA` | server | no (default `prod`) | no | Postgres schema the repositories and migrations target: `prod` on production, `staging` on staging (the two-schemas-in-one-database fallback of §5 and [data-model.md §9](data-model.md#9-two-logical-databases) uses it; harmless with two logical DBs) | `render.yaml` / `.env.example` |
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
| `VERCEL_PROD_DEPLOY_HOOK_URL` | GitHub Actions (repository secret) | for production client deploys | **yes** | Vercel Deploy Hook for branch `release`, called by `release-client.yml` after the server reports the commit's protocol version (§4.3) | Vercel → Project → Settings → Git → Deploy Hooks → GitHub repository secrets |
| `PROD_SERVER_HTTP_URL` | GitHub Actions (repository variable); also read by `tools/bots`, `tools/perf`, e2e as a **deny** value | yes | no | Production Render HTTPS URL; the release gate polls it, test tools refuse to target it | GitHub → Settings → Variables; local `.env` of the tools |
