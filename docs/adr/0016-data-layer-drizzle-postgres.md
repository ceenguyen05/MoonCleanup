# ADR-0016: Data layer - Drizzle ORM on Aiven PostgreSQL Free

- **Status:** Accepted (2026-11-12); staging database/budget superseded by [ADR-0029](0029-single-deploy-branch-main.md): one schema `prod`, layout in data-model.md §9
- **Deciders:** owner (engine choice), lead/orchestrator, backend-data-engineer
- **Canonical source:** [tech-stack.md](../architecture/tech-stack.md) section 4 (Database row), section 5 (Prisma)

## Context

Persisted data: guest players, refresh-token hashes, contracts (rooms), profile/progress and compressed world/save blobs (research estimated ~300 KB per full rewrite every 30-60 s = 0.4-0.9 GB/day of write volume per active room; the final design writes only a header slot + dirty dust chunks, see Decision). **Aiven free MySQL was retired 6 Nov 2026**; the free PostgreSQL tier gives 1 CPU, 1 GB RAM, 1 GB storage and powers off when idle. Render Free has **no pre-deploy command** and 0.1 CPU. Prisma's `latest` CLI is 8.0 RC with a new API and a shadow-DB requirement.

## Options considered

1. **Drizzle ORM 0.45.x + drizzle-kit 0.31.x + `postgres` driver.** Pro: TypeScript schema as source of truth; reviewable generated SQL; light runtime; high agent familiarity. Con: 0.x line; v1 is RC.
2. **Kysely.** Pro: smallest footprint, loud failure on out-of-order migrations. Con: hand-written migrations, separately synced types.
3. **Prisma.** Pro: mature DX in v7. Con: v8 RC churn; engine/shadow DB; excluded.
4. **Raw SQL + node-pg.** Pro: no abstraction. Con: no type safety.
5. **Aiven MySQL Developer ($5/mo) or SQLite file.** Con: breaks $0 / Render disk is ephemeral.

## Decision

Option 1, pinned exactly. Schema and migrations live in `packages/db` (owner: backend-data-engineer); `apps/server` is the only consumer (`client` never imports `db`). Process:
- **One migration owner at a time** runs `drizzle-kit generate` on up-to-date `main`; other agents edit schema in branches but never commit generated SQL.
- A human reviews the SQL in the PR (primary keys, no destructive change without expand/contract, small migrations).
- **Migrations are applied in the Render build command** (free plan has no `preDeployCommand`); a failed migration fails the build and the old version keeps serving. Every migration is backward-compatible with the previous release. `drizzle-kit push` is local-only.
- Saves: a compressed header blob in two alternating slots (A/B) per Contract plus per-chunk dust rows (`contract_dust_chunks`) where only dirty chunks are rewritten, all in one transaction; written only when dirty, every <= 30 s, on room empty and on SIGTERM; format versioned by `SAVE_FORMAT_VERSION` (see data-model.md §3.7/§3.7b).
- Two logical DBs (prod, staging) on one Aiven service; keep pool sizes small (deploy overlap doubles pools).
- If `drizzle-orm` 1.0 final lands before the first schema is written, start on v1.

## Consequences

**Positive**
- Typed, reviewable, cheap; swap-friendly (plain SQL migrations).

**Negative / risks**
- **Research nuance:** the data-layer report assumed MySQL (`mysql2`, MEDIUMBLOB) and presented PostgreSQL as an alternative; this ADR adopts the PostgreSQL branch (driver `postgres`, `bytea`).
- 1 GB storage and heavy blob writes cause WAL volume and bloat; keep writes small (header slot + dirty chunks only) and vacuum-friendly.
- Migrations at build time need the DB reachable and awake during builds; a powered-off Aiven free DB can break deploys.
- Aiven may change region/config of free services; connection limit unpublished.

## Revisit trigger

- Storage > 70% of 1 GB, or write volume throttles the DB.
- Drizzle 1.0 final with breaking API; Aiven retires or changes the free PostgreSQL tier.
- A paid Render plan becomes available: move migrations to `preDeployCommand`.

## Evidence

- [data-auth-observability.md](../research/tech/data-auth-observability.md) (section 0, sections 1-4, Contradictions)
- [platform-limits.md](../research/tech/platform-limits.md) (C1, B2, E3 items 7, 17)
- [tooling-and-libraries.md](../research/tech/tooling-and-libraries.md) (Data layer versions)

## Amendment 2026-11-12

Added after the principal-engineer planning review (M2, M3, m9, m12). The Decision above stands; these rules refine it and live in [data-model.md](../architecture/data-model.md) §3.5, §3.7, §3.7b, §4, §5.1, §8.

- **Crash-safe dust rows:** each dust chunk keeps **two versions** stamped with the header `save_seq` of the transaction that wrote them; the loader picks the newest valid header H and, per chunk, the newest valid version with `save_seq` ≤ H, so a corrupt newest header is never paired with newer chunk data. Plot state is stored inside each chunk row with its ledger; the header holds no per-plot dust data.
- **Guards:** the header is written first in the transaction; a zero-row `save_seq` guard rolls back the whole transaction. Leases are compare-and-set statements on the database clock (`now()`), keyed by instance and room id.
- **Capacity policy for the 1 GB disk:** ≤ 3 owned Contracts per player; per-Contract soft cap 4 MB and hard cap 8 MB; abandoned Contracts compacted after 30 days (stroke logs dropped) and 90 days (ledgers dropped); new Contracts refused above 800 MB total; daily size metrics in `ops_usage_daily` and `/status`. Budget: reserve 200 MB, staging 100 MB, prod accounts 100 MB, prod saves 600 MB.
- **Migrations:** applied by the programmatic Drizzle migrator (not the `drizzle-kit migrate` CLI) so `lock_timeout` and `statement_timeout` are set; the achievements seed runs after it in the Render build command.
- **Holder transfer:** when a Holder's account expires or is deleted, Holder passes to the most active Supervisor (else Staff) before any cascade.
