# Connect Aiven, Render and Vercel

For **Clean The Moon!**: Vercel serves the browser client, Render runs the authoritative game server, and Aiven PostgreSQL
stores progress. Both deployments use `main`; there is one Render service. You choose when to publish.

**Current state:** M0 still contains placeholder dev/build/migration scripts. These instructions describe the intended
working setup; provision/deploy when those scripts and the server are implemented. An `echo` script succeeding does not
prove a build, migration or connection. For localhost use [README](../README.md#run-on-localhost).

```text
Browser → Vercel client → HTTPS / WSS → Render server → TLS → Aiven PostgreSQL
```

## 1. Aiven: create the database and collect connection details

1. Open the [Aiven Console](https://console.aiven.io/). Create/select your project and a **PostgreSQL Free** service.
   Reuse an existing chosen service. On Free, Aiven assigns the cloud/region; note it before choosing Render's region.
2. Wait for **Running**. Open the service's **Overview / Connection information** and copy its **Service URI** privately.
   It contains the username, password, host, port and database. Preserve the supplied port and encoded password.
3. Use a dedicated application database/user if available with the required migration privileges. Otherwise keep the
   supplied `defaultdb`; this project uses schema `prod` inside it. `prod` is a schema, not a hostname or database name.
4. Download/copy the **CA certificate**. Render needs the complete PEM text, including its BEGIN/END lines, as
   `DATABASE_CA_CERT`. It is certificate text, not the path `C:\...\ca.pem`. Keep TLS certificate verification enabled.
5. Put the URI and certificate into Render's environment below. They never go into the browser or Vercel client settings.

URI shape only — replace every placeholder privately; do not paste this example unchanged:

```text
postgres://<USER>:<URL_ENCODED_PASSWORD>@<HOST>:<PORT>/<DATABASE>?sslmode=require
```

The CA must also be used by the server/database driver for verified TLS; `sslmode=require` alone is not proof of identity
verification. Claude must implement and verify that behavior in M0. See [Aiven setup](https://aiven.io/docs/products/postgresql/get-started)
and [TLS certificates](https://aiven.io/docs/platform/concepts/tls-ssl-certificates).

## 2. Render: connect the backend

1. In the [Render Dashboard](https://dashboard.render.com/), choose **New → Blueprint** and connect this repository.
   Select branch **main**, Blueprint path **render.yaml**. Reuse/update an existing matching service instead of creating duplicates.
2. Confirm one web service, `moon-cleanup-server`, **Free**, Node runtime, root = repository root. Confirm the region
   before first creation; `oregon` in `render.yaml` is a placeholder to compare with Aiven's assigned region.
3. Keep the build/start/health settings from [render.yaml](../render.yaml). The build installs workspace dependencies,
   builds the server, runs migrations and seed; start is `node apps/server/dist/index.js`, health path `/healthz`.
   Keep `checksPass` auto-deploy behavior. The server must listen on `0.0.0.0` and `PORT`.
4. Supply the manual values below under the service's **Environment**. On initial Blueprint creation, `sync: false`
   keys prompt for values; later updates to those keys are made directly in the service dashboard.
5. The repo's `.nvmrc` selects Node 26.13.1. Remove an obsolete dashboard `NODE_VERSION` override or make it match;
   dashboard overrides take precedence. Check the actual Node version in build logs.
6. When you choose to deploy, inspect build/migration/start logs and copy the service's actual HTTPS URL.
   Example shape: `https://<your-service>.onrender.com`; do not assume the sample service name is your assigned hostname.

Manual Render values:

| Key | Value / where it comes from | Secret? |
| --- | --- | --- |
| `DATABASE_URL` | Full Aiven Service URI for the chosen application DB/user | Yes |
| `DATABASE_CA_CERT` | Full Aiven PEM certificate, preserving line breaks | Public certificate; keep it server-side |
| `ALLOWED_ORIGINS` | Actual Vercel origin, e.g. `https://<your-project>.vercel.app`; no path or trailing slash | No |
| `SENTRY_DSN` | Optional server project's DSN; empty disables reporting | No credential; optional |
| `JWT_SECRET_PREVIOUS` | Empty normally; previous key only during deliberate JWT key rotation | Yes, when set |

`ALLOWED_ORIGINS` is a Blueprint `value`: update the non-secret value in `render.yaml` to the real origin as well as the
dashboard, so a later Blueprint sync does not restore the sample domain. For several exact origins, comma-separate them.

Generated secrets — Render creates these using `generateValue: true`; keep the generated values, do not replace them with examples:

| Key | Purpose |
| --- | --- |
| `JWT_SECRET` | Signs access tokens |
| `REFRESH_TOKEN_PEPPER` | Protects refresh/recovery/join-ticket and IP hashes; changing it invalidates related credentials |

Defaults already supplied by the repository Blueprint (no need to type them again):

| Key | Configured value |
| --- | --- |
| `NODE_ENV`, `ENV_NAME` | `production` |
| `PORT` | `10000` |
| `PERSISTENCE_DRIVER`, `DB_SCHEMA`, `DB_POOL_MAX` | `postgres`, `prod`, `4` |
| `LOG_LEVEL`, `SENTRY_TRACES_SAMPLE_RATE` | `info`, `0.01` |
| `SIM_TICK_HZ`, `SNAPSHOT_HZ` | `20`, `10` |
| `MAX_ROOMS`, `MAX_CLIENTS`, `TICK_BUDGET_MS` | `3`, `24`, `3.5` |
| `CHECKPOINT_INTERVAL_S`, `SEAT_HOLD_S` | `30`, `60` |
| `CLIENT_IP_HEADER` | `true-client-ip` (verify trusted proxy handling in M0) |
| `NODE_OPTIONS` | `--max-old-space-size=384` |
| `NET_SPIKE` | `0`; do not enable with live players/data |

`RENDER_GIT_COMMIT` is platform-provided; the server derives `BUILD_VERSION` from it. No manual commit hash needed.
For provider behavior see [Blueprint variables](https://render.com/docs/blueprint-spec),
[Node selection](https://render.com/docs/node-version) and [web service binding](https://render.com/docs/web-services).

## 3. Vercel: connect the browser client

1. In the [Vercel Dashboard](https://vercel.com/dashboard), add/import this repository as a project.
2. Set **Root Directory = repository root** (leave blank), **Framework = Vite**, **Production Branch = main**,
   **Node.js Version = 26.x**. Do not set the root to `apps/client`: the repository config builds the pnpm workspace.
3. Use [vercel.json](../vercel.json) for install/build/output settings. Output is `apps/client/dist`; keep its build
   command, which injects `VITE_BUILD_VERSION` from `VERCEL_GIT_COMMIT_SHA`.
4. Under **Settings → Environment Variables**, add these to **Production**. Preview is optional and needs its own
   explicitly permitted origin and safe test data; do not treat it as a second permanent backend.

| Key | Production value | Secret? |
| --- | --- | --- |
| `VITE_SERVER_HTTP_URL` | Render HTTPS URL, e.g. `https://<your-service>.onrender.com` | No, public |
| `VITE_SERVER_WS_URL` | Same host with `wss://`, e.g. `wss://<your-service>.onrender.com` | No, public |
| `VITE_ENV` | `production` | No |
| `VITE_SENTRY_DSN` | Optional browser project's DSN; empty disables reporting | Public DSN |
| `VITE_OFFLINE_SOLO` | Leave unset/empty; offline mode is not the current core path | No |
| `SENTRY_AUTH_TOKEN` | Optional source-map upload token; only if enabling uploads | Yes; build-only, never `VITE_` |
| `SENTRY_ORG`, `SENTRY_PROJECT` | Matching Sentry organization/client project slugs, only for uploads | No; build-only |

Do not add `DATABASE_URL`, `JWT_SECRET`, `REFRESH_TOKEN_PEPPER` or database credentials to Vercel for this static client.
Do not manually set `VERCEL_GIT_COMMIT_SHA` or `VITE_BUILD_VERSION` in the dashboard; the platform/build command supplies them.

5. When you choose to deploy, copy the actual client origin into Render `ALLOWED_ORIGINS` and `render.yaml`.
   Save/redeploy the server for environment changes to take effect. Open the client and check the HTTP/WSS connection.
6. Rebuild/redeploy Vercel after changing client environment values: Vite embeds them during build. Restart the local
   dev server after changing `.env.local`. Every `VITE_*` value is visible to browser users.

See [Vercel environment scopes](https://vercel.com/docs/environment-variables),
[Vercel Node versions](https://vercel.com/docs/functions/runtimes/node-js/node-js-versions) and
[Vite env loading](https://vite.dev/guide/env-and-mode.html).

## 4. Verify the connection

After real server/client/migrations exist, replace the hostname and run in PowerShell:

```powershell
Invoke-RestMethod 'https://<your-service>.onrender.com/healthz'
Invoke-RestMethod 'https://<your-service>.onrender.com/readyz'
```

Health should report the actual build/protocol; readiness should reflect a working database connection. Then open the
Vercel URL, join a session and verify a connected WebSocket in browser DevTools. Test save/reconnect on isolated data;
memory-mode success does not verify Aiven persistence. Do not expose connection strings or tokens in screenshots/logs.

| Problem | Check |
| --- | --- |
| Build only prints `placeholder` / no `dist/index.js` | M0 scripts/sources are unfinished; a dashboard setting cannot supply the implementation |
| Render never listens / health fails | Real start/build output, host `0.0.0.0`, `PORT`, server errors; a cold service may need time to wake |
| DB auth/connection failure | Aiven Running, exact URI/port/user/database, encoded password, network access rules, migration privileges |
| Certificate failure | Full correct CA PEM and verified TLS driver setup; do not disable verification |
| CORS or socket rejection | Exact browser origin in Render allow-list; HTTPS uses WSS; redeploy changed settings |
| Old server URL in browser | Correct Production scope, rebuild Vercel, refresh the page |
| Updating/version mismatch screen | Client/server builds deploy independently; compare health/protocol versions |

## 5. Where secrets live

Local: `apps/server/.env`; optional local Sentry build token in `apps/client/.env.local`. Hosted: Render/Vercel dashboard
environment settings for the correct service. The repo ignores these local files and certificates; examples contain no real values.
Keep backups of stable production secrets in your password manager. If a secret leaks, rotate it at the provider and update
the affected service; deleting text from a file alone does not revoke it. No deployment-hook/API token is needed for ordinary dashboard setup.

Full implementation contract: [environment keys](architecture/environments.md#9-canonical-env-var-list).
Claude: when M0 implements dev/migrate scripts, load the documented env files explicitly and keep this guide/README aligned
with actual commands. No additional planning document or commit gate is required.
