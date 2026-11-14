# spike-16: 6 bots, 60 s, profile none

Target http://localhost:2572, seed 1, 20/10 Hz, Node v26.13.1, started 2026-11-13T03:30:01.604Z. Milestone M0.

| Metric | Value |
| --- | --- |
| Snapshot rate achieved per bot | 10.01 Hz (target 10) |
| Frame inter-arrival p50 / p95 / max | 97.34 / 111.6 / 137.05 ms |
| RTT p50 / p95 / max (bot ping) | 0 / 1 / 3 ms (n=173) |
| Server tick p50 / p95 / max | 0.2 / 0.651 / 4.623 ms |
| CPU % of 0.1 quota median / max | 21.9 / 42.1 |
| Event-loop p99 max | 40.93 ms |
| Bytes in per bot per s (client side) | 2.98 KB/s |
| - FRAME | 2.29 KB/s |
| - DUST | 0.58 KB/s |
| - PONG | 0.00 KB/s |
| - statePatch | 0.11 KB/s |
| - stateFull | 0.00 KB/s |
| - other | 0.00 KB/s |
| Server bytes out per client per s by type | SPIKE_FRAME 2347, SPIKE_DUST 599, schema_patch 126, PONG 6, other 1, schema_full 0, control 0 B/s |
| Inputs sent / messages / skipped sends / resyncs | 7231 / 7216 / 0 / 1965 |
| Server input buffer depth p50 / p95 / max | 0 / 3 / 3 |
| Rejected inputs (late / rate-limited / malformed); substituted | n/a / n/a / n/a; n/a |
| Joins / disconnects / unexpected drops / scripted reconnects | 7 / 7 / 0 / 1 |
| Desync count | n/a (n/a in spike: synthetic world has no client prediction to compare (arrives with M1 sim)) |
| Server RSS first to last | n/a |
| Server heap first to last | n/a |
| Bot process heap growth | -0.9 MB |
