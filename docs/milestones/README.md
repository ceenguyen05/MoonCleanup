# docs/milestones — how milestone files work

Owner: **lead** (structure). Agents edit **only their own task row** in the status table.
Related: [../ROADMAP.md](../ROADMAP.md) · [AGENT_ORCHESTRATION.md](../handoff/AGENT_ORCHESTRATION.md) (§5 waves, §6 brief template, §7 review gates, §14 staged sessions) · [WORKFLOW.md §5](../handoff/WORKFLOW.md#5-task-status-lifecycle) · [module-boundaries.md §3](../architecture/module-boundaries.md#3-file-ownership-map) (ownership, canonical).

## 1. Files

| File | Milestone | Version tag | Detail level |
| --- | --- | --- | --- |
| [M0-foundation.md](M0-foundation.md) | M0 Foundation | `v0.1.0` | Full task cards (ready-to-paste briefs) |
| [M1-mvp.md](M1-mvp.md) | M1 MVP "Boreal Pilot Area" | `v0.2.0` | Full task cards |
| [M2-v1-parity.md](M2-v1-parity.md) | M2 v1.0 mechanics parity | `v1.0.0` | Compact task cards |
| [M3-polish-launch.md](M3-polish-launch.md) | M3 Polish & launch | `v1.1.0` (proposed) | Compact task cards |
| [M4-post-launch.md](M4-post-launch.md) | M4 Post-launch backlog | — | Themes + candidate tasks (not scheduled) |

## 2. Anatomy of a milestone file

1. **Goal, exit criteria, version tag.**
2. **Stage plan** — every wave is split into **stages** of ≤ 3 implementation agents, each sized to one 5-hour usage window (AGENT_ORCHESTRATION §14). Stages are numbered globally per milestone: `M1-S1`, `M1-S2`, …  A fresh lead session runs **one stage** and stops.
3. **Owner gates (Cee)** — manual steps only Cee can do (commits, dashboards, playtests). Not agent tasks; they block the next stage.
4. **Status table** — one line per task. This is the only place task status lives.
5. **Mermaid DAG** — task-level for M0/M1, wave-level for M2/M3.
6. **Task cards** — one section per task. The lead turns a card into a brief by copying it into the [§6 brief template](../handoff/AGENT_ORCHESTRATION.md#6-brief-template-copy-exactly-fill-every-field) in `docs/handoff/waves/<M#-W#>.md` (`/plan-wave`). **That file must exist before any agent of the wave is launched** — `/review`, `/launch-wave`, `/commit-plan` and the reviewers read it.

## 3. Task IDs, waves and stages

- Task ID: `M<milestone>-W<wave>-T<nn>` (e.g. `M1-W2-T03`). IDs are never reused; a split task becomes `T03a`/`T03b`.
- **W0 of every milestone is installs-then-contracts**: `devops-engineer` runs the milestone's install task **first and alone** (all installs for the milestone happen here; M0-W0-T02 performs the very first install), then `contracts-architect` (alone on `packages/shared/**`) launches when it reports. Installs and contracts agents never run at the same time. Installs outside W0 happen only between waves, by `devops-engineer`, on the lead's request.
- **W1…Wn**: ≤ 5 implementation specialists per wave on disjoint paths; ≤ 3 per stage.
- **The integrator's task runs last in every wave** (`/integrate`; its ID is `T05`/`T06`, and a task added later takes the next free number, for example `M0-W3-T07`, but still runs before the integrator — the stage plan and Depends column are authoritative, not ID order): wiring in `apps/*/src/app/**` only, gates, integration report. The wave's **review gate** is the set of per-task reviews plus the integration gates; the lead appends the result to `docs/REVIEW_LOG.md`.
- A task depending on another task in the same wave is placed in a later stage (or launched only after that task reports, noted in the card).
- **Contingent tasks** (only run if a revisit trigger fires) are listed with status `todo` and the word *contingent*; if never triggered, the lead sets them `done` with the note "not triggered" in STATUS.md.

## 4. Status values (WORKFLOW.md §5)

`todo` → `in-progress` → `in-review` → (`changes-requested` → `in-review`)* → `approved` → `done`

| Status | Set by | Meaning |
| --- | --- | --- |
| `todo` | lead (when the row is created) | Planned, not started |
| `in-progress` | owning agent (own row only) | Work started; report file created with "Done so far / Next" |
| `in-review` | owning agent (own row only) | Report written; waiting for required reviewers |
| `changes-requested` | lead (from a reviewer verdict) | Reviewer rejected with file:line fixes; max 2 fix cycles, then the lead escalates |
| `approved` | lead | Every required reviewer wrote APPROVED |
| `done` | lead | Wave integration gate PASS **and** Cee confirmed the commit |

## 5. How an agent updates its own row

1. Find the row whose first cell is **your task ID** in the status table.
2. Use an **exact-match single-line edit** of that row. Change **only the Status cell** (and nothing else on the line).
3. If the edit fails because the file changed, re-read the file and retry. **Never rewrite the whole file**, never touch another row, the cards, the DAG or the stage plan.
4. Agents may set only `in-progress` and `in-review`. All other values belong to the lead.

Row format (one line, pipe-separated, no line breaks inside cells):

```
| M1-W2-T03 | M1-S6 | rendering-engineer | Dynamic resolution + presets + warm-up | M1-W0-T05 | 3 | todo |
```

## 6. Standard Definition of Done (every card says "Standard DoD" plus any extras)

1. Every acceptance criterion is ticked in the agent report with its evidence (test name, command output, screenshot path, numbers).
2. Unit tests sit next to the code; `pnpm --filter <package> test` and `/verify` are green for the touched packages. Sim/world/protocol: deterministic tests (fixed seeds, golden vectors).
3. No file outside "Owned files" changed. No git, no installs (the single exception: the W0 install task of each milestone, `Installer: yes` in its card, performed by `devops-engineer`), no secrets, only naming-bible names, no reference-game assets.
4. `docs/agent-reports/<taskID>-<role>.md` is complete (written incrementally per §14) and lists requested dependencies and contract proposals.
5. Row set to `in-review`; every required reviewer APPROVED; the lead sets `approved`.
6. `done` only after the wave's integration report is PASS and Cee confirms the commit.

## 7. Conventions used in the cards

- **Port offset N**: client dev `5173+N`, server `2567+N`, test DB schema suffix `_aN` (module-boundaries §6). Unique within a wave; the integrator uses 9.
- **Required reviewers** follow AGENT_ORCHESTRATION §7: any code → `code-reviewer`; anything visible → + `visual-qa-reviewer`; render/terrain/dust/sim hot paths, assets, bundle size, server tick → + `performance-reviewer`; protocol, server, API, auth, persistence, DB, contracts → + `netcode-security-reviewer`; game-data, economy/sim rules, progression → + `balance-reviewer`.
- **Visual acceptance** cites IDs from [visual-target.md §4](../design/visual-target.md#4-per-milestone-visual-acceptance-checklists) (VT-M0-xx … VT-M3-xx) and moments VM-xx (§3). Screenshots come from `/visual-check` at native resolution into `docs/visual-reviews/<milestone>/`.
- **Barrel rule** (avoids two agents editing one `index.ts` in a wave): every package root `index.ts` re-exports sub-barrels (`./tools/index.js`, …). When two tasks share a package in one wave, the card names which task owns the root barrel; the other edits only its own sub-barrel.
- **Lead-delegated paths**: a few paths have no role in module-boundaries §3 yet (e.g. `docs/vendor/**`, `.claude/hooks/**`, app build configs). Cards that use them say "lead-delegated"; the lead adds them to module-boundaries §3 between waves.
- **Prototype folders** (`prototypes/*/*`) are **not** workspace packages: each has a private `package.json` and an isolated install inside its folder (`pnpm install --ignore-workspace`, run by `devops-engineer` in the milestone's W0 install task) and imports production code by relative path to `packages/*/src/index.ts`. Prototype agents never install.
