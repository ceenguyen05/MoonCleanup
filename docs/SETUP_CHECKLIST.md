# Setup checklist for Cee (manual, ordered)

Owner: `docs-keeper` - Audience: Cee, who performs every account, dashboard and git action. Agents never do these steps and never see secrets.
Facts and limits behind each step: [`research/tech/platform-limits.md`](research/tech/platform-limits.md), [`research/tech/data-auth-observability.md`](research/tech/data-auth-observability.md).
Branch rules: [`handoff/WORKFLOW.md`](handoff/WORKFLOW.md). Budget: **$0 forever** (Vercel Hobby, Render Free x2, Aiven PostgreSQL Free, Sentry Developer, GitHub Free).

> **Timing.** Sections 0-5 (tools, rename, GitHub, database, Sentry, secrets) can be done today. Section 8 (UptimeRobot) needs the Render production URL, so it comes after section 6. Create the Render Blueprint (section 6) and the Vercel project (section 7)
> **after the first wave that contains a runnable server and client skeleton** (M0-W1, Gate G1) is merged and a `pnpm-lock.yaml` is committed: until then
> `pnpm install --frozen-lockfile` fails and there is nothing to build, so the first deploys would fail (harmlessly, but noisily).

## 0. Tools on your machine

- [ ] Install Node.js **26.13.1** (match `.nvmrc`; use nvm-windows or fnm: `nvm install 26.13.1`). On Cee's machine this is already done, see "Local toolchain" below.
- [ ] Install pnpm **11.28.9** explicitly: `npm install --global pnpm@11.28.9` (Corepack is not bundled with Node 25+).
- [ ] Install Git. **Do not install or enable Git LFS** (section 2.5).
- [ ] **Headless Blender (OPEN_QUESTIONS Q23), before M0-S2 starts the asset-pipeline proof (M0-W0-T06):** install the current Blender **LTS** from blender.org (download the LTS build; a portable zip is fine) and tell the lead the path to `blender.exe`. Agents run it headless (`blender --background --python ...`) and never install it. If you would rather not, say so and the Node-only procedural path is used.
- [ ] Optional: Docker is installed on this machine; it can run a local Postgres for the DB tests and the `--cpus=0.1` bot run. Nothing in the plan requires it.

### Local toolchain (already installed on Cee's machine; verify, do not reinstall)

Installed: **fnm 1.39.0** (via winget), **Node 26.13.1** (the fnm default), **pnpm 11.28.9** and **actionlint 1.7.12**. Because fnm came from winget, it is not on `PATH` for new shells, so the PowerShell profile line must use fnm's full winget path:

- [ ] Add this line to your PowerShell profile (`notepad $PROFILE`):

```powershell
& "$env:LOCALAPPDATA\Microsoft\WinGet\Packages\Schniz.fnm_Microsoft.Winget.Source_8wekyb3d8bbwe\fnm.exe" env --use-on-cd --shell powershell | Out-String | Invoke-Expression
```

- [ ] Optional, for Git Bash: the equivalent `eval "$(.../fnm.exe env --use-on-cd --shell bash)"` line in `~/.bashrc`, using the same full path (in POSIX form).
- [ ] Open a new terminal in the repo (`.nvmrc` is read on `cd`) and verify: `node -v` prints **v26.13.1**; `pnpm -v` prints 11.28.9; `actionlint -version` prints 1.7.12.

## 1. Repo and folder (done)

- [x] GitHub repo is **`ceenguyen05/mooncleanup`** (renamed by Cee 2026-11-12). The local folder stays `C:\Users\caseyn\Downloads\BroswerMoonSweeper` — no folder rename. Internal package names stay `@moon-cleanup/*`.
- [ ] Point the local remote at the renamed repo: `git remote set-url origin https://github.com/ceenguyen05/mooncleanup.git` (GitHub redirects the old URL, but update it anyway).

## 2. GitHub

### 2.1 Create the repository

- [x] Repository exists: `ceenguyen05/mooncleanup` (attached to this folder; no commits yet).
- [ ] Choose visibility (decision Q10; recommended **Private** to start):

