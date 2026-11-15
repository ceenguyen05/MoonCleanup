# @moon-cleanup/game-data

**Path:** `packages/game-data` - **Owner role:** `game-designer` - **Layer:** balance + content tables

## Purpose

The 23 baseline tables of progression-and-economy.md §21 plus `tool-feel.json` (game-feel-and-controls.md §10.2;
`movement.json` also carries the §10.1 feel keys since contract v1.3) (`data/<table>.json`, reference mode) validated by the zod
schemas in `@moon-cleanup/shared` (`config/*.schema`, contract v1) and the cross-table `GameDataBundleSchema`.
Names come from `docs/design/naming-bible.md`; numbers will be re-tuned with `tools/balance-sim`.

## Layout

- `data/*.json` - one file per `GAME_DATA_TABLES` entry, each `{ "schemaVersion": 1, ... }`.
- `src/raw.ts` - JSON imports (`with { type: "json" }`; no DOM/Node APIs).
- `src/load.ts` - `loadGameData()` (parse once with `GameDataBundleSchema`, deep-freeze) and `parseGameData(raw)`.
- `src/content/display-names.json` + `labels.ts` - the one display-label source per id (`displayName(id)`).
  A rename = one row in the naming bible + one string here. Achievements keep `displayName` in their own table.
- `src/game-data.test.ts` - per-table and bundle validation, locked §21 counts, contract v1.1 fields (all doc values
  now live in the JSON tables), doc totals, label catalog coverage and a first-minutes check of the reference loop.

- `src/mvp-scope.test.ts` - every `MVP_SCOPE` id exists, MVP prerequisites stay inside the slice, dust levels <= 15 and thresholds match the 1/1000 and 1/100 ledger divisors, D1 sun path.
- `src/sun-path.ts` - Boreal gameplay sun path (peak 40 deg, trough -20 deg, 30/30 cycle); moves into `world.json` when the schema gains `sunPath`.

## Effect semantics

A level's `effects` are the full effect of owning that level (they replace the lower level's effects of the same
node/line). Across nodes `add` stats sum (`toolWidthBonus`, `moveSpeedBonus`, `payoutBonus`: base x (1 + sum)) and
`mul` stats multiply (`vehicleTripTimeMult`, `pourTimeMult`, ...), matching the §22.2 formulas. Record-scoped stats
append the id: `cellLevel.tool.desk_duster`.

## Status of the numbers

All values are **candidate tuning** from progression-and-economy.md (Draft v3). The opening through the first Bead
Kiln (≈3.5 h) is hand-derived (economy §18.2 / Appendix B); later pacing rows are estimates to regenerate with
`tools/balance-sim`. **Estimated by game-designer, not in the doc:** build-piece footprints and snap tokens; the 39 Deck
Plate / 20 Gantry breakdowns and their prices inside the doc's 10-120 / 30-150 bands; achievement stat ids;
onboarding trigger tokens; `cleanupOrder` params; pacing bands for "~" targets (first Cell 7-12 min, Assembly Gun
35-55 min, Shine 1% 5-7 h) and every `toleranceFrac`.

## Commands

```
pnpm --filter @moon-cleanup/game-data test
pnpm --filter @moon-cleanup/game-data typecheck
pnpm --filter @moon-cleanup/game-data lint
```

## Rules

- Data and validation only; no game logic (logic lives in `packages/sim`).
- Environment-agnostic (no DOM, no Node APIs): read by the sim in a browser, a Worker or Node.
- Consumed by `packages/sim`, `apps/*` and `tools/balance-sim` through `loadGameData()` only.
