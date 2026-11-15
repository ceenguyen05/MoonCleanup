# M1-B1 Detailing cooldown debt (review blocker B1 of M1-review-W3-ledger-roomsim-code-reviewer)

Task / status: M1-B1 / in-review (fix done; goldens re-recorded on lead approval) / 2026-11-15 / gameplay-systems-engineer / Opus 5.5

Update (lead approved the re-record): new values are written to `packages/sim/test/golden/cases.ts` (with an old -> new
changelog), `packages/sim/test/unit/checkpoint.test.ts:176` and the copy in
`apps/client/src/sim-host/browser/sim-host.worker-lane.ts`. Green runs:
- sim: 107/107
- world: 104/104
- client `src/sim-host`: 34/34
- client Chromium worker lane: 5/5
- server `src/net/shift` + `src/sim`: 22/22
- eslint, prettier and sim tsc: OK on the changed files

The old hashes remain only as history in these places, none edited:
- `docs/STATUS.md:13,15` (lead)
- the `packages/game-data/src/game-data.test.ts:88` comment, which says 4037918216 was produced with the feel keys and is still historically true
- older agent reports and the STATUS history

The table below is kept as the record.

Done:
- Reproduced B1 with a failing test. Detailing held through a full jump gave a cooldown of -2050 ms while airborne, then gaps of 2 ticks (100 ms) between discs after landing.
- Fix in `stepToolHead` (Detailing branch). `next = max(stored, 0) - stepMs`. A disc fires on a stroke tick when grounded and `next <= 0`, and then `stored = next + periodMs` (always >= 0). Otherwise `stored = max(next, 0)`. Debt can no longer build up while airborne or while waiting for a stroke tick. A negative restored value heals itself. Grounded cadence is unchanged: a temporary old-rule variant of the same code reproduced both old goldens exactly. Allocation-free: scalar locals only.

Golden changes (legitimate, re-recorded after lead approval):
| Golden | Field | Old | New |
| --- | --- | --- | --- |
| GOLDEN_REPLAY | stateHash | 4037918216 | 3938942926 |
| | strokeHash | 2027053455 | 786224438 |
| | strokes | 3975 | 3959 |
| | gramsCollected | 56640 | 55661 |
| WORLD_LEDGER | stateHash | 1669990435 | 3774476554 |
| | strokeHash | 2027053455 | 786224438 |
| | strokes | 3975 | 3959 |
| | gramsCollected | 67504 | 66779 |
| | dustHash | 3965169329 | 2946260242 |
| | ledgers / polished | 25 / 0 | 25 / 0 (unchanged) |

Why: I diffed the stroke dumps of the old and new runs. Every sweep stroke is identical. Only Detailing discs differ: 31 old discs became 15 new ones. The old run had 16 disc gaps shorter than 8 ticks (bursts such as ticks 938/940/942); the new run has 0. Checkpoint/reload restore tests land on the same new hashes, so restore determinism holds.

Next: lead updates the STATUS golden values. Then a short re-review of `tool.ts`. Optional (checkpoint owner): clamp `detailCooldownMs` to a lower bound of 0 in `checkpoint.ts:796`.

Files: `packages/sim/src/tools/tool.ts`, `packages/sim/test/unit/room-sim.test.ts` (new B1 test), `packages/sim/test/golden/cases.ts`, `packages/sim/test/unit/checkpoint.test.ts`, `apps/client/src/sim-host/browser/sim-host.worker-lane.ts`.

Evidence (Node 26 fnm, vitest 5.1):
- sim: 103 pass, 4 fail (only the golden comparisons above)
- world: 104/104 pass
- sim `tsc -p` exit 0; eslint exit 0 on the changed files

Blockers: none.

Commit suggestion: fix(sim): floor Detailing cooldown so airborne time cannot bank disc debt
