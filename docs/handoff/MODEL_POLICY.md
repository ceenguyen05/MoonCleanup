# Models and usage

Allowed versions: **Sonnet 5.5** (`claude-sonnet-5-5`) and **Opus 5.5** (`claude-opus-5-5`). No Haiku. **Fable 5.2 is retired (owner, 2026-11-15)**; do not launch it unless Cee explicitly says so. Exact role defaults/tools/turn checkpoints live in `.claude/agents/*.md`;
do not maintain a second copied roster here. Role files are a menu, not a launch checklist.

| Model | Default responsibility | Effort |
| --- | --- | --- |
| Sonnet 5.5 | Lead; default worker for most tasks: UI/backend/integration, setup, tests, profiling, balance checks, docs and routine gameplay/rendering code | Medium; high for edge cases/important craft |
| Opus 5.5 (premium, High) | Hard work: animation and tool feel, terrain/dust, rendering and technical art, contracts/architecture, netcode | High (the single premium slot, kept busy) |
| Opus 5.5 (regular, medium) | A regular worker when a task needs more care than Sonnet but is not premium-hard | Medium; high only for a bounded edge case |

## Lead's authority

The Sonnet lead may choose model and low/medium/high/xhigh/max effort per task without asking Cee again.
Record a one-line reason and exit check. Low for exact mechanical edits, medium for clear work, high for edge cases/craft;
xhigh/max are not allowed (owner, 2026-11-15: effort ceiling is High); the lead may raise or lower effort per task between low and High on its own judgment. Do not force all workers onto one model/effort.
Normally omit Agent's model argument to retain the pinned role ID. Invocation model overrides accept aliases;
verify alias resolution matches an allowed version, or use a task-specific role with the pin and unchanged tools/ownership.
Effort overrides can be passed per task; do not rewrite persistent defaults for a one-off effort change.
Resumed workers may retain earlier settings. Record actual model when known; never duplicate a live writer to change its model.
Check model availability and whether environment overrides defeat the profiles; do not dump secrets or purchase access.

## Usage controls

Run independent ready work in parallel; **keep 4 agents running: 3 regular workers (Sonnet 5.5 by default, Opus 5.5 where a task needs it, medium) + 1 premium worker (Opus 5.5, High)** (owner, 2026-11-18, supersedes the earlier 4 regular + 1 premium rule; Fable stays retired). Owner runs ONE active session at a time and rotates 4 Claude Pro accounts when a session limit is hit; there are no per-account work splits. After a switch, resume from docs/STATUS.md and the files on disk (kickoff prompt 2), and checkpoint compactly before a limit. Idle regular slots take the next dependency-ready task. Workers write a short report only for big changes, with no per-task evidence folders.
Installs/contracts/root edits/migrations are sequential. A second worker must unblock independent critical-path work.
No nested agents, worktrees, team mode, automatic prototype contest or polling loops. `maxTurns` is a checkpoint, not a token cap.
Brief ≤500 words plus paths; initially read ≤3 focused spec sections when practical. Read more source when correctness needs it.
Do not load whole milestones, historical reports, research, vendor or future design specs on every resume. Use scoped `rg` first.

## Review and verification

Owner 2026-11-18: build first, verify at the end. No per-task, per-batch or final-integrated review during the build; run the review/verification pass once at the end, and only for risky areas (auth, saves, netcode, supply chain) if Cee asks.
Keep known blocking findings. Review fixes/regressions only; after two failed cycles diagnose/split/escalate rather than loop.
One evidence producer per test/capture; reuse logs/artifacts for the same final file state. Reproduce suspect/high-risk results.
Per task: compile only. Run `pnpm verify` once at the end of the build and before Cee pushes; motion/visual/bot/perf/balance checks are end-of-build and on demand. Record N/A/BLOCKED/NOT RUN honestly. Check `/usage` at coherent checkpoints if available; otherwise quota is unknown.
No claimed savings percentage or stage-to-five-hour-window conversion without measurements.

## Session start

`claude --model claude-sonnet-5-5 --effort medium --permission-mode acceptEdits`

Existing session: reach a checkpoint, `/model claude-sonnet-5-5`, then `/effort medium`.
Recover existing reports/IDs; do not reinstall or restart M0. Continue across milestones without waiting for commits.
Design authority: [REFERENCE_TARGET](../design/REFERENCE_TARGET.md); workflow: [continuous build](WORKFLOW.md).
Configuration sources: [models](https://code.claude.com/docs/en/model-config.md),
[subagents](https://code.claude.com/docs/en/sub-agents.md). Pins were checked with Claude Code 2.1.322; access is account-dependent.
