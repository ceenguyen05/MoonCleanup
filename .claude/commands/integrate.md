---
description: Integration pass for a wave - integrator wires modules in the composition roots, then the gates run (verify, bot-test, visual-check, perf-check) and a PASS/FAIL report is written.
argument-hint: "[M#-W#, e.g. M1-W2]"
allowed-tools: Read, Write, Edit, Glob, Grep, Agent, SendMessage, Bash(pnpm turbo run *), PowerShell(pnpm turbo run *)
---

# /integrate

Run the integration protocol (AGENT_ORCHESTRATION section 8) for wave `$ARGUMENTS`. You are the lead. Never run git.

## Inputs

- `docs/handoff/waves/<M#-W#>.md` (gate plan), `docs/milestones/<M#>.md`, all wave reports and reviews in `docs/agent-reports/`

## Procedure

1. **Precondition:** every task in the wave is `approved`. If any is not, stop and list them.
2. **Launch the integrator** (`subagent_type: integrator`, no isolation) with a brief built from the template: goal "wire the wave's modules into `apps/client/src/app/**` and `apps/server/src/app/**`, resolve interface mismatches only there"; owned files exactly those two folders plus `docs/agent-reports/<M#-W#>-integration.md`; read-first list = module-boundaries sections 1, 2, 4, 5 and the wave's reports; a unique port offset; the gate plan. Wait for its notification. Mismatches that need changes in another role's files come back as items for the owner (re-brief the owner, then re-run the affected reviewer and `/review` flow for that task).
3. **Run the gates** the wave file requires, in this order, recording raw numbers and artifact paths:
   1. `/verify` (lint, typecheck, test, build).
   2. `/bot-test` (16 bots, netsim 120 ms +/- 30, 1% loss, 10 minutes). Needs a runnable server.
   3. `/visual-check <milestone>` (milestone scene list; native-resolution screenshots).
   4. `/perf-check` (Tier A/B budgets).
   5. `/balance-check` when game-data, economy or progression changed.
   Gates that cannot run yet (no code exists) are marked `N/A (reason)` in the report, never PASS.
4. **Integration report:** make sure `docs/agent-reports/<M#-W#>-integration.md` has PASS/FAIL per gate with numbers, wiring changes, mismatches returned to owners, open issues. If the integrator did not write it, write it yourself from the gate outputs.
5. **On FAIL:** map each failure to the owning role via the ownership map, re-brief the owner with the evidence (same fix-cycle rules, max 2), then re-run only the failed gate and `/verify`.
6. **On PASS:** run `/status`, `/update-docs`, append the wave to `docs/REVIEW_LOG.md` (via docs-keeper), run `/commit-plan <M#-W#>`, then plan the next wave. Do not open the next wave before PASS.

## Output

- `docs/agent-reports/<M#-W#>-integration.md`; gate artifacts (`docs/visual-reviews/<milestone>/`, bot and perf reports); updated STATUS and commit plan.

## Pass criteria

- All required gates PASS. Budgets come from `docs/architecture/performance-budgets.md`, visual items from `docs/design/visual-target.md`, pacing from `docs/design/progression-and-economy.md`.
