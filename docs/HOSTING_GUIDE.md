

- [ ] **A1. Run the local gates** (from the repo root, Git Bash/PowerShell with Node 26.13.1):
  `pnpm verify`, then the client size gate that CI also runs: `pnpm build` followed by
  `pnpm --filter @moon-cleanup/client run size:check` (first-load gzip must stay at or under 20 MB). Do this before pushing so CI does not fail on you.


### C. Render Blueprint (server)

- [ ] **C1.** <https://dashboard.render.com/> -> **New +** -> **Blueprint** -> connect GitHub (grant access to the repo) -> select the repo -> branch **main** -> Blueprint path `render.yaml`.
  Render shows one web service `moon-cleanup-server`, plan **Free**, region **Ohio**. (No card is expected for Free; if a card form appears, stop and read section 0.)
- [ ] **C2.** Fill the env var form (table below), then **Apply** (**Deploy Blueprint**).
- [ ] **C3.** Wait for the first build (several minutes). Open the service -> **Logs**. Confirm in the build log: Node 26.13.1, `[db:migrate] migrations applied to schema "prod"`, then the server start line.
- [ ] **C4.** Copy the service URL at the top of the service page (`https://moon-cleanup-server.onrender.com`, or with a random suffix if the name was taken). Open `<URL>/healthz`: JSON with 200. The first call may take about 1 minute.

