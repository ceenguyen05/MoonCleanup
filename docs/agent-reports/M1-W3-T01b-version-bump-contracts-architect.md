# M1-W3-T01b version bump (contracts-architect)

Status: done. No git. No design docs edited.

## Changes
- `packages/shared/src/world/dust.ts`: `DUST_MODEL_VERSION` 1 -> 2; header v1.2 -> v1.3 with changelog; `LEDGER_LATTICE_PITCH_DIVISOR` comment now states the snap down to a divisor of `LEDGER_TEXEL_SIZE_MM`. Test `dust.test.ts` expects 2.
- `packages/world/test/unit/dust-chunk.test.ts:128` expects 2; `test/vectors/ledger-v1.json` `dustModelVersion` 2. No hash depends on the version, so none changed (worldHash stays 1057297321).
- `apps/client/src/sim-host/browser/sim-host.worker-lane.ts`: golden copy set to stateHash 1669990435, gramsCollected 67504, dustHash 3965169329 (numbers edited; importing from the sim test cases would cross a test boundary).

## Evidence
shared vitest and tsc: no failures. world 100/100, world Chromium 5/5, sim 106/106, client src/sim-host 25/25, sim-host Chromium 5/5, server src/net 151/151. eslint and prettier clean on touched files. No golden moved beyond the ones named.

## Consumers
None must change. Saves written from now stamp 2; old ledgers load unchanged. Doc conflicts listed in the terrain-dust report remain for docs-keeper.
