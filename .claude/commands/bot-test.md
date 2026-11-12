---
description: Run the 16-bot headless load test through tools/bots with netsim latency 120 ms +/- 30 and 1% loss for 10 minutes, and report tick, bandwidth and desync numbers.
argument-hint: "[M#-W#, optional] [--staging]"
allowed-tools: Read, Write, Glob, Grep, Agent, SendMessage
---

# /bot-test

Multiplayer load gate for `$ARGUMENTS` (default: the current wave in `docs/STATUS.md`). You are the lead. Never run git; never install dependencies.

**Target rule (environments.md §3, §5): runs locally by default** (CPU-limited container or an uncapped local server; 1 h soaks are local only). `--staging` runs the same scenario on staging Render Free for **at most 5 minutes**, only for the M0 netcode spike and before releases, and records the bots' bytes in `ops_usage_daily.bot_bytes_out`. **Never against production:** `tools/bots` refuses any URL equal to `PROD_SERVER_HTTP_URL`; if a brief names the production URL, stop and report instead of running.

## Inputs

- `tools/bots/README.md` and `tools/netsim/README.md` (run commands), `docs/architecture/performance-budgets.md` (server tick and bandwidth budgets), `docs/research/tech/platform-limits.md` (Render Free 0.1 CPU, 512 MB, 5 GB egress)

## Fixed test profile

- **16 bots**, **10 minutes locally (5 minutes with `--staging`)**, netsim profile **latency 120 ms +/- 30 ms jitter, 1% packet loss**, seeded for reproducibility, scenario: join, walk, clean strokes, sell cargo, buy, reconnect once mid-run.

## Procedure

1. **Check tooling.** If bots or netsim cannot run, launch `qa-test-engineer` first (owned files: `tools/bots/**`, `tools/netsim/**`, `tests/e2e/**`) with the fixed profile above and a unique port offset N (server `2567+N`); wait.
2. **Launch `qa-test-engineer`** (`subagent_type: qa-test-engineer`, no isolation) to start the server (Colyseus, uWS transport) on `2567+N` (local) or point at the staging URL for `--staging`, and run the profile. Bots reconcile with the `packages/sim` reconciler (the same one the client uses), not a private copy. If the server stack is not built yet, report `N/A (no server)` rather than faking a run.
3. Capture: tick ms (average, p95, max), snapshot rate achieved (target 10 Hz snapshots on 20 Hz sim), bytes/s per bot in and out and projected GB/month, reconnects and recovery time, rejected inputs, desync count (bot predicted state vs authoritative snapshot hash), server memory growth, errors and crashes.
4. Wait for the notification. Have `performance-reviewer` (tick, bandwidth, memory) and `netcode-security-reviewer` (rejected inputs, reconnect, desync) quote the report when judging; launch them only if the gate plan says so.

## Output

- `docs/agent-reports/<M#-W#>-bot-test.md` (raw JSON path from `tools/bots`, the metrics table, PASS/FAIL per item) using a clean-network control run for comparison.

## Pass / fail criteria

- PASS: all 16 bots complete the run (10 minutes local, 5 minutes staging) with zero crashes and zero unrecovered desyncs; server tick time, share of the 0.1-CPU budget, memory (under 512 MB) and bandwidth per player are within `performance-budgets.md`; snapshot rate meets the configured 10 Hz within tolerance; reconnect recovers from authoritative state.
- FAIL: any of the above missed. Route to netcode-engineer, gameplay-systems-engineer or terrain-dust-engineer by cause; a 16-bot room above 50% of the 0.1-CPU budget at 20 Hz triggers the Colyseus-edge revisit in ADR-0014 (tell Cee via OPEN_QUESTIONS).
