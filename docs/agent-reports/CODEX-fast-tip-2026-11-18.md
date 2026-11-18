# Fast Tip unloading-only correction

2026-11-18. Temporary Codex worker; bounded data/test change authorized by the lead after Cee's decision.

Scope: remove Fast Tip's vehicle trip-time effect at both levels, retain unload multipliers 0.6 / 0.3, prices and base 2 s tip time. Historical M1-tipS-balance statement retaining trip time is superseded by this decision. The balance review identified that latent effect as a potential 40% / 70% trip reduction.

Read CLAUDE.md, current STATUS checkpoint and owner decisions, MODEL_POLICY, REFERENCE_TARGET, M1-tipS-balance, M1-balance-review-sell-loop-upgrades and relevant source. No STATUS, policy or golden edits; no git mutations.

Implemented: removed only the two `vehicleTripTimeMult` effects from Fast Tip. Unload effects remain 0.6 / 0.3, prices remain 0.1 / 0.3 of vehicle cost. Existing unloading behavior remains 24 / 12 ticks at 20 Hz (base 40 ticks / 2 s). No runtime code changed.

Added regression coverage in `packages/game-data/src/vehicle-feel.test.ts` and `packages/sim/test/unit/vehicles.test.ts`. Both levels preserve the resolved round-trip multiplier at 1, including unchanged composition of Afterburner II and Throttle Lock (0.88 x 0.97), while shortening the tip timer.

Evidence, Node v26.13.1 via `fnm exec --using=26`:

- RED before the JSON edit: game-data `src/vehicle-feel.test.ts` had 1 failure / 4 passes (`expected true to be false`, trip effect still present). Sim `test/unit/vehicles.test.ts -t "Fast Tip level"` had 2 failures / 25 skipped: level I resolved `tripTimeMult=0.6`, level II `0.3`, both expected 1.
- GREEN after the JSON edit: game-data full `vitest run`: 3 files / 64 tests passed, 13.64 s.
- GREEN sim `vitest run test/unit/vehicles.test.ts test/unit/room-vehicles.test.ts test/golden/replay.golden.test.ts`: 3 files / 46 tests passed, 22.66 s. Includes actual Dump Plate unload timing and both unchanged recorded replays. No golden was edited: stand-in state/stroke 1076468633 / 4164540033; real-ledger state/stroke/dust 1838396500 / 4164540033 / 2469925789.
- Commands run from the package directories: `fnm exec --using=26 node ../../node_modules/vitest/vitest.mjs ...`. Direct `fnm exec --using=26 pnpm ...` cannot spawn this machine's PowerShell pnpm shim; no install/config change was made.
- Prettier initially flagged the JSON's now-single-effect multiline arrays; applied Prettier to that file only (whitespace after successful tests). Final scoped Prettier check on all four owned files: PASS. Scoped `git diff --check`: PASS.

Only this worker's changes: two removed JSON effects and their resulting formatting, existing game-data test description plus absence assertion, one parametrized sim regression (two cases), and this report. Other pre-existing edits in these files were preserved. No server/browser/long-running process was started; focused test processes exited.

Look-check applicability: N/A for this correction. It changes an unused balance-model proxy; unloading timing and all rendering/motion remain unchanged. No browser/GPU result claimed. Full pnpm verify is reserved for lead integration and will not run here.
