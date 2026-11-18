# Clean The Moon!

> **PLAN REVISION 2026-11-18 (owner): BUILD FIRST, VERIFY AT THE END.**
> Keep the plan (M0-M4). Solo comes first for graphics, feel and fps; multiplayer, server and database stay in scope and keep being built, but never ahead of or at the cost of solo. Build out the whole game without stopping to verify, review, look-check or perf-test each task. Per task: write the code, make it compile (typecheck the touched package) and move on.
> Verification, bug fixing, perf, visual review and polish happen in ONE pass at the end, once a complete game is running. After that pass: revise, enhance, improve. The only standing rule is that `pnpm verify` (format check, lint, typecheck, tests with retries, build) should pass before Cee pushes to Render/Vercel.
> **Not per-task gates (end-of-build pass only):** `pnpm verify` runs, golden-hash/determinism lanes, bot/soak/netsim runs, perf and quiet-machine captures, per-wave visual gates (V-M1a/b/c), comparator/VT scoring, real-GPU look-checks, reviews and `/release-checklist`.
> **Scope decisions (owner MCQ 2026-11-18):** (1) CDLOD terrain and WebGL2 parity stay in scope, as before. (2) Assets: export plain GLBs and use them; KTX2/meshopt/LOD optimisation and the ASSET_LICENSES gate are an end-of-build pass, not a blocker. (3) One default look; quality presets and dynamic-resolution work wait until the end. (4) Golden-hash tests are not blockers: re-baseline or delete a hash test when it gets in the way (the sim stays deterministic). (5) Agents run lean: 4 total (3 regular + 1 premium), a short report only for big changes, STATUS updated per milestone, no per-task evidence folders, no GPU-lock ceremony.
> Wherever an older doc says a gate, exit criterion (E3, E5, E9, E14...), golden, soak, review or look-check is "required" before moving on, read it as deferred to the end-of-build pass. Timing and allocation tests stay loose enough not to flake.

Browser co-op lunar-cleaning game, 1–6 players per room (owner cap 2026-11-12; mostly single-player, multiplayer for demos). Exact game title: **Clean The Moon!**
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
**Product priority (owner, 2026-11-13): SOLO PLAY FIRST.** Graphics, animation, fps and game feel in solo play come first and must never lag; multiplayer
is a real, secondary objective that must exist and work, but it may feel laggy on the free Render service and must never cost solo feel
(no solo input delay, no solo frame-time or allocation cost from netcode). Cee plays/demos on the deployed Vercel + Render build; local is development only.
No deadline (owner, 2026-11-16): quality first; never silently reduce core scope.

## Continuous build

Build through M0→M1→M2→M3 without intermediate commit/permission gates; Cee decides when satisfied and ready to commit.
No commit plans, mandatory wave-planning files, per-task review swarm or stop-at-stage behavior. Follow `docs/handoff/WORKFLOW.md`.

## Execution

Sonnet 5.5 leads. Pinned role defaults: `.claude/agents/`; task model/effort choices: MODEL_POLICY.
Run independent ready work in parallel: keep 4 agents running: 3 regular workers (Sonnet 5.5 default, Opus 5.5 where needed, medium) + 1 premium worker (Opus 5.5, High) (owner 2026-11-18). One active session at a time; the owner rotates 4 Pro accounts on session limits (no per-account splits), so checkpoint compactly and always resume from STATUS (owner, 2026-11-15; Fable retired, replaces the Fable-only window); reviewers count toward the regular cap. Lead may set any worker's effort per task from low to High on its own judgment, never above High (owner, 2026-11-15). No nested delegation or reviewer swarm.
One writer per path; brief narrows `docs/architecture/module-boundaries.md` ownership. Lead alone edits task rows/STATUS.
Contracts via contracts-architect; root configs/installs via designated devops writer, sequentially when needed.
Routine project-local dependencies do not each need an ADR; review lifecycle scripts and record changes.
Checkpoint compactly at coherent deliverables/interruptions; continue across milestones. Ask only for actual decisions/access.
Health-check long agents and background tasks periodically (alive, progressing, stale, orphaned servers/stray output); see WORKFLOW.md "Long-running agents".
Missing cloud/tool/hardware inputs block that check, not all independent local development.

## Non-negotiables and checks

- Cee handles all git mutations; no worktrees, `/batch` or agent teams. Read-only status/diff/log allowed. No secrets or paid actions.
- Strict TS/ESM, public barrels, data-driven balance. `shared|sim|world|protocol|game-data`: no DOM/Node/three/Colyseus.
- Deterministic authoritative sim; clients send inputs/intents; render/audio/UI consume state/events. Reuse hot-path buffers.
- three r187 WebGPURenderer + TSL + RenderPipeline; no legacy WebGLRenderer/EffectComposer/GLSL ShaderMaterial/renderAsync.
- Build first, verify at the end (plan revision 2026-11-18): per task just make it compile; verify, bug fixes, perf and polish are one pass after a complete game runs. `pnpm verify` should pass before Cee pushes. No PASS from placeholders or reasoning.
- Source/test defects, authority, backend compatibility and budgets block claiming affected features complete. RF/VT style mapping governs look checks.
- Deployment: main only, one Render service (ADR-0029). `done` means implemented and verified; no commit requirement. Cee alone chooses commit/publication timing.

Need a spec? `docs/README.md` routes by task. Procedure: `docs/handoff/WORKFLOW.md`.
