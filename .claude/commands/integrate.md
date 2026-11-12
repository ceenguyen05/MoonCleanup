---
description: Integrate current modules and run meaningful checks without commit or stage gates.
argument-hint: "[current task/group]"
allowed-tools: Read, Write, Edit, Glob, Grep, Agent, SendMessage, Bash(pnpm turbo run *), PowerShell(pnpm turbo run *)
effort: medium
---

# /integrate

Follow WORKFLOW and MODEL_POLICY. Wire the ready modules, fix interface mismatches through their owners and run
meaningful affected checks plus full verify on a coherent integration state. No prerequisite that every task has a
separate reviewer approval or git commit. Keep substantive findings and final integrated independent review.
Use one evidence producer; record commands/environment/file state/results and relevant browser/motion/perf/network artifacts.
Unrun/stub checks are NOT RUN/N/A/BLOCKED, never PASS. Failures block the affected completion claim; continue independent work.
Update compact recovery state and continue next ready work through milestones. No commit plans or owner permission gate.
