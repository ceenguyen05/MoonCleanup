# Fable kickoff — start here

Audience: Cee (what to paste) and the Claude Fable 5.2 lead session (what to do).
Pre-requisite: Cee has finished [SETUP_CHECKLIST.md](../SETUP_CHECKLIST.md) §0–§2 (**Gate G0**: GitHub repo `ceenguyen05/mooncleanup` attached (local folder keeps its name), planning files committed from
[`commit-plans/planning-session.md`](commit-plans/planning-session.md) and pushed, `release` branch created).

## 1. Permission mode (read before pasting)

Start the lead from the repo root with **`claude --model fable --permission-mode acceptEdits`** (or auto mode, if Cee
prefers it). `.claude/settings.json` only *denies* git; it does not allow anything.

- Background subagents cannot answer permission prompts themselves, so prompts for `pnpm install`, `node` runs and web
  fetches (three.js docs, NASA downloads) surface in the **main session**: Cee approves them there.
- Expect **one prompt for T04's edit of `.claude/settings.json`** (the hooks block) in M0-S1.
- Optional, Cee's own choice: add allow rules to `.claude/settings.local.json` (not committed) for `pnpm *`, `node *`
  and `npx playwright *` to cut prompts. **Never allow git.**

## 2. How the lead verifies Gate G0 (read-only; never run anything else)

1. The working directory name ends in `moon-cleanup`.
2. `git rev-parse --abbrev-ref HEAD` prints `main`; `git log -1 --oneline` shows the planning commit; `git status`
   shows a clean tree (or only expected files).
3. Remote and `release` branch cannot be checked by the lead (`git remote` and `git branch` are denied): **ask Cee** to
   confirm "pushed to `origin/main`, `release` exists and is pushed".
If anything is missing, stop and point Cee to SETUP_CHECKLIST §2; do not start M0-S1.

## 3. The first prompt (paste exactly, in a new Claude Code session in the repo root, model Fable 5.2, effort max)

```text
You are the LEAD / ORCHESTRATOR for Moon Cleanup. Follow docs/handoff/AGENT_ORCHESTRATION.md exactly.

Rules you must obey at all times:
- NEVER run git commands that change repository state (add, commit, branch, checkout, switch, stash, reset, worktree,
  push, pull, tag, init, remote…). Never use worktree isolation, /batch or agent teams. Cee does all git; you hand him
  commit plans via /commit-plan. Read-only git (status, diff, log, rev-parse) is allowed.
- You plan, brief, launch specialists (Agent tool, subagent_type = files in .claude/agents/), review, integrate and
  update docs. You do not do specialist work yourself.
- Work in STAGES (AGENT_ORCHESTRATION §14): this session runs ONE stage only (≤3 implementation agents + reviewers +
  integration). Checkpoint docs/STATUS.md after every agent report. If usage runs low, stop launching and do /status
  and /commit-plan.
- Original names only (docs/design/naming-bible.md). No secrets. No dependency installs except the single exception
  below. Visual and performance bars are mandatory.
- Install rule: M0-W0-T02 (devops-engineer) performs the FIRST install; after that, installs happen only between
  waves by devops-engineer.

Do now:
1. Read, in the canonical order (AGENT_ORCHESTRATION §13): CLAUDE.md, docs/STATUS.md,
   docs/handoff/AGENT_ORCHESTRATION.md, docs/milestones/M0-foundation.md (§1–§5 and the task cards for the current
   stage), docs/architecture/module-boundaries.md. Read other docs only when a brief needs them.
2. Verify Gate G0 per docs/handoff/FABLE_KICKOFF.md §2 (read-only commands + ask Cee).
3. Run stage M0-S1: run /plan-wave for M0-W0 FIRST — it must WRITE docs/handoff/waves/M0-W0.md (briefs for T01, T02,
   T04, owned-file table, run log) before anything is launched; /launch-wave, /review and the reviewers read that
   file. Then launch M0-W0-T02 and M0-W0-T04 in parallel; when T02 reports, launch M0-W0-T01. Then /review each task.
4. Update docs/STATUS.md, and report to Cee: what finished, what's blocked, what the next stage is.
```

## 4. Every later session (paste)

```text
Resume as LEAD for Moon Cleanup. Read, in the canonical order (AGENT_ORCHESTRATION §13): CLAUDE.md, docs/STATUS.md
and the current milestone file. Recover any in-progress tasks per AGENT_ORCHESTRATION §14 (resume live agents with
SendMessage; otherwise relaunch from their partial report). Make sure docs/handoff/waves/<M#-W#>.md exists for the
wave (write it with /plan-wave if not). Then run the NEXT STAGE only. Never run git. Checkpoint STATUS.md after every
report; finish with /status (and /commit-plan if a wave completed).
```