| | Private | Public |
| --- | --- | --- |
| GitHub Actions minutes (Free plan) | ~2,000 min/month, then CI stops until next month | Unlimited on standard runners |
| Vercel Hobby | Works with **personal** repos (not organization-owned ones, Hobby cannot connect to org repos) | Same |
| Branch protection / rulesets | Not available for private repos on the Free plan (GitHub documents this as a Pro/Team feature; re-check current docs) | Available on Free |
| Risk | None | Anyone can read and copy code and shipped art; asset licenses are visible |

  If you stay private on Free, the protection rules in 2.3 cannot be enforced by GitHub, so follow them by discipline (only Cee pushes; `release` only fast-forwards).
- [ ] If the owner/name differs from `ceenguyen05/mooncleanup`, update `.github/ISSUE_TEMPLATE/config.yml` and tell the lead.

### 2.2 First push and the `release` branch

- [ ] Review the working tree against the planning commit plan: [`handoff/commit-plans/planning-session.md`](handoff/commit-plans/planning-session.md) (ordered groups, exact paths, Conventional Commit messages). Make the commits in that order. (The folder is already a git repository with no commits; if `git status` says it is not, run `git init` first.)
- [ ] Then, from the repo root (the repo is unborn, so name the branch, add the remote and push):

```bash
git status                      # tree matches the plan, no secrets, no .env files
git branch -M main
git remote set-url origin https://github.com/ceenguyen05/mooncleanup.git   # remote already exists (old name)
git push -u origin main
git branch release              # created from the planning commit
git push -u origin release
```

- [ ] `release` is created from the tested `main` commit (Render and Vercel production track it). From then on `release` is **fast-forward only** from `main`, and only after `/release-checklist` (the first time is `v0.1.0`).
- [ ] Tell the lead "G0 done"; the lead verifies it with read-only git commands (`git log -1`, `git rev-parse --abbrev-ref HEAD`, `git status`) and asks you to confirm the remote and `release` branch.

### 2.3 Protect branches (if your plan allows it)

- [ ] `main`: require a pull request, require status check **`CI gate`** (the always-green-on-scaffold job in `ci.yml`) and, optionally, **`Validate assets`**; block force pushes and deletion.
- [ ] `release`: block force pushes and deletion, require linear history, restrict pushes to you, require **`CI gate`**.
- [ ] Settings -> Actions -> General: workflow permissions "Read repository contents" (workflows declare their own `permissions`).

### 2.4 Dependabot

- [ ] Settings -> Code security: enable Dependabot alerts and security updates (version updates are configured in `.github/dependabot.yml`).

### 2.5 Git LFS: not needed

- [ ] **Do nothing.** ADR-0017: no Git LFS. LFS bandwidth (10 GiB/month on GitHub Free) would be shared with every Vercel clone, and only small compressed derivatives are committed. `.gitattributes` contains a commented-out LFS block explaining how a future ADR could enable it. Do not run `git lfs install`.

### 2.6 Lockfile and CI

- [ ] **You do not run the first install.** The agent task M0-W0-T02 (`devops-engineer`) performs the first `pnpm install` and creates `pnpm-lock.yaml` (the one named exception to "agents never install"; afterwards `devops-engineer` installs only between waves). When the lead says M0-W0 is done, **review the lockfile diff** and the agent's list of ignored build scripts; if pnpm printed "Ignored build scripts", review the package list and run `pnpm approve-builds` yourself.
- [ ] Commit `pnpm-lock.yaml` (and any `pnpm-workspace.yaml` change) together with M0-W0 per `handoff/commit-plans/M0-W0.md` (Gate G0b). This activates the gated CI jobs (they run only when both a lockfile and TypeScript sources exist).
- [ ] Open a PR to `main`; confirm `CI gate` is green.

### 2.7 Permission mode for the Fable session

