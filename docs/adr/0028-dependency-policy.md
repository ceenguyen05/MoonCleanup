# ADR-0028: Dependency policy

- **Status:** Accepted (2026-11-12) (decision D6)
- **Deciders:** lead/orchestrator, devops-engineer
- **Canonical source:** [module-boundaries.md §3](../architecture/module-boundaries.md) ("Dependencies" paragraph); [tech-stack.md](../architecture/tech-stack.md)

## Context

Parallel agents edit separate packages but share one pnpm workspace and one lockfile. Concurrent installs corrupt the lockfile and make waves unreproducible; an unreviewed package is also a supply-chain risk and can pull in a banned or unlicensed dependency. [ADR-0001](0001-typescript-monorepo-tooling.md) fixes the toolchain; this ADR fixes how dependencies enter and change.

## Options considered

1. **Agents install what they need, when they need it.** Pro: fast. Con: lockfile races, unreviewed packages, non-reproducible waves.
2. **Installs only by devops-engineer between waves, one ADR per new dependency, exact pins (chosen).** Pro: one lockfile writer, reviewed additions, reproducible builds. Con: an agent needing a package waits for the next inter-wave window.
3. **Vendor everything.** Pro: no registry. Con: repo bloat, manual updates.

## Decision

- **A new dependency needs an ADR** (a short one is enough: what, why, size, licence, alternatives). A major bump of an engine-level package (three, Colyseus, Vite, TypeScript, Drizzle, React) also needs an ADR. The ADR is written before the milestone's W0 install task (D6).
- **Installs happen only between waves, only by `devops-engineer`**, one lockfile writer at a time. The single exception is **M0-W0-T02, which performs the first `pnpm install`** and creates `pnpm-lock.yaml`. Other agents declare the dependency in their own `package.json` (they own it) and report it; they never run `pnpm install/add`.
- **Exact pins**: no `^` or `~` ranges in any `package.json` (devops sets pnpm's save-exact behaviour in the M0-W0-T02/T03 config if not already set); engine-level packages move deliberately (three roughly quarterly via the migration guide), never to "latest".
- **Dependabot** (`.github/dependabot.yml`, weekly grouped PRs, Cee merges after CI is green) already ignores majors, and for three, Colyseus, Drizzle and TypeScript also minors, of engine-level packages; **any major version bump needs an ADR** before it merges. GitHub Actions are pinned by commit SHA.
- Ignored postinstall/build scripts are listed in the installer's report for Cee (`pnpm approve-builds`); nothing is approved silently.
- Licences are checked against [asset-and-data-licensing.md](../research/asset-and-data-licensing.md) rules; a copyleft or unknown licence blocks the ADR.

## Consequences

**Positive**
- One reviewed, reproducible lockfile history; a paper trail for every package.

**Negative / risks**
- Agents blocked on a missing package must wait for the inter-wave window (mitigated by D6: dependency ADRs land before each milestone's W0 install task).

## Revisit trigger

Two or more waves lose more than one stage to waiting for installs, or a supply-chain incident.

## Evidence

- [module-boundaries.md §3](../architecture/module-boundaries.md), [M0-foundation.md](../milestones/M0-foundation.md) (M0-W0-T02)
- [planning-fix-handoff.md](../agent-reports/planning-fix-handoff.md) (D6), [tooling-and-libraries.md](../research/tech/tooling-and-libraries.md)
