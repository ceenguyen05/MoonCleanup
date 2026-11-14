# M0 doc cleanups (docs-keeper, 2026-11-13)

Prettier not run: `**/*.md` is in `.prettierignore`.

## Edits

| File | Edit |
| --- | --- |
| `packages/db/README.md` | Added `DATABASE_CA_CERT` optional / system-CA verify / `sslmode=require` in production / unset `ENV_NAME` fails migrate (code review item 5); "direct, non-pooler URL" |
| `docs/HOSTING_GUIDE.md` | Added "Monitors: /healthz only, never /readyz" note (before the optional-monitor paragraph) |
| `README.md`, `docs/README.md` | Aiven -> Neon |
| `docs/architecture/system-overview.md` | Aiven -> Neon (diagram, table, sequences); `onlineRequired` now `false` for Solo per ADR-0031 |
| `docs/architecture/netcode.md` | Sequence participant Neon PG |
| `docs/architecture/data-model.md` | Aiven -> Neon (lines 9, 290, 374, 385, 393, 394, 401); MySQL retirement kept as historical |
| `docs/architecture/tech-stack.md` | Lines 16, 19, 83, 85: Neon, Aiven marked superseded |
| `docs/architecture/world-and-dust-simulation.md` | Heading section 6 -> Neon (line 668 is historical, left) |
| `docs/architecture/security.md` | Line 82: Neon TLS row (system CA, `DATABASE_CA_CERT` optional) |
| `docs/milestones/M0-foundation.md` | Lines 23, 289 Aiven -> Neon |
| `docs/adr/0002`, `0016` | "Superseded 2026-11-13: Neon replaces Aiven" notes; historical rationale kept |
| `docs/design/scope-tiers.md` | Offline Solo row marked superseded by ADR-0031; roost row 16-player note superseded (cap 6) |
| `docs/milestones/M2-v1-parity.md` | Note 7.1 marked superseded by ADR-0031 and cap 6 |
| `docs/architecture/performance-budgets.md` | New 6.4 "Solo Web Worker sim" rows, all NOT MEASURED |

## Unresolved / for lead

| Where | Issue | Owner |
| --- | --- | --- |
| `.claude/agents/backend-data-engineer.md:27`, `devops-engineer.md:33` | Still say Aiven (agent meaning is lead-owned; not edited) | lead |
| `docs/architecture/data-model.md` ~374, 394, 401 | Aiven-specific unknowns reworded to "verify on Neon"; actual Neon limits (connections, WAL) are still unverified | backend-data-engineer |
| `docs/research/**`, `docs/agent-reports/**`, `docs/STATUS.md:40,42` | Aiven mentions left (evidence/historical; STATUS is lead-owned) | lead |
| `docs/architecture/performance-budgets.md` 6.4 | Numeric targets (4/8 ms worker tick, 100 MB heap) are my proposals; ADR-0031 only gives 0.3 ms host, 2 ms slice, 0 alloc, 1-frame | performance-engineer / lead |
| `docs/design/scope-tiers.md`, `M2-v1-parity.md` | Other 16-player mentions (e.g. M2 `/bot-test` 16 drivers, line 295) not touched | game-designer / lead |
