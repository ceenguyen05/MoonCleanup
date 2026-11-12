# @moon-cleanup/game-data

**Path:** `packages/game-data` - **Owner role:** `game-designer` - **Layer:** balance + content tables

## Purpose

JSON/TS data tables (tools, vehicles, robots, upgrades, contracts, progression curves, shop entries) validated at load
time by the zod schemas in `@moon-cleanup/shared` (`config/*.schema`). Names and terminology come from
`docs/design/naming-bible.md`. Numbers here are tuned with `tools/balance-sim`.

## What Fable will build here

`src/tables/` (numeric balance tables, one file per schema) and `src/content/` (definitions: names, descriptions,
unlock graph). A barrel `src/index.ts` that exports parsed, frozen, typed tables. A Vitest suite that validates every table
against its schema.

## Key contracts consumed (from `@moon-cleanup/shared`)

Balance config zod schemas (`config/*.schema`), IDs & units, audio cue IDs and event names where content references them.

## Rules

- Data and validation only; no game logic (logic lives in `packages/sim`).
- Environment-agnostic (no DOM, no Node APIs): the tables may be read by the sim in a browser, a Worker or Node.
- Consumed by `packages/sim` and `tools/balance-sim`.

## Commands

```
pnpm --filter @moon-cleanup/game-data test
```

`lint` / `typecheck` are echo placeholders until sources land.
