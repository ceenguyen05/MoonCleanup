---
description: Run meaningful lint, typecheck, tests and build and report actual failures.
allowed-tools: Read, Glob, Grep, Bash, PowerShell
effort: medium
---

# /verify

Use MODEL_POLICY and the laptop's Node prefix. Run `pnpm turbo run lint typecheck test build` from the repository root;
record exit code, real commands, failures and cache/skipped tasks. Reuse same-state evidence, not repeated speculative reruns.
Placeholder/no-op scripts and empty suites are NOT IMPLEMENTED/N/A, never proof a feature passed. Scope each pass honestly.
For failures report package/task, first file:line error and responsible owner; lead routes fixes then reruns affected checks.
Missing dependencies go to the designated installer when needed; no between-wave wait. Never mutate git.
Return a concise result; compact STATUS or existing integration evidence suffices. No mandatory report template or commit gate.
Unresolved failures block claiming the affected work complete; continue unrelated ready development.
