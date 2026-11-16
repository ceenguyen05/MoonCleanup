# M1 16-bot / 10-minute run (qa-test-engineer)

Status: DONE, numbers PROVISIONAL (other agents were running on this laptop; event-loop p99 spikes to 146 ms; not a quiet run).

## What was run
`pnpm exec tsx src/cli.ts shift-room --port 2571 --bots 16 --duration 600 --netsim typical --milestone M1-16bot --label 16b-typical` from tools/bots, Node v26.13.1. Netsim typical = 120 ms +/- 30 jitter, 1% loss, seeded (seed 1), 20 Hz tick / 10 Hz snapshots.
LoadTestRoom (spike-16) caps at 6, so I used **3 ShiftRooms in parallel (bots 6 + 6 + 4)**, one contract id per room, all in one harness server process.

## Harness fixes (tools/bots only; server untouched)
1. `shift-room.ts`: bot i joins contract `...00c7 + floor(i/6)` (previously all bots used one contract, so a 7th bot is impossible). Also saves the harness stdout as `<label>.server.log`.
2. `harness/shift-server.mts`: `clientIpHeader: null` and `maxSocketsPerIp: 24`. Without it every bot falls in the shared "unknown" IP bucket, capped at 8 sockets (`MAX_SOCKETS_UNKNOWN`), so bots 8+ got 1006 and only 4 to 8 of 12 to 16 stayed connected (found on two aborted runs).
Local only; production keeps true-client-ip.

## Results (results/M1-16bot/16b-typical.{json,md,server.log})
16/16 connected for the whole 600 s; 16 joins, 0 unexpected drops.
| Metric | Value | Budget (performance-budgets.md) |
| --- | --- | --- |
| Server tick p50 / p95 / max, per room, last 4096 ticks | 6p: 0.14 / 0.39 / 6.2 ms; 6p: 0.11 / 0.37 / 13.4 ms; 4p: 0.11 / 0.31 / 6.9 ms | 6-player room p50 ~1.4 est / p95 <= 3.5 / max <= 8 ms: within, except one 13.4 ms max |
| Server tick over all 183 StatsReporter windows (3 rooms) | median p50 0.13, worst-window p95 5.8, max 62.0 ms (whole-run, includes machine noise and GC) | p95 <= 3.5 ms: worst window exceeds, noisy |
| Tick p99 | NOT available (tools expose p50/p95/max only) | |
| Overruns | 0 per room | |
| Bandwidth per bot (client-received) | 0.61 KB/s (FRAME 0.60, DUST 0.01) | <= 3 KB/s typical, <= 5.0 busy: well within (bots walk/clean only; no busy scene) |
| Snapshot rate per bot | 10.05 Hz (target 10); frame gap p50/p95/max 98.8 / 126.7 / 489.9 ms | |
| RTT p50 / p95 / max | 136 / 271 / 576 ms | |
| Desync (heuristic) | 0 (decode 0, tick regress 0, ack regress 0, jumps 0; max step 0.34 m) | 0 |
| Late inputs (server dropped) | 3089 total (1020 + 1378 + 713 per room), about 0.016 per input of 192,032 sent (1.6%); 2490 skipped sends, 16 client resyncs | expected under 1% loss and jitter |
| Rate-limited / malformed / too-far-ahead | 0 / 0 / 0 | |
| Input buffer depth p50 / p95 / max | 3 / 5 / 7 | |
| CPU % of 0.1 quota median / max | 48 / 109 (host laptop CPU, not a 0.1-CPU container) | not a valid quota test |
| Server RSS start / end / peak | 242.5 / 204.7 / 256.2 MB | |
| Server heap start / end | 72.8 / 70.4 MB | no growth |
| Bot process heap growth | 1.1 MB | |

## Notes and caveats
- Server bytes-out by type is not reported (ShiftRoom has no recordBytesOut), so bandwidth is client-side.
- 10-min run is local, not CPU-quota limited; the 0.1-CPU container check and GC trace remain open.
- Bots are not a busy scene; 5.0 KB/s busy ceiling not exercised.
- Desync is the heuristic, not predicted-vs-authoritative replay.
- Cleanup: all harness, netsim and CLI processes stopped; ports 2571 and 2581 confirmed not listening.
