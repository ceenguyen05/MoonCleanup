# Continuous build — Clean The Moon!

Owner direction: build the requested game continuously toward **November 17, 2026**, test it, and let Cee decide
when satisfied and ready to commit/publish. No intermediate commit plans, stage-ending permission requests or per-wave commit gates.
M0→M1→M2→M3 are dependency/coverage checkpoints, not separate jobs awaiting owner sign-off. M4 remains optional.

## Keep building

1. Resume from STATUS/current source and known findings; pick the next dependency-ready deliverable.
2. Implement a coherent piece, run affected checks and inspect playable results. Integrate mechanics, world/graphics,
   animation/audio and UI as they become available; do not leave presentation until the final night.
3. Fix real failures, checkpoint briefly, then continue automatically into the next ready task or milestone.
4. Run the full meaningful test/build/browser/network/visual/motion/perf suite on the final candidate, fix regressions,
   and present the runnable game plus remaining limitations to Cee. Cee chooses when to commit and release.

## Minimal coordination

Lead owns STATUS and task rows. `done` means implemented and verified for its stated scope; a git commit is not required.
Keep existing task IDs/cards as a backlog. No mandatory new wave file, copied formal brief, per-task report, review swarm,
ADR for a routine edit, or docs audit. Reuse the active M0 brief/reports for recovery; do not recreate ceremony for later work.
A worker needs goal, exact paths, inputs/contracts and acceptance/evidence; a short message suffices. One writer per path.
Use MODEL_POLICY model/effort/concurrency defaults. Free project-local dependencies may be installed when needed by one
designated writer; record manifest/lockfile changes and rationale. No concurrent installs. Do not run third-party lifecycle
scripts blindly; review them and ask only if trust/permissions or machine-wide installation genuinely require Cee's decision.
Contracts/schema/root changes are sequenced by their responsible owner when consumers can migrate together; no need to
wait for a new wave or commit. New core architecture changes need a concise ADR; small fixes and dependency use do not.

## Tests and review

Keep deterministic sim/world/protocol tests, meaningful unit tests, typecheck/lint/build, browser smoke, console monitoring,
visual/motion inspection, multiplayer/netsim, persistence/reconnect and measured budgets. No success claims from stub scripts.
Run focused checks during iteration and full checks at coherent integration/final states; reuse same-state artifacts.
Lead schedules focused independent review for high-risk algorithms/trust boundaries or unresolved defects, plus one integrated
code/visual/gameplay/performance review of the candidate. No mandatory independent approval for every small task.
Known substantive findings remain until fixed/verified or the affected component is deliberately removed and reported as such.
Tests/acceptance failures block declaring that feature complete, not all unrelated useful development.

## Ask only for a real decision or input

Ask Cee when missing credentials/access, spending, major scope/product choice, ambiguous behavior or an external tool/device
actually needs an answer. Give a concrete recommendation and continue independent work. No repeated "may I start the next
stage/wave/milestone?" prompts. Missing cloud access/Blender/iGPU must not freeze all local gameplay work; mark its specific
check BLOCKED/provisional and continue. Do not invent credentials, hardware results or approval.
At an actual usage limit checkpoint files/Next/agent IDs and resume safely afterward; no duplicate live writers or restart.

## Git / delivery

Do not commit/stage/push/branch or use worktrees/agent teams. Existing permission denies remain. Preserve the working tree;
Cee commits when satisfied. No automatic tags, PRs, uploads or publication. Main-only hosting stays configured for later use.
Final report: runnable command/URL, implemented scope, test results, known limitations and exact owner inputs still needed.
Keep delivery notes concise; do not replace removed paperwork with new process gates.
