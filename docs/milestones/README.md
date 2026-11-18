# Development backlog

> **PLAN REVISION 2026-11-18 (owner): BUILD FIRST, VERIFY AT THE END.**
> Keep the plan (M0-M4). Solo comes first for graphics, feel and fps; multiplayer, server and database stay in scope and keep being built, but never ahead of or at the cost of solo. Build out the whole game without stopping to verify, review, look-check or perf-test each task. Per task: write the code, make it compile (typecheck the touched package) and move on.
> Verification, bug fixing, perf, visual review and polish happen in ONE pass at the end, once a complete game is running. After that pass: revise, enhance, improve. The only standing rule is that `pnpm verify` (format check, lint, typecheck, tests with retries, build) should pass before Cee pushes to Render/Vercel.
> **Not per-task gates (end-of-build pass only):** `pnpm verify` runs, golden-hash/determinism lanes, bot/soak/netsim runs, perf and quiet-machine captures, per-wave visual gates (V-M1a/b/c), comparator/VT scoring, real-GPU look-checks, reviews and `/release-checklist`.
> **Scope decisions (owner MCQ 2026-11-18):** (1) CDLOD terrain and WebGL2 parity stay in scope, as before. (2) Assets: export plain GLBs and use them; KTX2/meshopt/LOD optimisation and the ASSET_LICENSES gate are an end-of-build pass, not a blocker. (3) One default look; quality presets and dynamic-resolution work wait until the end. (4) Golden-hash tests are not blockers: re-baseline or delete a hash test when it gets in the way (the sim stays deterministic). (5) Agents run lean: 4 total (3 regular + 1 premium), a short report only for big changes, STATUS updated per milestone, no per-task evidence folders, no GPU-lock ceremony.
> Wherever an older doc says a gate, exit criterion (E3, E5, E9, E14...), golden, soak, review or look-check is "required" before moving on, read it as deferred to the end-of-build pass. Timing and allocation tests stay loose enough not to flake.

| Milestone | Work |
| --- | --- |
| [M0](M0-foundation.md) | Foundation, real toolchain/contracts, renderer/server and risk checks |
| [M1](M1-mvp.md) | Playable pilot loop and core co-op/persistence/visual/motion work |
| [M2](M2-v1-parity.md) | Whole-moon reference-system coverage |
| [M3](M3-polish-launch.md) | Integrated polish and final validation; publication only when Cee chooses |
| [M4](M4-post-launch.md) | Optional later ideas |

Follow [continuous build](../handoff/WORKFLOW.md), MODEL_POLICY and REFERENCE_TARGET. Older task IDs/stages/waves are
dependency labels, not stopping points. No per-wave commit, tag, formal planning file or owner sign-off requirement.
Use each card's real implementation/acceptance detail; current reference-first scope overrides retired custom extras.
Lead alone maintains task states: todo/in-progress/blocked/changes-requested/done; existing in-review/approved states can
be retained while finishing already-running reviews. `done` means implemented and meaningfully verified, independent of git.
High-risk/final integrated review is scheduled by the lead, not an automatic five-reviewer approval chain for every card.
Keep tests/budgets/evidence, disjoint file ownership, frozen consumer contracts during an edit and meaningful dependency order.
Checkpoint compactly for recovery, then continue into the next ready work. Ask Cee only for actual decisions/access.


Dependency labels such as "M0 done" mean the required technical inputs for that task exist. Unavailable cloud/hardware
evidence remains pending; do not claim the milestone fully verified, but do not stop unrelated local development.
Review-lens lists are menus selected by the lead for risk/final review, not mandatory per-card agent launches.
