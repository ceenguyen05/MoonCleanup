# Clean The Moon!

Browser co-op lunar-cleaning game, 1–16 players. Exact game title: **Clean The Moon!**
Keep existing `@moon-cleanup/*`, save IDs and service/repo identifiers stable. Item names are flexible.

## Resume and read narrowly

Read `docs/STATUS.md`, then the active task card and existing recovery notes/findings. No new wave document is required.
Read `docs/handoff/MODEL_POLICY.md` once per session/revision. Before design/visual/gameplay work read
`docs/design/REFERENCE_TARGET.md`. Other specs: only the exact sections needed for the current task.
Use `rg` on named paths first; no repository-wide dumps, repeated transcript reading or research/ADRs/vendor scans by default.
Continue M0 from disk; never restart the scaffold, reinstall unnecessarily or duplicate a live writer.

## Build the requested experience

Closely recreate Moon Sweepers' gameplay, graphics, animation, equipment, automation and world/map progression.
Author our own code/assets/text/branding. Common names/styles are allowed; no forced visual divergence.
REFERENCE_TARGET governs RF/VT acceptance and optional custom progression. Protect playable feel and world detail.
Deadline: **November 17, 2026, America/Chicago**; report risk honestly, never silently reduce core scope.

## Continuous build

Build through M0→M1→M2→M3 without intermediate commit/permission gates; Cee decides when satisfied and ready to commit.
No commit plans, mandatory wave-planning files, per-task review swarm or stop-at-stage behavior. Follow `docs/handoff/WORKFLOW.md`.

## Execution

Sonnet 5.5 leads. Pinned role defaults: `.claude/agents/`; task model/effort choices: MODEL_POLICY.
Default one implementer, max two workers total, one Opus/Fable worker combined. No nested delegation or reviewer swarm.
One writer per path; brief narrows `docs/architecture/module-boundaries.md` ownership. Lead alone edits task rows/STATUS.
Contracts via contracts-architect; root configs/installs via designated devops writer, sequentially when needed.
Routine project-local dependencies do not each need an ADR; review lifecycle scripts and record changes.
Checkpoint compactly at coherent deliverables/interruptions; continue across milestones. Ask only for actual decisions/access.
Missing cloud/tool/hardware inputs block that check, not all independent local development.

## Non-negotiables and checks

- Cee handles all git mutations; no worktrees, `/batch` or agent teams. Read-only status/diff/log allowed. No secrets or paid actions.
- Strict TS/ESM, public barrels, data-driven balance. `shared|sim|world|protocol|game-data`: no DOM/Node/three/Colyseus.
- Deterministic authoritative sim; clients send inputs/intents; render/audio/UI consume state/events. Reuse hot-path buffers.
- three r187 WebGPURenderer + TSL + RenderPipeline; no legacy WebGLRenderer/EffectComposer/GLSL ShaderMaterial/renderAsync.
- Focused meaningful tests during work; one final `pnpm verify` per coherent integration state. Reuse same-state evidence.
- Focused independent review for high-risk work and final integrated review; applicable visual/motion/perf/network/balance checks. No PASS from placeholders or reasoning.
- Source/test defects, authority, backend compatibility and budgets block claiming affected features complete. RF/VT style mapping governs look checks.
- Deployment: main only, one Render service (ADR-0029). `done` means implemented and verified; no commit requirement. Cee alone chooses commit/publication timing.

Need a spec? `docs/README.md` routes by task. Procedure: `docs/handoff/WORKFLOW.md`.
