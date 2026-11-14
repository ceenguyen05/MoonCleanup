# spike-16: 6 bots, 90 s, profile typical

Target http://localhost:2571, seed 1, 30/20 Hz, Node v26.13.1, started 2026-11-13T03:14:21.451Z. Milestone M0-W2-T04.

| Metric | Value |
| --- | --- |
| Snapshot rate achieved per bot | 20.16 Hz (target 20) |
| Frame inter-arrival p50 / p95 / max | 47.46 / 92.21 / 339.41 ms |
| RTT p50 / p95 / max (bot ping) | 142 / 315 / 590 ms (n=264) |
| Server tick p50 / p95 / max | 0.25 / 0.636 / 2.56 ms |
| CPU % of 0.1 quota median / max | 25 / 65.5 |
| Event-loop p99 max | 34.67 ms |
| Bytes in per bot per s (client side) | 5.08 KB/s |
| - FRAME | 4.26 KB/s |
| - DUST | 0.61 KB/s |
| - PONG | 0.00 KB/s |
| - statePatch | 0.21 KB/s |
| - stateFull | 0.00 KB/s |
| - other | 0.00 KB/s |
| Server bytes out per client per s by type | SPIKE_FRAME 4357, schema_patch 246, SPIKE_DUST 632, PONG 6 B/s |
| Inputs sent / messages / skipped sends / resyncs | 17718 / 15756 / 450 / 5 |
| Server input buffer depth p50 / p95 / max | 3 / 3 / 6 |
| Rejected inputs (late / rate-limited / malformed); substituted | 1071 / 0 / 0; 1035 |
| Joins / disconnects / unexpected drops / scripted reconnects | 6 / 6 / 0 / 0 |
| Desync count | n/a (n/a in spike: synthetic world has no client prediction to compare (arrives with M1 sim)) |
| Server RSS first to last | 121.2 to 96.4 MB (growth -24.8) |
| Server heap first to last | 31.1 to 28.1 MB (growth -3) |
| Bot process heap growth | -0.4 MB |
