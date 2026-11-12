---
description: Run the required reviewers for one task in parallel, read their verdicts, and set the task row (approved or changes-requested).
argument-hint: "<taskID, e.g. M1-W2-T03>"
allowed-tools: Read, Write, Edit, Glob, Grep, Agent, SendMessage
---

# /review

Review task `$ARGUMENTS`. You are the lead; reviewers are independent subagents that never wrote the code. Never run git.

## Inputs

- The task's brief in `docs/handoff/waves/<M#-W#>.md`, its report `docs/agent-reports/<taskID>-<role>.md`, its row in `docs/milestones/<M#>.md`
- `docs/handoff/AGENT_ORCHESTRATION.md` section 7 (required reviewers by change type), `docs/agent-reports/README.md` (review template)

## Procedure

1. **Preconditions:** the row is `in-review` and the report exists. If not, stop.
2. **Select reviewers** from the report's files touched and the brief's "Required reviewers":
   - any code: `code-reviewer`
   - anything visible (render, visuals, terrain, animation, UI): + `visual-qa-reviewer`
   - render/terrain/dust/sim hot paths, assets, bundle size, server tick: + `performance-reviewer`
   - protocol, server, API, auth, persistence, DB, contracts: + `netcode-security-reviewer`
   - game-data, economy/sim rules, progression: + `balance-reviewer`
3. **Prepare evidence the reviewers need** (do not do their judging): for visual tasks make sure screenshots exist or tell visual-qa-reviewer to capture them with `/visual-check` procedures; for performance tasks make sure a `tools/perf` capture or bot-test report exists or tell the reviewer to run it; for balance tasks point to `tools/balance-sim`.
4. **Launch reviewers in one message** (parallel, up to 5): one `Agent` call per reviewer with `subagent_type` = the reviewer role name. Prompt = task ID, brief path, report path, the changed-file list from the report, port offset N from the brief, the budget/visual IDs that apply, and the exact review file to write: `docs/agent-reports/<taskID>-review-<reviewer-role>.md`. No `isolation`.
5. **Wait for notifications** (never act on a verdict you have not received). Read each review file's verdict header and its blocking findings; spot-check the evidence of any contested finding.
6. **Decide:**
   - All required reviewers APPROVED: set the row to `approved` (`approved` = all required reviewers signed off on the task; `done` is set later, only after the wave integration gate passed AND Cee confirmed the commit, per WORKFLOW.md section 5); note the review file paths in the wave file.
   - Any CHANGES REQUESTED: set the row `changes-requested`; re-brief the **owner** (resume with `SendMessage` if the agent is alive, else a new `Agent` call with the original brief plus the findings and the same owned files) listing each blocking finding with file:line; after the owner sets `in-review` again, re-run **only the rejecting reviewer(s)**.
   - Track the fix cycle count in the wave file. **Maximum 2 fix cycles**; after the second rejection, escalate: re-scope, split the task, or log an OPEN_QUESTION with a recommended default.
7. Contract-change proposals and dependency requests in reviews or reports go on the carry-over list for the next `/plan-wave`.

## Output

- `docs/agent-reports/<taskID>-review-<reviewer-role>.md` per reviewer; updated task row and wave-file review table.

## Pass criteria

- Every required reviewer says APPROVED with evidence; blocking findings are zero. A task is never approved by its own author.
