# M1-W3-T09: steady-state per-tick allocation in packages/sim (gameplay-systems-engineer)

Status: done (awaiting lead review) / 2026-11-14 / gameplay-systems-engineer / Opus 5.5

## Done

The netcode report (M1-W4-T02b) saw about 1.1 KiB/tick. I reproduced it and traced it to the sites below.

- **Root cause:** V8 14.6 / Node 26.13.1 boxes every float64 argument into a fresh HeapNumber when TurboFan does not inline the call. It also boxes a float64 return value.
  - `turnToward`: 8 double arguments. Never inlined.
  - `sampleOffset`: 4 call sites. One was not inlined because the cumulative inlining budget ran out.
  - `doJump` / `land`: double arguments.
  - `headPhase`, `placeHead` and `quantiseSegment`: 6 doubles.
  - `dirScratch`: an `{x,y,z}` object literal. Literals share one map tree across the whole process, and those fields had gone tagged, so each double store allocated. It is now its own class.
  - `acceptStroke`: the `dust.collected` payload was built even when nobody listened, and `plotIds` grew a 17-slot backing array.
- **Fix:** helpers now take their operands from module scratch typed arrays. The slope probes call the ground from a single loop site. The payload is built only when there is a listener, with exact-size `plotIds`. The arithmetic is identical, so the hashes did not change.

## Results (6 actors, warmed, Node 26.13.1)

| Run | Before | After |
|---|---|---|
| Sweep + listener, total_allocated (tsx probe) | 2,614 B/tick | 520 B/tick (`dust.collected` payloads only) |
| Sweep, no listener, sim frames (sampled) | ~1,100 B/tick | 1-8 B/tick |
| Lope, sim frames | ~1,220 B/tick | 0 B/tick |
| stepAvatar alone | 204-207 B/actor-tick | 2-6 B/actor-tick (harness loop) |
| stepAvatar µs, interleaved A/B, 3 runs (laptop noisy) | 3.9-5.8 | 3.9-8.6 (one outlier); parity |
| room-sim cost test, alone | 6.2 (previous) | 5.52-12 (noisy) |

## Files

- `packages/sim/src/movement/avatar.ts`
- `packages/sim/src/tools/tool.ts` (exported `headPhase` signature unchanged)
- `packages/sim/src/room/moon-room-sim.ts`
- New: `packages/sim/test/unit/alloc.test.ts`. It uses the sampling heap profiler and counts only packages/sim frames. The bound is < 64 B/tick; 3/3 runs gave 0-8. I used the profiler because process-wide `total_allocated_bytes` has 100-600 B/tick of noise under vitest.

## Evidence (packages/sim)

- `tsc`, `eslint .` and `prettier --check src test`: clean.
- `vitest run`: **5 files, 77 passed**.
  - Golden: 4037918216 unchanged.
  - The checkpoint restore tests pass. The codec was not touched.
- Probe scripts are in scratch only.

## Remaining / Next

- When a listener exists, each `dust.collected` event costs about 150 B (payload plus `{name,payload}` envelope). This is inherent: worker-core queues events. Pooling them would need a contract change (contracts-architect).
- `packages/world` `noise()` allocates 4-8 B/tick (terrain owner).
- The µs figures need a quiet machine to be precise.

Commit suggestion: `perf(sim): remove per-tick HeapNumber boxing from avatar/tool hot paths`
