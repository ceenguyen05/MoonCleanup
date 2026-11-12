# M0-W0-T02 — Tooling config package, root configs and the FIRST install (devops-engineer)
Status: in-review
Date: 2026-11-12

## Done so far / Next
- Done so far: everything in the brief (config package, fixture suites, root configs, first install, Playwright Chromium, gates re-run after the usage cut-off, own-file Prettier check, hand-off).
- Next: reviewers (code-reviewer, netcode-security-reviewer: lockfile, build scripts, the uWebSockets.js override); Cee decides the items under "For Cee at Gate G0b".

## What changed
- **Install** (Node v26.13.1, pnpm 11.28.9, every command prefixed per wave §3): `pnpm install` created `pnpm-lock.yaml` (lockfileVersion 9.0, 6177 lines, 641 lockfile entries, 485 packages added, 18 workspace projects). `pnpm install --frozen-lockfile` re-run: "Already up to date". Lockfile pins match the manifests (`three@0.187.0`, `typescript@6.0.3`, `vitest@5.1.0`, `vite@8.3.8`, `@types/node@26.6.6`).
- **`packages/config`**: `eslint/` (`index.ts` flat config, `boundaries.ts` rules 1-6, `ban-list.ts`, `lint-fixture.ts` + 2 fixture suites), `vitest/` (`node.ts` preset, `browser.ts` placeholder preset, `index.ts`), `prettier/index.ts`, own `vitest.config.ts`, `tsconfig.json` (extends the repo-root base; adds `allowImportingTsExtensions` + `erasableSyntaxOnly` because sources are loaded as native `.ts`), `package.json` (exports map `./eslint`, `./vitest`, `./prettier`; real `lint` / `typecheck` scripts; `@types/node` 26.6.6 devDependency as the brief requires; plus `eslint`, `prettier`, `typescript`, `vitest` as devDependencies at the exact versions the root manifest pins, because the package's sources and tests import them), README rewritten. `.gitkeep` placeholders removed.
- **Root**: `eslint.config.js`, `prettier.config.js`, `vitest.config.ts` (uses `test.projects`, no `vitest.workspace`), `pnpm-workspace.yaml` (see below), `turbo.json` (`test.outputs` set to `[]`: with `coverage/**` turbo printed a "no output files found" warning for every package; re-add when coverage is enabled).
- **ESLint scope decision**: `docs/**` (so `docs/vendor/**`, 37 vendored files) and `prototypes/**`, `assets/**`, build output are ignored. `.claude/hooks/**/*.mjs` is **linted** with a plain non-type-aware JavaScript block (core recommended + Node globals); it passes on T04's real `block-git.mjs` and `block-git.test.mjs` (`pnpm exec eslint .claude` exit 0). Prettier ignores `docs/vendor/` through the existing `.prettierignore` (unchanged by me).
- Boundary rules apply to `packages/<name>/src/**` (build files beside `src` may import tooling); rule 1 applies to all of `packages/**`; ban-list and deep-import ban apply to every linted file. No import-boundary plugin added (undecided, per brief). Rule 3 is enforced with `no-restricted-imports` (Node built-ins with and without `node:`, `three*`, `@colyseus/*`, react/motion/DOM libs) plus `no-restricted-globals` (DOM and Node globals) for shared/sim/world/protocol. Dependency direction of the mermaid graph is also enforced per package (for example world cannot import sim).

## Files touched
- packages/config/package.json, tsconfig.json, vitest.config.ts, README.md (modified/new)
- packages/config/eslint/{index,boundaries,ban-list,lint-fixture}.ts, boundaries.test.ts, ban-list.test.ts (new)
- packages/config/vitest/{index,node,browser}.ts, packages/config/prettier/index.ts (new); the three `.gitkeep` files (deleted)
- eslint.config.js, prettier.config.js, vitest.config.ts (new, root)
- pnpm-workspace.yaml (modified), turbo.json (modified: `test.outputs`), pnpm-lock.yaml (generated)
- node_modules/** (generated, git-ignored); `%LOCALAPPDATA%\ms-playwright` (outside the repo)
- Not touched: `.nvmrc`, `.editorconfig`, `.gitignore`, `.gitattributes`, `.prettierignore`, `tsconfig.base.json`, root `package.json`, any other package.

## Contracts used / proposed contract changes
- Used: none. Proposed: none.

## Tests run (all with `node -v` = v26.13.1)
- `pnpm lint` exit 0 (17 tasks; the other packages are still `echo` placeholders until T03)
- `pnpm typecheck` exit 0 (17 tasks) · `pnpm test` exit 0 (16 tasks; second run `FULL TURBO`, 188 ms)
- `pnpm --filter @moon-cleanup/config test`: 2 files, **131 tests passed** (boundary fixtures: one per rule, repeated for each of shared/sim/world/protocol for rule 3, plus 14 allowed-layer fixtures that must produce zero findings; ban-list: 35 fixtures covering all 10 names, the `three/examples/jsm/postprocessing/*` path, R3F and `postprocessing`, plus 4 allowed-API fixtures, plus a test that fails if a ban-list entry has no fixture). The fixtures lint through the real root `eslint.config.js`.
- `pnpm exec vitest run` at the root (projects config): 131 passed.
- `pnpm exec eslint packages/config` exit 0 · `pnpm exec eslint .` exit 0 (about 6 s) · `pnpm exec eslint .claude` exit 0
- `pnpm exec tsc -p packages/config/tsconfig.json` exit 0 (it failed once on a readonly-tuple typing and on my own `onBeforeCompile:` object key tripping the ban-list; both fixed, which also shows the ban-list lints its own file)
- Sample violation output: `apps/server/src/a.ts` importing three and `new THREE.Clock()` gives two errors, "apps/server never imports three.js ... rule 4" and `three.js ban-list: "Clock" is banned (deprecated; use Timer)`.
- `pnpm exec prettier --check` on my files (packages/config, the three root configs, package.json, pnpm-workspace.yaml, turbo.json): "All matched files use Prettier code style".
- **Repo-wide `pnpm format:check` currently FAILS (exit 1): 108 files** (not reformatted, not mine): 101 `.md` (docs, ADRs, agent reports, `.claude/agents|commands`, `CLAUDE.md`, READMEs, PR template), 3 `.json` (`apps/server/package.json`, `packages/db/package.json`, `vercel.json`), 2 `.mjs` (`.claude/hooks/block-git.mjs`, `.claude/hooks/block-git.test.mjs`, T04), 1 `.yml` (`.github/workflows/ci.yml`), 1 `.yaml` (`render.yaml`). Suggested follow-up for the lead: one formatting pass by each file's owner (or a docs-keeper pass for the `.md`), or add `docs/` and `.claude/**/*.md` to `.prettierignore` (needs the lead's decision; I did not widen it). CI must not enable `format:check` until this is resolved.

## Screenshots / captures
- n/a

## Performance notes
- Install: `node_modules` 611 MB (487 entries in `node_modules/.pnpm`); pnpm content store 765 MB (`%LOCALAPPDATA%\pnpm\store\v11`); first install about 60 s plus registry slowness (some requests took 30 s+). Re-install from lockfile: 1 s.
- Playwright: `pnpm exec playwright install chromium` downloaded Chrome for Testing 158.0.8127.18 (205.8 MiB zip, playwright chromium v1254) and Chrome Headless Shell 158.0.8127.18 (123.2 MiB) to `%LOCALAPPDATA%\ms-playwright\chromium-1254` and `chromium_headless_shell-1254`. The whole `ms-playwright` folder is 2.1 GB because older builds (1223, 1248) from other projects were already there. Not blocked.
- Lint of the whole repo about 6 s; turbo `lint` 17 tasks about 17 s cold, 221 ms cached.

## Open issues & risks
- **Version deviations from the manifests: none.** Every pin resolved; no manifest other than `packages/config/package.json` was edited.
- **Needed pnpm-workspace.yaml changes (decisions for Cee/lead):**
  1. `overrides: "@colyseus/uwebsockets-transport>uWebSockets.js": "-"`. `uWebSockets.js` is a git dependency; `apps/server` pins it directly (v20.71.0, allowed), but `@colyseus/uwebsockets-transport@0.18.5` also declares it as a sub-dependency (v20.52.0) and pnpm 11 stopped with `ERR_PNPM_EXOTIC_SUBDEP` (`blockExoticSubdeps` is on by default). I first tried switching `blockExoticSubdeps` off, which the permission system denied as a security weakening, so I never ran it and replaced it with the narrower override above: it removes only that one transitive edge, keeps `blockExoticSubdeps` enabled, and leaves exactly one uWebSockets.js in the lockfile (commit 9ec36de, tarball integrity `sha512-tuVmOn7w...`). Verified: the lockfile contains a single `gitHosted` entry, the one for the direct dependency. **Risk:** the transport reaches uWebSockets.js through pnpm's hoisted `.pnpm/node_modules` rather than its own dependency list; it resolved there on disk, but the first real server boot (M0-W1 / T03 server stub) must confirm `import "uWebSockets.js"` works from the transport. Alternative if it does not: Cee relaxes `blockExoticSubdeps` consciously, or the transport is bumped.
  2. `minimumReleaseAgeExclude` (9 entries: `@colyseus/schema@5.0.48`, `@turbo/*@2.11.11`, `prettier@3.10.1`, `turbo@2.11.11`) was added to `pnpm-workspace.yaml` **by pnpm itself** during the install (these versions are newer than the minimum release age). Please review that you accept them; they are exactly the pinned versions.
  3. `allowBuilds` (see next section).
- `eslint@9.39.5` is reported deprecated by the registry (ESLint 10 exists); the pin is deliberate per tech-stack/README (ADR needed to move). Three deprecated subdependencies come from `drizzle-kit` (`@esbuild-kit/*`, `glob@10.5.0`); nothing to do now.
- `packages/config/vitest/browser.ts` is a placeholder: no browser provider is installed (`@vitest/browser-playwright` would need an ADR and a between-waves install).
- `pnpm test` in each package still runs the bare `vitest run --passWithNoTests` (defaults), so only `packages/config` runs tests until packages add their own `vitest.config.ts`.
- `docs/vendor/**` produces a "file ignored" notice if passed to eslint explicitly; that is the intended ignore.

### Blocked build scripts (for Cee at Gate G0b; I did not run `pnpm approve-builds`)
Recorded in `pnpm-workspace.yaml` as `allowBuilds: esbuild: false, msgpackr-extract: false`, so no third-party script ran. pnpm listed: `esbuild@0.18.20`, `esbuild@0.25.12`, `esbuild@0.28.2`, `msgpackr-extract@3.0.7`.
- **esbuild** (0.18.20 via `@esbuild-kit/core-utils` <- `drizzle-kit`; 0.25.12 via `drizzle-kit`; 0.28.2 direct in `apps/server` and via `tsx`): `postinstall: node install.js` only validates and optimizes the platform binary (it can replace the JS shim with the native binary). The platform packages (`@esbuild/win32-x64`) are installed as normal optional dependencies without any script; I ran `esbuild --version` on 0.28.2 and it printed 0.28.2, so builds work without the script.
- **msgpackr-extract@3.0.7** (via `msgpackr@2.1.4` <- `@colyseus/core` 0.18.28): `install: node-gyp-build-optional-packages` selects a prebuilt native addon (`@msgpackr-extract/msgpackr-extract-win32-x64` is present). It is an optional speed-up; msgpackr falls back to pure JS. Server netcode will work without it; with it, decoding is faster.
- No gate in this brief needed either script. uWebSockets.js (git tarball) ships prebuilt binaries and has no install script.

## Hand-off for T01 (contracts-architect) and T03 (scripts)
All commands run from the repo root with the wave §3 Node 26 prefix. `<pkg>` = folder (for example `packages/shared`).
- Typecheck one package before its scripts are wired: `pnpm exec tsc -p packages/<pkg>/tsconfig.json` (a package tsconfig extends `../../tsconfig.base.json`; `config` shows the pattern; env-agnostic packages keep `"types": []`).
- Lint one package: `pnpm exec eslint packages/<pkg>` (the root config is found automatically; boundary rules apply to `src/**`).
- Format-check one package: `pnpm exec prettier --check packages/<pkg>` (`--write` to fix; only format files you own).
- Test one package: `pnpm --filter @moon-cleanup/<pkg> test` or `pnpm exec vitest run --root packages/<pkg>`; from the root, `pnpm exec vitest run --project <name>` works once the package has a `vitest.config.ts` with `test.name`.
- Opt into a Vitest preset: add `packages/<pkg>/vitest.config.ts`:
  ```ts
  import { mergeConfig } from "vitest/config";
  import { nodePreset } from "@moon-cleanup/config/vitest";
  export default mergeConfig(nodePreset, { test: { name: "<pkg>" } });
  ```
  (`vitest` and `@moon-cleanup/config` resolve from the root `node_modules`; verified from `packages/shared`.) Note a package's own `vitest.config.ts` file is outside `src/`, so the boundary rules do not block this import.
- T03 scripts suggestion: `"lint": "eslint ."`, `"typecheck": "tsc -p tsconfig.json"`, `"test": "vitest run"` (the preset already sets `passWithNoTests`). Run `eslint .` from the package folder; ESLint 9 walks up to the root config. Every package needs its own `tsconfig.json` before `typecheck` can run.
- Boundary fixtures show what is banned in `src/`: `packages/shared/src` cannot import any workspace package, DOM/Node globals or built-ins, `three`, `colyseus*`; no default exports in `packages/*/src`; no `@moon-cleanup/*/src/**`.
- T01: if a rule blocks a legitimate contract file, report it instead of editing configs. `zod` imports are allowed in shared.

## Dependencies requested (need ADR + devops install between waves)
- none (the only addition, `@types/node` 26.6.6 in `packages/config`, was in the brief; the other four devDependencies of that package repeat the root pins and were resolved from the same lockfile entries).

## Suggested Conventional Commit message(s)
- `build(deps): first pnpm install, lockfile, workspace build-script policy`
- `build(config): ESLint boundary and three.js ban-list rules, Vitest and Prettier presets with fixture tests`
