# ADR-0029: Single deploy branch (`main` only) and one Render service

- **Status:** Accepted (2026-11-12)
- **Deciders:** owner (Cee, at Gate G0), lead/orchestrator
- **Canonical source:** [tech-stack.md](../architecture/tech-stack.md) Hosting row and [environments.md](../architecture/environments.md) (both updated in the follow-up docs pass listed below)
- **Supersedes:** the branch and staging topology of [ADR-0002](0002-hosting-topology-free-tier.md) (Decision bullet "Render Free web service x2", Amendment bullet "Release order"). The rest of ADR-0002 ($0 budget, Vercel Hobby, Render Free, Aiven PostgreSQL Free, accepted bandwidth risk) stands.

## Context

ADR-0002 planned two long-lived branches (`release` = production, `main` = staging), two Render Free services and a GitHub workflow that deployed the production client only after the production server reported the commit's protocol version. At Gate G0 the owner decided this is more process than a solo, $0 project needs: **there is no `release` branch; everything is pushed to `main` and deployed from `main`**, with **one Render service** (OPEN_QUESTIONS Q24, Q24b). The owner does all git.

## Options considered

1. **Two branches, two Render services (ADR-0002).** Pro: a pre-production soak environment and a gated release order. Con: a second branch to fast-forward, two dashboards to configure, 750 instance-hours and 5 GB egress shared by two services, extra Actions minutes.
2. **`main` only, one Render service, platform auto-deploys (chosen).** Pro: push = deploy; one of everything; all free hours go to the live server. Con: no soak environment; every push to `main` is live.
3. **`main` only, two Render services on `main`.** Pro: a spare instance for load tests. Con: the dashboard and hour-sharing cost of option 1 without its release gate.

## Decision

- **Branches:** `main` is the only long-lived branch and the only deploy branch. No `release` branch is created. Version tags (`v0.1.0`, …) are still placed on `main` by the owner.
- **Client:** Vercel Production Branch = `main`; Vercel's own git integration deploys it. The `git.deploymentEnabled.release` entry in `vercel.json`, the Vercel deploy hook and the `release-client` workflow are removed.
- **Server:** **one** Render Free web service, `moon-cleanup-server`, `branch: main`, `autoDeployTrigger: checksPass` (it deploys only after the commit's `CI gate` passes), `ENV_NAME=production`. The staging service is removed from `render.yaml`.
- **Database:** one Aiven database, one schema (`DB_SCHEMA=prod`). The `staging` values of `ENV_NAME`, `VITE_ENV` and `DB_SCHEMA` stay valid in the contracts and env schema but are unused. OPEN_QUESTIONS Q19 is closed by this.
- **Release order:** the rule "the client never goes live ahead of the server" ([netcode.md §13](../architecture/netcode.md#13-versioning-and-release-order)) is no longer enforced by a deploy gate. It is covered by the existing client behaviour for a newer-than-server client ("Brightside is updating the servers", `/healthz` probe every 30 s) and by strict `PROTOCOL_VERSION` equality at join. That flow is therefore a **required, tested path** from M1 on, not a should-not-happen fallback.
- **Tests against the deployed server:** until public launch the single service is also the spike and soak target (M0 netcode spike, short bot runs ≤ 5 min), enabled only by an explicit opt-in on the tool side; the "refuse the production URL" guard in `tools/bots`, `tools/perf` and e2e stays the default. After launch, load tests run locally (`--cpus=0.1` container) or in an announced maintenance window.
- **Checks before going live:** `/verify` and the wave gates run before the owner pushes; `/release-checklist` becomes the pre-tag checklist for `main`.

## Consequences

**Positive**
- One branch, one server, one database schema: less setup at Gate G1 (no deploy hook, no second Blueprint service, no second set of env values), fewer places for configuration drift.
- The 750 free instance-hours and the 5 GB egress are no longer shared with a staging instance.

**Negative / risks**
- Every push to `main` is live. A commit that passes CI but breaks at runtime reaches players; recovery is Vercel Instant Rollback for the client and a revert commit (or Render rollback) for the server.
- Vercel usually finishes before Render. On a protocol-changing commit the new client is live for a few minutes before the server (longer if the Render build fails); players then see the "updating" screen instead of a broken join. A failed server deploy on such a commit needs a client rollback or a fix-forward.
- No environment to soak-test a change before players get it. Local runs under the network conditioner and the 16-bot test carry that weight.
- This diverges from the principal-engineer planning review item M12 (server-first release gate), which the owner has traded for simplicity.

## Revisit trigger

- After public launch: a bad deploy reaches players, or the "updating" window is reported as a problem → reinstate a server-first gate on `main` (deploy hook + workflow) or add a staging service.
- The game needs soak testing with real infrastructure that cannot disturb live players.

## Follow-up (owners)

- `devops-engineer`, M0-W0-T03: `render.yaml` (one service), `vercel.json`, `.github/workflows/**` (remove `release-client`, branch triggers), `**/.env.example`.
- lead (docs pass before Gate G1): `architecture/environments.md`, `system-overview.md`, `netcode.md` §13, `data-model.md` §9, `tech-stack.md` Hosting row, milestone gate text (G1–G3, M0-W3-T01), `handoff/WORKFLOW.md`, `handoff/FABLE_KICKOFF.md`, `.claude/commands/release-checklist.md`, agent files that mention `release`.
- `docs-keeper`: `SETUP_CHECKLIST.md` §2.2, §6, §7, §10; `README.md`.

## Evidence

- Owner decisions recorded in [OPEN_QUESTIONS.md](../OPEN_QUESTIONS.md) Q24 and Q24b and in [STATUS.md](../STATUS.md) (log, 2026-11-12).
- [platform-limits.md](../research/tech/platform-limits.md) (Render Free instance-hours and egress, Vercel Hobby).
