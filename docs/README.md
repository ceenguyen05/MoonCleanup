# Documentation router

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
| Local play / hosting connections | [localhost and tests](../README.md#run-on-localhost), [Aiven → Render → Vercel guide](HOSTING_GUIDE.md) (read when setting up, not every resume) |
| Licensing / evidence | [asset ledger](ASSET_LICENSES.md), [research index](research/README.md), [review log](REVIEW_LOG.md) |

Detailed specs, technical research and vendored r187 API docs remain available by exact section/API lookup. Tests,
CI, bots, netsim, perf, screenshot and balance tools remain. Superseded planning transcripts/secondary Roblox research
are removed; current decisions and active findings live at the paths above. Never treat a planning file as evidence a feature works.
