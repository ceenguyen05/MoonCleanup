---
description: Validate an integrated candidate and report remaining defects; no commit or publication prerequisite.
argument-hint: "[candidate or version]"
allowed-tools: Read, Write, Edit, Glob, Grep, Agent, SendMessage, Bash, PowerShell
effort: medium
---

# /release-checklist

Validate the current working tree. Follow WORKFLOW and MODEL_POLICY; Cee chooses when satisfied and ready to commit/publish.
Run full meaningful lint/typecheck/tests/build plus applicable browser, motion/visual, multiplayer/reconnect/save, performance
and balance checks. Reuse evidence for the same file state; rerun invalidated checks. Complete focused/final independent review
and fix substantive failures. No per-task reviewer chain, signed wave reports, git commit, PR or remote CI prerequisite.
Record remote CI/hosted/device results only if actually available; unavailable checks are BLOCKED/provisional, never PASS.
Check reference coverage, compatibility, licensing, env placeholders and secrets without printing secret values.
Use safe local/test data; no destructive production testing. Main-only hosting remains configured for later owner publication.
Return runnable commands/URL, implemented scope, test results, defects/limitations and actual inputs needed. A compact STATUS
checkpoint or final summary suffices; no separate release-plan document. Continue fixing/testing until the candidate is ready.
