# Claude session prompts — Clean The Moon!

Open Claude in this project root with **Sonnet 5.5 / medium**. Send prompt 1 once in the new conversation.
Keep that conversation across usage resets: send prompt 2 when usage returns. Prompt 3 is optional before a break/limit.
If a hard limit arrives before a checkpoint, send prompt 2 after reset; Claude must recover from actual files.
These prompts do not schedule work, reset usage or switch the lead model automatically. Model routing follows MODEL_POLICY.

```powershell
claude --model claude-sonnet-5-5 --effort medium --permission-mode acceptEdits
```

## 1. New conversation — paste once

```text
Continue developing Clean The Moon! from this project's existing files and interrupted M0 work. You are the Sonnet 5.5
lead at medium effort. Build through M0, M1, M2 and M3 toward November 17, 2026 (America/Chicago); M4 remains optional.

Read CLAUDE.md, docs/STATUS.md, docs/handoff/WORKFLOW.md, docs/handoff/MODEL_POLICY.md and docs/design/REFERENCE_TARGET.md
once to adopt the updated instructions. Then read only the current task/source/spec sections and unresolved findings
needed for the next deliverable. Current repo instructions supersede old workflow directions in reports or conversation.
Preserve completed work, source changes and real bug findings. Do not restart M0, repeat setup or reinstall unnecessarily.
Check actual worker availability before resuming historical IDs; never duplicate a live writer.

Use the pinned Sonnet 5.5, Opus 5.5 and Fable 5.2 role defaults; choose model/effort per task within MODEL_POLICY's usage
and concurrency limits. Spend premium effort on hard mechanics, gameplay feel, rendering, art, animation and world detail.
Closely follow Moon Sweepers' experience using our own code/assets/branding. Keep the title Clean The Moon! and item names flexible.

Build, integrate, test and fix continuously. Milestones/stages are dependency checkpoints, not permission or commit gates.
Use focused checks while iterating and full meaningful validation on integrated candidates. Preserve quality and disclose
missing scope, unrun checks and deadline risk honestly. No mandatory wave plans, per-task report/reviewer swarm or repeated docs audit.
Never stage, commit, push, tag, create PRs or publish automatically. Keep the git safeguard; I decide when satisfied and ready to commit.

Ask concise questions for actual decisions or missing inputs, with a recommendation; continue independent ready work.
Keep docs/STATUS.md compact and current at coherent deliverables and before interruptions, including exact Next and recovery details.
Do not stop for a guessed usage window or after each milestone. Start the next dependency-ready implementation now.
```

## 2. Same conversation after a usage reset — paste each time

```text
Usage is available again. Continue Clean The Moon! from the last checkpoint in this conversation and docs/STATUS.md.
Check actual files and worker/process state; a limit may have interrupted work before notes were saved. Resume useful
existing context, never duplicate a live writer, restart M0 or repeat completed setup. Reload instructions only if changed
or no longer in context; read only the task sections/findings needed now. Reuse valid evidence and rerun invalidated checks.

Keep the documented Sonnet/Opus/Fable routing, effort and usage limits. Continue implementation, integration, testing and
fixes through M0–M3 toward November 17, protecting mechanics, graphics, animation and world/gameplay fidelity.
No stage/commit stops or extra planning paperwork. Preserve the git safeguard; I choose when to commit/publish.
Checkpoint compactly at meaningful progress or interruptions. Ask only for actual decisions/inputs while continuing ready work.
Start the next unfinished, dependency-ready deliverable now.
```

## 3. Before ending a usage window — optional checkpoint prompt

Send while Claude can still respond, then use prompt 2 when ready to resume. If work can continue, no need to send this.

```text
Checkpoint this session for a usage break, then pause. Finish only an atomic write already underway; do not start new work.
Update docs/STATUS.md with the current task/state, files changed and incomplete edits, actual checks/results and evidence,
unresolved findings/inputs, relevant worker IDs and running process state, and the exact next implementation/check command.
Coordinate active workers to checkpoint safely and record their actual state; never assume they stopped. Mark unfinished
or unrun checks honestly. Keep notes compact; no new handoff document, transcript, commit plan or git mutation.
Reply briefly with what is saved, anything still running, and where to resume. Then wait for my continuation message.
```
