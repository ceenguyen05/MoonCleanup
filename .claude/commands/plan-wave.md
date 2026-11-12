---
description: Draft the next wave (tasks, owners, disjoint file sets, port offsets, briefs) into docs/handoff/waves/<M#-W#>.md without launching anything.
argument-hint: "[milestone, e.g. M1]"
allowed-tools: Read, Write, Edit, Glob, Grep
---

# /plan-wave

Plan the next wave for milestone `$ARGUMENTS` (if empty, use the current milestone from `docs/STATUS.md`). You are the lead; this command only writes the plan. It never launches agents and never runs git.

## Inputs

- `docs/STATUS.md`, `docs/milestones/<M#>.md`, the latest `docs/agent-reports/*-integration.md`, open items in `docs/OPEN_QUESTIONS.md`
- `docs/handoff/AGENT_ORCHESTRATION.md` (sections 3-6, 9) and `docs/architecture/module-boundaries.md` section 3 (ownership map)
- Pending contract proposals and dependency requests in `docs/agent-reports/` since the last wave

## Procedure

1. **Establish state.** Read STATUS.md and the milestone file. Confirm the previous wave is `done` (Cee confirmed the commit). If not, stop and say what is missing. **For the very first wave of the project (`M0-W0`) there is no previous wave: skip this check** (Gate G0 is verified instead, per `docs/handoff/FABLE_KICKOFF.md` §2).
2. **Pick the wave id** `<M#-W#>` (e.g. `M1-W2`). Wave 0 is always installs-then-contracts: the milestone's devops-engineer install task runs first and alone (it is the only task with `Installer: yes`; for M0 it also performs the very first install), then contracts-architect alone; everything else waits for both.
3. **Collect carry-over:** contract proposals (batch them into W0 for contracts-architect), dependency requests (devops-engineer installs between waves, each needs an ADR), changes-requested leftovers, OPEN_QUESTIONS defaults to apply.
4. **Select tasks** from the milestone's `todo` rows whose contracts are frozen. Task IDs are `M<milestone>-W<wave>-T<nn>`. Maximum **6 implementation tasks per wave, ≤ 3 per stage**; add the `integrator` task last. Sequential-only work (installs, DB schema/migrations, shared root files, releases) never runs in parallel with anything touching the same files.
5. **Assign per task:** role (an exact name from `.claude/agents/`), port offset N (0-9, unique in the wave: client `5173+N`, server `2567+N`, test DB suffix `_aN`), owned files (narrowed paths from the ownership map, never wider than the role's owned paths), required reviewers by the change-type table (code-reviewer for any code; + visual-qa-reviewer for anything visible; + performance-reviewer for hot paths/assets/bundle/server tick; + netcode-security-reviewer for protocol/server/API/auth/persistence/DB/contracts; + balance-reviewer for game-data/economy/sim rules).
6. **Disjointness check:** write a table of every owned path per task and verify no path (or glob overlap) appears twice and nothing falls outside the ownership map. Fix the plan until it is clean. Competing-approach tasks go in `prototypes/<topic>/<approach>/` with identical benchmark briefs.
7. **Write each brief** using the template in AGENT_ORCHESTRATION section 6 exactly, every field filled: goal, owned files, read-first docs (specific sections), frozen contracts (file + version), constraints (no git, no installs unless the brief says `Installer: yes`, no secrets, original names, quality-bar IDs from `docs/design/visual-target.md` and budget sections from `docs/architecture/performance-budgets.md`), testable acceptance criteria with how each is verified, visual acceptance with VT-IDs and scene/preset/tier, required reviewers, report instructions.
8. **Add the gate plan:** which of `/verify`, `/bot-test`, `/visual-check`, `/perf-check`, `/balance-check` the integration step must run for this wave.
9. **Update structure:** add the new task rows (status `todo`) to `docs/milestones/<M#>.md`; log new Cee-level decisions in `docs/OPEN_QUESTIONS.md` with a recommended default.

## Output

- `docs/handoff/waves/<M#-W#>.md` containing: wave goal, task table (ID, role, port N, owned files, reviewers, depends-on), the disjointness table, installs/ADRs needed first, the full briefs, the gate plan, and risks.

## Pass criteria

- Every brief is self-contained (a subagent with no context can execute it), every owned-file list is disjoint and within the ownership map, at most 6 implementation tasks (≤ 3 per stage), every task has reviewers and testable criteria. This file **must be written before any agent is launched** — `/launch-wave`, `/review`, `/commit-plan` and the reviewers read it. Tell Cee the wave file path and the next command (`/launch-wave <M#-W#>`).
