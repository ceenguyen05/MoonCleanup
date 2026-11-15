# M1-W5-T01b durable room storage, SQL side (backend-data-engineer)

Status: DONE for the three items; two documented gaps below. No git, no real Postgres, no migration (existing 0000-0003 cover everything).

## Evidence
- `packages/db`: `tsc` clean, `eslint .` clean, `vitest run` 8 files, 129 passed / 2 skipped (pre-existing skips). New: `room-memory.test.ts` and `room-postgres.test.ts` = 32 tests.
- `apps/server`: `tsc` clean, `eslint src/persistence src/app` clean, full `vitest run` 28 files, 344/344 (was 326).
- Test DB = PGlite (real PostgreSQL in WASM) with the generated migrations applied, schema `_a6`; the same approach as `postgres.test.ts`. Not covered: postgres.js, TLS, Neon cold start, true multi-session row-lock contention.

## 1. SQL ports + conformance suite (packages/db)
- `repositories/room-types.ts`: the ports (moved from apps/server), `LEASE_TTL_MS`, `RoomSaveCorruptError`, `bakeHash` on checkpoint/snapshot, `storedBytes` on the saved result. `apps/server/src/persistence/ports.ts` re-exports them and keeps `ContractUnavailableError`.
- `room-memory.ts`: `MemoryRoomSaveRepository` moved here (server `memory-room-repository.ts` is now a re-export), so one suite can run against both.
- `room-postgres.ts`: `createPostgresRoomRepository(db, {clock?, saveFormatVersion?, gameDataVersion?})` implements `RoomSaveRepository` and `UsageRepository`.
  - Lease: data-model 3.5 CAS in one `UPDATE ... RETURNING` on the DB clock (`now() + 35 s`), shared by acquire/renew; release `WHERE lease_room_id`. A deleted or missing Contract can never be leased (`busy`).
  - Checkpoint: one transaction; `contracts` row `FOR UPDATE`; lease guard (ours passes even past expiry, anyone else's or none = `lease_lost`, nothing written); header into the OLDER A/B slot with CAS on that slot's `save_seq`, `save_seq = newest + 1`, `origin_kind = 'room'`, `saved_by = instance`; chunk rows into the older version; `stored_bytes` and `last_played_at` mirrors. Zero-row header CAS rolls back and returns `lease_lost`.
  - Load: 3.7b rule. H = highest header `save_seq`; per chunk the valid version with the highest `save_seq <= H`; versions newer than H ignored; a CRC/inflate failure falls back to the other version, never forward; no valid qualifying version or a bad room header = `RoomSaveCorruptError`.
  - Chunk codec is zlib `deflate` with signed CRC32, identical to the solo upload, so a Contract moving between solo and private loads either host's rows.
  - Usage: `addEgress` upsert adds to the day row (clamped, validated `YYYY-MM-DD`), `monthEgress` sums by month range.
- `room-suite.ts` (`runRoomSuite`): 12 conformance tests (lease exclusivity/expiry/renew/release, load null, refuse without lease, round trip with only dirty chunks, 7 alternating slots, bounded stored bytes, expired-but-ours vs stolen, bakeHash, egress sums/clamps). Run by `room-memory.test.ts` and `room-postgres.test.ts`. The Postgres file adds 6 specifics: slot/version layout and Contract mirrors, bit-rot fallback and ignoring newer-than-header versions, corrupt chunk/header, deleted/missing Contract, input validation with full rollback, real DB clock when no test clock.
- Interim room header: codec `room-v0`, blob = 0 or 32 bytes (bakeHash). The MCSV envelope (wallet, gear) is still not persisted by rooms; it replaces this blob with no migration.

## 2. SIGTERM checkpoint and bakeHash (apps/server)
- `persistence/checkpoint-rooms.ts`: `checkpointRooms(rooms, {deadlineMs})` runs every room's checkpoint in parallel, returns `{rooms, saved, failed, timedOut, ms}`, never waits past the deadline (default 10 s of the 25 s shutdown budget). `app/server.ts` `shutdown()` runs it over every live `ShiftRoom` (found via `matchMaker.query` + `getLocalRoomById`) BEFORE `gracefullyShutdown`; the room `onDispose` then writes anything newer and releases the lease. Exposed as `ServerApp.shutdownCheckpoint()`.
- `server.ts` now builds `createPostgresRoomRepository(db)` for PERSISTENCE_DRIVER=postgres (the "not durable yet" warning and the duck-type guard path are gone); seams `roomRepository`, `bakeHash`, `shutdownCheckpointDeadlineMs` on `StartServerOptions`.
- bakeHash: `DurableShiftDustStore({bakeHash})` writes it with every checkpoint and refuses a stored save whose recorded hash differs (`save_corrupt`, lease returned, nothing written). `RoomSaveCorruptError` maps to `save_corrupt` without marking the link down. The per-chunk `bakeCheck` byte was already enforced by `DustRestoreJob` in strict restore.
- Tests (persistence.test.ts, 7 new): corrupt mapping with link still healthy, same-bake load, other-bake refusal with no write over the real save, no check without a hash, parallel drain with failed/timed-out/hung rooms, deadline return, no rooms.

## 3. HTTP 409 CONTRACT_BUSY (app/server.test.ts)
Boots the real server over HTTP with a shared memory room repository: another instance holds the lease -> `POST /v1/contracts/:id/join` = 409 `{error:"CONTRACT_BUSY"}` with `retry-after: 5` and `/readyz` shows 0 rooms; repository offline -> 503 `RETRY_LATER`, 0 rooms; back online and free -> 200 and the room holds the lease. Second test: join a room, `shutdown()`, report `{rooms:1, saved:1}` and the lease is released.

## Gaps and notes
- The server world has no bakeHash yet, so `bakeHash` is not passed in production (`startServer` option only); wire it when the world bake exists (also pass `bakeCheckOf(hash)` as `ShiftRoomDeps.bakeCheck`).
- The shutdown integration test closes a room with a clean ledger (checkpoint is dirty-only), so it proves ordering, report and lease release, not a dirty write at SIGTERM; dirty writes are covered by the store/repo tests and the existing shift-room dispose test. No header-only checkpoint exists because rooms persist no header yet.
- The room header blob (wallet, gear) remains open (needs the sim checkpoint envelope, not a backend-only change), as do the earlier review lows (ShiftCore clocks, `as never` comment, W5-T07 N5 boundary tests); I did not touch shift pacing code.
- `contract_dust_chunks` recovery nuance: "older version after a fallback load" is chosen by lower `save_seq`; with atomic transactions an orphaned higher-seq version can only exist after header corruption, which `room-v0` headers detect by CRC.

## Continuation 2026-11-15 (encode slicing)
- Re-verified on disk: `packages/db` tsc clean, 129 passed / 2 skipped; `apps/server` tsc and eslint (`src/net/shift src/persistence src/app`) clean.
- Encode slicing DONE: `ShiftDustPersistence.save` now encodes dirty chunks in `SHIFT_ENCODE_SLICE_BUDGET_MS` (1.5 ms) slices: first slice synchronous, a macrotask yield between slices (none after the last chunk), dirty mark cleared per chunk as it is encoded, so a stroke between slices re-marks its chunk for the next save. At least one chunk per slice; overlapping saves chain; failed write re-marks as before. New counter `encodeSlices`; budget is an optional constructor arg (tests use 0 to force one chunk per slice). A single chunk's encode time is not split further.
- Tests (`net/shift/shift-ledger.test.ts`, +2): slices equal the dirty chunk count, nothing lost, restore into a fresh ledger gives the same worldHash; a stroke between slices keeps its chunk dirty. `vitest run src/net/shift src/persistence src/app`: 8 files, 69/69.
- Full `apps/server` vitest under machine load (other agents running): 1 to 4 files failed on timeouts only (`admission-ws-rooms` hook 40 s, `uws-boot` 30 s, `seat-cap-idle` timing); passed in the earlier clean run (344/344). Not related to this change; re-run on a quiet machine.
- Still open: room header blob (wallet, gear), production `bakeHash` (no server world bake yet), review lows (ShiftCore clocks, `as never` comment, W5-T07 N5 boundary tests).

## Review lows closed (2026-11-15, second continuation)
- **ShiftCore clocks:** `shift-room.ts` now passes `Date.now()` to `new ShiftCore(..., Date.now())`, `addSeat(..., Date.now())` and `resumeSeat(..., Date.now())`. The seat input buckets were created and reset on the `performance.now()` default but fed `Date.now()` in `receiveInput`; they now share one wall clock.
- **`as never`:** removed. `queueIntent(..., intent.data, ...)` type-checks as is (the zod `ControlIntent` output matches the `ControlIntent` interface), so no cast or comment is needed.
- **W5-T07 N5 boundary tests:** the per-chunk (421,959 accepted / 421,960 `size_limit`) and 32 MiB + 1 B (`size_limit`) tests were already in `api/checkpoints/checkpoints.test.ts`. I added the missing accepted side: exactly 32 MiB declared raw is accepted (200).
- **Evidence (focused only):** `vitest run src/api/checkpoints src/net/shift`: 6 files, 74/74; eslint clean on the touched files; prettier applied. `tsc -p apps/server` currently reports 4 errors in `packages/sim/src/room/moon-room-sim.ts` (`plotAtXYZ`, `cellCapGrams`), which is another agent's in-progress edit and not in my paths; no errors in apps/server or packages/db files.
- Not touched: room header blob, production `bakeHash`. Full server suite not run (machine load).
