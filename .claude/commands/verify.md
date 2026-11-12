---
description: Run the full quality gate (lint, typecheck, test, build) through Turborepo and report pass/fail per task with the owning role for each failure.
allowed-tools: Read, Glob, Grep, Bash(pnpm turbo run *), PowerShell(pnpm turbo run *)
---

# /verify

Run the repository gate. Never run git, never install dependencies, never fix code yourself.

## Procedure

1. Run exactly: `pnpm turbo run lint typecheck test build` from the repository root (Bash or PowerShell, whichever works; Windows paths are fine). Capture the full output tail and the exit code.
2. **Before code exists** (only scaffolding and configs in the workspace) the command **must pass trivially**: every package's scripts are no-ops or trivial checks. A failure at that stage is a scaffolding bug owned by devops-engineer; report it, do not work around it. If `pnpm` itself or the workspace is missing, say so and stop (installs are devops-engineer's job: the first one is M0-W0-T02, later ones between waves).
3. On failure, list for each failing Turbo task: package, task (`lint`/`typecheck`/`test`/`build`), first error with `file:line`, and the **owning role** looked up in `docs/architecture/module-boundaries.md` section 3. Group by owner. Do not re-run repeatedly hoping for a different result; flaky tests are reported as flaky with the evidence.
4. Distinguish: real failures, cached results (`FULL TURBO`), and skipped packages.

## Output

- A summary in chat; when called from `/integrate`, paste the table into `docs/agent-reports/<M#-W#>-integration.md` under "Gate: verify".
- Table: task, status (PASS/FAIL), duration, cache hit or miss, owner on failure.

## Pass criteria

- Exit code 0 and all four task types green across all packages. Anything else is FAIL and blocks `/integrate`.
