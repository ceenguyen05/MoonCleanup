# spike-16: 6 bots, 600 s, profile none

Target http://localhost:2571, seed 1, 30/15 Hz, Node v26.13.1, started 2026-11-13T14:43:35.553Z. Milestone M0.

| Metric | Value |
| --- | --- |
| Snapshot rate achieved per bot | 15 Hz (target 15) |
| Frame inter-arrival p50 / p95 / max | 63.3 / 79.25 / 98.5 ms |
| RTT p50 / p95 / max (bot ping) | 0 / 1 / 2 ms (n=1794) |
| Server tick p50 / p95 / max | 0.13 / 0.514 / 3.58 ms |
| CPU % of 0.1 quota median / max | 20.2 / 46.9 |
| Event-loop p99 max | 35.09 ms |
| Bytes in per bot per s (client side) | 2.95 KB/s |
| - FRAME | 2.19 KB/s |
| - DUST | 0.60 KB/s |
| - PONG | 0.00 KB/s |
| - statePatch | 0.16 KB/s |
| - stateFull | 0.00 KB/s |
| - other | 0.00 KB/s |
| Server bytes out per client per s by type | SPIKE_FRAME 2275, SPIKE_DUST 632, schema_patch 189, PONG 6, other 0, schema_full 0, control 0 B/s |
| Inputs sent / messages / skipped sends / resyncs | 108501 / 108006 / 0 / 5 |
| Server input buffer depth p50 / p95 / max | 3 / 3 / 3 |
| Rejected inputs (late / rate-limited / malformed); substituted | n/a / n/a / n/a; n/a |
| Joins / disconnects / unexpected drops / scripted reconnects | 7 / 7 / 0 / 1 |
| Desync count | n/a (n/a in spike: synthetic world has no client prediction to compare (arrives with M1 sim)) |
| Server RSS first to last | n/a |
| Server heap first to last | n/a |
| Bot process heap growth | 1.8 MB |
