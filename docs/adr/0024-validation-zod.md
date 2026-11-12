# ADR-0024: Validation and config schemas - zod 4

- **Status:** Accepted (2026-11-12)
- **Deciders:** lead/orchestrator, contracts-architect
- **Canonical source:** [tech-stack.md](../architecture/tech-stack.md) section 4 (Validation / config schemas row)

## Context

Untrusted input reaches the server through REST, join options and gameplay messages; balance tables in `packages/game-data` are edited by many agents and the designer; environment variables differ per host (Vercel, Render, local). Contracts live in `packages/shared`, which may contain pure types, constants and zod schemas only. Validation must be cheap on the 0.1-CPU server and the hot byte path must not pay for generic validation.

## Options considered

1. **zod 4 (4.6.7).** Pro: highest agent familiarity; inferred types; built-in `z.toJSONSchema`; Colyseus supports zod `validate()` for messages. Con: large unpacked size (use `zod/mini` for client bundles); runtime cost.
2. **valibot (1.5.0).** Pro: smallest, tree-shakable. Con: less agent familiarity; extra converter for JSON Schema.
3. **TypeBox (1.4.6).** Pro: compiled validators, JSON Schema native. Con: different mental model; less familiar.
4. **Hand-written guards.** Pro: no dependency. Con: drift, errors, and no inferred types.
5. **io-ts / ArkType.** Con: less ecosystem alignment.

## Decision

**zod 4** is the single validation library. Uses:
- **REST DTOs** and message payloads defined in `packages/shared` (`api/rest.ts`, `protocol/messages.ts`), validated at the API edge on the server; the client reuses the same schemas.
- **Balance config:** every table in `packages/game-data` is validated by `shared/config/*.schema.ts`; CI fails on invalid tables, and balance-sim consumes the validated data.
- **Environment parsing:** `apps/server/src/ops` parses env vars with zod and fails fast with readable errors; `VITE_*` vars are parsed in the client (never secrets).
- **Hot byte path exception:** the bit-packed channels (ADR-0023) are validated by bounds-checked decoding, not zod; zod validates only decoded control messages and rate-limited gameplay messages.
- Client bundles use `zod/mini` or import only needed schemas; maximum message sizes and `maxMessagesPerSecond` backstop validation costs.
- Types are inferred from schemas (`z.infer`) so contracts and types cannot drift.

## Consequences

**Positive**
- One validation language and source of truth for types, config and wire contracts; JSON Schema export is available for tooling.

**Negative / risks**
- Runtime cost on 0.1 CPU if overused; keep zod off per-tick paths.
- `shared` carries a runtime dependency on zod; zod major upgrades need an ADR (engine-level dependency policy).
- Slightly larger client bundle than valibot.

## Revisit trigger

- Profiling shows validation costs > 5% of server CPU at 16 players.
- Client bundle exceeds budget because of zod: switch client-side to valibot or `zod/mini`.

## Evidence

- [data-auth-observability.md](../research/tech/data-auth-observability.md) (section 7.2 input validation)
- [tooling-and-libraries.md](../research/tech/tooling-and-libraries.md) (schemas table: zod 4.6.7, valibot, TypeBox)
- [netcode-case-colyseus.md](../research/tech/netcode-case-colyseus.md) (messages map with zod `validate()` and rate limits)
- [module-boundaries.md](../architecture/module-boundaries.md) (shared contracts, config schemas)
