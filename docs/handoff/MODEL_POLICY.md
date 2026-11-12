# Models and usage

Allowed versions: **Sonnet 5.5** (`claude-sonnet-5-5`), **Opus 5.5** (`claude-opus-5-5`),
**Fable 5.2** (`claude-fable-5-2`). No Haiku. Exact role defaults/tools/turn checkpoints live in `.claude/agents/*.md`;
do not maintain a second copied roster here. Role files are a menu, not a launch checklist.

| Model | Default responsibility | Effort |
| --- | --- | --- |
| Sonnet 5.5 | Lead; UI/backend/integration, setup, tests, profiling, balance checks and docs | Medium; high for edge cases/important craft |
| Opus 5.5 | Contracts/architecture, game design, netcode, independent code/visual/security reviews | High; Sonnet can cover simple sub-tasks |
| Fable 5.2 | Demanding gameplay/feel, terrain/dust, rendering, technical art and animation | High; simpler fixes can use Sonnet/Opus |

## Lead's authority

The Sonnet lead may choose model and low/medium/high/xhigh/max effort per task without asking Cee again.
Record a one-line reason and exit check. Low for exact mechanical edits, medium for clear work, high for edge cases/craft;
xhigh/max only for a specific bounded hard problem, then return to the default. Do not force all workers onto one model/effort.
Normally omit Agent's model argument to retain the pinned role ID. Invocation model overrides accept aliases;
verify alias resolution matches an allowed version, or use a task-specific role with the pin and unchanged tools/ownership.
Effort overrides can be passed per task; do not rewrite persistent defaults for a one-off effort change.
Resumed workers may retain earlier settings. Record actual model when known; never duplicate a live writer to change its model.
Check model availability and whether environment overrides defeat the profiles; do not dump secrets or purchase access.

## Usage controls

Default one implementer; **max two workers total including reviewers**, **one Opus/Fable worker combined**.
Installs/contracts/root edits/migrations are sequential. A second worker must unblock independent critical-path work.
No nested agents, worktrees, team mode, automatic prototype contest or polling loops. `maxTurns` is a checkpoint, not a token cap.
Brief ≤500 words plus paths; initially read ≤3 focused spec sections when practical. Read more source when correctness needs it.
Do not load whole milestones, historical reports, research, vendor or future design specs on every resume. Use scoped `rg` first.

## Review and verification

Use focused independent review for high-risk changes and one final integrated review. Related work may be reviewed together; no per-task approval gate. Visual review per integrated visible batch;
perf for changed hot paths/assets/budgets; security for trust/auth/wire/save/hook/build/supply-chain risks; balance for changed
economy/pacing. Omitted specialist lenses get a short N/A reason; no unconditional multi-reviewer launch for a neutral type edit.
Keep known blocking findings. Review fixes/regressions only; after two failed cycles diagnose/split/escalate rather than loop.
One evidence producer per test/capture; reuse logs/artifacts for the same final file state. Reproduce suspect/high-risk results.
Run focused checks while building and final `pnpm verify` at integration; run applicable motion/visual/bot/perf/balance gates.
Record N/A/BLOCKED/NOT RUN honestly. Check `/usage` at coherent checkpoints if available; otherwise quota is unknown.
No claimed savings percentage or stage-to-five-hour-window conversion without measurements.

## Session start

`claude --model claude-sonnet-5-5 --effort medium --permission-mode acceptEdits`

Existing session: reach a checkpoint, `/model claude-sonnet-5-5`, then `/effort medium`.
Recover existing reports/IDs; do not reinstall or restart M0. Continue across milestones without waiting for commits.
Design authority: [REFERENCE_TARGET](../design/REFERENCE_TARGET.md); workflow: [continuous build](WORKFLOW.md).
Configuration sources: [models](https://code.claude.com/docs/en/model-config.md),
[subagents](https://code.claude.com/docs/en/sub-agents.md). Pins were checked with Claude Code 2.1.322; access is account-dependent.