| Group | Key | Value |
| --- | --- | --- |
| **Type this** | `ALLOWED_ORIGINS` | Pre-filled from `render.yaml` as `https://moon-cleanup.vercel.app`. Leave it for now; you change it in step E4 if your real Vercel URL differs (or you may type the real one now if you already know it) |
| **Paste from Neon** | `DATABASE_URL` | The direct connection string from B3 (secret) |
| **Leave blank** | `DATABASE_CA_CERT` | Optional; Neon needs none. Do not fill it for Neon |
| **Leave blank** | `SENTRY_DSN`, `JWT_SECRET_PREVIOUS` | Prompted because they are `sync: false`; empty is valid (off). If Render refuses an empty prompt, finish the Blueprint and add or skip them later under **Environment** |
| **Render generates** | `JWT_SECRET`, `REFRESH_TOKEN_PEPPER` | Random 32+ characters, nothing to type. Never regenerate the pepper later (it invalidates sessions/recovery codes) |
| **Already in `render.yaml`** | `NODE_ENV=production`, `PORT=10000`, `ENV_NAME=production`, `DB_SCHEMA=prod`, `DB_POOL_MAX=4`, `PERSISTENCE_DRIVER=postgres`, `CLIENT_IP_HEADER=true-client-ip`, `MAX_CLIENTS=12`, `MAX_ROOMS=3`, `SIM_TICK_HZ=20`, `SNAPSHOT_HZ=10`, `TICK_BUDGET_MS=3.5`, `CHECKPOINT_INTERVAL_S=30`, `SEAT_HOLD_S=60`, `LOG_LEVEL=info`, `SENTRY_TRACES_SAMPLE_RATE=0.01`, `NODE_OPTIONS=--max-old-space-size=384`, `NET_SPIKE=0` | Do not touch. Do **not** add `NODE_VERSION`: Render reads `.nvmrc` (verified against Render's docs: `NODE_VERSION` > `.node-version` > `.nvmrc` > `engines`) |

### D. Vercel (client)

- [ ] **D1.** <https://vercel.com/new> (sign in with GitHub) -> **Import** the repo -> **Project Name** `moon-cleanup` (gives `https://moon-cleanup.vercel.app` if free; Vercel appends letters if taken).
- [ ] **D2.** **Root Directory: leave as the repo root.** Framework Preset **Vite**. Leave the Build, Install and Output overrides **off** (`vercel.json` provides them).
- [ ] **D3.** Before clicking **Deploy**, open **Environment Variables** and add these for the **Production** environment (use the Render URL from C4):

| Key | Value to paste |
| --- | --- |
| `VITE_SERVER_HTTP_URL` | `https://moon-cleanup-server.onrender.com` (your real C4 URL, no trailing slash) |
| `VITE_SERVER_WS_URL` | `wss://moon-cleanup-server.onrender.com` (same host, `wss://`) |
| `VITE_ENV` | `production` |
| `VITE_SENTRY_DSN` | Optional; leave out to keep Sentry off (public by design) |
| `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT` | Optional, only for source-map upload; never `VITE_`-prefixed |

  Do not set `VITE_BUILD_VERSION` (the build command derives it). The CSP only allows `*.onrender.com`, so the server URL must be a `onrender.com` address.
- [ ] **D4.** **Deploy**. Confirm: the deployment turns **Ready** and the **Visit** button opens the page (title **Clean The Moon!**). Copy the production URL
  (e.g. `https://moon-cleanup.vercel.app`; this exact origin goes into E4).
- [ ] **D5.** Project **Settings -> Build and Deployment**: confirm Production Branch is **main** and Node.js Version is 26.x (the repo `engines` is `26.x`, which Vercel selects; research lists 26.x as available).

**Preview deployments.** Vercel also builds pull requests and other branches at their own `...-git-<branch>-....vercel.app` URLs. Those origins are **not** in
`ALLOWED_ORIGINS`, so their client cannot reach the server. Default: ignore previews (you push straight to `main`). If you ever want one, add its exact origin
(comma-separated) to `ALLOWED_ORIGINS` on Render, and set `VITE_ENV=preview` plus the two `VITE_SERVER_*` values for the **Preview** environment on Vercel.

## 2. Render (game server)

Prereq: the repo (with `render.yaml` and the baked terrain payloads) is pushed to GitHub `main` by you. Render needs no card for Free.

1. [Render Dashboard](https://dashboard.render.com/) -> **New -> Blueprint** -> connect GitHub, select this repo, branch **main**,
   Blueprint path `render.yaml`. Render lists one web service. Reuse/update an existing one instead of duplicating.
2. Confirm: name `moon-cleanup-server`, runtime Node, **plan Free** (an omitted plan would be paid), branch `main`, auto-deploy
   after checks pass. Region: `ohio` in `render.yaml` (owner decision: nearest Render region to Texas; it cannot be changed later without recreating the service). Neon runs in AWS us-east-2 (Ohio), the same metro, so save latency is small.
3. Enter the prompted secrets (those marked `sync: false`), table below. `JWT_SECRET` and `REFRESH_TOKEN_PEPPER` are generated by Render.
4. Click **Apply**. First build takes several minutes. Watch the log for the Node version (from `.nvmrc`, 26.13.1; Render honours `.nvmrc`
   per its Node-version docs, so `NODE_VERSION` is deliberately not set, and any dashboard `NODE_VERSION` override would win over `.nvmrc`), the `[db:migrate]` line and the server start.
5. Copy the service URL shown at the top (`https://<name>.onrender.com`). It may differ from the sample name.

Commands (verified against `package.json` scripts):

| Setting | Value |
| --- | --- |
| Build | `npm install --global pnpm@11.28.9 && pnpm install --frozen-lockfile --prod=false --filter "@moon-cleanup/server..." --filter moon-cleanup && pnpm exec turbo run build --filter=@moon-cleanup/server && pnpm --filter @moon-cleanup/db run migrate && pnpm --filter @moon-cleanup/server run seed` |
| Start | `node apps/server/dist/index.js` (produced by `apps/server/build.config.mjs`) |
| Health check path | `/healthz` (liveness, always 200 once the port is bound, no DB). `/readyz` probes the DB and returns 503 when not ready; it is for you, not the Render health check |
| Listen | `0.0.0.0` on `PORT` (Render sets 10000; yaml also fixes it) |

The `seed` step is currently an `echo` placeholder that exits 0 (real seed arrives with M1 persistence); it does nothing and cannot fail the build.
`pnpm-lock.yaml` must be committed (`--frozen-lockfile`).

Env vars. Server boot validates all of these (`apps/server/src/ops/env.ts`) and refuses to start with a readable, secret-free error.

| Key | Value | Source |
| --- | --- | --- |
| `DATABASE_URL` | Neon **direct** connection string (`sslmode=require`) | Secret, you paste (prompted) |
| `DATABASE_CA_CERT` | Leave empty for Neon (optional private-CA PEM) | Prompted; empty is valid |
| `TRANSPORT` | `auto` (default; `uws` or `ws` to force). Not in `render.yaml`; add it in the dashboard only to force a transport | Optional, see checklist F |
| `ALLOWED_ORIGINS` | Exact Vercel origin, e.g. `https://<project>.vercel.app`; comma-separate several; no path, no trailing slash, `http(s)` only | `render.yaml` has the placeholder `https://moon-cleanup.vercel.app`: replace in yaml and dashboard in step 4.4 (checklist E4) |
| `SENTRY_DSN` | Optional | Empty = off |
| `JWT_SECRET` | min 32 chars | Generated by Render (`generateValue`); you need nothing |
| `REFRESH_TOKEN_PEPPER` | min 32 chars; changing it invalidates refresh tokens/recovery codes | Generated by Render |
| `JWT_SECRET_PREVIOUS` | Empty normally (min 32 chars if set); only during key rotation | Prompted; leave blank |
| `ENV_NAME` | `production` (allowed: `local`, `production`) | Fixed in yaml |
| `NODE_ENV` / `PORT` | `production` / `10000` | Fixed in yaml |
| `PERSISTENCE_DRIVER` | `postgres` (`memory` is refused unless `ENV_NAME=local`) | Fixed |
| `DB_SCHEMA` / `DB_POOL_MAX` | `prod` / `4` | Fixed |
| `CLIENT_IP_HEADER` | `true-client-ip` (Render's edge header; blank is refused unless `ENV_NAME=local`) | Fixed |
| `MAX_CLIENTS` / `MAX_ROOMS` | `12` / `3` (cap 6 players per room) | Fixed |
| `MAX_SEATS_PER_IP` | Optional, integer 1-64, default `6` (one full room): live seats one client IP may hold. Raise it only for demos where many players share one address | Not in yaml (default applies) |
| `SIM_TICK_HZ` / `SNAPSHOT_HZ` | `20` / `10` (snapshot must divide tick) | Fixed |
| `TICK_BUDGET_MS`, `CHECKPOINT_INTERVAL_S`, `SEAT_HOLD_S` | `3.5`, `30`, `60` | Fixed |
| `LOG_LEVEL`, `SENTRY_TRACES_SAMPLE_RATE` | `info`, `0.01` | Fixed |
| `NODE_OPTIONS` | `--max-old-space-size=384` | Fixed |
| `NET_SPIKE` | `0`. Env validation **refuses `1` when `ENV_NAME=production`** | Fixed, see section 5 |
| `RENDER_GIT_COMMIT` | Platform-provided; server derives the build id from its first 12 chars | Do not set |


## 3. Vercel (client)

1. [Vercel Dashboard](https://vercel.com/dashboard) -> **Add New -> Project** -> import this repo.
2. **Root Directory: leave blank (repository root)**. Do not set `apps/client`: the build needs the pnpm workspace.
3. Framework Preset **Vite**. Leave Install/Build/Output overrides **off**: `vercel.json` already sets them.
4. **Settings -> General:** Production Branch **main**; Node.js Version **26.x** if offered (repo `engines` is `26.x`; if Vercel
   does not list 26 yet, check the Vercel Node versions page and tell Claude, since the lowest working version is a code decision).
5. **Settings -> Environment Variables (Production), set BEFORE the first build** (Vite bakes them in; a missing value silently
   falls back to `http://localhost:2567`, a broken production client). Use the Render URL from section 2:

| Key | Value |
| --- | --- |
| `VITE_SERVER_HTTP_URL` | `https://<service>.onrender.com` |
| `VITE_SERVER_WS_URL` | `wss://<service>.onrender.com` |
| `VITE_ENV` | `production` |
| `VITE_SENTRY_DSN` | Optional, empty = off |
| `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT` | Optional, only for source-map upload; never `VITE_` |

Do not set `VITE_BUILD_VERSION` (the build command sets it from `VERCEL_GIT_COMMIT_SHA`) and never put DB or JWT secrets on Vercel.