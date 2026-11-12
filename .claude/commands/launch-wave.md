---
description: Launch the next STAGE of a planned wave (at most 3 implementation agents per stage, 6 per wave overall) as parallel subagents and track them to completion; checkpoint after every report.
argument-hint: "[M#-W#, e.g. M1-W2]"
allowed-tools: Read, Write, Edit, Glob, Grep, Agent, SendMessage
---

# /launch-wave

Launch wave `$ARGUMENTS` from `docs/handoff/waves/$ARGUMENTS.md`. You are the lead. Never run git, never use worktree isolation.

## Inputs

- `docs/handoff/waves/<M#-W#>.md` (briefs, owned-file table, port offsets), `docs/milestones/<M#>.md`, `docs/STATUS.md`

## Procedure

1. **Preconditions** (stop and report if any fails):
   - The wave file exists and every brief has all template fields filled.
   - Dependency installs and root-config changes for this wave are finished (devops-engineer, between waves). No agent is allowed to install during the wave, **except** the milestone's W0 install task (`Installer: yes`; M0-W0-T02 does the very first install), which is launched alone first, and its stage's other agents start only after it reports.
   - If this is not Wave 0, the contracts it depends on are frozen and approved.
   - No agent from a previous wave is still running on any listed path.
2. **Re-check disjointness** of every brief's "Owned files" against every other brief and against the ownership map; check port offsets are unique.
3. **Launch in one message**: one `Agent` call per implementation task, all in the same assistant message so they run in parallel (maximum 3 per stage — see AGENT_ORCHESTRATION §14 staged sessions; launch the remaining tasks of the wave as the next stage, ideally in the next usage window). After each report arrives, immediately update its task row and add a log line to docs/STATUS.md. For each call: `subagent_type` = the task's role name exactly as in `.claude/agents/`; `description` = the task ID and goal; `prompt` = the full brief text copied verbatim from the wave file. Do **not** pass `isolation`. Do not launch an agent on files another live agent owns. Do not launch the `integrator` yet.
4. **Record state:** set each launched task row to `in-progress` in `docs/milestones/<M#>.md` if the agent has not (exact-match row edit), and note the launch time and agent IDs in the wave file under "Run log".
5. **Wait.** Subagents run in the background; results arrive as notifications. Never act on a result you have not received. Never poll in a loop. When a notification arrives, read the agent's report file, not just its reply.
6. **Rate limits / stalls:** if an agent reports a rate limit or stops early, resume it with `SendMessage` using its agent ID and a short "continue from where you stopped" note. Never launch a duplicate.
7. **Collect:** for each finished task confirm `docs/agent-reports/<taskID>-<role>.md` exists, the row is `in-review` (or the report says blocked), and the files touched are inside the brief's owned files. Violations go back to the owner with a fix request.
8. When all implementation agents are done, print a table: task, role, status, report path, blockers, contract proposals, dependency requests.

## Output

- Updated task rows, the "Run log" in `docs/handoff/waves/<M#-W#>.md`, agent reports under `docs/agent-reports/`.

## Pass criteria

- Every launched task ended `in-review` with a report, or is explicitly blocked with a reason. Next: `/review <taskID>` for each task, then `/integrate <M#-W#>`.
