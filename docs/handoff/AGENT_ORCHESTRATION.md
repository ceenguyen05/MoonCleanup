# Agent orchestration — how the Fable team builds Moon Cleanup

Audience: the Claude Fable 5.2 **lead/orchestrator** session (and Cee).
Companion docs: [module-boundaries.md](../architecture/module-boundaries.md) (ownership map — canonical) · [WORKFLOW.md](WORKFLOW.md) (git hand-off) · [FABLE_KICKOFF.md](FABLE_KICKOFF.md) · [../STATUS.md](../STATUS.md) · [Claude Code formats research](../research/tech/claude-code-formats.md).

## 1. Operating model

- The **main Fable session is the LEAD**. It plans each wave, writes self-contained briefs, launches specialist subagents **in parallel** with the `Agent` tool (`subagent_type` = a file name in `.claude/agents/`), waits for their completion notifications, runs review gates, integrates, updates status, and hands Cee a commit plan.
- The lead **does not do specialist work** when a specialist exists for it. It may make small glue fixes during integration only through the `integrator`.
- Subagents start with **no context**: everything they need is in the brief + the files the brief tells them to read.
- Subagents run in the background by default; their results arrive as notifications. Never act on a result you have not received. Never launch a second agent on files another live agent owns.
- **Wave brief file first:** before launching any agent of a wave, the lead writes the assembled briefs, the owned-file table and the run log to `docs/handoff/waves/<M#-W#>.md` (via `/plan-wave`). `/launch-wave`, `/review`, `/commit-plan` and the reviewer agents all read that file. For the very first wave (`M0-W0`) `/plan-wave` skips its "previous wave done" check.
- **Permission mode:** background subagents cannot answer permission prompts themselves; prompts (for example `pnpm install`, web fetches) surface in the main session for Cee. Start the lead with `--permission-mode acceptEdits` (or auto, if Cee prefers) — see [FABLE_KICKOFF.md §1](FABLE_KICKOFF.md#1-permission-mode-read-before-pasting). Git is never allowed.

```mermaid
flowchart LR
  P[/plan-wave/] --> L[/launch-wave/] --> R[agents report] --> V[/review taskID/ per task]
  V -->|rejected| F[owner fixes] --> V
  V -->|all approved| I[/integrate/: verify, bot-test, visual-check, perf-check]
  I -->|fail| F
  I -->|pass| S[/status/ + /update-docs/] --> C[/commit-plan/] --> Cee[Cee commits] --> P
```

## 2. Team roster

`model`/`effort` are set in each agent file. Fable = `fable`; cheaper mechanical roles use `sonnet` to protect usage limits.

| Role (`.claude/agents/<name>.md`) | Responsibility | Owns (see module-boundaries §3) | Model / effort |
| --- | --- | --- | --- |
| lead-orchestrator | Guide for the main session (the kickoff paste in a plain session is canonical; `claude --agent lead-orchestrator` is an equivalent option) | STATUS, ROADMAP, OPEN_QUESTIONS, milestone structure, wave briefs | fable / max |
| contracts-architect | Shared types, protocol catalog, schemas, event catalog, interfaces; versioning | `packages/shared/**` | fable / xhigh |
| game-designer | GDD, naming bible, economy tables, balance-sim | `packages/game-data/**`, `tools/balance-sim/**`, design docs | fable / high |
| rendering-engineer | Renderer, backend tiers, frame orchestration, LOD/culling/instancing, presets, dynamic res | `apps/client/src/render/**` | fable / xhigh |
| terrain-dust-engineer | Plot grid, terrain bake + CDLOD, dust ledger, stroke replay, server dust state | `packages/world/**`, `apps/client/src/terrain/**`, `apps/server/src/world/**`, `tools/terrain-bake/**`, `assets/terrain/**` | fable / xhigh |
| technical-artist | Materials, lighting rig, sky, post look, VFX, asset pipeline | `apps/client/src/visuals/**`, `tools/asset-pipeline/**`, `assets/models|textures/**`, `apps/client/public/assets/**` | fable / high |
| animation-engineer | Skeletal pipeline, blend trees, procedural IK/bounce, machine motion | `apps/client/src/animation/**`, `assets/animations/**` | fable / high |
| ui-ux-motion-designer | HUD, menus, shop, Promotions Board, Survey Globe UI, tokens, motion, a11y | `apps/client/src/ui/**`, `assets/ui/**` | fable / high |
| audio-engineer | Audio graph, cues, music, helmet muffle | `apps/client/src/audio/**`, `assets/audio/**` | sonnet / high |
| gameplay-systems-engineer | Shared sim (movement, tools, vehicles, robots, economy), input, camera feel, server sim driver | `packages/sim/**`, `apps/client/src/gameplay/**`, `apps/server/src/sim/**` | fable / xhigh |
| netcode-engineer | Codecs, Colyseus rooms, prediction/reconciliation, interpolation, reconnect/wake-up | `packages/protocol/**`, `apps/client/src/net/**`, `apps/server/src/net/**` | fable / xhigh |
| backend-data-engineer | DB schema/migrations, REST API, auth, persistence | `packages/db/**`, `apps/server/src/api/**`, `apps/server/src/persistence/**` | fable / high |
| devops-engineer | Tooling configs, CI, Vercel/Render configs, env, installs between waves, ops logging | `packages/config/**`, `.github/**`, root configs, `apps/server/src/ops/**`, `apps/client/public/hub/**` | sonnet / high |
| qa-test-engineer | Test infra, netsim, 16-bot load tests, e2e, screenshot harness | `tools/bots|netsim|screenshots/**`, `tests/e2e/**` | sonnet / high |
| performance-profiler | Perf HUD, GPU timing, benchmarks, budgets tracking | `apps/client/src/debug/**`, `tools/perf/**` | fable / high |
| integrator | Composition roots, wiring, interface mismatches, gate runs | `apps/client/src/app/**`, `apps/server/src/app/**`, integration reports | fable / high |
| code-reviewer | Correctness, boundaries, tests, readability | review files only | fable / high |
| visual-qa-reviewer | Screenshots vs visual-target.md checklist; crisp UI | `docs/visual-reviews/**`, review files | fable / high |
| performance-reviewer | Frame-time, memory, draw calls, download size, server tick, bandwidth | review files only | fable / high |
| netcode-security-reviewer | Authority, validation, auth, rate limits, protocol compat, secrets | review files only | fable / xhigh |
| balance-reviewer | Pacing vs targets via balance-sim; economy exploits | review files only | sonnet / high |
| docs-keeper | Doc hygiene, indexes, research/licensing ledgers, consistency checks | see ownership map | sonnet / medium |

## 3. Ownership rules

1. **Two agents never edit the same path in the same wave.** The lead checks every brief's "Owned files" list against the others before launching.
2. Ownership comes from module-boundaries §3. A brief may *narrow* ownership (e.g. only `apps/client/src/ui/hud/**`) but never widen it into another role's path.
3. **Shared contracts (`packages/shared`) change only through the contracts-architect and only between waves** (§9).
4. **Shared root files** (root `package.json`, lockfile, `turbo.json`, `tsconfig.base.json`, CI, `vercel.json`, `render.yaml`) change only between waves, by devops-engineer (inside a wave only where a card lists them as the devops task's owned files).
5. **Dependencies are installed only between waves** by devops-engineer, from requests in agent reports, each with an ADR. Agents never run `pnpm add`/`install` during a parallel wave (single lockfile writer). **Exception (defined once, here): M0-W0-T02 (`devops-engineer`) performs the FIRST install; after that, installs happen only between waves by `devops-engineer`.** The W0 install task of each later milestone is that between-waves install (it runs first and alone in the stage; its card says `Installer: yes`). No other agent installs, and prototype folders get isolated installs from `devops-engineer` too (see milestones README §7).
6. Need something outside your paths? Stop and report it (§10). Do not "just fix it".

## 4. Parallelism rules

- **Default: at most 6 implementation tasks per wave, never more than 3 running at once (one stage)**, plus reviewers launched after implementation (up to 5 at once).
  Why 5: (a) the ownership map splits naturally into ~5 independent areas per milestone stage; (b) the lead must read every report and diff — beyond ~5 integration quality drops; (c) **usage limits are real** — the planning session hit both the 5-hour and the weekly limit with 17 concurrent agents within minutes; (d) builds/tests of parallel agents contend for CPU on Cee's machine.
- **Safe to parallelize:** separate packages/folders, asset work, docs, tests in their own folders, prototype approaches in separate `prototypes/<topic>/<approach>/` folders.
- **Must be sequential:** Wave 0 contracts; dependency installs (never overlapping a contracts or code agent — the install task runs first and alone); DB schema/migration changes; integration; anything touching shared root files; release steps.
- Each brief gives a **port offset N** (client `5173+N`, server `2567+N`) so parallel dev servers never collide.
- If an agent stops on a rate limit, **resume it with `SendMessage`** (its context is saved) instead of launching a duplicate.

## 5. Wave structure (every milestone)

| Wave | Who | Content | Ends with |
| --- | --- | --- | --- |
| W0 — installs, then contracts | devops-engineer install task first and alone; then contracts-architect alone (devops config work on disjoint files may continue in parallel only if it does not touch `node_modules`) | Dependency installs for the milestone, then new/changed types, protocol messages, schemas, interfaces, event names, config schemas | code-reviewer + netcode-security-reviewer sign-off; `/verify` green |
| W1…Wn — specialists | ≤6 specialist tasks on disjoint paths (≤3 at once per stage) | Feature work against frozen contracts | per-task reviews → integration task |
| Integration (last task of each wave) | integrator | `/integrate`: wire modules, fix interface mismatches (in composition roots only; anything else goes back to owners), run gates | integration report; lead opens next wave only after PASS |
| Review gate | required reviewers | see §7 | REVIEW_LOG entry |

Task IDs: `M<milestone>-W<wave>-T<nn>` (e.g. `M1-W2-T03`). Task cards live in `docs/milestones/M*.md`.

## 6. Brief template (copy exactly; fill every field)

```markdown
# Brief: <taskID> — <goal in one line>
Role: <agent name>          Port offset: <N>          Wave: <M#-W#>   Stage: <M#-S#>   Installer: <yes|no>
## Goal
<what must exist when you finish, from the player's/system's point of view>
## Owned files (you may create/edit ONLY these)
- <paths/globs>
## Read first (only these)
- CLAUDE.md (auto-loaded) · docs/architecture/module-boundaries.md §<n>
- <specific docs/sections> · <contract files in packages/shared>
## Inputs / contracts you depend on (frozen this wave)
- <files + versions>
## Constraints
- No git commands of any kind. No dependency installs unless this brief says `Installer: yes` (then only the installs its card lists); otherwise request dependencies in your report.
- No secrets. Original names only (docs/design/naming-bible.md). No reference-game assets.
- Quality bar: docs/design/visual-target.md items <IDs>; performance budgets: docs/architecture/performance-budgets.md §<n>.
- Do not edit files outside "Owned files". Contract change needed → propose it in your report and continue with a local adapter.
## Acceptance criteria (testable)
- [ ] <criterion> — verified by <test/command/screenshot>
## Visual acceptance (if any)
- [ ] <VT-ID> — screenshot <scene/preset/tier>
## Required reviewers
<code-reviewer, …>
## Report
Write docs/agent-reports/<taskID>-<role>.md using the template in docs/agent-reports/README.md (create it at the start with Status: in-progress and a Done so far / Next list),
set your task row in docs/milestones/<M#>.md to `in-review`, then reply with ≤150 words: status, files, blockers.
```

## 7. Report protocol and review gates

- Every agent ends by writing `docs/agent-reports/<taskID>-<role>.md` (template in [agent-reports/README.md](../agent-reports/README.md)): what changed, files touched, tests run, screenshots, open issues, requested deps/contract changes, suggested Conventional Commit message — and sets its own task row to `in-review`.
- **No task is done without sign-off from a reviewer that did not write it.** Required reviewers by change type:

| Change touches | Required reviewers |
| --- | --- |
| Any code | code-reviewer |
| Anything visible (render, visuals, terrain, animation, UI) | + visual-qa-reviewer |
| Render/terrain/dust/sim hot paths, assets, bundle size, server tick | + performance-reviewer |
| protocol, server, API, auth, persistence, DB, contracts | + netcode-security-reviewer |
| game-data, economy/sim rules, progression | + balance-reviewer |

- Reviewers write `docs/agent-reports/<taskID>-review-<reviewer>.md` with **APPROVED** or **CHANGES REQUESTED** and specific, file:line fixes. The lead sets the task `changes-requested`, re-briefs the owner with the findings, then re-runs only the rejecting reviewer. **Max 2 fix cycles**, then the lead escalates (re-scope, split the task, or log an OPEN_QUESTION).
- Visual reviews require native-resolution screenshots from `/visual-check` saved in `docs/visual-reviews/<milestone>/`.

## 8. Integration protocol (`/integrate`)

1. Confirm every task in the wave is `approved`.
2. Integrator wires new modules in the composition roots, resolves interface mismatches (only in `app/` folders; anything else → back to owner).
3. Run `/verify` (lint, typecheck, unit tests, build), then `/bot-test` (16 headless bots, netsim latency 120 ms ± 30, 1% loss, 10 min), `/visual-check` (milestone scene list), `/perf-check` (Tier A/B budgets).
4. Write `docs/agent-reports/<M#-W#>-integration.md` with PASS/FAIL per gate and numbers.
5. Only after PASS: lead runs `/status`, `/update-docs`, `/commit-plan`, appends to `docs/REVIEW_LOG.md`, and plans the next wave.

## 9. Contract change process

Proposals collect in agent reports → lead batches them → contracts-architect applies them in the next W0 (or a mini "contracts wave" between waves), bumps `PROTOCOL_VERSION`/`SAVE_FORMAT_VERSION` when breaking, updates module-boundaries §2 and lists every consumer to update. Consumers update in the following wave.

## 10. Competing-approach rule

For the riskiest problems — **dust simulation, terrain LOD, netcode sync, cleaning visuals** (and the three.js-vs-Babylon fallback if the render spike fails) — the lead may launch 2–3 agents to prototype alternatives in `prototypes/<topic>/<approach>/` with an identical benchmark brief (same scene, seed, camera path, tiers, measurements). performance-reviewer (+ visual-qa-reviewer for visuals) writes `prototypes/<topic>/BENCHMARK.md`; the lead picks the winner, records an ADR, and deletes/archives losers. Prototype code is never imported by production code. Planned contests: dust (P1/P2/P3 in world-and-dust-simulation.md) in M1-W1; terrain LOD only if CDLOD misses budget.

## 11. Escalation

An agent that hits a blocker, a missing contract, an ambiguous requirement or a decision outside its brief **stops that thread, finishes what it safely can, and reports** under "Open issues". The lead decides, or — if it is Cee's call (money, naming, scope, licensing, public URLs) — logs it in `docs/OPEN_QUESTIONS.md` with a recommended default and proceeds with the default where safe.

## 12. Git and commit hand-off

**No agent runs git — ever** (including `git init/add/commit/branch/checkout/switch/stash/reset/worktree/remote/push/pull/tag`). Never use `isolation: worktree`, `EnterWorktree`, `/batch` or agent teams. `.claude/settings.json` denies these as a safety net; it is not a substitute for following the rule. At the end of each wave the lead runs `/commit-plan` → `docs/handoff/commit-plans/<M#-W#>.md` (ordered groups: contracts → packages → apps → tools → assets → docs; exact paths; Conventional Commit messages). Cee commits per [WORKFLOW.md](WORKFLOW.md) and tells the lead; only then are tasks set `done`.

## 13. Context hygiene and resuming

- Agents read only the docs named in their brief (CLAUDE.md is auto-loaded and short on purpose).
- `docs/STATUS.md` is the single source of truth for where the build stands: current milestone/wave, task states, gates, open blockers, last commit plan. Update it via `/status` after every wave and before ending any session.
- **Canonical reading order for any lead session** (the kickoff references this list): CLAUDE.md (auto-loaded) → docs/STATUS.md → this file (first session, or when unsure) → the current milestone file (§1–§5 and the cards for the current stage) → docs/architecture/module-boundaries.md (when briefing) → the latest integration report → open OPEN_QUESTIONS → in-progress agent reports (§14).
- Large research files are evidence, not reading assignments; briefs cite the exact section.

## 14. Staged sessions — working within usage limits (MANDATORY)

Cee's plan has a rolling **5-hour usage window** (and a weekly cap). The planning session hit both limits; expect every
build session to end on a limit. The build is therefore organized so that **a cut-off never loses more than one task**.

**Unit of work = a Stage.** A stage is what one lead session should finish inside one usage window:
- 1 wave **or** half a wave (split large waves into stage A/B), **≤ 3 implementation agents** + their reviewers, 1 integration pass.
- Each roadmap task is sized so one agent finishes it in **≤ ~60–90 min of agent time** (if bigger, split it before launch).
- Stages are listed in each milestone file (`Stage M1-S3 = M1-W1 tasks T01–T02`). The lead never starts a stage it can't plausibly finish; if little budget remains, it does housekeeping (`/status`, `/commit-plan`) instead.

**Checkpoint continuously (not just at wave end):**
1. The moment an agent report arrives, the lead updates that task row in the milestone file and appends one line to `docs/STATUS.md` → "Log". STATUS.md is always current enough to resume from.
2. Agents write their report file **incrementally**: create `docs/agent-reports/<taskID>-<role>.md` at start with status `in-progress` and a running "Done so far / Next" list, updated after each meaningful sub-step. A cut-off agent therefore leaves a readable trail.
3. Prefer many small, complete files over one huge edit; never leave a file half-rewritten (write new content to the final path in one operation).
4. After each completed wave, `/commit-plan` immediately — so Cee can commit finished work even if the next stage dies. **Cee commits (and confirms to the lead) before the next wave's first stage starts**; the milestone owner-gate table names that gate (for M0-W0 it is Gate G0b, after M0-S2). Tasks become `done` only after that confirmation.

**When a limit hits mid-stage:**
- Next session: read CLAUDE.md → STATUS.md → current milestone file → in-progress agent reports.
- For each `in-progress` task: if the agent's transcript is still resumable, **resume it with `SendMessage`** ("usage reset — continue from your report's Next list"). If not, launch a fresh agent with the original brief **plus** "Resume from docs/agent-reports/<taskID>-<role>.md; verify existing files before continuing". Never launch a duplicate on files a live agent owns.
- Run `/verify` before continuing to catch half-finished edits.

**Efficiency rules:** cheap models (`sonnet`) for mechanical roles; briefs cite exact doc sections instead of whole files; reviewers run only the checks their change type needs; no exploratory research in build sessions (log an OPEN_QUESTION instead); keep CLAUDE.md short; integrate once per wave, not per task.

**Kickoff line for every new session (Cee pastes):** *"Resume as lead. Read CLAUDE.md, docs/STATUS.md and the current milestone file, recover any in-progress tasks per AGENT_ORCHESTRATION §14, then run the next stage only."*

## 15. Slash commands (in `.claude/commands/`)

| Command | Purpose |
| --- | --- |
| `/plan-wave [milestone]` | Draft the next wave: tasks, owners, file sets (checked disjoint), briefs → `docs/handoff/waves/<M#-W#>.md` (must run before `/launch-wave`; skips the "previous wave done" check for M0-W0) |
| `/launch-wave [M#-W#]` | Launch the wave's briefs as parallel subagents (≤5), set rows `in-progress` |
| `/integrate [M#-W#]` | Integrator pass (§8) |
| `/review <taskID>` | Run the required reviewers for a task (§7) in parallel |
| `/verify` | lint, typecheck, test, build (turbo) |
| `/visual-check [milestone]` | Capture screenshots, compare with visual-target.md, report gaps |
| `/perf-check` | Frame-time/memory/draw-call/download/server-tick budgets vs performance-budgets.md |
| `/balance-check` | Run balance-sim; compare pacing with progression-and-economy.md targets |
| `/bot-test` | 16-player headless load test with network conditioning |
| `/status` | Rewrite docs/STATUS.md from milestone files + reports |
| `/update-docs` | docs-keeper pass: indexes, ADR index, cross-links, consistency grep |
| `/release-checklist` | Pre-promotion checks for `release` |
| `/commit-plan` | Changed files grouped into suggested Conventional Commits for Cee |
