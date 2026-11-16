# M1 dust interest throttle (backend-data-engineer)

Status: implemented, focused checks green (see Tests). Behaviour unchanged by construction and by test.

## What changed (apps/server/src/net/shift/shift-core.ts, shift-dust.ts; new test shift-dust-interest.test.ts)
- `ShiftCore.refreshDustInterest` is now a thin wrapper over `ShiftDust.scanInterest(DustInterestScan, avatar, sent)`. The loop lives in shift-dust.ts: typed-array scratch only (`scanU`, `hitPlots`), no calls and no closures in the loop, slot-indexed cache of plot centre directions (`dirPlot`/`dirVec`; removes the `centerDirectionInto` call per ledger per pass). Hits are returned in `hitPlots`; the core enqueues them in the same slot order as before.
- Throttle is exact, not a cell approximation: a per-seat `DustInterestScan` stores the unit direction of the last pass and the "slack" (smallest distance of any considered ledger's dot to its in/out threshold; a dot moves by at most the chord the unit vector moved). The pass is skipped while the same ledger allocations are live (`ledger.counters.ledgersAllocated`), nothing outside the pass changed the seat's marks, and the direction moved less than the slack. A fixed interest cell would change results near the boundary; the slack test cannot (1e-12 margin for float rounding). Sweeping seats at 0.5 s cadence move more than the slack, so they still rescan (cheaply); stationary or slow seats skip.
- Invalidation (spawn/teleport/resync/radius): `requestDustSnapshot`, snapshot build (`sent.fill(0)`), `setDustRadius`/`addSeat` (radius), the early-return states (snapshot pending, hidden, paced snapshot), a full stream queue, a streamed ledger going 2 -> 1 in `sendDust`, and a stale-snapshot catch-up reset. Teleports need no hook: a large jump exceeds the slack.
- Not touched: wire format, queue/credit logic, `buildSnapshotRaw`, `ledgerInput` (the optional ledgerInputInto hoist from the profiler report was not part of this brief).

## Tests
- New `apps/server/src/net/shift/shift-dust-interest.test.ts`: 4000-step table over a real ShiftCore ledger (3 sweeping seats keep allocating ledgers) with a verbatim copy of the old loop as reference: tiny and large random-walk steps, teleports to avatars and random points, radius changes, 2 -> 1 and reset stream transitions, a sometimes-full queue. Asserts identical queued plots (order included) and identical `sent` marks after every call, plus that hits, allocations, full-queue cases and >10 % skips occurred. Mutation check: loosening the slack (gap*4+1e-3) fails the table ("expected [] to deeply equal [81666, ...]"); restored.
- Focused vitest `src/net src/world`: 20 files, 189 tests passed (includes dust-budget.test.ts and the new table). eslint clean, prettier applied, `tsc --noEmit` (apps/server) clean.

## Measurement (existing apps/server/src/world/dust-budget.test.ts, 6 seats, 20 Hz, 60 s sweep; NOISY: Windows laptop shared with other agents, unforced GC; use as indication only)
| | heapUsed delta, sweep (KiB / 60 s) | sweep CPU ms/s | walk CPU ms/s |
|---|---|---|---|
| before | 3839 (profiler report: 2800-4000) | 6.04 | 4.99 |
| after | 1575 / 1550 / 1548 | 8.37-8.61 | 4.55-6.74 |
- Heap garbage in the sweep run drops about 2.3 MiB/min (~60 %), consistent across three runs; the walk run (no ledgers, early return) is unchanged at 826 KiB.
- CPU ms/s is not a reliable signal here: machine load varied (walk, which this change barely touches, moved 4.55 to 6.74), and the after runs sat in the loaded window, which also pushed the 8 ms sweep bound and the storm p99 bound over their limits in those runs (the same storm bound also failed once in the baseline). No CPU regression is claimed or ruled out; rerun on a quiet machine before reading the CPU column.
- Retained heap is unchanged (the profiler report showed no leak; this only removes garbage).

## Risks
- The skip logic is only as exact as the invalidation list: any new writer of a seat's `dustSent` marks outside the pass must call `seat.dustScan.invalidate()`. Documented on `DustInterestScan`.
- `hitPlots`/`dirVec` grow with the ledger pool capacity (12 B + 4 B per slot, a few KiB).
