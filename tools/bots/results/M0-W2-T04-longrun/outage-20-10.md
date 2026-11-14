# spike-16: 6 bots, 150 s, profile outage

Target http://localhost:2571, seed 1, 20/10 Hz, Node v26.13.1, started 2026-11-13T07:51:34.232Z. Milestone M0-W2-T04-longrun.

| Metric | Value |
| --- | --- |
| Snapshot rate achieved per bot | 10.04 Hz (target 10) |
| Frame inter-arrival p50 / p95 / max | 94.98 / 126.45 / 5062.17 ms |
| RTT p50 / p95 / max (bot ping) | 140 / 345 / 5173 ms (n=438) |
| Server tick p50 / p95 / max | 0.16 / 0.498 / 0.826 ms |
| CPU % of 0.1 quota median / max | 18.8 / 34.3 |
| Event-loop p99 max | 34.01 ms |
| Bytes in per bot per s (client side) | 2.69 KB/s |
| - FRAME | 2.00 KB/s |
| - DUST | 0.58 KB/s |
| - PONG | 0.00 KB/s |
| - statePatch | 0.10 KB/s |
| - stateFull | 0.00 KB/s |
| - other | 0.00 KB/s |
| Server bytes out per client per s by type | SPIKE_FRAME 2044, SPIKE_DUST 599, schema_patch 122, PONG 6, other 0, schema_full 0, control 0 B/s |
| Inputs sent / messages / skipped sends / resyncs | 19389 / 17303 / 733 / 16 |
| Server input buffer depth p50 / p95 / max | 2 / 3 / 6 |
| Rejected inputs (late / rate-limited / malformed); substituted | n/a / n/a / n/a; n/a |
| Joins / disconnects / unexpected drops / scripted reconnects | 7 / 7 / 0 / 1 |
| Desync count | n/a (n/a in spike: synthetic world has no client prediction to compare (arrives with M1 sim)) |
| Server RSS first to last | n/a |
| Server heap first to last | n/a |
| Bot process heap growth | 0.3 MB |
