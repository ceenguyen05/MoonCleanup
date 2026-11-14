# spike-16: 6 bots, 90 s, profile clean

Target http://localhost:2571, seed 1, 30/20 Hz, Node v26.13.1, started 2026-11-13T03:10:29.965Z. Milestone M0-W2-T04.

| Metric | Value |
| --- | --- |
| Snapshot rate achieved per bot | 20.03 Hz (target 20) |
| Frame inter-arrival p50 / p95 / max | 47.74 / 79.36 / 106.46 ms |
| RTT p50 / p95 / max (bot ping) | 31 / 32 / 33 ms (n=264) |
| Server tick p50 / p95 / max | 0.23 / 0.427 / 1.684 ms |
| CPU % of 0.1 quota median / max | 23.5 / 34.4 |
| Event-loop p99 max | 34.11 ms |
| Bytes in per bot per s (client side) | 5.06 KB/s |
| - FRAME | 4.24 KB/s |
| - DUST | 0.60 KB/s |
| - PONG | 0.00 KB/s |
| - statePatch | 0.21 KB/s |
| - stateFull | 0.00 KB/s |
| - other | 0.00 KB/s |
| Server bytes out per client per s by type | SPIKE_FRAME 4278, schema_patch 248, SPIKE_DUST 632, PONG 6 B/s |
| Inputs sent / messages / skipped sends / resyncs | 16584 / 16206 / 0 / 5 |
| Server input buffer depth p50 / p95 / max | 2 / 3 / 4 |
| Rejected inputs (late / rate-limited / malformed); substituted | 16 / 0 / 0; 16 |
| Joins / disconnects / unexpected drops / scripted reconnects | 6 / 6 / 0 / 0 |
| Desync count | n/a (n/a in spike: synthetic world has no client prediction to compare (arrives with M1 sim)) |
| Server RSS first to last | 119.9 to 92.1 MB (growth -27.8) |
| Server heap first to last | 33.5 to 28.2 MB (growth -5.3) |
| Bot process heap growth | -1.5 MB |
