# @moon-cleanup/config

**Path:** `packages/config` - **Owner role:** `devops-engineer` - **Layer:** tooling presets (not imported at runtime)

## Purpose

Shared tooling presets consumed by the repo root: the ESLint 9 flat config (typescript-eslint 8.72.2,
`eslint-config-prettier`, `no-restricted-imports` rules enforcing the package dependency direction, the ban-list for
legacy three.js APIs such as `WebGLRenderer`, `EffectComposer`, GLSL `ShaderMaterial`, `renderAsync`,
`PostProcessing`), Vitest presets and the Prettier config. TypeScript compiler options live in the repo-root
`tsconfig.base.json`, not here (no tsconfig bases are exported; M0 uses no project references).

## Layout

| Path                                                   | What                                                                                                            |
| ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| `eslint/index.ts` -> `@moon-cleanup/config/eslint`     | `eslintConfig`: the whole flat config. The root `eslint.config.js` re-exports it                                |
| `eslint/boundaries.ts`                                 | module-boundaries section 1 rules 1-6 as core `no-restricted-imports` / `-globals` / `-syntax` options          |
| `eslint/ban-list.ts`                                   | three.js ban-list (rendering-pipeline section 18): import bans + AST selectors                                  |
| `eslint/*.test.ts`, `eslint/lint-fixture.ts`           | fixture suites: one test per rule/ban-list entry proves it fires, one per layer proves allowed code stays clean |
| `vitest/index.ts` -> `@moon-cleanup/config/vitest`     | `nodePreset`, `browserPreset({ provider })` (placeholder: no browser provider is installed yet)                 |
| `prettier/index.ts` -> `@moon-cleanup/config/prettier` | `prettierConfig`. The root `prettier.config.js` re-exports it                                                   |

The sources are `.ts` files loaded directly by Node 26 (native type stripping), Vite and ESLint: relative imports end in
`.ts` and only erasable syntax is used (`erasableSyntaxOnly` in this package's tsconfig).

## Rules

- Versions are pinned: `eslint` 9.39.5 (ESLint 9 per `docs/architecture/tech-stack.md`; npm `latest` is 10.x, adopting
  it needs an ADR), `@eslint/js` 9.39.5, `typescript-eslint` 8.72.2 (does **not** support TypeScript 7: stay on TS 6.0.3).
- Boundary rules apply to `packages/<name>/src/**` (build files next to `src` such as `vitest.config.ts` may import
  tooling). Rule 1 (no apps/tools) applies to every file under `packages/`. The three.js ban-list and the deep-import ban
  apply to every linted file.
- Whether to add an import-boundary plugin (for example `eslint-plugin-boundaries`) is undecided: verify the current
  version on the registry and record it in an ADR first; core `no-restricted-imports` is enough so far.
- ESLint ignores `docs/**` (including the vendored `docs/vendor/**`), `prototypes/**`, `assets/**`, generated output.
  `.claude/hooks/**/*.mjs` is linted with the plain, non-type-aware JavaScript block (core recommended + Node globals).
- Shared root files: change only between waves.

## Commands

```
pnpm --filter @moon-cleanup/config lint typecheck test
pnpm exec eslint packages/config
pnpm exec tsc -p packages/config/tsconfig.json
```

## Opting a package into a Vitest preset

Packages without a `vitest.config.ts` run with Vitest defaults. To use the preset, add `packages/<name>/vitest.config.ts`:

```ts
import { mergeConfig } from "vitest/config";
import { nodePreset } from "@moon-cleanup/config/vitest";

export default mergeConfig(nodePreset, { test: { name: "<name>" } });
```

`vitest` and `@moon-cleanup/config` resolve from the workspace root `node_modules`, so no install is needed.
