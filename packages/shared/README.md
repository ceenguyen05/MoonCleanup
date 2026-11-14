# @moon-cleanup/shared

**Path:** `packages/shared` - **Owner role:** `contracts-architect` - **Layer:** contracts (imports nothing from the workspace)

## Purpose

The single source of truth for every cross-module contract: branded IDs and units, the network protocol catalog, input
commands, entity component shapes, the `RoomSim` interface, plot grid / stroke formats, the event catalog, the client
module interface and service registry keys, UI store shape, audio cue IDs, render quality presets, balance config zod
schemas, REST DTOs and the save format. Pure types, constants and zod schemas only - no logic, no I/O.

## Layout (contracts v0, M0-W0-T01)

Each contract file starts with `// @contract <path> v<n>` and `// @consumers ...` (checked by `src/index.test.ts`).
One sub-barrel per folder of `docs/architecture/module-boundaries.md` section 2, re-exported by `src/index.ts`:
`ids`, `units`, `protocol` (catalog, channels, close codes, M0 payloads, golden vectors, `PROTOCOL_VERSION = 0`),
`sim` (RoomSim placeholder), `world` (grid constants, plot states, PlotGrid placeholder), `events` (typed bus + M0
events), `client` (ClientModule, FrameInfo, service registry), `ui` (store v0), `audio` (cue id placeholder), `render`
(quality presets), `config` (common game-data schemas), `api` (Health/Ready DTOs, HttpRouteDef), `save` (header
envelope layout, `SAVE_FORMAT_VERSION = 0`, golden vector). M1-W0 extends sim/world/events/ui/audio/config.

## Key contracts consumed

None. This package is the root of the dependency graph. Only external dependency: `zod` 4.6.7.

## Rules

- Environment-agnostic: no DOM, no Node APIs (the tsconfig has an empty `types` array and no DOM lib on purpose).
- Contracts change only through the lead and `contracts-architect` (module-boundaries "Contract change process"); consumers migrate together.
- Expose everything through the `src/index.ts` barrel; deep imports are banned.

## Commands

```
pnpm --filter @moon-cleanup/shared test        # vitest run --passWithNoTests
pnpm --filter @moon-cleanup/shared typecheck   # placeholder until sources land
```

`lint` and `typecheck` are placeholders (they only echo) because no source or ESLint config exists yet. In M0-W0, `devops-engineer` (task T03) replaces the `scripts` fields with real commands; `contracts-architect` (task T01) owns `src/**`, `tsconfig.json` and this README but **not** `package.json`. Until T03 lands, T01 checks itself with `pnpm exec tsc -p packages/shared/tsconfig.json` and `pnpm exec vitest run --root packages/shared`.
