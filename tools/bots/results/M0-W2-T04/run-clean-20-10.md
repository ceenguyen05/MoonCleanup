# spike-16: 6 bots, 90 s, profile clean

Target http://localhost:2571, seed 1, 20/10 Hz, Node v26.13.1, started 2026-11-13T03:08:31.809Z. Milestone M0-W2-T04.

| Metric | Value |
| --- | --- |
| Snapshot rate achieved per bot | 10.03 Hz (target 10) |
| Frame inter-arrival p50 / p95 / max | 95.83 / 115.16 / 126.92 ms |
| RTT p50 / p95 / max (bot ping) | 31 / 32 / 34 ms (n=264) |
| Server tick p50 / p95 / max | 0.18 / 0.615 / 2.985 ms |
| CPU % of 0.1 quota median / max | 15.6 / 28.2 |
| Event-loop p99 max | 35.32 ms |
| Bytes in per bot per s (client side) | 2.90 KB/s |
| - FRAME | 2.21 KB/s |
| - DUST | 0.58 KB/s |
| - PONG | 0.00 KB/s |
| - statePatch | 0.11 KB/s |
| - stateFull | 0.00 KB/s |
| - other | 0.00 KB/s |
| Server bytes out per client per s by type | SPIKE_FRAME 2266, schema_patch 125, SPIKE_DUST 599, PONG 6 B/s |
| Inputs sent / messages / skipped sends / resyncs | 11031 / 10806 / 0 / 19 |
| Server input buffer depth p50 / p95 / max | 2 / 3 / 3 |
| Rejected inputs (late / rate-limited / malformed); substituted | 12 / 0 / 0; 18 |
| Joins / disconnects / unexpected drops / scripted reconnects | 6 / 6 / 0 / 0 |
| Desync count | n/a (n/a in spike: synthetic world has no client prediction to compare (arrives with M1 sim)) |
| Server RSS first to last | 116.5 to 93.2 MB (growth -23.3) |
| Server heap first to last | 29.9 to 28.3 MB (growth -1.6) |
| Bot process heap growth | -0.9 MB |
