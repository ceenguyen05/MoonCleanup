# Hosting runbook: Postgres, Render, Vercel

For **Clean The Moon!**. Audited against the code on 2026-11-13 (see [M0-deploy-audit](agent-reports/M0-deploy-audit.md)).
Everything is `main` only, one Render service, schema `prod` ([ADR-0029](adr/0029-single-deploy-branch-main.md)).
You do all account, dashboard and git steps; nothing here needs an agent. For localhost use [README](../README.md#run-on-localhost).

# START HERE: checklist

Do the steps in this order and tick each box. Flow: **GitHub (public repo) -> push `main` -> Render Blueprint auto-deploys the
server, Vercel git integration auto-deploys the client**, with the database and env vars set in the provider dashboards.
Placeholders in angle brackets (`<...>`) are yours to fill. Reference detail is in sections 0-8 below.

### A. GitHub (the repo already exists and is public)

Public is fine: Render Free and Vercel Hobby both deploy public repos, and Vercel Hobby only forbids commercial use, which does not apply here.

> **Public repo hygiene.** Everything pushed is world-readable forever (history included).
> Never commit `apps/server/.env`, `apps/client/.env.local` or any real secret (the `.gitignore` already excludes `.env` / `.env.*`
> but keeps `.env.example`). Secrets live only in the Render and Vercel dashboards. `DATABASE_URL` is pasted only
> into Render. If a secret ever reaches GitHub, rotate it at the provider; deleting the file does not help. No Dependabot
> version updates (owner decision): if GitHub offers to enable them, skip; "Dependabot alerts" (notifications only) are harmless.
> `VITE_*` values and the Sentry DSN end up in the public bundle by design, so never put a secret in them.

- [ ] **A1. Run the local gates** (from the repo root, Git Bash/PowerShell with Node 26.13.1):
  `pnpm verify`, then the client size gate that CI also runs: `pnpm build` followed by
  `pnpm --filter @moon-cleanup/client run size:check` (first-load gzip must stay at or under 20 MB). Do this before pushing so CI does not fail on you.
- [ ] **A2. Make sure these are in the first commit** (they are all tracked-by-default, none is ignored):
  `pnpm-lock.yaml`, `assets/terrain/*.bin` + `assets/terrain/manifest.json` (baked terrain; only `assets/terrain/raw/` and `cache/` are ignored),
  `.nvmrc`, `render.yaml`, `vercel.json`, `.github/` (workflows). **Not** `apps/server/.env`, `apps/client/.env.local` (ignored).
  Check before committing: `git status --short` must not list any `.env` file other than `.env.example`.
- [ ] **A3. Add the remote and push** (you run these; `<owner>/<repo>` is the existing GitHub repo):

  ```powershell
  git remote add origin https://github.com/<owner>/<repo>.git
  git push -u origin main
  ```

  If `origin` already exists, `git remote -v` shows it and you skip the first line.
- [ ] **A4. Confirm Actions ran:** GitHub repo -> **Actions** tab -> workflow **CI** on your push turns green.
  Confirm: the run ends with the job **CI gate** passing. If the Actions tab says workflows are disabled, click **I understand my workflows, enable them**
  (repo **Settings -> Actions -> General -> Allow all actions**; the workflows only use pinned official actions and `pnpm/action-setup`).

What runs on push (from `.github/workflows`, nothing for you to configure):

| Workflow | Trigger | What it checks |
| --- | --- | --- |
| `ci.yml` "CI" | push to `main`, every pull request | Detect job (action SHA pins, `vercel.json` contract), then install, Prettier + lint, `pnpm audit --prod` (high+), golden hashes (skips until a script exists), save fixtures, typecheck, unit tests, build + 20 MB first-load size check, software-WebGL2 smoke (Playwright Chromium). The aggregate job **CI gate** fails if any of those fail |
| `asset-validation.yml` "Asset validation" | pull requests touching `assets/**`, `apps/client/public/assets/**`, `docs/ASSET_LICENSES.md` only | File sizes (10 MiB each), banned types, content-hashed names, new assets listed in the license ledger. Not run on direct pushes to `main` |

Render's `autoDeployTrigger: checksPass` makes Render wait for the commit's GitHub checks to pass before it deploys; **CI gate** is the single
aggregate check that fails when any CI job fails, so a red CI means no Render deploy. Repo secrets or variables needed: **none** (the workflows use only
the automatic `GITHUB_TOKEN`). Optional, not required: branch protection on `main` with **CI gate** as the required check (you push straight to `main`, so it is off by default).
Vercel does not wait for CI; it builds every push independently.

### B. Neon Postgres

Neon Free: 1 GB storage per project, 100 compute-hours per month (a 0.25 CU compute runs about 400 hours), **no credit card**, and the compute
**scales to zero after 5 idle minutes and wakes by itself on the next connection** (about 1-5 s; nothing to power on). Neon's docs list no inactivity
deletion for Free projects in AWS regions. Facts are from <https://neon.com/docs/introduction/plans> and <https://neon.com/pricing>; the console layout can change, so trust what you see.

- [ ] **B1.** Go to <https://neon.com> -> **Sign up** -> **Continue with GitHub** (no card form should appear; if one does, stop and read section 0).
- [ ] **B2.** Create the project (the first-run wizard, or **New project** in the console): **Project name** `moon-cleanup`; **Postgres version** the default; **Region: AWS US East 2 (Ohio)**
  (`aws-us-east-2`, the same metro as Render Ohio, so saves are fast); leave other options at their defaults. Click **Create**. The project comes with branch `main`, database `neondb` and role `neondb_owner`.
- [ ] **B3.** On the project dashboard click **Connect**. In the connection-string dialog set Branch `main`, Database `neondb`, Role `neondb_owner`, and **turn Connection pooling OFF** (the host must NOT contain `-pooler`).
  Click **Show password**, then copy the whole string. It looks like
  `postgresql://neondb_owner:<password>@ep-<words>-<digits>.us-east-2.aws.neon.tech/neondb?sslmode=require&channel_binding=require`. Keep it in a scratch note (not in the repo) until step C3.
  Confirm: it starts with `postgresql://`, the host ends `.us-east-2.aws.neon.tech` and has no `-pooler`, and it contains `sslmode=require` (the extra `&channel_binding=require` is fine).
  There is **no CA certificate to copy** (Neon uses a publicly trusted CA; the server checks it against Node's built-in store).
- [ ] **B4.** Nothing else: the app creates schema `prod` itself during the Render build. A sleeping database is not a problem: the first build/server connection wakes it (the build log may show `[db] waking database…` and a retry).

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

### E. Order of operations (chicken and egg)

The server needs the Vercel origin (`ALLOWED_ORIGINS`) and the client needs the Render URL (`VITE_SERVER_*`). Break the loop like this:

1. **Neon** first (B). 2. **Render** second (C): it works without the Vercel URL because `ALLOWED_ORIGINS` has a placeholder. 3. **Vercel** third (D) with the real Render URL, so the client needs no rebuild.
4. **Redeploy point 1 (Render):** if the Vercel URL from D4 is not exactly `https://moon-cleanup.vercel.app`: Render -> `moon-cleanup-server` -> **Environment** -> edit `ALLOWED_ORIGINS`
   to the exact Vercel origin (`https://...vercel.app`, no path, no trailing slash) -> **Save changes**. Render redeploys by itself (or **Manual Deploy -> Deploy latest commit**). Then edit the same value in `render.yaml` so a later Blueprint sync does not revert it; commit it with your next push.
5. **Redeploy point 2 (Vercel):** only needed if you changed any `VITE_SERVER_*` / `VITE_*` value after the first deploy (for example the Render URL had a random suffix you fixed later):
   Vercel -> project -> **Deployments** -> latest -> **...** -> **Redeploy** (Vite bakes env values in at build time, so a redeploy is the only way a change takes effect).
6. Open the Vercel URL and run the smoke checklist (section 5).

### F. How a push deploys

```text
git push origin main
   |
   +--> GitHub Actions "CI" ---> ... jobs ... ---> "CI gate" (green/red)
   |                                                    |
   |                                         green: Render deploys (build filter: server, packages, lockfile, root configs)
   |                                         red:   Render does NOT deploy
   |
   +--> Vercel git integration (starts immediately, does not wait for CI)
             |-- ignoreCommand: nothing the client uses changed since last good deploy? -> build skipped
             `-- otherwise: install -> turbo build client -> publish to the CDN

Render rebuild = pnpm install -> build server -> DB migrate (schema prod) -> seed (placeholder) -> restart (~1 min of cold-ish start)
```

When a deploy fails, look here first:

| Where | Path | What to look for |
| --- | --- | --- |
| GitHub | repo -> **Actions** -> the failed run -> failed job | Lint/type/test/build/size error; fix and push again |
| Render | service -> **Events** (status of each deploy) then **Logs** (build log, then runtime log) | `[db:migrate]` line (and `[db] waking database…` retries), the `[net] transport=` line, env validation message at boot (secret-free, names the bad key) |
| Render | `https://<service>.onrender.com/readyz` | 200 = DB reachable; 503 = DB or admission not ready. `/healthz` 200 only proves the process is up |
| Vercel | project -> **Deployments** -> click the deployment -> **Build Logs** | pnpm install/turbo errors, missing `VITE_*`, "Canceled" = skipped by `ignoreCommand` (normal when only server/docs changed) |

Skipped Vercel builds (`ignoreCommand`): it compares the last **successful** Vercel deployment (`VERCEL_GIT_PREVIOUS_SHA`) with the new commit over `apps/client`, `packages`, `assets`, the lockfile and root configs.
It never skips when that reference is missing: the very first deploy, an empty or unfetchable previous SHA (shallow clone), or any git error all end in "build". A skipped build still shows as **Canceled** and counts toward Vercel's daily deployment quota.

**uWebSockets.js (server transport).** `uWebSockets.js` is an optional dependency installed from a GitHub tarball during the Render build. If the tarball cannot be fetched or the native addon cannot load, the server boots on Colyseus' built-in `ws` transport with the same protections (slightly more CPU per socket). The runtime log shows which one is live: `[net] transport=uws` (uWS loaded, normal), `[net] transport=ws (TRANSPORT=ws)` (forced), or the warning `[net] transport=ws (uWebSockets.js unavailable: <reason>)` (fallback). To get uWS back, use **Manual Deploy -> Clear build cache & deploy**. `TRANSPORT=uws` makes a missing uWS fatal; `TRANSPORT=ws` forces the fallback; default `auto`. Unverified: whether pnpm on Render skips a failed GitHub-tarball fetch of an optional dependency (look at the first Render build log).

### G. First visit and when something is wrong

**First visit after idle:** Render Free sleeps after 15 min without traffic. The first request takes about 1 minute; the client shows the **waking** screen, retries by itself and continues when the server answers. This cold start is accepted (no keep-alive pinger).
**Monitors: `/healthz` only.** Any uptime or health monitor must hit `/healthz`, never `/readyz`: `/readyz` touches the database, so polling it would keep Neon awake and burn compute hours.
*Optional, later:* an external uptime monitor pinging `https://<service>.onrender.com/healthz` every 5-10 minutes would keep it awake, but one always-awake service uses 720-744 of your 750 free hours per month and the traffic counts toward the 5 GB egress cap; do this only if you decide cold starts hurt demos.
Neon Free scales the database to zero after 5 idle minutes and wakes by itself (about 1-5 s on the next connection), so there is nothing to power on; the server and the Render build retry through the wake.

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| Browser console: CORS error / "blocked by CORS policy" on a request to `onrender.com` | `ALLOWED_ORIGINS` does not exactly equal the page origin (scheme, host, no trailing slash, no path) or you are on a preview URL | Fix `ALLOWED_ORIGINS` on Render, save, wait for the redeploy; reload |
| WebSocket closes with code **1006** immediately (or never opens) | Server still waking; origin rejected at the handshake (same cause as CORS); `VITE_SERVER_WS_URL` is `ws://`, wrong host or baked as `localhost`; blocked by `connect-src` | Open `<server>/healthz` first and wait for 200; check `ALLOWED_ORIGINS`; check the Vercel env values and **Redeploy** if you changed them; look at Render Logs for a rejected origin |
| Blank page on Vercel | Root Directory set to `apps/client` (wrong); Output Directory override; a JS error in the console | Vercel Build Logs and browser console; root dir must be blank, no overrides; **Redeploy** |
| `503` with `at_capacity` (REST error `AT_CAPACITY`) | Server admission limit: `MAX_ROOMS=3` rooms or `MAX_CLIENTS=12` connections reached (Free 512 MB is the reason) | Wait and retry (`retry-after` header); it is expected under load, not a bug. Raising limits needs a bigger instance |
| TLS / "self-signed certificate" / certificate error to the database in the Render log | `DATABASE_CA_CERT` is set to something that is not Neon's CA (for example a leftover from the old Aiven plan), or the URL host is wrong | Clear `DATABASE_CA_CERT` (Neon needs none) and keep `?sslmode=require` in `DATABASE_URL` |
| Build fails at `[db:migrate]` / `ECONNREFUSED` / timeout | Wrong URL (host, URL-encoded password), `-pooler` host (refused on purpose), or a Neon outage | The build already retried through a cold wake (about 4 min of backoff). Re-copy the **direct** string from B3, check <https://neonstatus.com>, then Render -> **Manual Deploy -> Deploy latest commit** |
| Render deploy never starts after a push | CI red, or the push only touched files outside the Render build filter | Check the Actions run; for a forced rebuild use **Manual Deploy** |

---

## 0. What runs where

```text
Browser -> Vercel (static client) -> HTTPS / WSS -> Render Free (Node game server) -> TLS -> Neon PostgreSQL Free
```

| Piece | Host | Why |
| --- | --- | --- |
| Client (static Vite build, `apps/client/dist`) | Vercel Hobby, free, non-commercial | Static hosting, global CDN, auto-deploys `main` |
| Game server + REST (`apps/server`, Colyseus on uWebSockets) | One Render Free web service `moon-cleanup-server` | Needs a long-lived WebSocket process; Vercel cannot host it |
| Saves | Neon **Free** PostgreSQL (AWS us-east-2), schema `prod` | [ADR-0002](adr/0002-hosting-topology-free-tier.md); Neon replaced Aiven Free on 2026-11-13 because it wakes from scale-to-zero by itself |

Free-tier facts (from [platform-limits](research/tech/platform-limits.md); re-check the provider pricing pages before you rely on them):

| Limit | Value |
| --- | --- |
| Render Free CPU / RAM | 0.1 CPU / 512 MB (hence `--max-old-space-size=384`, `MAX_ROOMS=3`) |
| Render sleep | Spins down after 15 min with no inbound HTTP or WebSocket traffic; wake takes about 1 min, browsers see a loading page meanwhile |
| Render hours | 750 free instance-hours per workspace per month (one always-awake service uses 720-744) |
| Render egress | 5 GB/month on Hobby; without a payment method, services are suspended for the rest of the month when exceeded |
| Render filesystem | Ephemeral (the game never relies on it; saves go to Postgres) |
| Neon Free Postgres | 1 GB storage and 100 compute-hours per project per month, 0.25-2 CU autoscaling, scale to zero after 5 min idle (cannot be disabled), about 1-5 s wake, no card ([plans](https://neon.com/docs/introduction/plans)) |
| Vercel Hobby | Free; commercial use not allowed. Check Vercel pricing page for current bandwidth/build limits (not verified here) |

**Card needed?** The docs claim $0 and say Render does not need a card for a free service. Neon states "no credit card required" for the Free plan
([pricing](https://neon.com/pricing)); Vercel Hobby is also stated as free. I could not verify at signup time whether any of the three asks for a card; if a form asks for one,
stop and decide. Do not add one to Render: with no card the free service is suspended, not billed, at the limits.

## 1. Free Postgres (Neon)

1. <https://neon.com> -> **Sign up -> Continue with GitHub** (no card). **Create project** `moon-cleanup`, region **AWS US East 2 (Ohio)** (`aws-us-east-2`: the Neon region closest to Render Ohio, so
   only checkpoint/save round trips are short; gameplay ticks never touch the database).
2. The project has branch `main`, database `neondb`, role `neondb_owner`. Use these as given (the role owns the database, so it can create schema `prod`).
3. **Connect** button -> Branch `main`, Database `neondb`, Role `neondb_owner`, **Connection pooling OFF** -> **Show password** -> copy the string. That is the **direct** connection string
   (host `ep-<words>-<digits>.us-east-2.aws.neon.tech`, no `-pooler`).
4. The app uses **schema `prod`** inside `neondb`; `prod` is not a database or host name.

| What you copy | Goes into (Render env key) | Notes |
| --- | --- | --- |
| Direct connection string `postgresql://neondb_owner:PASSWORD@HOST/neondb?sslmode=require&channel_binding=require` | `DATABASE_URL` | Secret. Same string for the build-time migration and the running server. Must start `postgres://` or `postgresql://` and include `sslmode=require` (the server refuses to boot without TLS outside `ENV_NAME=local`) |
| - | `DATABASE_CA_CERT` | **Optional, leave empty for Neon** (public CA). Only set it for a database whose CA is private |
| - | `DB_SCHEMA=prod` | Fixed in `render.yaml` |

**Direct vs pooled (decided: direct everywhere).** Neon also offers a `-pooler` host (PgBouncer, transaction mode). We do not use it: our code sets `search_path`
(and, for migrations, lock/statement timeouts) as connection startup parameters, which the pooled endpoint does not accept, and Neon says migrations must use a direct connection. The pool is
4 connections against a free compute that allows 100+ (0.25 CU: 112), so pooling buys nothing. A `-pooler` URL is refused by both the migrate step and the server's env validation with a clear message. (The code also
disables prepared statements for `-pooler` hosts, as PgBouncer transaction mode requires.)

**TLS** is always verified, never disabled. `sslmode=require` alone would only encrypt in postgres.js, so the code passes `ssl: { rejectUnauthorized: true }` whenever the URL asks for TLS: with no `DATABASE_CA_CERT` it checks Neon's
certificate against Node's system CA store; with a CA it trusts that CA (`packages/db/src/connection.ts`, tested). Neon needs SNI, which postgres.js sends from the host name (a client without SNI would fail with
"The endpoint ID is not specified"; not a concern for our stack). The `channel_binding=require` that Neon adds is supported by postgres.js 4.

**Idle and wake behaviour.** After 5 minutes without queries Neon suspends the compute (Free: always on, cannot be disabled). The next connection wakes it in a few hundred ms to about 5 s. The code tolerates this:
connect timeout is 15 s, the migrate step retries with backoff (1 s -> 30 s, up to 12 attempts, about 4 min) and prints `[db] waking database…`, `/readyz` probes with a 5 s timeout and backoff, and idle pool connections close after 20 s so
the compute can sleep when nobody plays. While players are active, a checkpoint every 30 s keeps it awake; 100 compute-hours per month is far more than a demo needs (0.25 CU for about 400 hours).
If the monthly compute or 5 GB transfer were ever used up, Neon suspends the compute until the next billing period: that is the only way the database stays down.

**First migration:** no separate step. `render.yaml`'s build command runs `pnpm --filter @moon-cleanup/db run migrate` on
every Render build against the same `DATABASE_URL`. It creates schema `prod` if missing, applies pending migrations, waits through a cold start, and **fails the build** if
`DATABASE_URL` is missing or the DB stays unreachable (zero pending migrations counts as success). Look for
`[db:migrate] migrations applied to schema "prod"` in the Render build log. Until M1 persistence lands the migrations
folder may be minimal; the log line is still the proof that the connection and TLS work.
To verify from Neon: console -> your project -> **SQL Editor** (database `neondb`) -> run `select schema_name from information_schema.schemata;` (shows `prod`) and `select * from prod.__drizzle_migrations;`
(the journal; the table `ops_usage_daily` is in schema `prod`), or from a terminal `psql "<direct string>"` then `\dt prod.*`.

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

If you want your own secrets instead of Render's, generate 48+ random characters locally (do the same for `apps/server/.env`):

```powershell
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

Free-tier caveats: cold start about 1 min after 15 min idle (the client shows a waking screen and retries); the process is
restarted on each deploy (`maxShutdownDelaySeconds: 30` lets it checkpoint); health checks may not count as traffic
(unverified, "check Render pricing page / docs"); no uptime pinger by default.

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

What `vercel.json` does: installs pnpm 11.28.9 and the client's workspace deps; builds with
`turbo run build --filter=@moon-cleanup/client`; serves `apps/client/dist`; skips builds when nothing the client uses
changed since the last successful deploy (`ignoreCommand`, safe when the reference commit is missing; see checklist F); sends the CSP and security headers; immutable cache for hashed assets, no-cache for `index.html`
and `assets/manifest.json`; SPA rewrite to `index.html`. The CSP `connect-src` allows only `*.onrender.com` (https/wss) and
Sentry ingest hosts: **a custom Render domain needs a CSP edit in `vercel.json`**. Vercel's own git integration deploys
`main` after your push; there is no deploy hook or workflow.

Rebuild/redeploy Vercel after any `VITE_*` change. The baked terrain (`assets/terrain/*.bin`, `manifest.json`) is copied into
`dist/assets/terrain`, so those files must be committed (only `raw/` and `cache/` are ignored). A built `dist` is about
27 MB including source maps; the 20 MB first-load gate (`pnpm --filter @moon-cleanup/client run size:check`) is gzip, excludes maps
and runs in CI only, so run it before pushing (checklist A1: `pnpm build` then `pnpm --filter @moon-cleanup/client run size:check`).

CSP verified against the real build (2026-11-13, headless Chromium, `/?scene=s01&hud=1`, headers from `vercel.json` applied by a throwaway static server): no
`Refused to ...` errors for scripts, styles, fonts, workers, wasm, images or terrain fetches, so `style-src 'self'` stays (no `'unsafe-inline'`). One
`script-src` "eval" violation is reported from the main bundle: it is a bundled library's `try { Function("") }` capability probe (zod's JIT detection),
caught and harmless (the library falls back to non-eval parsing). `'unsafe-eval'` is deliberately **not** added. Only one title screen was loaded; re-check
the console for `Refused to` after adding new UI that sets inline `style="..."` attributes in markup (DOM `el.style.x = ...` is allowed).

## 4. Cross-wiring order

1. Neon project running; copy the direct connection string (section 1).
2. Push `main`, create the Render Blueprint, paste `DATABASE_URL` (leave `DATABASE_CA_CERT` empty); first deploy runs the migration; copy the Render URL.
3. Create the Vercel project with `VITE_SERVER_*` pointing at the Render URL; deploy; copy the Vercel production URL (the exact origin you will browse to).
4. Render -> service -> Environment: set `ALLOWED_ORIGINS` to that Vercel origin, and put the same value in `render.yaml`
   (`ALLOWED_ORIGINS`) so a later Blueprint sync does not revert it. Save; Render redeploys (or **Manual Deploy**).
5. Reload the Vercel URL; check CORS and the WebSocket.

`ALLOWED_ORIGINS` gates both CORS and the WebSocket handshake. `CLIENT_IP_HEADER=true-client-ip` is required behind Render's
edge for per-IP rate limits; with a blank value all users would share one bucket (so it is refused outside `ENV_NAME=local`).
Add Vercel preview origins only deliberately (comma-separated).

## 5. Post-deploy smoke checklist

```powershell
Invoke-RestMethod 'https://<service>.onrender.com/healthz'   # liveness: build id, protocol; first call may take ~1 min (cold start)
Invoke-RestMethod 'https://<service>.onrender.com/readyz'    # readiness: DB reachable, admission state; 503 = not ready
```

- [ ] `/healthz` 200 with the expected build; `/readyz` 200 (database ok, schema `prod`).
- [ ] Open the Vercel URL: page loads, no console CSP/CORS errors, `ENV` shows production.
- [ ] After the first title interaction the client probes the server; with the server asleep you should see the **waking** screen, then ready.
- [ ] Join a session; DevTools -> Network -> WS shows a connected `wss://` socket.
- [ ] Second browser (or another device/profile) joins the same room and sees the first player.
- [ ] Reconnect: reload or briefly go offline in DevTools; the seat is held for 60 s (`SEAT_HOLD_S`) and you rejoin.
- [ ] Render logs: JSON lines, one room-stats line per room per minute, no secrets.

Persistence note: until M1 persistence lands, joining does not prove saves; memory success never verifies Neon.

**16-bot spike against the hosted server (optional, test-only).** `NET_SPIKE` is `0` in production and the server **refuses to
boot** with `ENV_NAME=production` plus `NET_SPIKE=1`. To run a short hosted test (at most 5 min, no real players, no real saves):
in the Render dashboard temporarily set `ENV_NAME=local`, `PERSISTENCE_DRIVER=memory`, `NET_SPIKE=1` (memory keeps the
Postgres data untouched; the DB build step is skipped in memory mode; keep `CLIENT_IP_HEADER=true-client-ip`). After the redeploy run, from the repo root:

```powershell
pnpm bots -- spike-16 --url https://<service>.onrender.com --origin https://<project>.vercel.app --allow-hosted --duration 300 --server-log render.log
```

(`--allow-hosted` is required by the tool's guard against non-local URLs; `--server-log` takes a pasted Render log export.)
Then **revert immediately**: `ENV_NAME=production`, `PERSISTENCE_DRIVER=postgres`, `NET_SPIKE=0`, redeploy, and confirm
`/healthz` says production. Risks: while the three values are set the service exposes unauthenticated spike routes, runs in
memory (saves not persisted), and reports itself as `local`; forgetting to revert breaks production persistence. The run also uses egress against the 5 GB/month budget.

## 6. What Claude prepared vs what you do

| Item | Claude prepared | Cee does by hand |
| --- | --- | --- |
| Accounts | - | Neon (GitHub login), Render, Vercel (GitHub login), optional Sentry; confirm none asks for a card |
| Postgres | Migration code, schema `prod`, verified TLS, build-time migrate that waits through a cold start | Create the Neon project (us-east-2), copy the direct connection string |
| Render | `render.yaml` (one free service, Ohio, commands, env names, health path) | New -> Blueprint, paste `DATABASE_URL`, click Apply, set `ALLOWED_ORIGINS` |
| Vercel | `vercel.json`, CSP/headers, build command | Import project, set Production `VITE_*` vars, confirm Node version, deploy |
| Secrets | `.env.example` placeholders, generation command | Hold secrets only in provider dashboards and ignored `.env` files |
| Git | - | Commit (incl. `pnpm-lock.yaml`, baked terrain files) and push `main` |
| Verification | This checklist, `pnpm bots` tool | Run section 5 on real URLs and record results |

## 7. Known gaps found in the audit

| Gap | State | Fix / owner |
| --- | --- | --- |
| Old text said hosted spikes use `NET_SPIKE=1` on the service, but env validation refuses it when `ENV_NAME=production` | Documented the `ENV_NAME=local` + memory recipe (section 5) | Fixed in docs. If Cee wants `NET_SPIKE` allowed in production for a test window, that is a code decision (`apps/server/src/ops/env.ts`, devops-engineer) |
| `render.yaml` `ALLOWED_ORIGINS` is a guessed `moon-cleanup.vercel.app` | Comment added; step 4.4 | Cee edits after the real Vercel URL exists |
| Render region | Set to `ohio` (owner decision 2026-11-13) | None; Neon is created in us-east-2 (Ohio), same metro |
| Render Node version | Verified in Render docs: `.nvmrc` is honoured (`NODE_VERSION` > `.node-version` > `.nvmrc` > `engines`); `NODE_VERSION` not set. Render docs do not mention Node 26 explicitly | Confirm "Node 26.13.1" in the first build log; if Render rejects it, add `NODE_VERSION=26.13.1` under envVars |
| Vercel `ignoreCommand` with `HEAD^` | Fixed: now diffs against `VERCEL_GIT_PREVIOUS_SHA` (last successful deploy), builds when it is empty/missing/unfetchable; `assets` added to watched paths (baked terrain ships in `dist`) | Tested locally with an empty, bogus and valid SHA; first real Vercel run is the final proof |
| CSP vs the real build | Verified with one headless load: no `Refused to ...` for style/font/worker/wasm/img; one harmless `eval` probe; CSP unchanged | Re-check the console after new inline-style UI |
| `size:check` only runs in CI | Documented as checklist step A1 | Run before pushing |
| uWebSockets.js failure on Render install | Fixed: the server falls back to Colyseus' built-in `ws` transport and logs `[net] transport=ws (uWebSockets.js unavailable: <reason>)`; `TRANSPORT=uws\|ws\|auto` | Unverified whether pnpm skips a failed optional GitHub-tarball fetch: read the first Render build log |
| No keep-alive pinger | Accepted by owner; documented as optional (checklist G) | None |
| Client falls back silently to `localhost:2567` when `VITE_SERVER_*` are unset at build | Not a code failure | Docs: set before first build. Optional hardening: fail `vite build` in production mode when unset (devops-engineer, `apps/client/vite.config.ts`) |
| Build `seed` step is an `echo` placeholder | Harmless | Real seed with M1 persistence (server owner) |
| Vercel Node 26.x availability | Research lists 26.x as Vercel's default; not seen in the dashboard | Cee checks Settings -> Build and Deployment -> Node.js Version (D5) |
| Dependency `uWebSockets.js` is a GitHub tarball | Needs network access during Render install; not verified on Render | Watch first build log |
| CSP `connect-src` allows only `*.onrender.com` | Custom domain would break the client | Edit `vercel.json` if a custom domain is ever used |
| Render `autoDeployTrigger: checksPass` needs a CI check on the commit | CI workflow `ci-gate` exists | If deploys never start, check Render's GitHub checks setting |

## 8. Secrets

Local: `apps/server/.env`, optional `apps/client/.env.local` (both git-ignored). Hosted: Render and Vercel dashboards only.
If a secret leaks, rotate it at the provider and update the service; deleting text from a file does not revoke it.
Keep stable production secrets in your password manager. No deploy hook or API token is needed.
Full key contract: [environments.md](architecture/environments.md#9-canonical-env-var-list).

## 9. Feasibility check (2026-11-13, lead research; re-verify on first deploy)

Verdict: **doable at $0 for solo play and small friend sessions**, with two real risks (free-DB idle power-off, Render bandwidth/CPU for multiplayer). Solo is local-first ([ADR-0031](adr/0031-local-first-solo.md) when written), so the free server only carries auth, saves and optional rooms.

| Piece | Our need | Free limit (source) | Fit |
| --- | --- | --- | --- |
| Vercel client | `dist` ≈ 27 MB (terrain 15.4 MB, first-load gzip < 20 MB gate) | Hobby: 100 GB/month fast data transfer ([Vercel limits](https://vercel.com/docs/limits)); 100 MB limit applies to CLI source uploads only, Git builds happen in Vercel | OK: about 3,700 full 27 MB loads/month; **Hobby cannot connect to Git repos owned by a GitHub organization: the repo must be under a personal account** |
| Render server CPU/RAM | 1 room, 6 players busy ≈ 27 % of 0.1 CPU (est.), ~11–47 MB room memory | Free: 512 MB RAM, 0.1 CPU ([Render](https://render.com/docs/free)) | OK for 1–3 rooms; solo costs ~nothing |
| Render uptime | friends can join any time | Sleeps after 15 min without HTTP/WebSocket traffic; wakes on a new HTTP request or WebSocket connection in about 1 min; messages on an open WebSocket keep it awake; 750 free instance-hours/month per workspace ≈ one always-on service | OK with the waking screen; solo is unaffected (local-first) |
| Render egress | ≈ 100 MB per busy 6-player room-hour (est.) | Free services count against the workspace's monthly outbound bandwidth; docs research says 5 GB on Hobby, then **services are suspended for the rest of the month if no payment method** | OK for demos (~50 room-hours); never put a card on it unless you want overage billing |
| Render WebSockets | Colyseus rooms | Supported (open sockets count as activity) | OK |
| Free Postgres (Neon) | saves, ~KBs per solo checkpoint | 1 GB storage, 100 compute-hours/month, 112 max connections at 0.25 CU, scale to zero after 5 min with automatic wake of about 1-5 s ([Neon plans](https://neon.com/docs/introduction/plans), [compatibility](https://neon.com/docs/reference/compatibility)) | Storage/hours/connections OK (our pool is 4). **Small risk: the first save after idle waits a few seconds for the wake; the server and the migrate step retry.** |

Mitigations built into the plan: solo plays from the local sim and queues checkpoint uploads (IndexedDB) while the server or DB is asleep; the client shows a waking screen for multiplayer; the Render build retries through a cold database wake and fails loudly only if it stays unreachable. The code is plain Postgres with TLS (no Neon SDK), so moving to another Postgres changes only `DATABASE_URL` (and `DATABASE_CA_CERT` for a private CA).

Not verified (prove on the first deploy): whether Render counts WebSocket traffic toward the free bandwidth exactly as estimated; the real Neon wake time from Render Ohio; Node 26 on Render and Vercel; whether pnpm on Render skips a failed GitHub-tarball fetch of the optional `uWebSockets.js` dependency (read the first Render build log; at runtime the server falls back to the `ws` transport if the addon is missing).

## 10. Commit hygiene for Cee (M0 close-out, 2026-11-14)

Agents never run git; you choose what to commit. Checklist before the first deploy commit:

| Item | Do | Why |
| --- | --- | --- |
| `assets/terrain/*.bin` (height cube, horizon map, fixtures) | **Commit** | The client build and Render/Vercel builds read them; without them the deployed terrain is missing |
| `pnpm-lock.yaml` | **Commit** | `pnpm install --frozen-lockfile` on Vercel, Render and CI fails without it |
| `docs/visual-reviews/M0/checks/**/*.png` (430 frames, about 277 MB) | **Leave ignored** (`.gitignore`) | Regenerable with `docs/visual-reviews/M0/checks/driver`; JSON sidecars and drivers stay tracked |
| Bot and perf results (`tools/bots/results/**`, `tools/perf/results/**`, `tools/bots/reports/`, `tools/perf/captures/`) | **Ignore** (logs already ignored; `tools/bots/results/M0-closeout/` is untracked, skip it or add it to `.gitignore`) | Machine output, not source |
| `docs/visual-reviews/M0/asset-proof/` turntable PNGs (about 38 MB) | **Your choice** | Review evidence only; not needed to build or deploy |
| `.env`, `.env.*` (only `*.env.example` are tracked) | **Never commit** | Secrets (Neon URL, tokens); `.gitignore` already blocks them |
