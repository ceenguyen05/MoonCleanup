# spike-16: 6 bots, 90 s, profile typical

Target http://localhost:2571, seed 1, 20/10 Hz, Node v26.13.1, started 2026-11-13T03:12:23.836Z. Milestone M0-W2-T04.

| Metric | Value |
| --- | --- |
| Snapshot rate achieved per bot | 10.09 Hz (target 10) |
| Frame inter-arrival p50 / p95 / max | 95.72 / 126.4 / 381.59 ms |
| RTT p50 / p95 / max (bot ping) | 141 / 236 / 374 ms (n=264) |
| Server tick p50 / p95 / max | 0.2 / 0.618 / 1.584 ms |
| CPU % of 0.1 quota median / max | 21.8 / 40.6 |
| Event-loop p99 max | 34.41 ms |
| Bytes in per bot per s (client side) | 2.91 KB/s |
| - FRAME | 2.22 KB/s |
| - DUST | 0.58 KB/s |
| - PONG | 0.00 KB/s |
| - statePatch | 0.11 KB/s |
| - stateFull | 0.00 KB/s |
| - other | 0.00 KB/s |
| Server bytes out per client per s by type | SPIKE_FRAME 2273, SPIKE_DUST 599, schema_patch 125, PONG 6 B/s |
| Inputs sent / messages / skipped sends / resyncs | 11072 / 10699 / 107 / 5 |
| Server input buffer depth p50 / p95 / max | 2 / 3 / 4 |
| Rejected inputs (late / rate-limited / malformed); substituted | 316 / 0 / 0; 285 |
| Joins / disconnects / unexpected drops / scripted reconnects | 6 / 6 / 0 / 0 |
| Desync count | n/a (n/a in spike: synthetic world has no client prediction to compare (arrives with M1 sim)) |
| Server RSS first to last | 118.3 to 91.9 MB (growth -26.4) |
| Server heap first to last | 30 to 28.1 MB (growth -1.9) |
| Bot process heap growth | -1.4 MB |
