# M0-W0-T03 devops-engineer report

Status: implemented; `pnpm verify` exit 0 (52/52 turbo tasks, 0 cached, 1m43s, Node 26.13.1). No installs, no git mutations.
Not green: repo-wide `pnpm format:check` fails on one T04 file only (`.claude/hooks/block-git.test.mjs`, not edited per brief).

## Evidence
- Client: `vite build` -> `apps/client/dist` (index.html + one 0.67 kB JS chunk, source maps on); `<title>Clean The Moon!</title>`.
- Server: `node build.config.mjs` (esbuild, ESM, node26, `uWebSockets.js` external) -> `apps/server/dist/index.js`; `node apps/server/dist/index.js` prints one line, exit 0.
- Size check `.github/scripts/size-check.mjs`: real dist passes (0.00 MB); limit 100 bytes fails with exit 1.
- actionlint 1.7.12: `ci.yml` and `asset-validation.yml` clean.
- Main-only cleanup was already in place and reused: `render.yaml` (one service, all required values), `vercel.json` (no `git.deploymentEnabled`), no `release-client.yml`, no dependabot, `.prettierignore` has `**/*.md`.
- grep `release|staging` over `.github`, `render.yaml`, `vercel.json`, env examples: only hit is `apps/client/.env.example:18` ("no permanent staging service", an explicit ADR-0029 statement). I removed the two stale "staging" value mentions from both `.env.example` files.

## Changes
- CI: new `smoke-webgl2` job (`pnpm test:e2e`, Chromium install via `@moon-cleanup/e2e install:browsers`, empty suite passes via `--pass-with-no-tests`), added to `ci-gate`; size step now calls `size:check` directly. The SwiftShader launch flags belong in the Playwright config (M0-W1-T05).
- Files: `apps/client/{vite.config.ts,index.html,src/main.ts,src/app/boot.ts}`, `apps/server/{build.config.mjs,src/app/index.ts}`, `src/index.ts` placeholders (header + `export {};`) in protocol, world, sim, game-data, db and the 7 tools, `tests/e2e/fixtures/placeholder.ts` (needed for tsc TS18003).
- Vite: `envPrefix: VITE_`, sourcemap, `--port 5173` (offset by flag), no COOP/COEP in dev.

## Script table (all exit 0 in verify)
| package | script | command | status / replaced by |
|---|---|---|---|
| client | dev / preview | `vite --port 5173` / `vite preview --port 5173` | real |
| client | build | `tsc -p tsconfig.json && vite build` | real |
| client | size:check | `node ../../.github/scripts/size-check.mjs dist` | real (CI) |
| server | dev | `tsx watch src/app/index.ts` | real (stub entry) |
| server | build | `node build.config.mjs` | real |
| server | seed | `echo NOT IMPLEMENTED` | placeholder; M1 persistence task |
| db | generate, migrate | `echo NOT IMPLEMENTED` | placeholder; M1 persistence task (called by Render build) |
| shared, protocol, world, sim, game-data, db, client, server, tools/* | lint / typecheck | `eslint .` / `tsc -p tsconfig.json` | real |
| same (+ e2e none) | test | `vitest run --passWithNoTests` | real |
| e2e | lint / typecheck / test:e2e | `eslint . --no-error-on-unmatched-pattern` / `tsc -p tsconfig.json` / `playwright test --pass-with-no-tests` | real; spec in M0-W1-T05 |
| asset-pipeline | assets:build, assets:check | `echo NOT IMPLEMENTED` | M0-W0-T06 |
| balance-sim, bots, perf, screenshots, terrain-bake | balance / bots / perf / screenshots / bake | `echo NOT IMPLEMENTED` | later tool tasks |

## Open items
- `.claude/hooks/block-git.test.mjs` needs `prettier --write` (T04 owner).
- `esbuild` `allowBuilds: false` is fine (binary comes from the platform package; build works). No lockfile change needed.
- Playwright smoke has not run against a browser yet (job unexercised locally).
