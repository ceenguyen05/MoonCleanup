# spike-16: 6 bots, 600 s, profile typical

Target http://localhost:2571, seed 1, 30/15 Hz, Node v26.13.1, started 2026-11-13T11:56:35.552Z. Milestone M0-W2-T04-longrun.

| Metric | Value |
| --- | --- |
| Snapshot rate achieved per bot | 14.99 Hz (target 15) |
| Frame inter-arrival p50 / p95 / max | 65.4 / 95.21 / 520.3 ms |
| RTT p50 / p95 / max (bot ping) | 140 / 320 / 564 ms (n=1794) |
| Server tick p50 / p95 / max | 0.24 / 0.935 / 17.009 ms |
| CPU % of 0.1 quota median / max | 34.4 / 74.9 |
| Event-loop p99 max | 187.56 ms |
| Bytes in per bot per s (client side) | 3.02 KB/s |
| - FRAME | 2.25 KB/s |
| - DUST | 0.60 KB/s |
| - PONG | 0.00 KB/s |
| - statePatch | 0.16 KB/s |
| - stateFull | 0.00 KB/s |
| - other | 0.00 KB/s |
| Server bytes out per client per s by type | SPIKE_FRAME 2308, schema_patch 188, SPIKE_DUST 631, PONG 6, other 0, schema_full 0, control 0 B/s |
| Inputs sent / messages / skipped sends / resyncs | 117064 / 105508 / 2548 / 17 |
| Server input buffer depth p50 / p95 / max | 2 / 3 / 6 |
| Rejected inputs (late / rate-limited / malformed); substituted | n/a / n/a / n/a; n/a |
| Joins / disconnects / unexpected drops / scripted reconnects | 7 / 7 / 0 / 1 |
| Desync count | n/a (n/a in spike: synthetic world has no client prediction to compare (arrives with M1 sim)) |
| Server RSS first to last | n/a |
| Server heap first to last | n/a |
| Bot process heap growth | 5.2 MB |
