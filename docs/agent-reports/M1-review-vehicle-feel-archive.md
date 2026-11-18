# M1 review: VEHICLE_FEEL swap (A) + archive-on-bake-mismatch / saveArchived (B)

Status: done / 2026-11-17 / code-reviewer / Opus 5.5. Read-only review; no source edited.

## Verdicts
- **A VEHICLE_FEEL swap: PASS** (no blocking defects).
- **B archive + saveArchived: PASS** (no blocking defects).

## A: checked
- Determinism: `handling.ts:10-16` aliases the frozen game-data table, so it is the same object. `tuning.ts:117-135` does trig and division only at config time. The values match the old table (`vehicle-feel.ts:12-40`), and the author reports unchanged golden hashes.
- Hot path: `resolveVehicleTuning` (`tuning.ts:142-199`) runs only at config time. `VehicleDriveView.update` (`vehicle-drive.ts:89-154`) allocates nothing; `feelOf` runs only in the constructor and `setActive`.
- Purity: sim already imports game-data at runtime (`clock/sun-clock.ts:6`) and lists it in `packages/sim/package.json:19`. `game-data/src/vehicle-feel.ts` imports only `@moon-cleanup/shared`, so it has no DOM, Node, three or Colyseus.
- Schema check at load: the zod parse of a 27-field table runs once per bundle (worker, server). game-data already loads zod, so the bundle does not grow. A bad table throws when the module loads. That fails fast, which is acceptable.
- Match-test tolerance (`vehicle-feel-match.test.ts:137-148`): a 10-bit yaw step is 2π/1024 ≈ 6.14 mrad. Half a step × 0.9 m ≈ 2.76 mm is the theoretical maximum error, under the 1 cm bound (the author measured 2.73 mm). The 1 mm exact-yaw bound sits well above floating-point noise. The +0.3 m wrong-offset check (>0.25 m) makes the test fail if the table is not used. The tolerances are valid.
- Fallback: an unknown kind falls back to the Trundle row (`vehicle-drive.ts:66-68`), and a test covers it.

## A: non-blocking notes
- N-A1 `handling.ts:16`: the `VEHICLE_HANDLING` alias is harmless (same frozen reference, tests assert `toBe`). Keep it until M2 adds vehicles, then switch the imports to `VEHICLE_FEEL` and drop it so there is one name.
- N-A2 `tuning.ts:134`: `centerWeightDrum` divides by `probeForwardM[0]-probeForwardM[1]`. A data table where these are equal gives Infinity or NaN. The behaviour predates this change; consider a schema refine (contracts-architect).

## B: checked
- Atomicity (`room-postgres.ts:381-433`): one `db.transaction`. It takes `FOR UPDATE` on the contract row, re-checks the lease, copies to the archive tables, then deletes the live rows and zeroes `storedBytes`. A failure at any step rolls everything back and the live rows survive. Insert batches stay inside the transaction. After an archive, `commitRoomCheckpoint` recomputes the generation from the remaining slots (`:261-266`), so the fresh room's first save starts at seq 1 and does not hit a lease_lost CAS.
- Memory implementation (`room-memory.ts:192-223`): it moves the save by reference and resets it. Lease-guarded, equivalent to Postgres.
- Migration 0004: expand-only (two `CREATE TABLE`s, FKs, one index, `SET STORAGE EXTERNAL`). There is no `public.` qualification and the journal entry is present. It is not textually idempotent (no `IF NOT EXISTS`), but the drizzle journal applies it exactly once, the same as 0001-0003. Safe on Neon.
- `DurableDustStore.load` (`durable-dust-store.ts:227-249`): it archives only when the bake hashes are known and differ. lease_lost marks the lease lost and fails closed. Any throw releases the lease (`:277`) and the room is refused (strict), so there is no pristine overwrite. If `link.run` times out while the transaction later commits, the data is still safe. The next join sees a null snapshot and starts fresh, or the second archive gets `nothing` once the row lock frees.
- One-shot handling: the flag is set in `onCreate` after the awaited restore (`shift-room.ts:243`) and consumed synchronously in `onJoin` (`:391-397`). Colyseus runs `onJoin` callbacks one at a time, so two joiners cannot both get it. A protocol-mismatch first joiner returns before line 391, so the flag passes to the next valid joiner. `shift-room-save-archived.test.ts` covers first vs. second joiner. The author report's line "no room-level integration test" is out of date: this test exists.
- Old-client parse: `HelloPayloadSchema` is `z.object` (strips unknown keys; `payloads.ts:96`), and `PROTOCOL_VERSION` stays unchanged. A test covers it (`payloads.test.ts:126-135`).

## B: non-blocking notes
- N-B1 `durable-dust-store.ts:230-237`: if the archive transaction commits but `link.run` times out, the room is refused. The retry starts fresh, and `saveArchived` is never sent, so the player does not get the notice. No data is lost. The same applies if the first joiner drops before HELLO arrives, or if the room is disposed with no joiner. This is an accepted limit of the one-shot design.
- N-B2 `durable-dust-store.ts:236`: `counters.archives` also increments on `kind: "nothing"`. This only affects the ops metric. Count only `archived`.
- N-B3 `durable-dust-store.ts:227`: saves with `bakeHash === null` (written before stamping) load into any terrain without being archived. This is by design (earlier decision) but worth confirming with the owner.
- N-B4 Archive tables have no retention policy and count toward the 1 GB cap; the author already flagged this.

## Evidence / NOT CHECKED
- NOT RUN by me: focused vitest. The `fnm exec --using=26` shell could not find `pnpm`, `npx` or a root `node_modules/vitest` bin in my session. I relied on the authors' same-state runs: sim 203/203 including goldens, client vehicles 11/11, db 127 passed + 2 skipped (room-postgres runs against PGlite, which is real PostgreSQL), server persistence 27/27.
- NOT CHECKED: room-postgres against real Neon (needs secrets), client UI for the notice (`room-session.ts:540`, `online-room.ts:397`; out of scope), `pnpm verify`, browser drive feel.

## Fixes

- N-A2: `vehicle-feel.schema.ts` superRefine rejects `probeForwardM[0] === probeForwardM[1]` (the divisor in `tuning.ts` centerWeightDrum / vehicle.ts wheelBase). Test added in `packages/game-data/src/vehicle-feel.test.ts`.
- N-B2: `durable-dust-store.ts` increments `counters.archives` only when `archiveRoomSave` returns `archived`. Tests in `persistence.test.ts` (real archive counts 1, `nothing` counts 0).
- Evidence: vitest (2 files, 30 tests) pass; tsc clean for apps/server, packages/shared, packages/game-data.
