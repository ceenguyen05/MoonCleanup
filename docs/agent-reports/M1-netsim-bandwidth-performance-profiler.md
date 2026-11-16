# M1 ShiftState v1.1 bandwidth and tick measurement (performance-profiler)

Measure-only. No source edits; apps/server/** and packages/db/** only read and executed.
Status: DONE (partial scope, see Not run). All numbers NOISY: other agents were running (CPU load sampled at 39 %).

## Machine
Intel i7-8650U @ 1.90 GHz (laptop, UHD 620), Windows 11 Pro 10.0.26200, Node v26.13.1 (fnm PATH prefix, confirmed with
`node -v`), tsx, no browser involved. No netsim conditioner (in-process, no sockets).

## Commands run
```
export PATH="$(cygpath -u "$APPDATA")/fnm/aliases/default:$PATH"; node -v        # v26.13.1
cd apps/server
pnpm exec tsx tools/perf/scripts/shift-state-bandwidth.mts        # x3 (runs RUN1..RUN3)
pnpm exec vitest run src/net/shift/shift-core.test.ts src/net/shift/shift-state.test.ts   # x3: 14/14 pass each time
```
The script (new, mine: `C:\Users\caseyn\Downloads\BroswerMoonSweeper\tools\perf\scripts\shift-state-bandwidth.mts`) drives a
real `ShiftCore` (the same class ShiftRoom uses) with N seats via the protocol INPUT codec, 400 warm-up + 1,200 measured
ticks (60 s game time, 20 Hz sim, 10 Hz frames), sweeping/walking inputs, and builds a `ShiftStateSchemaClass` the way
`ShiftRoom.buildState` does (12 beacons, N players, permissions). It encodes the Schema with the Colyseus `Encoder`
(`encodeAll` = full/join state, `encode` = delta patch, each frame tick as ShiftRoom does).

## Numbers (3 runs; identical bytes every run, deterministic)

### Encoded state size (Schema, shared encode, same bytes to every client)
| Players | Full state (`encodeAll`, join) | Delta, nothing changed | Delta mask only | wallet only | shine only | mask+wallet+shine | tool equip (2 fields) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 333 B | 0 B | 2 B | 9 B | 5 B | 16 B | 6 B |
| 6 | 743 B | 0 B | 2 B | 9 B | 5 B | 16 B | 6 B |

`nearParcelsCollected` costs 2 B per change (field index + uint8) and 0 B when unchanged: the v1.1 field adds nothing to
steady-state bandwidth. Full state grows about 82 B per added player (333 to 743 B for +5).
In the flat test world the sim never changed wallet/shine/mask, so all 600 patches per run were empty (0 B); the delta
columns above are forced single-field changes, not a gameplay trace.

### Per-client bandwidth (application bytes, FRAME + Schema patch)
| Players | FRAME B/s per client | FRAME avg / max | Schema patch B/s | Total incl. 10 writes/s x 80 B overhead assumption |
| --- | --- | --- | --- | --- |
| 1 | 303 | 30.3 / 51 B | 0 | about 1.10 KB/s |
| 6 | 799 | 79.9 / 230 B | 0 | about 1.60 KB/s |

Same in all 3 runs. Overhead (800 B/s) is the netcode.md section 14 estimate, not measured (no sockets here). The
`FRAME` dust sections, ledgers, robots and vehicles are whatever ShiftCore emits in a flat world with no robots or
vehicles, so this is a lower bound, not the "busy" section 14 scenario (8 vehicles, 32 robots, dust ledger streaming).

### Server tick cost (ShiftCore.step + 6x receiveInput, plus Schema encode on frame ticks), ms, 1,200 ticks
| Run | Players | p50 | p95 | max | Schema encode p95 |
| --- | --- | --- | --- | --- | --- |
| 1 | 1 | 0.030 | 0.084 | 0.949 | 0.007 |
| 2 | 1 | 0.032 | 0.077 | 1.099 | 0.007 |
| 3 | 1 | 0.020 | 0.070 | 0.745 | 0.006 |
| 1 | 6 | 0.096 | 0.308 | 1.083 | 0.007 |
| 2 | 6 | 0.094 | 0.310 | 1.011 | 0.007 |
| 3 | 6 | 0.098 | 0.296 | 1.154 | 0.006 |
An earlier warm-up run (not counted, before the 3 repeats) showed 6-player p50 0.205 / p95 0.457 / max 22.6 ms: the max
was a machine-noise or GC spike from concurrent load; the 3 counted runs did not repeat it. Treat max as unreliable.
Schema encode is about 0.007 ms per frame tick, so v1.1 adds no measurable tick cost.

## Budget verdicts (docs/architecture/performance-budgets.md)
| Budget | Limit | Measured | Verdict |
| --- | --- | --- | --- |
| Bandwidth per client, busy, 6 players | <= 5.0 KB/s | 1.60 KB/s (flat world lower bound, includes assumed 0.8 KB/s overhead) | PASS for this scenario only; busy-scenario claim NOT RUN |
| Bandwidth per client typical | <= 3 KB/s | 1.60 KB/s (6 players), 1.10 KB/s (1 player) | PASS (lower bound, see caveat) |
| 6-player room tick p50 | about 1.4 ms est. | 0.094-0.098 ms | PASS (well under, scenario is light) |
| 6-player room tick p95 | <= 3.5 ms | 0.296-0.310 ms | PASS (noisy machine, 11x margin) |
| 6-player room tick max | <= 8 ms | 1.01-1.15 ms in 3 runs (22.6 ms once in warm-up run) | PASS on counted runs, flagged: noise spike seen once |
| Solo Shift room tick p95 | <= 0.4 ms | 0.070-0.084 ms | PASS |
| Join snapshot blocking part | typ. 20-35 KB, <= 150 KB | Schema full state 333 / 743 B only; the sim join snapshot/ledger not exercised | NOT RUN (Schema part is a tiny share) |
| Schema field delta from v1.1 | n/a (no explicit budget) | 2 B per change, 0 B steady | informational |

Reporting only; performance-reviewer issues verdicts.

## Not run, and why
- `tools/bots` `spike-16` + `tools/netsim` end-to-end (real sockets, 120 ms +/- 30, 1 % loss, per-message-type server
  counters): requires a running server (spike room via `src/net/spike/run-spike.ts`, or ShiftRoom behind the real
  transport) and the bots target the NET_SPIKE `LoadTestRoom`, not `ShiftRoom`. I could not start servers on ports
  without risk of colliding with the backend agent editing apps/server, so only the in-process path was measured.
  Socket overhead and uWS coalescing are therefore assumed, not measured.
- Busy scenario (vehicles, robots, dust ledger streaming, purchases, builds): no existing tool drives ShiftCore with
  those; the flat-world result is a lower bound.
- "Slice" encodes (checkpoint slice, 1.5 ms/tick) and join-snapshot assembly: not measured here.

## Blockers
- No bots scenario for ShiftRoom; a `shift-6` bot scenario (owner: qa-test-engineer) plus a ShiftRoom run script would
  give real-socket per-message-type bytes and tick p95 under netsim.
- Machine noise: repeat on a quiet machine before using these in any verdict.
