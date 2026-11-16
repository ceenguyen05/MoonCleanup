# M1-W5-T01 finish (backend-data-engineer)

Status: the four items are already in the tree, so I made no code changes. I only verified them. No git, no installs, no manifest/lock changes.

| Item | State | Evidence |
|---|---|---|
| 1. HTTP-level 409 test | done | `apps/server/src/app/server.test.ts` "answers 409 CONTRACT_BUSY ..." covers 409 + Retry-After 5 + body, 0 rooms, then 503 RETRY_LATER offline, then 200 |
| 2. SIGTERM checkpoint of every room | done | `persistence/checkpoint-rooms.ts`, wired in `app/server.ts` `shutdown()`; test "checkpoints every live room on shutdown ..." expects `{rooms:1, saved:1, failed:0, timedOut:0}` and lease released |
| 3. bakeHash | done | `DurableShiftDustStore` option `bakeHash` is written with each checkpoint. A save with a different hash is refused as `save_corrupt` (bake_mismatch). Nothing is checked while the server world has no hash. 3 tests in `persistence.test.ts`. |
| 4. SQL repos | present | `packages/db/src/repositories/room-postgres.ts` (+ suite and tests), selected in `server.ts` when the driver is postgres |

Remaining gaps:
- `bakeHash` is only an optional `startServer` option. Nothing passes the real world bake hash yet, so the check is dormant until the server world is baked.
- I did not run the `room-postgres` tests. They need a real Postgres test schema, which I did not set up.
- Room header blob persistence and 1.5 ms/tick encode slicing are still open.
- Review lows are still open: ShiftCore mixed clocks, the `as never` comment, W5-T07 boundary tests.

Checks, run in `apps/server`:
- `tsc --noEmit` is clean.
- `vitest run src/app src/persistence` passes 31/31.
- `eslint src/app src/persistence` is clean.
- `prettier --check src/app src/persistence` is clean.
