# spike-16: 6 bots, 60 s, profile none

Target http://localhost:2571, seed 1, 20/10 Hz, Node v26.13.1, started 2026-11-13T12:09:22.365Z. Milestone M0-netcode-confirm.

| Metric | Value |
| --- | --- |
| Snapshot rate achieved per bot | 10.01 Hz (target 10) |
| Frame inter-arrival p50 / p95 / max | 95.87 / 111.14 / 114.77 ms |
| RTT p50 / p95 / max (bot ping) | 1 / 1 / 3 ms (n=174) |
| Server tick p50 / p95 / max | n/a (no server log) |
| CPU % of 0.1 quota median / max | n/a |
| Event-loop p99 max | n/a |
| Bytes in per bot per s (client side) | 2.97 KB/s |
| - FRAME | 2.28 KB/s |
| - DUST | 0.58 KB/s |
| - PONG | 0.00 KB/s |
| - statePatch | 0.11 KB/s |
| - stateFull | 0.00 KB/s |
| - other | 0.00 KB/s |
| Inputs sent / messages / skipped sends / resyncs | 7452 / 7206 / 0 / 6 |
| Server input buffer depth p50 / p95 / max | 3 / 3 / 3 |
| Rejected inputs (late / rate-limited / malformed); substituted | n/a / n/a / n/a; n/a |
| Joins / disconnects / unexpected drops / scripted reconnects | 6 / 6 / 0 / 0 |
| Desync count | n/a (n/a in spike: synthetic world has no client prediction to compare (arrives with M1 sim)) |
| Server RSS first to last | n/a |
| Server heap first to last | n/a |
| Bot process heap growth | -1.8 MB |
