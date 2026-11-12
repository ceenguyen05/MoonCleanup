---
description: Write the ordered commit plan for Cee (groups, exact paths, Conventional Commit messages) for a finished wave. Never stages or commits.
argument-hint: "[M#-W#, e.g. M1-W2]"
allowed-tools: Read, Write, Glob, Grep, Bash(git status *), Bash(git diff *), Bash(git log *), PowerShell(git status *), PowerShell(git diff *), PowerShell(git log *)
---

# /commit-plan

Produce the commit plan for wave `$ARGUMENTS`. **You must never stage or commit.** Cee performs all git operations. Only read-only `git status --short`, `git diff --stat` / `git diff --name-status`, and `git log --oneline` are allowed, only to list changed files; never use `-C`/`-c`; no other git command, ever.

## Inputs

- `docs/handoff/waves/<M#-W#>.md`, every task report in `docs/agent-reports/` for the wave (files touched, suggested Conventional Commit messages), the integration report
- `docs/handoff/WORKFLOW.md` sections 3-4 (Conventional Commits, scopes, footers, order), `docs/STATUS.md`
- Read-only git output: changed and untracked files

## Procedure

1. **Confirm readiness:** integration report is PASS and every task is `approved`. If not, stop and say so.
2. **List changed files** with read-only git; map each file to the task that owns it using the reports' "Files touched" lists and the ownership map (`docs/architecture/module-boundaries.md` section 3).
3. **Flag problems** instead of grouping them: files in no task report, files outside their task's owned paths, secrets or `.env` files (never include; report path only), raw or oversized assets (`assets/terrain/raw/`, source art outside git per ADR-0017), build outputs, and anything under `prototypes/` (normally not committed; offer a `proto/<topic>` branch note for Cee).
4. **Group** in this order: contracts (`packages/shared`) -> packages (`packages/*`) -> apps (`apps/*`) -> tools (`tools/*`, `tests/`) -> assets (`assets/**`, `apps/client/public/assets/**`) -> docs (`docs/**`, `CLAUDE.md`, `.claude/**`). One concern per commit; split further by scope where it reads better.
5. **For each group write:** the exact file paths (explicit list, or a directory only when every file in it belongs to the group), the commit message in Conventional Commits form `<type>(<scope>): <imperative summary>` (summary at most 72 characters, lower-case, no trailing period; types feat/fix/perf/refactor/test/docs/build/ci/chore/style/revert; scopes from WORKFLOW.md section 3), a short body explaining why, and a footer `Refs: <taskIDs>`; add `BREAKING CHANGE: ...` when `PROTOCOL_VERSION` or `SAVE_FORMAT_VERSION` bumped.
6. **Wave metadata:** suggested wave branch name `wave/<m#>-<w#>-<slug>`, PR title, PR body checklist (CI green, Vercel preview link, reports and reviews linked), and a proposed tag name only for milestone-closing waves.
7. End with the line Cee should reply with: `"<M#-W#> committed, PR #<n> merged"` and the reminder to tell the lead about any hand edits.

## Output

- `docs/handoff/commit-plans/<M#-W#>.md` with: readiness summary, flagged problems, ordered commit groups (paths + message), branch/PR suggestions. Cee reviews the diff, stages each group exactly as listed, and commits.

## Pass criteria

- Every changed file is in exactly one group or in the flagged list; no secrets or raw assets listed; messages follow WORKFLOW.md; nothing was staged, committed or otherwise mutated in git.