- [ ] Start Fable with `claude --model fable --permission-mode acceptEdits` (or auto mode if you prefer). `.claude/settings.json` only denies git.
- [ ] Expect prompts in the **main session** for `pnpm install`, `node` runs and web fetches (three.js docs, NASA data) that background agents trigger, plus one prompt for the hooks edit of `.claude/settings.json` in M0-S1. Approve the ones you recognise.
- [ ] Optional: add allow rules for `pnpm *`, `node *` and `npx playwright *` to your own `.claude/settings.local.json` (not committed) to cut prompts. **Never allow git.**
- [ ] After M0-S2, start a **new** Claude session and check the git hook: ask it to run `git status` (must work) and `git commit --dry-run -m x` (must be blocked). Hooks added mid-session do not apply to sessions already running.

## 3. Aiven (PostgreSQL Free) - do this before Render

Why first: Render's region cannot be changed later, and Aiven's free tier does not let you choose cloud or region.

- [ ] Sign up at aiven.io (no card needed for the free plan).
- [ ] Create service -> **PostgreSQL** -> plan **Free** (1 CPU, 1 GB RAM, **1 GB storage**; powers off when idle). Note the cloud/region it assigns.
- [ ] Pick the **closest available Render region** to that location (`oregon`, `ohio`, `virginia`, `frankfurt`, `singapore`). `render.yaml` carries `region: oregon` only as a **placeholder** (a Blueprint needs a value). **Confirm the region before the first Blueprint apply**: if another region is closer, edit `region:` in **both** services first and tell the lead (a region cannot be changed afterwards).
- [ ] Service -> **Databases** tab (name may differ): try to create **`moon_prod`** and **`moon_staging`**. Whether the free plan allows more than the default `defaultdb` is **unverified**. **If it does not, you do not need to stop:** use the single `defaultdb` for both services (same URI, `?sslmode=require`). The server separates the environments with Postgres schemas through the `DB_SCHEMA` variable (`prod` on production, `staging` on staging; already set in `render.yaml`), so migrations and data never collide. Tell the lead which option you used.
- [ ] Optional but recommended: Users tab -> create an application user (for example `moon_app`) instead of using the admin user `avnadmin` in Render.
- [ ] Download the CA certificate: service **Overview -> Connection information -> CA certificate** (download `ca.pem` or copy the text). Keep it in a password manager note; never commit it (`*.pem` is git-ignored).
- [ ] Copy the **Service URI** (same Connection information panel) and build two URIs by replacing the database name: `.../moon_prod?sslmode=require` and `.../moon_staging?sslmode=require`.
- [ ] IP allow-list: defaults to open (`0.0.0.0/0`). Leave it for now; restricting it to Render's shared outbound ranges (Render service -> Connect -> Outbound) is optional hardening.
- [ ] Expect: after idle the free database powers off and the next connection is slow; the server must retry (a Fable task).

## 4. Sentry (Developer plan, free)

- [ ] Sign up at sentry.io and create an organization.
- [ ] Create **two projects**: `moon-cleanup-client` (platform: Browser JavaScript) and `moon-cleanup-server` (platform: Node.js).
- [ ] For each: **Project Settings -> Client Keys (DSN)** -> copy the DSN. Client DSN goes to `VITE_SENTRY_DSN` (Vercel), server DSN to `SENTRY_DSN` (Render, both services; environments are told apart by `ENV_NAME` / `VITE_ENV`).
- [ ] Later (when Fable wires `@sentry/vite-plugin` for source maps): Settings -> Developer Settings -> create an organization auth token and store it **only** in Vercel as `SENTRY_AUTH_TOKEN` (plus `SENTRY_ORG`, `SENTRY_PROJECT`).
- [ ] Note the free quota (5k errors/month, 30-day lookback); spend caps are paid features.

## 5. Generate secrets

- [ ] `REFRESH_TOKEN_PEPPER` and `JWT_SECRET` are both **generated by Render itself** (`generateValue` in `render.yaml`) for each service, so you do not create them. Optionally copy each generated pepper into your password manager after the first deploy (rotating a pepper logs every guest out). For local development create your own in `apps/server/.env`.
- [ ] Local env files: copy `apps/client/.env.example` to `apps/client/.env.local` and `apps/server/.env.example` to `apps/server/.env`. Both are git-ignored. Never paste secrets into any tracked file.

