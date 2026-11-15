# M1-W0-T07 - Drop `joinTicket` from the Contract join response (contracts-architect)

Status: done / 2026-11-14 / contracts-architect / Sonnet 5.5 (owner decision 2026-11-14)

## What changed
- `packages/shared/src/api/rest.ts`: `JoinContractResponseSchema` is now `{ reservation, role }`. `joinTicket` is removed. A v0.4 body that still has the key parses and the key is stripped.
- `ContractView.createdAt` is not in any shared schema (`ContractView` is a `packages/db` domain type). Formalised as an optional `createdAt: IsoInstant` on `ContractSummarySchema` (additive). The server does not populate it yet, because the brief limited server edits to what the removal needs. Clients must not depend on it.
- `apps/server/src/net/shift/shift-join.ts`: the response no longer carries `joinTicket`. The ticket is still granted and held server-side, and the 503 `RETRY_LATER` on a full pending store is unchanged. Comment fix in `join-ticket.ts`.
- Tests:
  - shared `rest-v2.test.ts`: the old join case lost the field. New cases cover a v0.4 body being stripped, the schema keys, a type-level `not.toHaveProperty("joinTicket")`, and the optional `createdAt`.
  - server `shift-room.test.ts` and `app/server.test.ts`: assert the response has no `joinTicket`, and drop it from local types.

## Version bump
- `api/rest` v0.4.0 to **v0.5.0**. The header comment has the entry. The removal is breaking for any reader of the field. No reader exists in `apps/client`; grep over apps, packages and tools found none.
- `PROTOCOL_VERSION` and `SAVE_FORMAT_VERSION` are unchanged. No sim, world or protocol payload was touched.

## Consumers
- `apps/server/src/net/shift` (done).
- `apps/client/src/net`: join flow must use `reservation` and `role` only (it does not read the ticket today, so no change was needed).
- `apps/server/src/api`: later, populate `createdAt` in `toSummary` if wanted.
- `docs/architecture/module-boundaries.md` section 2 still says rest v0.2.0 (stale, not edited, the brief did not ask).

## Checks (Node 26.13.1 PATH prefix)
- `packages/shared`: tsc clean, eslint (src/api) clean, vitest 32 files / 467 passed.
- `apps/server`: tsc clean, eslint (src/net/shift, src/app) clean, vitest 23 files / 281 passed.
- `apps/client`: tsc --noEmit clean.
- prettier --check clean on the touched dirs (packages/shared/src/api, apps/server/src/net/shift, server.test.ts).

## Not run
- Client vitest (typecheck only, as asked), full-repo eslint, real over-the-wire join from a browser, `pnpm verify`.

## Files
`packages/shared/src/api/{rest.ts,rest-v2.test.ts}`, `apps/server/src/net/shift/{shift-join.ts,join-ticket.ts,shift-room.test.ts}`, `apps/server/src/app/server.test.ts`.
