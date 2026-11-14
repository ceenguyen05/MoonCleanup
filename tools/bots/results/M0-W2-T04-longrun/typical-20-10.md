# spike-16: 6 bots, 600 s, profile typical

Target http://localhost:2571, seed 1, 20/10 Hz, Node v26.13.1, started 2026-11-13T07:38:15.340Z. Milestone M0-W2-T04-longrun.

| Metric | Value |
| --- | --- |
| Snapshot rate achieved per bot | 10.01 Hz (target 10) |
| Frame inter-arrival p50 / p95 / max | 95.09 / 126.22 / 390.35 ms |
| RTT p50 / p95 / max (bot ping) | 141 / 285 / 396 ms (n=1794) |
| Server tick p50 / p95 / max | 0.12 / 0.428 / 3.506 ms |
| CPU % of 0.1 quota median / max | 14 / 28.2 |
| Event-loop p99 max | 34.05 ms |
| Bytes in per bot per s (client side) | 1.96 KB/s |
| - FRAME | 1.27 KB/s |
| - DUST | 0.58 KB/s |
| - PONG | 0.00 KB/s |
| - statePatch | 0.11 KB/s |
| - stateFull | 0.00 KB/s |
| - other | 0.00 KB/s |
| Server bytes out per client per s by type | SPIKE_FRAME 1300, SPIKE_DUST 599, schema_patch 126, PONG 6, other 0, schema_full 0, control 0 B/s |
| Inputs sent / messages / skipped sends / resyncs | 74083 / 71252 / 784 / 5 |
| Server input buffer depth p50 / p95 / max | 3 / 3 / 3 |
| Rejected inputs (late / rate-limited / malformed); substituted | n/a / n/a / n/a; n/a |
| Joins / disconnects / unexpected drops / scripted reconnects | 7 / 7 / 0 / 1 |
| Desync count | n/a (n/a in spike: synthetic world has no client prediction to compare (arrives with M1 sim)) |
| Server RSS first to last | n/a |
| Server heap first to last | n/a |
| Bot process heap growth | -0.6 MB |