## 6. Render (game server, 2 free services)

- [ ] Sign up with GitHub at render.com; use the **Hobby** workspace. Hobby: **750 free instance-hours per month shared by the whole workspace** and **5 GB outbound bandwidth per month**. If you add no payment method, free services are **suspended for the rest of the month** when limits are exceeded (accepted risk, OPEN_QUESTIONS Q4).
- [ ] Make sure `render.yaml` and the server skeleton exist on `main` (see Timing). `release` only has the planning commit until `v0.1.0`, so the **production** service's first build fails (harmlessly) until you fast-forward `release` after `/release-checklist`; staging builds from `main` and is the one that matters for G1.
- [ ] **New -> Blueprint** -> connect `ceenguyen05/mooncleanup` -> use branch `main` for the Blueprint file.
- [ ] On the preview screen confirm for **both** services: **Plan = Free** (never a paid plan), **Region = the one confirmed in section 3** (`oregon` is only the placeholder), names `moon-cleanup-server` (branch `release`) and `moon-cleanup-server-staging` (branch `main`).
- [ ] Fill the `sync: false` values when prompted (they are asked only once; change them later in each service's **Environment** tab):

| Variable | moon-cleanup-server (prod) | moon-cleanup-server-staging |
| --- | --- | --- |
| `DATABASE_URL` | Service URI for `moon_prod` | Service URI for `moon_staging` |
| `DATABASE_CA_CERT` | Full CA PEM text from Aiven | Same PEM |
| `SENTRY_DSN` | Server project DSN | Server project DSN |
| `ALLOWED_ORIGINS` | already set: `https://moon-cleanup.vercel.app` | Vercel stable branch URL for `main` (section 7), no trailing slash; comma-separate extra origins |

- [ ] Verify the generated `JWT_SECRET` and `REFRESH_TOKEN_PEPPER` exist on both services (Environment tab).
- [ ] Note both service URLs (`https://<name>.onrender.com`); you need them for Vercel.
- [ ] Behavior to expect: a free service spins down after 15 min without traffic (WebSocket traffic counts) and takes about a minute to wake up; **staging will sleep, that is intended**. Do not point an uptime pinger at staging.
- [ ] Deploys run on every commit to the tracked branch that touches `apps/server/**`, `packages/**`, the lockfile or `render.yaml`; the build also runs DB migrations (`preDeployCommand` is paid-only).

## 7. Vercel (static client, Hobby)

- [ ] Sign up with GitHub at vercel.com on the **Hobby** plan. **Hobby is for non-commercial personal use only**: no ads, no payments, no paid contributors (donations are fine). Monetizing means Pro ($20/month).
- [ ] Add New -> Project -> import `ceenguyen05/mooncleanup` (must be a personal repo, not an organization repo).
- [ ] Project name **`moon-cleanup`** (gives `moon-cleanup.vercel.app`; if taken, choose another and update `ALLOWED_ORIGINS` in `render.yaml` and Render).
- [ ] **Framework Preset = Vite**. **Root Directory = repository root** (leave blank). Keep "Include files outside the root directory in the Build Step" **enabled** (workspaces need it). Install, build and output settings come from `vercel.json`; do not override them in the UI.
- [ ] Settings -> General -> Node.js Version **26.x** (matches `engines.node`).
- [ ] Settings -> Environments/Git -> **Production Branch = `release`**. Every other branch (including `main`) gets a preview URL.
- [ ] Environment variables (Settings -> Environment Variables), values from `apps/client/.env.example`:

| Variable | Production | Preview (includes `main` and wave branches) |
| --- | --- | --- |
| `VITE_SERVER_HTTP_URL` | `https://moon-cleanup-server.onrender.com` (use the real Render URL) | staging service URL |
| `VITE_SERVER_WS_URL` | `wss://moon-cleanup-server.onrender.com` | `wss://` + staging service host |
| `VITE_SENTRY_DSN` | client project DSN | client project DSN |
| `VITE_BUILD_VERSION` | commit SHA or `0.x.y` | same |
| `VITE_ENV` | `production` | `staging` |

- [ ] Copy the **stable branch URL for `main`** (Settings -> Domains, looks like `moon-cleanup-git-main-<scope>.vercel.app`) into the staging service's `ALLOWED_ORIGINS` on Render. Per-wave preview URLs differ and will be rejected by CORS unless allowed; test wave branches locally or after merging to `main`.
- [ ] **Production client deploys go through the release gate, not Vercel's git integration.** Automatic deployment of `release` is disabled in `vercel.json` (`git.deploymentEnabled.release = false`). Create the hook: Settings -> Git -> **Deploy Hooks** -> create a hook for branch **`release`**, copy its URL.
- [ ] GitHub -> Settings -> Secrets and variables -> Actions: add repository **secret `VERCEL_PROD_DEPLOY_HOOK_URL`** (the hook URL) and repository **variable `PROD_SERVER_HTTP_URL`** (the production Render HTTPS URL, no trailing slash). `.github/workflows/release-client.yml` waits for the production server's `/healthz` protocolVersion, then POSTs the hook. Treat the hook URL as a secret; never paste it into a file or an agent prompt.
- [ ] **Enable nothing else**: leave Web Analytics, Speed Insights, Functions, Image Optimization and Vercel Cron off (Hobby limits can pause features for 30 days).

## 8. Optional: UptimeRobot

- [ ] Free monitor of `https://moon-cleanup-server.onrender.com/healthz`, 5-minute interval, **production only**.
- [ ] Caution: a 5-minute ping keeps the free service awake 24/7 (about 720-744 of the 750 shared hours), which starves staging and can suspend **all** free services for the month. Enable it only around planned playtests, then pause it. Never monitor staging.

## 9. Hub kit (portal/store listing assets)

- [ ] The kit lives in **`apps/client/public/hub/`** (owner: `devops-engineer`): `metadata.json` plus thumbnail images. It is deployed with the client, so the metadata is served at `/hub/metadata.json` (cached 5 minutes, see `vercel.json`) and thumbnails at `/hub/<file>`.
- [ ] No target hub/portal is chosen yet, so the **exact `metadata.json` schema and thumbnail sizes are undefined** (verify against the hub's published requirements before creating them). Typical contents: title, short and long description, version, controls, credits link, thumbnail files.
- [ ] Thumbnails are art assets: add a ledger row for each in [`ASSET_LICENSES.md`](ASSET_LICENSES.md) and keep each file small.

## 10. First-run verification

- [ ] Local: `pnpm install --frozen-lockfile` then `pnpm verify` (lint, typecheck, test, build via Turborepo) passes (the lockfile already exists from M0-W0-T02).
- [ ] GitHub: a PR to `main` shows green `CI gate`; a PR touching `assets/**` shows `Validate assets`.
- [ ] Render staging: open `https://<staging-name>.onrender.com/healthz` (first hit can take about a minute); Logs show the build, the migration step and a healthy deploy.
- [ ] Vercel preview of `main`: page loads; browser dev tools show requests to the **staging** server and a connected `wss://` socket, no CORS errors.
- [ ] Headers: `curl -I` on a file under `/assets/` shows `cache-control: public, max-age=31536000, immutable`; the page `/` shows `max-age=0, must-revalidate`; security headers are present.
- [ ] Sentry: trigger the debug test error (when Fable provides it) and see it arrive in the right project with the right environment.
- [ ] Production: fast-forward `release` to the tested `main` commit, wait for the Render production deploy and the Vercel production deploy, repeat the checks against `https://moon-cleanup.vercel.app`.

## 11. Ongoing

- Merge Dependabot groups (patch/minor) after CI is green; majors of engine-level packages need an ADR.
- Watch Render **Metrics -> Bandwidth** and instance hours monthly (free limits are shared by both services).
- Secrets live only in Vercel, Render, Aiven and local `.env` files: never in commits, issues, PR text or agent prompts.
