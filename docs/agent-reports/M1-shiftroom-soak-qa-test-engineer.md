# M1 ShiftRoom 300 s soak (qa-test-engineer)

Status: DONE. 2 runs, 6 bots, 300 s each, seed 1, Node v26.13.1, local harness (tools/bots/harness/shift-server.mts). ALL NUMBERS NOISY (shared i7-8650U, other agents running; event-loop p99 max 42-46 ms). Budget comparisons are PROVISIONAL, not PASS. No code changes.

Run: `pnpm exec tsx src/cli.ts shift-room --port 2571 --bots 6 --duration 300 --netsim typical|bad --milestone M1-shift --label soak-6b-<profile>-300s` (from tools/bots). Profiles: tools/netsim/src/conditioner/profiles.ts (typical 120+-30 ms/1 %, bad 250+-50 ms/5 %).
Results: tools/bots/results/M1-shift/soak-6b-typical-300s.{json,md}, soak-6b-bad-300s.{json,md}.

| Metric | typical | bad |
| --- | --- | --- |
| Room tick p50 / p95 (StatsReporter) / max | 0.17 / 0.74 / 4.66 ms | 0.19 / 0.82 / 23.6 ms |
| Room tick ring (last 4096 ticks) p50 / p95 / max | 0.14 / 0.32 / 4.0 ms | 0.17 / 0.34 / 23.6 ms |
| Tick p99 | not exposed (only p50/p95/max) | same |
| Overruns | 0 | 0 |
| Server CPU % of 0.1 quota median / max | 20.2 / 51.6 | 21.9 / 40.5 |
| Bytes in per bot (client side) | 0.79 KB/s (FRAME 0.76, DUST 0.01) | 0.80 KB/s (FRAME 0.78, DUST 0.01) |
| Snapshot rate per bot | 10.03 Hz | 10.06 Hz |
| Frame gap p50 / p95 / p99 / max | 97 / 127 / 292 / 374 ms | 94 / 158 / 613 / 658 ms |
| RTT p50 / p95 / max | 141 / 268 / 563 ms | 316 / 863 / 1285 ms |
| Late inputs (rejected) | 581 of 36017 sent (1.6 %) | 3569 of 33021 sent (10.8 %) |
| Skipped sends / resyncs | 524 / 5 | 7310 / 13 |
| Server input buffer depth p50 / p95 / max | 3 / 5 / 7 | 5 / 11 / 15 |
| Desyncs (heuristic) | 0 | 0 |
| Reconnects (unexpected drops / scripted) | 0 / 0 (6 joins, 6 clean leaves) | 0 / 0 |
| Heap used first to last | 71.5 to 71.9 MB (+0.4) | 93.2 to 72.2 MB (-21; first sample is pre-GC) |
| RSS first to last | 285.8 to 176.7 MB | 297.6 to 187.4 MB |
| Bot process heap growth | 2.3 MB | 2.3 MB |
| Dust (typical run counters) | 6 snapshots, 354 B total; 254 ledgers streamed, 26.5 KB; 0 paced/paused/stale/requests | not recorded in md |

## Findings
- Memory: no growth. Heap flat at about 72 MB at the end in both runs. RSS fell about 110 MB because the first sample is the startup peak (module load); there is no leak signal over 5 min. A steady-state RSS slope needs more mid-run samples than first/last; not computed.
- Netsim FIFO fix holds over 5 min: 0 desyncs, 0 drops in both, including 5 % loss and 250 ms.
- Bad profile: input handling degrades as expected (10.8 % late, 7310 skipped sends, buffer depth p95 11, 13 resyncs) but nothing breaks; this is netsim stress, not a server fault. The 23.6 ms tick max at bad is a single spike (ring p95 0.34 ms), consistent with the machine noise (event-loop p99 46 ms), not attributable.
- Dust snapshot cost: only counters exposed (bytes, ledgers); no per-snapshot ms. Traffic is trivial because bots clean little.

## Budget comparison (performance-budgets.md section on server, lines 102-113; PROVISIONAL)
- 6-player room tick p50/p95/max budget about 1.4 / 3.5 / 8 ms: p50 and p95 far under; max 4.7 ms typical within, 23.6 ms bad exceeds 8 ms once (noise-suspect, needs quiet machine).
- Bandwidth per client: 0.8 KB/s measured vs 3 KB/s typical / 5 KB/s busy ceiling. Low because bots are light on dust activity; not a busy-load result.
- Max process stall <= 50 ms: event-loop p99 max 42 / 46 ms, under but close, and noisy. GC trace not enabled, so unverified.
- Process RSS <= 300 MB: peak sample 286 / 298 MB (startup), just under; settled 177-187 MB.
- CPU of 0.1 quota: the harness reports median about 20 %, max 52 %, but the machine is not CPU-limited to 0.1 CPU; not a valid quota test.
- The bot-test skill file was not found in `.claude/skills`; thresholds taken from the budget doc section 8 (16 bots, 10 min standard) only. This run is 6 bots / 5 min, so the standard 16-bot / 10-min load test is still not done.

## Limits and Next
- Server bytes-out by type is empty (ShiftRoom has no recordBytesOut calls); client-side counts only. Server-side owner: netcode-engineer (not changed).
- Tick p99 not in the tickStats API; add if needed.
- Not done: 16 bots x 10 min, scripted reconnect, quiet-machine rerun, GC trace, busy-dust scenario for bandwidth ceiling.
- Stray runs: my first attempt from the bash shell failed on PATH (no processes started). Ports 2571/2581 verified free (only TIME_WAIT leftovers, no LISTEN).
