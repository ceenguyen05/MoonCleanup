# Moon Cleanup: documentation index

Planning baseline, 2026-11-12. The repo-level [README](../README.md) and [CLAUDE.md](../CLAUDE.md) explain the project and the agent rules; this page lists every doc folder and file. Owner: docs-keeper (see [module-boundaries.md §3](architecture/module-boundaries.md)). `/update-docs` keeps it current.

## Start here

| File | What it is |
| --- | --- |
| [STATUS.md](STATUS.md) | Single source of truth for current progress (rewritten by `/status`) |
| [ROADMAP.md](ROADMAP.md) | Milestone roadmap and key decisions |
| [OPEN_QUESTIONS.md](OPEN_QUESTIONS.md) | Owner decisions and open questions (Q1-Q23) |
| [SETUP_CHECKLIST.md](SETUP_CHECKLIST.md) | Cee's account, hosting and secret setup steps |
| [REVIEW_LOG.md](REVIEW_LOG.md) | Review verdict log |
| [ASSET_LICENSES.md](ASSET_LICENSES.md) | Asset and data licence ledger (one row per third-party asset) |

## [design/](design/)

| File | What it is |
| --- | --- |
| [GDD.md](design/GDD.md) | Game design document |
| [naming-bible.md](design/naming-bible.md) | Canonical in-game names |
| [progression-and-economy.md](design/progression-and-economy.md) | Tables and pacing targets |
| [scope-tiers.md](design/scope-tiers.md) | MVP / v1.0 scope tiers |
| [art-direction.md](design/art-direction.md) | Look, materials, luma targets, asset production plan (§13) |
| [visual-target.md](design/visual-target.md) | Acceptance bars (VT items), comparators, capture rules |
| [audio-direction.md](design/audio-direction.md) | Audio direction |
| [animation-spec.md](design/animation-spec.md) | Clips, rigs, blend rules, animation budgets |
| [game-feel-and-controls.md](design/game-feel-and-controls.md) | Movement, camera, input, feel numbers (canonical for landing thresholds) |
| [ui-screens-and-flows.md](design/ui-screens-and-flows.md) | Every DOM screen, HUD widget, flow and UI state |

## [architecture/](architecture/)

| File | What it is |
| --- | --- |
| [tech-stack.md](architecture/tech-stack.md) | Canonical stack and versions |
| [system-overview.md](architecture/system-overview.md) | System diagram, boot and cold-start sequence |
| [module-boundaries.md](architecture/module-boundaries.md) | Package map, contracts, file ownership (canonical) |
| [rendering-pipeline.md](architecture/rendering-pipeline.md) | Renderer; §14 is the canonical quality preset table |
| [world-and-dust-simulation.md](architecture/world-and-dust-simulation.md) | Plot grid, terrain, dust model, GPU side |
| [netcode.md](architecture/netcode.md) | Protocol, rates, interest, server CPU budget |
| [data-model.md](architecture/data-model.md) | Database schema and save format |
| [security.md](architecture/security.md) | Auth, validation, rate limits, secrets |
| [environments.md](architecture/environments.md) | Local, staging and production; env variables |
| [performance-budgets.md](architecture/performance-budgets.md) | Frame, memory, download and server budgets |

## [adr/](adr/)

[Index and template](adr/README.md). 28 Architecture Decision Records (ADR-0001 to ADR-0028), append-only. Recent: [0027 3D art production path](adr/0027-3d-art-production-path.md), [0028 Dependency policy](adr/0028-dependency-policy.md).

## [milestones/](milestones/)

| File | What it is |
| --- | --- |
| [README.md](milestones/README.md) | Stage plan, task-card rules, gates |
| [M0-foundation.md](milestones/M0-foundation.md) | Foundation, contracts, spikes |
| [M1-mvp.md](milestones/M1-mvp.md) | MVP |
| [M2-v1-parity.md](milestones/M2-v1-parity.md) | v1.0 parity |
| [M3-polish-launch.md](milestones/M3-polish-launch.md) | Polish and launch |
| [M4-post-launch.md](milestones/M4-post-launch.md) | Post-launch |

## [handoff/](handoff/)

| File | What it is |
| --- | --- |
| [FABLE_KICKOFF.md](handoff/FABLE_KICKOFF.md) | Kickoff prompt for the lead session |
| [AGENT_ORCHESTRATION.md](handoff/AGENT_ORCHESTRATION.md) | Which agents run, in what order, with what limits |
| [WORKFLOW.md](handoff/WORKFLOW.md) | Wave workflow, reviews, gates |
| [waves/](handoff/waves/README.md) | Wave plans (`<M#-W#>.md`) written by `/plan-wave` |
| [commit-plans/](handoff/commit-plans/README.md) | Commit plans for Cee (`/commit-plan`) |

## [research/](research/README.md)

| File | What it is |
| --- | --- |
| [asset-and-data-licensing.md](research/asset-and-data-licensing.md) | Licence rules and sources |
| [browser-feasibility.md](research/browser-feasibility.md) | Hardware tiers, budgets evidence |
| [mechanics-parity-matrix.md](research/mechanics-parity-matrix.md) | Reference-game mechanics parity |
| [moon-sweepers-mechanics.md](research/moon-sweepers-mechanics.md) | Reference mechanics analysis |
| [moon-sweepers-reception.md](research/moon-sweepers-reception.md) | Reference reception analysis |
| [roblox-references.md](research/roblox-references.md) | Platform references |
| [visual-analysis.md](research/visual-analysis.md) | Reference visual analysis |
| [tech/](research/tech/) | Technology cases: [claude-code-formats](research/tech/claude-code-formats.md), [data-auth-observability](research/tech/data-auth-observability.md), [netcode-case-colyseus](research/tech/netcode-case-colyseus.md), [netcode-case-raw-websocket](research/tech/netcode-case-raw-websocket.md), [netcode-case-webrtc-webtransport](research/tech/netcode-case-webrtc-webtransport.md), [platform-limits](research/tech/platform-limits.md), [rendering-case-babylonjs](research/tech/rendering-case-babylonjs.md), [rendering-case-playcanvas](research/tech/rendering-case-playcanvas.md), [rendering-case-threejs](research/tech/rendering-case-threejs.md), [terrain-and-dust-techniques](research/tech/terrain-and-dust-techniques.md), [tooling-and-libraries](research/tech/tooling-and-libraries.md) |

## [agent-reports/](agent-reports/README.md)

One file per agent run (planning reviews, fix passes, routing reports, wave reports). Each agent writes only its own files.

## [visual-reviews/](visual-reviews/README.md)

Milestone screenshots (native-resolution PNG) and the generated capture `index.md`, owned by visual-qa-reviewer.

## Outside `docs/`

| Path | What it is |
| --- | --- |
| [../.claude/agents/](../.claude/agents/) | Agent role definitions |
| [../.claude/commands/](../.claude/commands/) | Slash commands (`/verify`, `/review`, `/plan-wave`, `/update-docs` ...) |
| `../apps/`, `../packages/`, `../tools/`, `../tests/`, `../prototypes/`, `../assets/` | Code and assets; each has its own README |
