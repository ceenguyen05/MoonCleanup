# M1-W3-T04 Server authoritative dust state (terrain-dust-engineer)

Task / status: **in-review** / 2026-11-16 / terrain-dust-engineer / Opus 5.5 (effort set by lead). Node v26.13.1 (fnm PATH prefix), Windows 11. No git.

## Gap analysis (card vs disk)

Already met before this task, with tests: authoritative `WorldDustLedger` per room (`net/shift/shift-ledger.ts`, W4-T03), completion + Stamp events from the sim, streamed ledgers with dust radius 60-220 m + 20 m margin + 20 m hysteresis, staggered 0.5 s (`shift-core.ts refreshDustInterest`), `dust.plots` L0 deltas, DUST_REQUEST / DUST_CHECK detail (W4-T06), checkpoint/restore in the shared chunk codec with the bakeHash check byte and room header v2 (`shift-persistence.ts`, W5-T01). The code lives in `net/shift`, not `world/`. That is intentional.

Real gap found by measurement: every join or resync snapshot rebuilt the moon-wide part, and a per-plot `PlotState.Opened` namespace read made it cost 33-53 ms. Six resyncing seats cost 115 ms/s, tick p99 216 ms. There was no snapshot cache (WDS 5.1).

## Done

- `shift-dust.ts`: a moon-wide cache (plot-state bits + Opened bytes), rebuilt only per dust generation, so it is never stale. The constant is hoisted. New `noteDirty()`, `moonWide()` and cache counters.
- `shift-core.ts` (minimal hookup): `noteDirty` in `collectDirtyPlots`, and at most one snapshot build per frame tick.
- New `world/dust-budget.test.ts`: cache byte-equality against an uncached build, plus the budget run.

## Evidence

`vitest run src/world src/net src/persistence`: 19 files, 202/202 passed. Measured with 6 seats at 20 Hz over 60 s, whole tick:

| Run | CPU | Tick p99 |
| --- | --- | --- |
| Walking | 3.4 ms/s | — |
| Sweeping | 5.4 ms/s, under 8 ms/s | — |
| Sweeping + resync storm | 16.5 ms/s (was 115) | 6.1 ms |

- Snapshot build max: 5.7 ms.
- Ledger RAM: 2.48 MiB per room. Pool growths: 0.

eslint is clean on the edited files. prettier is clean after `--write` on `shift-dust.ts` and the test.

tsc has one error, in `shift-ledger.test.ts:326` (RequestId). That file belongs to the backend agent, not to this task.

## Not met / Next

1. Under a storm, all seats resyncing at the 2 s limit, CPU is about 2x the budget. Normal play is within budget.
2. Stroke logs (capped, LRU) were not built. My brief says to rebuild from ledgers, and logs are cosmetic.
3. The 5 s `dust.check` chunk summary is not sent. The client ignores `chunks` mode (`apps/client/src/net/remote-dust.ts:214`); netcode owner.
4. Sweep heap delta is about 4 MB/min against 1 MB walking. This is sim/stroke allocation and needs a profiler.

Commit suggestion: `perf(server): cache moon-wide dust snapshot, cap one snapshot build per frame, dust budget test`
