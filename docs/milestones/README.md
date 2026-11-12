# Development backlog

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
