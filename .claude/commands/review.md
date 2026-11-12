---
description: Focused risk-based or final integrated review with actionable findings; no per-task ceremony.
argument-hint: "[scope or final candidate]"
allowed-tools: Read, Write, Edit, Glob, Grep, Agent, SendMessage
effort: medium
---

# /review

Lead selects independent review for high-risk correctness/trust/algorithm work or the final integrated candidate.
Use relevant code/visual/motion/perf/network/balance lenses; no automatic reviewer swarm for every task. Batch related work.
Review actual source and same-state evidence, reproduce critical/suspect behavior. Reviewer never fixes or approves its own code.
Return real blocking findings (file:line, evidence, required fix); preferences are non-blocking. Preserve unresolved findings.
Re-review fixes/regressions only. A short review note suffices; per-task signed reports are optional when not needed for recovery.
No git/commit condition. Lead routes fixes and continues independent work.
