---
description: Run the 16-bot headless load test through tools/bots with netsim latency 120 ms +/- 30 and 1% loss for 10 minutes, and report tick, bandwidth and desync numbers.
argument-hint: "[M#-W#, optional] [--hosted-spike]"
allowed-tools: Read, Write, Glob, Grep, Agent, SendMessage
effort: medium
---

# /bot-test

Follow MODEL_POLICY; reuse applicable evidence.

Multiplayer load gate for `$ARGUMENTS` (default: the current wave in `docs/STATUS.md`). You are the lead. Never run git; never install dependencies.

**Target rule:** run locally by default; long soaks remain local. ADR-0029 removed the separate staging service.
`--hosted-spike` is an orchestration request, not a claimed implemented CLI flag: use only a Cee-approved isolated
test fixture on the single Render service, with no active player/save data, for ≤5 minutes, logging bot egress.
Honor tool URL guards; do not bypass them or recreate staging. If existing tooling refuses the only hosted URL,
mark the hosted spike BLOCKED and ask the owner/netcode engineer for an explicitly supported safe test path.
Never run destructive load scenarios against live production data. Legacy `--staging` means the same bounded
isolated test intent, not a requirement for a second service.

## Inputs

- `tools/bots/README.md` and `tools/netsim/README.md` (run commands), `docs/architecture/performance-budgets.md` (server tick and bandwidth budgets), `docs/research/tech/platform-limits.md` (Render Free 0.1 CPU, 512 MB, 5 GB egress)

## Fixed test profile

- **16 bots**, **10 minutes locally (≤5 minutes for an approved hosted spike)**, netsim profile **latency 120 ms +/- 30 ms jitter, 1% packet loss**, seeded for reproducibility, scenario: join, walk, clean strokes, sell cargo, buy, reconnect once mid-run.

## Procedure

1. **Check tooling.** If bots or netsim cannot run, resume the existing tooling owner or launch `qa-test-engineer` first (owned files: `tools/bots/**`, `tools/netsim/**`, `tests/e2e/**`) with the fixed profile above and a unique port offset N (server `2567+N`); wait.
2. **Use the same `qa-test-engineer` after any repair; otherwise launch it** (`subagent_type: qa-test-engineer`, no isolation) to start the server (Colyseus, uWS transport) on `2567+N` (local) or point at the explicitly approved isolated hosted test URL, and run the profile. Bots reconcile with the `packages/sim` reconciler (the same one the client uses), not a private copy. If the server stack is not built yet, report `N/A (no server)` rather than faking a run.
3. Capture: tick ms (average, p95, max), snapshot rate achieved (target 10 Hz snapshots on 20 Hz sim), bytes/s per bot in and out and projected GB/month, reconnects and recovery time, rejected inputs, desync count (bot predicted state vs authoritative snapshot hash), server memory growth, errors and crashes.
4. Wait for the notification. Have `performance-reviewer` (tick, bandwidth, memory) and `netcode-security-reviewer` (rejected inputs, reconnect, desync) quote the report when judging; launch them only if the gate plan says so.

## Output

- `docs/agent-reports/<M#-W#>-bot-test.md` (raw JSON path from `tools/bots`, the metrics table, PASS/FAIL per item) using a clean-network control run for comparison.

## Pass / fail criteria

- PASS: all 16 bots complete the run (10 minutes local, ≤5 minutes approved hosted spike) with zero crashes and zero unrecovered desyncs; server tick time, share of the 0.1-CPU budget, memory (under 512 MB) and bandwidth per player are within `performance-budgets.md`; snapshot rate meets the configured 10 Hz within tolerance; reconnect recovers from authoritative state.
- FAIL: any of the above missed. Route to netcode-engineer, gameplay-systems-engineer or terrain-dust-engineer by cause; a 16-bot room above 50% of the 0.1-CPU budget at 20 Hz triggers the Colyseus-edge revisit in ADR-0014 (tell Cee via OPEN_QUESTIONS).
