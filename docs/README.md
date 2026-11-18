# Documentation router

> **PLAN REVISION 2026-11-18 (owner): BUILD FIRST, VERIFY AT THE END.**
> Keep the plan (M0-M4). Solo comes first for graphics, feel and fps; multiplayer, server and database stay in scope and keep being built, but never ahead of or at the cost of solo. Build out the whole game without stopping to verify, review, look-check or perf-test each task. Per task: write the code, make it compile (typecheck the touched package) and move on.
> Verification, bug fixing, perf, visual review and polish happen in ONE pass at the end, once a complete game is running. After that pass: revise, enhance, improve. The only standing rule is that `pnpm verify` (format check, lint, typecheck, tests with retries, build) should pass before Cee pushes to Render/Vercel.
> **Not per-task gates (end-of-build pass only):** `pnpm verify` runs, golden-hash/determinism lanes, bot/soak/netsim runs, perf and quiet-machine captures, per-wave visual gates (V-M1a/b/c), comparator/VT scoring, real-GPU look-checks, reviews and `/release-checklist`.
> **Scope decisions (owner MCQ 2026-11-18):** (1) CDLOD terrain and WebGL2 parity stay in scope, as before. (2) Assets: export plain GLBs and use them; KTX2/meshopt/LOD optimisation and the ASSET_LICENSES gate are an end-of-build pass, not a blocker. (3) One default look; quality presets and dynamic-resolution work wait until the end. (4) Golden-hash tests are not blockers: re-baseline or delete a hash test when it gets in the way (the sim stays deterministic). (5) Agents run lean: 4 total (3 regular + 1 premium), a short report only for big changes, STATUS updated per milestone, no per-task evidence folders, no GPU-lock ceremony.
> Wherever an older doc says a gate, exit criterion (E3, E5, E9, E14...), golden, soak, review or look-check is "required" before moving on, read it as deferred to the end-of-build pass. Timing and allocation tests stay loose enough not to flake.

Do not read this directory end to end. Start with [STATUS](STATUS.md); use only the row needed for the current task.

| Task | Source |
| --- | --- |
| Resume / dispatch | [MODEL_POLICY](handoff/MODEL_POLICY.md), [build procedure](handoff/WORKFLOW.md), [kickoff](handoff/FABLE_KICKOFF.md) |
| Current brief / acceptance | [waves](handoff/waves/README.md), [milestones](milestones/README.md), [reports](agent-reports/README.md) |
| Requested game / allowed names | [REFERENCE_TARGET](design/REFERENCE_TARGET.md), [catalog](design/naming-bible.md), [scope](design/scope-tiers.md) |
| Mechanics / economy | [GDD](design/GDD.md), [progression](design/progression-and-economy.md), [parity](research/mechanics-parity-matrix.md) |
| Controls / animation / UI / audio | [feel](design/game-feel-and-controls.md), [animation](design/animation-spec.md), [UI](design/ui-screens-and-flows.md), [audio](design/audio-direction.md) |
| Look / visual acceptance | [art](design/art-direction.md), [visual target](design/visual-target.md); apply REFERENCE_TARGET RF/VT overrides |
| Ownership / versions | [module boundaries](architecture/module-boundaries.md), [stack](architecture/tech-stack.md), [ADRs](adr/README.md) |
| Rendering / world / budgets | [render pipeline](architecture/rendering-pipeline.md), [world/dust](architecture/world-and-dust-simulation.md), [budgets](architecture/performance-budgets.md) |
| Network / data / security / env | [netcode](architecture/netcode.md), [data](architecture/data-model.md), [security](architecture/security.md), [env](architecture/environments.md) |
| Setup / owner handoff | [setup](SETUP_CHECKLIST.md), [questions](OPEN_QUESTIONS.md), [workflow](handoff/WORKFLOW.md), [deadline](handoff/DEADLINE_PLAN.md) |
| Local play / hosting connections | [localhost and tests](../README.md#run-on-localhost), [Neon → Render → Vercel guide](HOSTING_GUIDE.md) (read when setting up, not every resume) |
| Licensing / evidence | [asset ledger](ASSET_LICENSES.md), [research index](research/README.md), [review log](REVIEW_LOG.md) |

Detailed specs, technical research and vendored r187 API docs remain available by exact section/API lookup. Tests,
CI, bots, netsim, perf, screenshot and balance tools remain. Superseded planning transcripts/secondary Roblox research
are removed; current decisions and active findings live at the paths above. Never treat a planning file as evidence a feature works.