After each completed wave, Cee commits per `docs/handoff/commit-plans/<M#-W#>.md` and replies to the lead:
*"M0-W0 committed (PR #n merged)."* The next wave starts only after that reply. Owner gates G0b and G1–G3 are listed
in M0-foundation.md §4.

## 5. Reading order

The canonical reading order lives in [AGENT_ORCHESTRATION.md §13](AGENT_ORCHESTRATION.md#13-context-hygiene-and-resuming)
(CLAUDE.md → STATUS → AGENT_ORCHESTRATION → current milestone file → module-boundaries → only the docs cited by the
current task cards).

## 6. M0 at a glance (one stage = one usage window)

| Stage | Wave | Tasks | Ends with |
| --- | --- | --- | --- |
| **M0-S1** | W0 | T02 devops (configs, **first `pnpm install`**, lockfile) ∥ T04 devops* (git hook + three r187 docs) → T01 contracts-architect (contracts v0, launched when T02 reports) | reviews |
| M0-S2 | W0 | T03 devops (scripts, Vite/esbuild, CI, env keys, bootstrap stubs) → T05 integrator | `/commit-plan M0-W0` → **Gate G0b** (Cee commits M0-W0, checks the hook in a new session) |
| M0-S3 | W1 | T01 rendering (renderer bootstrap) ∥ T02 devops (server ops) ∥ T03 backend (health + db + first migration) | reviews |
| M0-S4 | W1 | T04 netcode (Colyseus on uWS, HelloRoom) ∥ T05 qa (screenshot harness, smoke e2e) → T06 integrator | `/commit-plan M0-W1` → **Gate G1** (Cee: Aiven, Sentry, Render, Vercel; answers Q21 Tier B device) |
| M0-S5 | W2 | T01 perf HUD ∥ T02 render spike bench v0 ∥ T03 netcode spike room | reviews |
| M0-S6 | W2 | T04 bots + netsim ∥ T05 terrain bake spike → T06 integrator | `/commit-plan M0-W2` → **Gate G2** |
| M0-S7 | W3 | T01 run netcode spike on Render Free ∥ T03 look-dev v0 (light/sky/post) ∥ T04 regolith material v0 | reviews |
| M0-S8 | W3 | T07 bench v1 (real material + real height cube) ∥ T05 UI tokens → T02 run render spike on Tier A/B/WebGL2 → T06 integrator (milestone close) | spike verdict ADRs, `/commit-plan M0-W3`, tag `v0.1.0` (Cee) |
| M0-S9 | W4 | *Only if a spike revisit trigger fired* (Babylon or custom-uWS prototype) | ADR |

\* T02 and T04 are both devops-engineer tasks with disjoint files; they may run as two parallel devops agents. T04 does
not need `node_modules`, so the lead may also start it after T02's install finishes if it prefers no overlap.

## 7. Briefs for M0-S1

The brief template is **canonical in [AGENT_ORCHESTRATION.md §6](AGENT_ORCHESTRATION.md#6-brief-template-copy-exactly-fill-every-field)**
— copy it exactly and fill it from the task card in `docs/milestones/M0-foundation.md` §7 (the cards already contain
goal, owned files, read-first, inputs, acceptance criteria, reviewers and DoD). For M0-S1 set `Stage: M0-S1`; set
`Installer: yes` for M0-W0-T02 only and `Installer: no` for T01 and T04.

Launch order for M0-S1:
1. `/plan-wave M0-W0` → writes `docs/handoff/waves/M0-W0.md` (briefs, owned-file table, run log). Check that the owned
   files of T01, T02, T04 are disjoint (T01 = `packages/shared/src/**` and its tsconfig/README; T02 = configs and
   `packages/config/**`; T04 = `.claude/hooks/**`, the hooks block of `.claude/settings.json`, `docs/vendor/**`).
2. **In parallel:** `M0-W0-T02` (subagent_type `devops-engineer`, port 1) and `M0-W0-T04` (`devops-engineer`, port 3).
3. **When T02 reports** (lockfile + `node_modules` + root `tsconfig.base.json` exist): `M0-W0-T01`
   (`contracts-architect`, port 0).
4. `/review M0-W0-T02`, `/review M0-W0-T04`, `/review M0-W0-T01` (code-reviewer + netcode-security-reviewer each;
   reviewers read the wave file).
5. `/status`. M0-S2 (T03, then integration T05) is the next session.

## 8. What "done" looks like for the build

- M0 → `v0.1.0`: deployable hello-world, CI green, spikes answered (renderer on the real look, netcode on Render Free,
  terrain bake).
- M1 → `v0.2.0` MVP: the Boreal Pilot Area playable solo and with friends at the full visual bar.
- M2 → `v1.0.0`: full mechanics parity across the whole moon.
- M3 → polish & launch on Cee's games hub.
See [../ROADMAP.md](../ROADMAP.md).
