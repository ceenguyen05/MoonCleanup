---
description: Rewrite docs/STATUS.md from the milestone files, agent reports and review files so it stays the single source of truth.
allowed-tools: Read, Write, Edit, Glob, Grep, Bash(git status *), Bash(git diff *), Bash(git log *), PowerShell(git status *), PowerShell(git diff *), PowerShell(git log *)
---

# /status

Rewrite `docs/STATUS.md`. You are the lead; this file is yours. Read-only git is allowed here (`git status`, `git diff --stat`, `git log --oneline`) only to list what changed and what is committed; never use `-C`/`-c` and never run any other git command.

## Inputs

- `docs/milestones/*.md` (task rows), `docs/agent-reports/` (reports, reviews, integration reports), `docs/handoff/waves/`, `docs/handoff/commit-plans/`, `docs/OPEN_QUESTIONS.md`, `docs/REVIEW_LOG.md`, the previous `docs/STATUS.md`
- Read-only: `git status --short`, `git log --oneline -n 20` to see whether the last commit plan was committed

## Procedure

1. Read the previous STATUS.md (keep its structure; do not lose history sections).
2. For the current milestone and wave, tabulate each task: ID, role, status (`todo`, `in-progress`, `in-review`, `changes-requested`, `approved`, `done`), report path, reviewers and verdicts, fix cycle count. Take the status from the milestone file; if a report or review file contradicts it, flag the mismatch.
3. Gates: last result of `/verify`, `/bot-test`, `/visual-check`, `/perf-check`, `/balance-check` with date and report path (or `not run`/`N/A`).
4. Blockers and open questions: from reports "Open issues" and `docs/OPEN_QUESTIONS.md`, each with owner and recommended default. Pending contract proposals and dependency requests as separate lists for the next W0.
5. Commit state: last commit plan path (`docs/handoff/commit-plans/<M#-W#>.md`), whether Cee has confirmed it (from the log and what Cee told you); uncommitted file count from `git status`.
6. Next actions: the next 1-3 commands to run and by whom (lead, Cee).
7. Write `docs/STATUS.md` with an "Updated" date at the top and a "Resume here" section naming the files a fresh lead session reads: CLAUDE.md, docs/STATUS.md, the current milestone file, the latest integration report, open OPEN_QUESTIONS.

## Output

- `docs/STATUS.md` (rewritten). Never edit task rows of other roles beyond the lead-owned states (`changes-requested`, `approved`, `done`).

## Pass criteria

- Every task of the current wave appears once with its true state; every claim cites a file; nothing marked `done` without Cee's confirmation. Run before ending any session and after every wave.
