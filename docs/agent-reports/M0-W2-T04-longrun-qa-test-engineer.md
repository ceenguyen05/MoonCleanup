# M0-W2-T04 long-run netcode checks (qa-test-engineer)

Status: COMPLETE with INCONCLUSIVE items (2026-11-13). Real server entry (`apps/server/src/app/index.ts` via tsx, NODE_ENV=production for JSON logs,
NET_SPIKE=1, ENV_NAME=local, memory persistence, throwaway secrets, ALLOWED_ORIGINS=http://localhost:5173, PORT 2571), 6 bots,
`pnpm bots -- spike-16`, one run at a time, no browsers. Raw output: `tools/bots/results/M0-W2-T04-longrun/<label>.{json,md,server.log}`.
Runner scripts (scratchpad, not in repo): a queue runs sequentially: clean 20/10, clean 30/20, typical 20/10, typical 30/20 (600 s each),
then bad 20/10 (150 s), outage 20/10 (150 s), coldstart 20/10 (180 s, server killed and restarted at t=60 s). Each run starts and kills its own server.

## Method limits (apply to every row)
- The spike protocol carries input only (no sell/buy, no client sim): **zero-desync cannot be asserted**; bots report desync "n/a". Any "zero desync" claim is limited to: no unexpected disconnects, frame/snapshot rate holds, seq steering recovers.
- The real server entry logs `room-stats` only (tick, bytes by type, CPU, event loop). It does NOT log late-input drops, substitutions, RSS or heap (those lines come only from the old `run-spike.ts` harness). So **late-input drops are INCONCLUSIVE server-side**; the bot-side "resyncs" count (steering hard-resyncs) is the proxy.
- Windows loopback, tsx (not the esbuild bundle), Node 26.13.1, no 0.1-CPU container; CPU % of quota is indicative only. Run-to-run noise from other agents' processes cannot be excluded.

## Results

| Run | Tick p50 / p95 / max (ms) | Server KB/s per client (p50 / p95 window / max window; mean) | Snapshot rate | RTT p50/p95/max | Resyncs (proxy for late drops) | Joins / unexpected drops / scripted reconnect | Verdict |
| --- | --- | --- | --- | --- | --- | --- | --- |
| clean 20/10, 600 s | 0.11 / 0.47 / 2.72 (worst 10 s window p95 0.73) | 1.91 / 3.30 / 3.45; mean ~2.0 (FRAME 1302, DUST 599, patch 126, PONG 6 B/s) | 10.00 Hz | 0 / 1 / 2 | 8,556 of 72,024 inputs | 7 / 0 / 1 (rejoin ok) | **PASS** (tick, bandwidth, rate, reconnect); late drops INCONCLUSIVE; desync N/A |
| clean 30/20 | **BLOCKED**: real server env refuses it ("SNAPSHOT_HZ: must divide SIM_TICK_HZ evenly", netcode N4). Earlier 90 s harness numbers (T04 report) stay the only 30/20 data (~5.2 KB/s total, over the 5.0 ceiling). Substitute 30/15 queued | | | | | | BLOCKED |
| typical 20/10 (120+/-30 RTT, 1 % loss), 600 s | 0.12 / 0.43 / 3.51 (worst window p95 0.92) | 1.92 / 3.01 / 3.48; mean ~2.0 | 10.01 Hz | 141 / 285 / 396 | 5 resyncs; 784 skipped sends | 7 / 0 / 1 (rejoin ok) | **PASS**; late drops INCONCLUSIVE; frame gap max 390 ms |
| typical 30/20 | BLOCKED (same env rule) | | | | | | BLOCKED |
| bad 20/10 (250+/-50 RTT, 5 % loss), 150 s | 0.12 / 0.48 / 1.29 (worst window p95 0.87) | 2.90 / 3.33 / 3.33; mean ~2.9 | 10.09 Hz | 357 / 815 / 1280 | 53 resyncs; 2,371 skipped sends; server input buffer max 6 | 7 / 0 / 1 (rejoin ok) | **PASS** (no drops, rate held, budget met); frame gap max 660 ms |
| outage 20/10 (5 s hold at t=30 s), 150 s | 0.16 / 0.50 / 0.83 (window max 4.24 ms) | 2.74 / 3.42 / 3.42; mean ~2.8 | 10.04 Hz | 140 / 345 / 5173 | 16 resyncs; 733 skipped | 7 / 0 / 1 (rejoin ok) | **PASS** (connection survived the 5 s stall: max frame gap 5,062 ms, no drop, steering recovered) |
| coldstart + mid-run server restart | the bot run aborted when the server was killed: the scripted rejoin got ECONNREFUSED and `spike16.ts` throws on a failed join (no retry/backoff). Server log kept as `coldstart-restart-attempt.server.log` | | | | | | **FAIL (bot limitation) / server-restart recovery INCONCLUSIVE**; bots need join retry to test it |
| coldstart 20/10, no restart, 180 s (first client chunk held 8 s) | 0.13 / 0.44 / 1.41 | 2.54 / 3.29 / 3.49 | 11.92 Hz (inflated by catch-up after the hold) | 140 / 233 / 533 | 5 resyncs; 208 skipped | 7 / 0 / 1 | **PASS** (joined after the delay, no drops) |
| clean 30/15, 600 s | 0.16 / 0.72 / 4.41 (worst window p95 0.90; window max 5.05) | 2.92 / 4.59 / 4.69; first third mean 3.95, last third 2.77 | 15.00 Hz | 0 / 1 / 16 | 10 resyncs | 7 / 0 / 1 | **PASS** on p95 <= 3.5 ms and 5.0 KB/s (headroom only 0.3 KB/s at peak) |
| typical 30/15, 600 s | 0.24 / 0.94 / 17.0 (worst window p95 0.96) | 2.89 / 4.44 / 4.67 | 14.99 Hz | 140 / 320 / 564 | 17 resyncs; 2,548 skipped | 7 / 0 / 1 | **PASS** with note: one 17 ms tick and event-loop p99 188 ms (CPU max 75 % of 0.1 quota equivalent), likely host noise (other processes); not reproduced elsewhere |

## Verdict summary
- Server tick p95 <= 3.5 ms: PASS in every run (worst 10 s window p95 0.98 ms; overall p95 0.43-0.94 ms). Single ticks up to 17 ms (typical 30/15) and 5 ms (clean 30/15).
- Bandwidth <= 5.0 KB/s per client at 6 players: PASS at 20/10 (mean ~2.0, peak window 3.5) and 30/15 (peak window 4.7). The 90 s T04 harness figure for 30/20 (~5.2 KB/s) is unchanged and over the ceiling; 30/20 itself cannot run on the real server (env divisibility rule). Early windows are heavier than late ones (first-third 3.9 vs last-third 2.8 KB/s at 30/15), so a 90 s run overstates and a 10 min mean understates the busy peak; use the peak.
- Reconnect: bot scripted leave and rejoin succeeded in every run (7 joins, 0 unexpected drops). Reconnect after a **server restart**: INCONCLUSIVE (bot run aborts on ECONNREFUSED, no join retry). Recommended fix (qa-owned bot code, outside this brief): retry join with backoff in `spike16.ts`/`bot.ts`, then rerun coldstart with `RESTART=60`.
- Late-input drops: INCONCLUSIVE server-side (real entry does not log them). Bot-side resyncs: 5-17 on typical/bad/outage runs, but 8,556 (12 %) on clean 20/10 and ~10 on clean 30/15; the clean 20/10 count is unexplained (clean-network steering resyncing over-eagerly; netcode-engineer).
- Desync: not testable (spike protocol carries input only, no client sim). Only claim: no unexpected disconnect and no stall beyond the injected outage (max frame gap 5.06 s = the 5 s outage).
- M1 E9-style criteria (reconnect, no desync, budgets): partial. Budgets met for tick and bandwidth; reconnect met for client-side rejoin only; desync and server-restart recovery not demonstrated.
- Memory growth: server RSS/heap not logged by the real entry: INCONCLUSIVE; bot heap growth ~0 (-0.1 MB clean 20/10).

## Cleanup
All servers and bots I started are stopped; `netstat` shows no listener or established connection on 2571/2581. (Unrelated node processes by other tools exist on the machine; not mine.) Config note: tools/bots/results/M0-W2-T04-longrun also holds `*.srvpid` scratch files and the aborted `coldstart-restart-attempt.server.log`.

Budget reference: busy ceiling 5.0 KB/s per client, tick p95 <= 3.5 ms (performance-budgets.md / netcode.md 6-player rows).

Observations (clean 20/10): server bytes per client drifted down over the run (first third mean 2.56 KB/s, last third 1.80 KB/s); FRAME is 1.30 KB/s here against 2.3 KB/s in the 90 s T04 and 60 s T06 runs, so FRAME size depends on how long the synthetic world has run (content-dependent). Do not quote 2.0 KB/s as a steady-state figure; the early-window peak (3.45 KB/s) is the safer number. 8.5k resyncs on a clean loopback network (about 12 % of inputs) was also reported in T06 and is unexplained: owner (netcode-engineer) should look at the steering resync trigger.

## Remaining plan
Queue continues unattended in this order (see above); results are appended here after each run. At the end: netstat check that 2571/2581 have no listeners and no tsx/node server of mine remains.
