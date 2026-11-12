# Clean The Moon!

The game name is **Clean The Moon!** everywhere it is displayed. Existing `moon-cleanup` package/repository IDs remain internal implementation identifiers.

A browser co-op moon-cleaning game for 1–16 players: clean regolith, earn Lumens, upgrade tools,
drive vehicles and automate the operation. Original Brightside Facilities Co. identity, detailed lunar terrain,
stylized PBR lighting and satisfying low-gravity motion. TypeScript, three.js WebGPU/WebGL2, React and Colyseus.

**Current state: M0 foundation is in progress.** Many package build/dev/lint scripts are still placeholders.
A command exiting successfully does not yet prove the game builds or runs. See [STATUS](docs/STATUS.md).
Target delivery: **November 17, 2026**; preserve gameplay/visual quality and report scope risk honestly.

Primary design goal: a close Moon Sweepers-like experience in gameplay, mechanisms, graphics, animation and whole-moon
progression, with authored assets/branding. [Reference target and flexible naming](docs/design/REFERENCE_TARGET.md)
supersede earlier bans on common names and mandatory visual differences.

## Continue development

Approved models: **Sonnet 5.5** lead/routine work, **Opus 5.5** architecture/design/netcode/reviews,
**Fable 5.2** demanding gameplay/world/graphics/animation. Lead chooses effort per task.

Use the [Claude resume prompt](docs/handoff/FABLE_KICKOFF.md) and [model/usage policy](docs/handoff/MODEL_POLICY.md).
Recover existing M0 files/reports; do not restart the scaffold or reinstall on every resume.
The [delivery plan](docs/handoff/DEADLINE_PLAN.md) protects mechanics, graphics, animation, world detail and playtesting.
Cee handles git and deployment dashboards.

## Workspace

| Path | Purpose |
| --- | --- |
| `apps/client`, `apps/server` | Browser game and authoritative multiplayer/API server |
| `packages/shared`, `protocol`, `sim`, `world` | Contracts, wire codecs, deterministic gameplay, terrain/dust |
| `packages/game-data`, `db`, `config` | Balance tables, persistence, shared tooling presets |
| `assets/`, `tools/` | Original/licensed assets; asset/terrain pipeline, bots, network/perf/balance/capture tools |
| `tests/e2e/` | Real browser flows and smoke tests |
| `docs/`, `.claude/` | Design/architecture, active checkpoints, scoped agent instructions |
| `prototypes/` | Bounded experiments only after a measured production-approach failure |

Empty/planned modules are retained for the authored game scope. Their existence is not an implementation claim.
`node_modules/` and `.turbo/` are ignored local dependencies/cache; they are not game source or documentation.

## Root files

| File(s) | Why retained |
| --- | --- |
| `package.json`, `pnpm-workspace.yaml`, `pnpm-lock.yaml` | Commands, workspace graph, pinned reproducible dependencies/build policy |
| `.nvmrc`, `tsconfig.base.json`, `turbo.json` | Node version, strict shared TS options, task ordering/cache |
| `eslint.config.js`, `prettier.config.js`, `vitest.config.ts` | Entry points for shared lint/format/test presets |
| `.prettierignore` | Exclude prose, generated assets, vendor data and lockfile from formatting |
| `.editorconfig`, `.gitattributes`, `.gitignore` | Consistent editing/line endings; keep secrets, caches and output out of git |
| `vercel.json`, `render.yaml` | Static browser hosting and one free multiplayer service on main |
| `CLAUDE.md`, `README.md` | Short builder rules and project entry point |

## Run on localhost

**Not runnable yet:** the current client/server `dev` and `build` scripts still print placeholders. Claude must finish
M0's real scripts and app/server boot before these commands launch a game. If a command prints `placeholder` and exits,
that is unfinished implementation, not a localhost or database problem. The steps below are the intended personal run path.

### First-time preparation (Windows PowerShell)

Open PowerShell in this repo. On this laptop Node 26 is already installed through fnm; these variables affect only this
terminal. Repeat this block in each new terminal used for the game:

```powershell
Set-Location 'C:\Users\caseyn\Downloads\BroswerMoonSweeper'
$env:PATH = "$env:APPDATA\fnm\aliases\default;$env:PATH"
$env:DO_NOT_TRACK = '1'
node --version
pnpm --version
```

Expected: Node **26.13.1** (`.nvmrc`) and pnpm **11.28.9** (`package.json`). Dependencies already exist here.
For a fresh checkout or a needed dependency refresh, run `pnpm install --frozen-lockfile` once.

Create local settings without overwriting existing files:

```powershell
if (!(Test-Path -LiteralPath 'apps/client/.env.local')) {
    Copy-Item -LiteralPath 'apps/client/.env.example' -Destination 'apps/client/.env.local'
}
if (!(Test-Path -LiteralPath 'apps/server/.env')) {
    Copy-Item -LiteralPath 'apps/server/.env.example' -Destination 'apps/server/.env'
}
```

