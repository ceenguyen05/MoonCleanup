---
description: Run tools/balance-sim and have balance-reviewer compare pacing with the targets in docs/design/progression-and-economy.md and hunt economy exploits.
argument-hint: "[M#-W#, optional]"
allowed-tools: Read, Write, Glob, Grep, Agent, SendMessage
---

# /balance-check

Pacing and economy gate for `$ARGUMENTS` (default: the current wave in `docs/STATUS.md`). You are the lead. Never run git.

## Inputs

- `docs/design/progression-and-economy.md` (target time-to-unlock per tier and archetype, tolerances: the pass/fail source)
- `packages/game-data/**` (the tables), `packages/shared/src/config/*.schema.ts`, `tools/balance-sim/README.md`
- `docs/design/naming-bible.md`

## Procedure

1. **Check tooling.** If `tools/balance-sim` is missing or does not run, launch `game-designer` first (owned files: `tools/balance-sim/**`, `packages/game-data/**`) to make it run; wait.
2. **Launch `balance-reviewer`** (`subagent_type: balance-reviewer`, no isolation) with: the changed tables, the simulator command and seed from its README, the archetypes in progression-and-economy.md, a baseline report path if one exists, and the review file to write.
3. It runs the simulator, tabulates time-to-unlock per tier and archetype (and with 1, 4 and 16 players on the shared shift wallet), and compares with the target bands.
4. It hunts exploits: Assay Counter vs Receiving Gate arbitrage, Relay Pad fee loops, robot scaling, sell/buy loops, Commendations/Tenure farming, negative or overflowing values.
5. Wait for the notification; rerun the simulator once yourself (same seed) to confirm the reported table matches.

## Output

- `docs/agent-reports/<M#-W#>-balance-check.md` (the time-to-unlock table, deltas vs baseline, exploits found) and `docs/agent-reports/<M#-W#>-review-balance-reviewer.md`.

## Pass / fail criteria

- PASS: every tier inside its target band (within the tolerance stated in progression-and-economy.md) for every archetype; no Lumens-minting loop; tables validate against the schemas; names are in naming-bible form.
- FAIL: any tier out of band, any exploit, schema or naming violation. Return findings to `game-designer` (tables, sim) or `gameplay-systems-engineer` (rules) for the normal fix cycle; re-run the simulator after the fix.
