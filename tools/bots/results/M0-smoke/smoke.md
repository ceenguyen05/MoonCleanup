# spike-16: 6 bots, 61 s, profile typical

Target http://localhost:2571, seed 1, 20/10 Hz, Node v26.13.1, started 2026-11-13T03:06:58.481Z. Milestone M0-smoke.

| Metric | Value |
| --- | --- |
| Snapshot rate achieved per bot | 10.11 Hz (target 10) |
| Frame inter-arrival p50 / p95 / max | 95.5 / 126.2 / 392.16 ms |
| RTT p50 / p95 / max (bot ping) | 140 / 174 / 390 ms (n=179) |
| Server tick p50 / p95 / max | 0.2 / 0.556 / 0.902 ms |
| CPU % of 0.1 quota median / max | 23.4 / 25 |
| Event-loop p99 max | 34.37 ms |
| Bytes in per bot per s (client side) | 3.01 KB/s |
| - FRAME | 2.31 KB/s |
| - DUST | 0.58 KB/s |
| - PONG | 0.00 KB/s |
| - statePatch | 0.10 KB/s |
| - stateFull | 0.00 KB/s |
| - other | 0.00 KB/s |
| Server bytes out per client per s by type | SPIKE_FRAME 2322, SPIKE_DUST 598, schema_patch 126, PONG 6, other 1, schema_full 0, control 0 B/s |
| Inputs sent / messages / skipped sends / resyncs | 7386 / 7181 / 80 / 5 |
| Server input buffer depth p50 / p95 / max | 3 / 3 / 3 |
| Rejected inputs (late / rate-limited / malformed); substituted | 227 / 0 / 0; 195 |
| Joins / disconnects / unexpected drops / scripted reconnects | 7 / 7 / 0 / 1 |
| Desync count | n/a (n/a in spike: synthetic world has no client prediction to compare (arrives with M1 sim)) |
| Server RSS first to last | 124.2 to 91.7 MB (growth -32.5) |
| Server heap first to last | 32 to 28.3 MB (growth -3.7) |
| Bot process heap growth | -1.9 MB |
