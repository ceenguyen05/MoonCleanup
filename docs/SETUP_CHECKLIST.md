# Setup — Clean The Moon!

Use only the section needed now. Existing local tools, repo connection and first pnpm install already exist; do not repeat
setup on resume. [STATUS](STATUS.md) records actual progress. Build/test continuously under [WORKFLOW](handoff/WORKFLOW.md).
For click-by-click connection steps, variables and secret locations use [HOSTING_GUIDE](HOSTING_GUIDE.md).
For your own localhost run/test commands use [README](../README.md#run-on-localhost).
No setup commit, PR, tag, branch promotion or stage sign-off is required. Cee commits/publishes when satisfied.

## Local development

- Use Node/pnpm versions from `.nvmrc` and `package.json`. This laptop already has Node 26 through fnm; use the
  per-command PATH prefix in [M0 recovery §3](handoff/waves/M0-W0.md#3-environment-rules).
- Dependencies/lockfile exist. Designated devops writer installs only for a fresh checkout or actual dependency need,
  sequentially; review lifecycle scripts/licenses. No per-package ADR or between-wave wait.
- Copy `.env.example` templates to ignored local env files. Use memory persistence or isolated local Postgres for testing;
  never point local destructive tests at live saved games. See [environment contract](architecture/environments.md#9-canonical-env-var-list).
- Replace stub scripts in M0-W0-T03. Then use `pnpm dev`, meaningful `pnpm verify` and browser checks. Stub exit 0 is not a pass.
- Ask for Blender executable path (Q23) when needed for asset proof; do not install software machine-wide automatically.
  Keep working on other local features if the path/device/cloud credentials are unavailable.
- Keep the custom git-blocking hook and permission denies (owner confirmed November 12). Run its Node matrix and piped
  PreToolUse JSON cases; never invoke a real git mutation to test it. Hook config changes activate next session.

## Hosting, only when Cee chooses

Topology: `main` → Vercel static client + **one** Render Free service + Aiven Postgres, schema `prod`
([ADR-0029](adr/0029-single-deploy-branch-main.md)). No release branch, second staging service, deploy-hook secret or release workflow.
Local feature development does not depend on cloud setup. Account/dashboard actions and publication remain Cee's choice.
Verify current provider terms/quotas before account changes; stay within the $0 budget.

1. Aiven: obtain database URI and CA certificate. Confirm assigned region and choose the closest available Render region
   before first service creation; do not recreate a service automatically. Use a dedicated application DB/user when available;
   `defaultdb` + schema `prod` is the fallback. Never paste credentials into tracked files or agent prompts.
2. Render: connect the existing repo, branch `main`, use `render.yaml`; confirm exactly one service, `plan: free`, correct
   region, `ENV_NAME=production`, `DB_SCHEMA=prod`, `NET_SPIKE=0`. Supply `DATABASE_URL`, `DATABASE_CA_CERT`, optional `SENTRY_DSN`
   and exact client origins via the dashboard. Keep generated `JWT_SECRET` and `REFRESH_TOKEN_PEPPER` private.
3. Vercel: import the existing repo, root directory = repository root, use `vercel.json` and **Production Branch = main**.
   Use the Node version required by the repo. Set public `VITE_SERVER_HTTP_URL`, `VITE_SERVER_WS_URL`,
   `VITE_ENV=production`, optional `VITE_SENTRY_DSN`. Put the resulting exact HTTPS origin in Render `ALLOWED_ORIGINS`.
   The existing Vercel build command sets `VITE_BUILD_VERSION` from the platform commit SHA; do not set it manually.
   Source-map credentials (`SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT`) are build-only, never `VITE_*`.
4. Optional Sentry: client/server projects; empty DSNs disable it. Do not hold local development for observability setup.
5. When the tested working tree is satisfactory, Cee chooses whether to commit/push; configured main deployments can then run.
   Remote CI/deploy checks are recorded when available, not invented as a prerequisite to writing local features.

## Hosted verification

- Confirm real builds/migrations, `/healthz` and `/readyz`, client boot, WebGPU/WebGL2, socket/CORS, correct versions and
  security/cache headers. Record actual URLs/results; do not claim success from placeholders.
- Main client/server deploy independently. Reject incompatible protocol versions cleanly and show updating/retry UI.
- Use local isolated data for soak/restart/destructive tests. Hosted spikes need an agreed isolated/test-only window;
  no live player data. Keep runs short under documented budgets, restore `NET_SPIKE=0`, record bytes/device/environment.
- Missing cloud/device tests remain BLOCKED/provisional while other development continues. Final candidate report discloses them.
- No uptime pinger by default. Keep secrets in local ignored env/provider dashboards. Monitor real usage and provider limits.
- Hub metadata/images only if a portal is actually chosen; verify its schema then. Retain asset licensing/credits checks.
