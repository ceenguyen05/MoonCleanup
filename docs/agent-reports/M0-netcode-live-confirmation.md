# M0 netcode live confirmation (qa-test-engineer)

Status: IN PROGRESS (started 2026-11-13 06:05). Local only, port offset 4 (server 2571). Tick/bandwidth numbers are "under concurrent load" (visual captures running).

## Preflight

- At 06:04 the server on :2571 (PID 21312, started 05:56:20) was NOT idle: a bot run `typical-30-15` (600 s, netsim typical, PIDs 12584/15480/12372) from the long-run queue was connected through it. Killing it would destroy another worker's live run, so I waited for that run to finish (expected about 06:07) before stopping the server.

## Run 1: clean 20/10, 60 s, 6 bots: PASS

Result files: `tools/bots/results/M0-netcode-confirm/run1-clean-20-10.{json,md}` (+ `run1.server.log`). Server: fresh start, ENV_NAME=local, memory, NET_SPIKE=1, blank CLIENT_IP_HEADER. The bot runner logged ECONNREFUSED retries on the first join (server still booting), then connected on attempt 4 after 1,483 ms of backoff: join retry works.

| Metric | Old (T04 clean 20/10, 600 s) | Now (60 s) |
| --- | --- | --- |
| Inputs sent | 72,024 | 7,452 |
| Resyncs | 8,556 (about 12 %) | **6 (0.08 %; exactly 1 per bot, the initial sync)** |
| Skipped sends | 0 | 0 |
| Server input buffer depth p50 / p95 / max | not given | 3 / 3 / 3 |
| Unexpected drops | | 0 (6 joins, 6 disconnects at end) |

- Late-drop stats: the bots' `rejectedInputs.late` is `null`, because the server stdout is pretty-printed and carries no `spike-loop` counters, so the merger cannot read it. Indirect evidence: a constant depth of 3 and 1 resync per bot means no substituted or late frames after the first sync. Netcode fix to note: run the server with the JSON log format (or ask for `spike-loop` lines) if exact late counts are wanted.
- Under concurrent load: snapshot rate 10.01 Hz; frame gap p50 / p95 / max 95.9 / 111.1 / 114.8 ms; bandwidth in 2.97 KB/s per bot (FRAME 2.28, DUST 0.58, patch 0.11); RTT p50 1 ms. Server tick (from the pretty log, per-second windows): p95 max 0.76 ms, max 3.54 ms; CPU peaked at about 33 % of quota.
- Verdict: steering fix confirmed live.

## Run 2: cold start and mid-run server restart: PASS (with a slow-detection note)

Files: `run2-restart.{json,md}`, `run2.bots.log` (timestamped), `run2a/run2b.server.log`. Bots started BEFORE the server (cold start), 75 s, clean netsim, `--join-retry-max 60`.

| Time (06:1x) | Event |
| --- | --- |
| 11:24.2 | bot 0 first join: ECONNREFUSED (server not up). Retries at 196, 394, 893, 1859, 2215 ms |
| 11:29.8 | bot 0 connected on attempt 6 after 5.6 s of backoff (server booted about 5 s after the bots, cold start OK); all 6 connected by 11:59 (30 s mark) |
| 12:12.0 | server killed (about 30 s after connect); restarted immediately, listening at 12:18 (6 s boot) |
| 12:12 to 12:25 | Colyseus SDK session reconnect ("Re-establishing sessionId", attempts up to 15 of 15, 5 s backoff) fails: the restarted memory server has no such room |
| 12:25.7 to 12:26.6 | all 6 bots report "dropped by server; rejoining" |
| 12:29.7 | `connected 6/6` (60 s mark); no `[join]` failure lines, so each rejoin succeeded on the first attempt |

- Time to rejoin: at most 17.7 s from the kill, about 11.5 s from the server being ready; the dominant cost is the SDK's own 15-attempt reconnect schedule, not the join retry. All 6 resumed and finished the run (12 joins, 12 clean disconnects, 6 unexpected drops, 6 counted reconnects).
- Totals: 7,864 inputs, 12 resyncs (6 initial plus 6 after rejoin, no steering storm), 1,338 skipped sends (the outage), snapshot rate 8.4 Hz average over the run including the outage.
- Improvement suggestion (bots, not server): treat a failed session reconnect to a restarted server as immediate "dropped" after 1 or 2 attempts (or cap `reconnection.maxRetries`) to cut about 10 s of dead time. Not a defect.

## Run 3: admission: PASS

Server with MAX_ROOMS=1, MAX_CLIENTS=6 (`run3.server.log`); script `adm.mjs` (raw HTTP against `/v0/spike/join` and raw WebSocket upgrades from 127.0.0.1, socket mode).

- Seats 1 to 6 (same room): 200 each, one room.
- 7th request, same room: **503** `{"error":"AT_CAPACITY","message":"at_capacity:clients"}`, `retry-after: 30`.
- Second-room request (30/15): **503** AT_CAPACITY `at_capacity:clients` (the client limit trips first because 6 seats are reserved; the `at_capacity:rooms` message was not separately provoked live, it is covered by the unit test).
- `/readyz` after: `admitting:false`, `ready:false`, rooms 1; `/healthz` stays 200 at the end. No crash.
- Per-IP sockets: upgrades 1 to 8 got 101, the **9th got 429**; after closing all, a new upgrade got 101 again (slots released).
- Note: the code is `AT_CAPACITY` in the live body (the batch report said ROOM_FULL until the contract adds it), so the contract may already accept it; worth a check by contracts-architect.

## Run 4: 30/15 clean 10 min: NOT RUN

Per the coordinator's turn-limit instruction. Earlier pre-fix 30/15 data is in `M0-W2-T04-longrun-qa-test-engineer.md`. Suggested command: `pnpm bots -- spike-16 --url http://localhost:2571 --duration 600 --netsim none --tick 30 --snap 15 --label clean-30-15-postfix --server-log <file>` against a server with `SNAPSHOT_HZ=15 TICK_HZ=30` style spike options (spike options come from the join body, defaults apply).

## Cleanup

All servers and bots I started were stopped; netstat verified (see end of the final reply).
