# ADR-0001: TypeScript monorepo and tooling baseline

- **Status:** Accepted (2026-11-12)
- **Deciders:** lead/orchestrator (planning session 2026-11-11/12)
- **Canonical source:** [tech-stack.md](../architecture/tech-stack.md) section 4, rows Language / Runtime / Package manager / Bundler / Lint

## Context

The game is built by many AI agents in parallel, so it needs one language end to end, pinned versions, small packages with single owners and enforceable import rules ([module-boundaries.md](../architecture/module-boundaries.md)). The sim, world and protocol packages must run in a browser main thread, a Web Worker and Node. As of 2026-11-11 the toolchain landscape is unusual: TypeScript 7 (native Go compiler) is `latest` but ships no programmatic API, Node 26 is Active LTS without a bundled Corepack, and pnpm 12 (Rust rewrite) has just overtaken pnpm 11.

## Options considered

1. **TypeScript 6.0.3 as the tool-facing compiler (optional `tsgo` 7.0.2 for fast CLI typecheck).** Pro: typescript-eslint 8.72 peer range is `<6.1.0`; every tool works. Con: not the newest compiler.
2. **TypeScript 7.0.2 only.** Pro: fastest. Con: no API, breaks typescript-eslint and other API consumers.
3. **pnpm 11.28.9 + Turborepo 2.x.** Pro: stable, known lockfile, light task graph and caching. Con: one major behind `latest`.
4. **pnpm 12.18 or Nx 24.** Pro: newest / richer graph. Con: pnpm 12 is 11 weeks old; Nx is heavy with fast major cadence.
5. **Node 24 (Render default) instead of Node 26.** Pro: matches Render's default. Con: already in Maintenance LTS.

## Decision

- **TypeScript 6.0.3** everywhere; `tsgo` 7.0.2 may be aliased for CLI-only typechecking.
- **Node.js 26 LTS**: `.nvmrc` = `26.13.1`, `engines.node: 26.x`. Vercel defaults to 26.x, Render reads `.nvmrc`, uWebSockets.js ships Node 26 binaries.
- **pnpm 11.28.9** workspaces, pinned through `packageManager`. Corepack is not bundled with Node 25+, so CI uses `pnpm/action-setup` and Vercel/Render use an explicit install command.
- **Turborepo 2.x** for the task graph; **Vite 8.3.x** (Rolldown) for the client.
- **ESLint 9 flat config + typescript-eslint 8.72 + Prettier 3**, including `no-restricted-imports` rules for package boundaries and the three.js legacy-API ban-list (ADR-0003).
- Dependabot ignores major bumps of engine-level packages; a new major requires an ADR.

## Consequences

**Positive**
- One toolchain all agents can learn; reproducible installs; boundary rules are machine-checked.
- Node 26 gives the longest support window (EOL 2029-04-30).

**Negative / risks**
- **Research disagreement:** [tooling-and-libraries.md](../research/tech/tooling-and-libraries.md) shows pnpm 12.18.0 as `latest` and lists pnpm 11.28.9 as the maintained fallback; [platform-limits.md](../research/tech/platform-limits.md) (E3 item 16) suggested pinning Node 24 on both hosts for safety. tech-stack.md chose pnpm 11 and Node 26; this ADR follows it. Mitigation: verify Vercel and Render build logs show the pinned pnpm and Node versions in M0.
- Vercel auto-detects lockfile v9 as pnpm 9/10, so the install command must be overridden explicitly.
- Rolldown-based Vite 8 and pnpm are young; expect occasional churn.

## Revisit trigger

- typescript-eslint supports TypeScript 7 (peer range extended and TS 7.1 API shipped): move the tool-facing compiler to 7.x.
- pnpm 11 stops receiving fixes, or Vercel/Render break on the pinned pnpm install: move to pnpm 12 via a new ADR.
- Node 26 build failures on Vercel or Render that Node 24 does not show.

## Evidence

- [tooling-and-libraries.md](../research/tech/tooling-and-libraries.md) (Executive summary, section 1)
- [platform-limits.md](../research/tech/platform-limits.md) (A4, B6, E3)
- [module-boundaries.md](../architecture/module-boundaries.md) (rules 1-6)
