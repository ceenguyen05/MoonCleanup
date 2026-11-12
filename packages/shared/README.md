# @moon-cleanup/shared

**Path:** `packages/shared` - **Owner role:** `contracts-architect` - **Layer:** contracts (imports nothing from the workspace)

## Purpose

The single source of truth for every cross-module contract: branded IDs and units, the network protocol catalog, input
commands, entity component shapes, the `RoomSim` interface, plot grid / stroke formats, the event catalog, the client
module interface and service registry keys, UI store shape, audio cue IDs, render quality presets, balance config zod
schemas, REST DTOs and the save format. Pure types, constants and zod schemas only - no logic, no I/O.

## What Fable will build here (Wave 0, contracts)

Each contract file starts with a version header comment. Planned layout (see `docs/architecture/module-boundaries.md` section 2):
`src/ids/` and `units`, `src/protocol/{messages,channels}`, `src/sim/{input,components,room-sim}`,
`src/world/{plot-grid,dust,stroke}`, `src/events/catalog`, `src/client/module`, `src/ui/store`, `src/audio/cues`,
`src/render/quality`, `src/config/*.schema`, `src/api/rest`, `src/save/format`, plus the `index.ts` barrel. The empty
folders already exist with `.gitkeep`. `PROTOCOL_VERSION` and `SAVE_FORMAT_VERSION` live here.

## Key contracts consumed

None. This package is the root of the dependency graph. Only external dependency: `zod` 4.6.7.

## Rules

- Environment-agnostic: no DOM, no Node APIs (the tsconfig has an empty `types` array and no DOM lib on purpose).
- Contracts change only between waves, through a proposal in an agent report (module-boundaries "Contract change process").
- Expose everything through the `src/index.ts` barrel; deep imports are banned.

## Commands

```
pnpm --filter @moon-cleanup/shared test        # vitest run --passWithNoTests
pnpm --filter @moon-cleanup/shared typecheck   # placeholder until sources land
```

`lint` and `typecheck` are placeholders (they only echo) because no source or ESLint config exists yet. In M0-W0, `devops-engineer` (task T03) replaces the `scripts` fields with real commands; `contracts-architect` (task T01) owns `src/**`, `tsconfig.json` and this README but **not** `package.json`. Until T03 lands, T01 checks itself with `pnpm exec tsc -p packages/shared/tsconfig.json` and `pnpm exec vitest run --root packages/shared`.
