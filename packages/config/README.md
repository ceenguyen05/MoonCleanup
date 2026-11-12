# @moon-cleanup/config

**Path:** `packages/config` - **Owner role:** `devops-engineer` - **Layer:** tooling presets (not imported at runtime)

## Purpose

Shared tooling presets consumed by the repo root: the ESLint 9 flat config (typescript-eslint 8.72.2, `eslint-config-prettier`,
`no-restricted-imports` rules enforcing the package dependency direction, the ban-list for legacy three.js APIs such as
`WebGLRenderer`, `EffectComposer`, GLSL `ShaderMaterial`, `renderAsync`, `PostProcessing`), Vitest presets and the
Prettier config. TypeScript compiler options live in the repo-root `tsconfig.base.json`, not here.

## What Fable will build here

Task M0-W0-T02 (`devops-engineer`). This package exports **no tsconfig bases**: the single base is the repo-root `tsconfig.base.json` and M0 uses no project references. Its own `tsconfig.json` uses `types: ["node"]`, so T02 adds `@types/node` to this package's devDependencies.

`eslint/` (flat config pieces: base, per-layer boundary rules, client, server), `vitest/` (node preset, browser-mode
preset), `prettier/` (shared options; `.editorconfig` already sets indent/EOL). The root `eslint.config` and
root `vitest.config` (no deprecated `vitest.workspace`) will import from here (the root `package.json` already lists this package as a workspace dependency).

## Key contracts consumed

The package map and rules in `docs/architecture/module-boundaries.md` section 1 (ESLint encodes them).

## Rules

- Versions are pinned: `eslint` 9.39.5 (ESLint 9 per `docs/architecture/tech-stack.md`; npm `latest` is 10.x, adopting it needs an ADR),
  `@eslint/js` 9.39.5, `typescript-eslint` 8.72.2 (does **not** support TypeScript 7: stay on TS 6.0.3).
- Whether to add an import-boundary plugin (for example `eslint-plugin-boundaries`) is undecided: verify the current
  version on the registry and record it in an ADR first; core `no-restricted-imports` is enough to start.
- Shared root file: change only between waves.

## Commands

```
pnpm --filter @moon-cleanup/config test
```

`lint` / `typecheck` are echo placeholders until sources land.
