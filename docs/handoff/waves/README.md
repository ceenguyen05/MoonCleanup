# docs/handoff/waves

**Written by:** the lead/orchestrator - **Read by:** specialist agents and Cee

One file per wave: `<M#>-<W#>.md` in upper case (for example `M0-W1.md`, matching the milestone cards, the slash commands and the commit-plan names). The wave file is the entry point for everything an agent needs
to start its task in that wave. **The lead writes it with `/plan-wave` before launching any agent of the wave** (including `M0-W0`, where the "previous wave done" check is skipped); `/launch-wave`, `/review`, `/commit-plan` and the reviewers read it, and the lead appends the run log (agent IDs, launch times, review file paths) to it.

## What a wave file contains

- Goal and exit criteria of the wave, and the milestone it belongs to (`docs/milestones/<milestone>.md`).
- Task table: task ID, owning role, owned paths (from `docs/architecture/module-boundaries.md` section 3), dependencies, status.
- Per-agent briefs: scope, contracts to consume, files they may touch, port offset `N` (client `5173+N`, server `2567+N`), definition of done.
- Gates: which of `/verify`, `/bot-test`, `/visual-check`, `/perf-check` must pass before the integrator signs off.
- Known risks and contract-change proposals batched from the previous wave.

## Rules

- One owner per path; agents edit only their own task row in the milestone file.
- Installs (`pnpm install`, lockfile changes) happen only between waves, by `devops-engineer`. The single exception: M0-W0-T02 (`devops-engineer`) performs the FIRST install; each milestone's W0 install task is the between-waves install and runs first and alone in its stage.
- After the wave, the lead writes the matching plan in [`../commit-plans/`](../commit-plans/).

Empty until the first wave is planned (`M0-W0.md`, written at the start of stage M0-S1).
