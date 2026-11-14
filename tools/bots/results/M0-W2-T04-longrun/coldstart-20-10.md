# spike-16: 6 bots, 196 s, profile coldstart

Target http://localhost:2571, seed 1, 20/10 Hz, Node v26.13.1, started 2026-11-13T07:56:00.009Z. Milestone M0-W2-T04-longrun.

| Metric | Value |
| --- | --- |
| Snapshot rate achieved per bot | 11.92 Hz (target 10) |
| Frame inter-arrival p50 / p95 / max | 95.1 / 126.25 / 379.44 ms |
| RTT p50 / p95 / max (bot ping) | 140 / 233 / 533 ms (n=574) |
| Server tick p50 / p95 / max | 0.13 / 0.44 / 1.409 ms |
| CPU % of 0.1 quota median / max | 12.5 / 29.7 |
| Event-loop p99 max | 33.95 ms |
| Bytes in per bot per s (client side) | 3.03 KB/s |
| - FRAME | 2.23 KB/s |
| - DUST | 0.69 KB/s |
| - PONG | 0.00 KB/s |
| - statePatch | 0.10 KB/s |
| - stateFull | 0.00 KB/s |
| - other | 0.00 KB/s |
| Server bytes out per client per s by type | SPIKE_FRAME 1878, SPIKE_DUST 585, other 1, schema_patch 102, schema_full 1, control 0, PONG 5 B/s |
| Inputs sent / messages / skipped sends / resyncs | 23767 / 23023 / 208 / 5 |
| Server input buffer depth p50 / p95 / max | 3 / 3 / 3 |
| Rejected inputs (late / rate-limited / malformed); substituted | n/a / n/a / n/a; n/a |
| Joins / disconnects / unexpected drops / scripted reconnects | 7 / 7 / 0 / 1 |
| Desync count | n/a (n/a in spike: synthetic world has no client prediction to compare (arrives with M1 sim)) |
| Server RSS first to last | n/a |
| Server heap first to last | n/a |
| Bot process heap growth | 2.8 MB |
