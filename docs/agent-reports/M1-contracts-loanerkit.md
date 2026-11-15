# M1 contracts: moderation.loanerKit fields

Status: done. Contract v1.1 (additive; `GAME_DATA_SCHEMA_VERSION` stays 1, no hash/version files exist for game-data).

Changes
- `packages/shared/src/config/moderation.schema.ts` (v1 -> v1.1): `loanerKit` now `{ maxVehiclesOut, walletFrac: number in (0,1], capLm: positive int, windowS: positive number }`.
- `packages/game-data/data/moderation.json`: `loanerKit` = `{ maxVehiclesOut: 4, walletFrac: 0.02, capLm: 25000, windowS: 600 }`.
- `packages/shared/src/config/bundle.schema.test.ts`: fixture updated.
- `docs/design/progression-and-economy.md` section 21 table row updated.

Tests: shared, game-data (59), protocol (123), sim (153) vitest pass; shared and sim tsc clean.

Consumer action (economy owner, packages/sim/src/room/moon-room-sim.ts)
- Fields: `options.data.moderation.loanerKit.walletFrac`, `.capLm`, `.windowS` (seconds; ticks = round(windowS * tickHz)).
- Remove `LOANER_KIT_SPEC` (line ~240), the `Partial<Record<...>>` cast and `??` fallbacks (lines ~455-460); read the fields directly (now typed, required).
- No other consumers read `loanerKit`; server/client need no change.