Open those files in your editor. For the simplest local session use:

| File | Values |
| --- | --- |
| `apps/client/.env.local` | `VITE_SERVER_HTTP_URL=http://localhost:2567`, `VITE_SERVER_WS_URL=ws://localhost:2567`, `VITE_ENV=local`, `VITE_BUILD_VERSION=dev` |
| `apps/server/.env` | `PORT=2567`, `ENV_NAME=local`, `NODE_ENV=development`, `PERSISTENCE_DRIVER=memory`, `ALLOWED_ORIGINS=http://localhost:5173`, `NET_SPIKE=0` |
| Server secrets | Replace `JWT_SECRET` and `REFRESH_TOKEN_PEPPER` placeholders with **two different** locally generated values |

To generate a local secret, run this twice yourself and paste each result into the corresponding server key:

```powershell
node -p "require('node:crypto').randomBytes(32).toString('hex')"
```

Keep generated values in your ignored local file/password manager. Leave Sentry keys and `DATABASE_URL` empty for memory
mode. No hosted accounts are needed for local memory play. Memory progress is lost when the server restarts; saving across
restarts requires isolated PostgreSQL and `PERSISTENCE_DRIVER=postgres` (see the [connection guide](docs/HOSTING_GUIDE.md)).

### Start and open the game (after M0 implements the commands)

From the root, run `pnpm dev` and leave that terminal open. Open **[http://localhost:5173](http://localhost:5173)** in an
up-to-date desktop browser; the server should run at **http://localhost:2567**. Use localhost consistently, not a mixture
of localhost and 127.0.0.1. Stop with **Ctrl+C**. Restart after editing env values.

If you prefer separate logs, use two prepared terminals:

```powershell
# Terminal 1: game server
pnpm --filter @moon-cleanup/server dev
```

```powershell
# Terminal 2: browser client
pnpm --filter @moon-cleanup/client dev
```

If either port is busy, stop the old dev process or coordinate new ports in client URLs, server `PORT`, and
`ALLOWED_ORIGINS`. The terminal's printed address is authoritative; changing client ports without updating the allow-list
can cause connection rejection. No need to deploy to Render/Vercel for each local edit.

## Test locally

Run checks from a separate prepared terminal. These root commands exist, but some underlying tasks are still placeholders:

| Command | Purpose |
| --- | --- |
| `pnpm verify` | Full lint, typecheck, unit tests and build |
| `pnpm test` | Unit tests across the workspace |
| `pnpm --filter @moon-cleanup/shared test` | Focused shared-contract tests |
| `pnpm format:check` | Code/config formatting |
| `pnpm test:e2e` | Browser flows once the Playwright harness/specs are implemented |

For browser tests, install Chromium once if the runner reports a missing browser:

```powershell
pnpm --filter @moon-cleanup/e2e exec playwright install chromium
```

The E2E script currently prints a placeholder; installing Chromium does not create the tests. Once the harness is real,
follow its startup instructions in [tests/e2e](tests/e2e/README.md). `PASS` requires real commands/assertions; empty suites
and `echo` output do not verify gameplay.

For your own playtest, open localhost, check movement/camera/cleaning/sell/upgrade as features land, and inspect **F12 →
Console / Network** for errors. Use a private browser window as a second player with separate guest storage. Check
`http://localhost:2567/healthz` and `/readyz` once those handlers exist. Exercise reconnect, WebGL2 fallback
(`http://localhost:5173/?backend=webgl2`) and save/restart with isolated Postgres when implemented. Test against local
data; memory-mode progress resetting is expected. Report missing features separately from bugs.

## Deployment and references

`main` → Vercel static client + one Render Free server + Aiven Postgres; no release branch or second staging service
([ADR-0029](docs/adr/0029-single-deploy-branch-main.md)). Cee sets Vercel's Production Branch to main in its dashboard.
Follow [Connect Aiven, Render and Vercel](docs/HOSTING_GUIDE.md) for account setup, exact environment keys, generated
secrets, database TLS, domain wiring and troubleshooting. Read that guide only when setting up hosting.
Do not publish until the real builds/gates pass; the old release-client workflow has been removed.
Strict protocol compatibility and the updating-server UI must handle independent client/server deployment timing.

[Documentation index](docs/README.md) · [Game design](docs/design/GDD.md) · [Visual target](docs/design/visual-target.md) ·
[Animation](docs/design/animation-spec.md) · [Controls/feel](docs/design/game-feel-and-controls.md) ·
[Ownership](docs/architecture/module-boundaries.md) · [Performance budgets](docs/architecture/performance-budgets.md).
Record third-party assets in [ASSET_LICENSES](docs/ASSET_LICENSES.md). Project licensing remains Cee's decision (Q9).
