# spike-16: 6 bots, 600 s, profile none

Target http://localhost:2571, seed 1, 20/10 Hz, Node v26.13.1, started 2026-11-13T07:06:01.408Z. Milestone M0-W2-T04-longrun.

| Metric | Value |
| --- | --- |
| Snapshot rate achieved per bot | 10 Hz (target 10) |
| Frame inter-arrival p50 / p95 / max | 95.13 / 110.76 / 130.01 ms |
| RTT p50 / p95 / max (bot ping) | 0 / 1 / 2 ms (n=1794) |
| Server tick p50 / p95 / max | 0.11 / 0.466 / 2.717 ms |
| CPU % of 0.1 quota median / max | 12.5 / 39 |
| Event-loop p99 max | 35.23 ms |
| Bytes in per bot per s (client side) | 1.95 KB/s |
| - FRAME | 1.26 KB/s |
| - DUST | 0.58 KB/s |
| - PONG | 0.00 KB/s |
| - statePatch | 0.11 KB/s |
| - stateFull | 0.00 KB/s |
| - other | 0.00 KB/s |
| Server bytes out per client per s by type | SPIKE_FRAME 1302, SPIKE_DUST 599, schema_patch 126, PONG 6, other 0, schema_full 0, control 0 B/s |
| Inputs sent / messages / skipped sends / resyncs | 72024 / 72006 / 0 / 8556 |
| Server input buffer depth p50 / p95 / max | 3 / 3 / 3 |
| Rejected inputs (late / rate-limited / malformed); substituted | n/a / n/a / n/a; n/a |
| Joins / disconnects / unexpected drops / scripted reconnects | 7 / 7 / 0 / 1 |
| Desync count | n/a (n/a in spike: synthetic world has no client prediction to compare (arrives with M1 sim)) |
| Server RSS first to last | n/a |
| Server heap first to last | n/a |
| Bot process heap growth | -0.1 MB |
