# ADR-0033: M0 netcode spike verdict - 6 bots pass at 20/10; plain uWS HTTP handlers

- **Status:** Accepted, lead, 2026-11-14. Colyseus 0.18 on uWebSockets.js ([ADR-0014](0014-netcode-framework-colyseus.md)) and 20/10 Hz ([ADR-0025](0025-netcode-model-revision.md)) are confirmed for rooms. Verdict is partial (see Not demonstrated).
- **Closes:** M0 exit criterion E8 ([M0-foundation.md](../milestones/M0-foundation.md)).
- **Evidence:** [M0-W2-T04-longrun-qa-test-engineer.md](../agent-reports/M0-W2-T04-longrun-qa-test-engineer.md); raw runs in `tools/bots/results/M0-W2-T04-longrun/` (`tools/bots/results/M0/` holds only the 60 s integrated run, `M0-W2-T06-integrated-clean-20-10.md`); [M0-W1-T04-netcode-engineer.md](../agent-reports/M0-W1-T04-netcode-engineer.md).

## Method

Real server entry under tsx (not the esbuild bundle), loopback on Windows, Node 26.13.1, 6 bots (`spike-16`), one run at a time. **Not a CPU-limited container**: "CPU % of 0.1 quota" is process CPU divided by 0.1, indicative only. The hosted Render run was dropped by decision (local-first, ADR-0031; cap is 6 players). The spike protocol carries input only, so desync cannot be asserted.

## Results (600 s each, 6 bots)

| Run | Tick p50 / p95 / max (ms) | KB/s per client (p95 window / max window) | CPU % of 0.1 quota median / max | Event-loop p99 max (ms) | Snapshot Hz |
| --- | --- | --- | --- | --- | --- |
| clean 20/10 | 0.11 / 0.47 / 2.72 | 3.30 / 3.45 (mean about 2.0) | 12.5 / 39 | 35.23 | 10.00 |
| typical 20/10 (120 +/- 30 ms RTT, 1 % loss) | 0.12 / 0.43 / 3.51 | 3.01 / 3.48 (mean about 2.0) | 14 / 28.2 | 34.05 | 10.01 |
| clean 30/15 (substitute) | 0.16 / 0.72 / 4.41 | 4.59 / 4.69 | 23.5 / 48.4 | 36.08 | 15.00 |
| typical 30/15 (substitute) | 0.24 / 0.94 / 17.0 | 4.44 / 4.67 | 34.4 / 74.9 | 187.56 | 14.99 |

- Budgets: tick p95 <= 3.5 ms and 5.0 KB/s per client busy peak. Both met in every run; worst 10 s window tick p95 0.98 ms. The 30/15 peak leaves only 0.3 KB/s headroom.
- Shorter runs at 20/10 (all PASS, 7 joins, 0 unexpected drops): bad network (250 +/- 50 ms RTT, 5 % loss, 150 s) tick p95 0.48; 5 s outage (150 s) survived, max frame gap 5,062 ms; cold start with 8 s hold (180 s) joined without drops.
- Bandwidth drifts down over a run (clean 20/10 first third 2.56, last third 1.80 KB/s), so use the peak window (3.45), not the 2.0 mean.
- Typical 30/15: the 17 ms tick and 188 ms event-loop spike are likely host noise (CPU max 74.9 %), not reproduced.

## 30/20 comparison: blocked

The real server env refuses 30/20 ("SNAPSHOT_HZ: must divide SIM_TICK_HZ evenly", netcode N4), so 30/20 could not run on the real entry; 30/15 was run instead. The only 30/20 datum is the earlier 90 s harness figure of about 5.2 KB/s total, over the 5.0 ceiling. **20/10 stays the default**; 30/15 fits the budget with thin bandwidth headroom.

## HTTP routing on uWS

**Confirmed: plain uWS handlers, not Colyseus' router** (M0-W1-T04). On uWS the Colyseus router buffers POST bodies without a size limit, drops the peer address (client IP from the left-most `X-Forwarded-For`), applies one global CORS set including credentials, leaves unknown paths hanging, and allocates Request/Response objects per call. The adapter enforces a 16 KB body limit and an exact CORS allowlist. No fallback was needed.

## Not demonstrated (carry to M1)

| Item | State |
| --- | --- |
| Late-input drops | INCONCLUSIVE: real entry does not log them; clean 20/10 had 8,556 steering resyncs of 72,024 inputs, unexplained (netcode-engineer) |
| Desync | Not testable with the input-only spike protocol |
| Reconnect after server restart | INCONCLUSIVE: bot aborts on ECONNREFUSED (no join retry in `spike16.ts`) |
| Server RSS / heap, GC stall | Not logged by the real entry |
| 0.1-CPU container run | Not done; CPU figures are inferred |

## Revisit trigger

ADR-0014 and ADR-0025 triggers stand: a hosted or 0.1-CPU run showing a 6-player room above 50 % of the CPU budget at 20 Hz replaces the Colyseus edge with the custom uWS adapter.
