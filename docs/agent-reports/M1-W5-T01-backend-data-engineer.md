# M1-W5-T01 durable room storage (backend-data-engineer)

Status: PARTIAL. Core durability layer written and compiling; no new tests, not wired into server.ts, eslint not run.
Scope kept to apps/server (no packages/db, apps/client, packages/sim, goldens). No git. No Postgres.

## Update (continuation)
Status: tests, server.ts wiring and the 409 preflight are DONE. Evidence: `tsc` clean, `eslint .` clean, full `vitest run` in apps/server 27 files, 326/326 pass (includes new `persistence/persistence.test.ts`, 14 tests: lease exclusivity/expiry/renewal/loss 4108, checkpoint lease_lost writes nothing, unreachable renewal is not a loss, restore round-trip, strict refusal, corrupt save, failed save then recovery, new rooms refused during backoff, StorageLink 1-2-4-8-16-30-30-30 s backoff and timeout, UsagePersister seed/delta/failed-write retry).
- `app/server.ts`: `DurableShiftDustStore` over `MemoryRoomSaveRepository` (or the db repo once it implements the ports); `UsagePersister` seeded and started after listen, flushed in `shutdown()`; warn logged when driver is postgres (not durable yet).
- `net/shift/shift-join.ts` + `net/game-server.ts`: `ensureLease` preflight before seat reservation: busy -> 409 CONTRACT_BUSY, storage down -> 503 RETRY_LATER (retry-after 5). No dedicated HTTP-level test of the 409 yet (the store-level busy verdict is tested).
- Known behaviour: after a failed load the link is down so the lease release is skipped and the lease expires on its own (35 s); a retry by the same instance re-acquires immediately.
- Still open: SQL repos in packages/db, bakeHash check, room header blob, SIGTERM checkpoint of every room and encode slicing, review lows (ShiftCore clocks, `as never` comment, W5-T07 boundary tests), HTTP-level 409 test.

## Evidence (first pass)
- `tsc -p apps/server --noEmit`: clean (no output).
- `vitest run src/net/shift src/ops`: 7 files, 86/86 pass (after my edits to shift-persistence, shift-room, bandwidth).
- eslint: NOT run. New persistence files: NOT tested.

## Done (code only)
New `apps/server/src/persistence/` (barrel `index.ts`):
- `ports.ts`: `RoomSaveRepository` (lease acquire/renew/release, loadRoomSave, commitRoomCheckpoint), `UsageRepository` (ops_usage_daily), `ContractUnavailableError` (busy | storage_down | save_corrupt | lease_lost).
- `memory-room-repository.ts`: in-memory implementation with fake DB clock, 35 s lease CAS, generation, `offline` switch.
- `storage-link.ts`: outage state, per-call timeout, backoff 1 to 30 s (uses `backoffDelayMs` from packages/db), `canAttempt`.
- `durable-dust-store.ts`: `DurableShiftDustStore` implements `ShiftDustStore`: `ensureLease` (busy -> 409 path, storage down -> refuse new room), 10 s renewal (unreachable is not a loss; CAS `lost` fires 4108 listeners), strict restore, release after final save.
- `usage-persister.ts`: seeds egress from `ops_usage_daily`, writes deltas every 10 min and on `flush()`; failed writes return bytes to the counter.
- `guards.ts`: duck-type guards so the composition root can switch on once packages/db implements the ports.

Edits to existing files:
- `net/shift/shift-persistence.ts`: `ShiftDustStore` gains optional `strict`, `release`, `onLeaseLost`; strict restore rethrows on load failure or rejected chunks (no pristine start over a real save); `maybeSave` has no pile-up and retries with backoff after a failure; new `close()` (final save then release), `abort()`, `watchLease()`.
- `net/shift/shift-room.ts`: restore failure aborts room creation (lease returned, nothing written); lease loss closes with `CloseCode.CONTRACT_UNAVAILABLE` (4108); `onDispose` uses `close()`.
- `ops/bandwidth.ts`: `takeUnpersisted` / `returnUnpersisted` (seed does not count as unpersisted).

## Open (not done)
1. Tests for everything in `persistence/` (lease busy/lost, outage + backoff with fake clock, restore refusal, save/restore round-trip through the room, egress seed/flush/failure). Highest priority.
2. Wiring in `app/server.ts`: choose `DurableShiftDustStore` when the repo passes `isRoomSaveRepository` (memory driver can use `MemoryRoomSaveRepository`); start `UsagePersister` (seed at boot, `flush()` in `shutdown()` before `db.close()`).
3. Join preflight in `net/shift/shift-join.ts`: call `store.ensureLease` before `reserveShiftSeat`; map `busy` -> 409 CONTRACT_BUSY, `storage_down` -> 503 RETRY_LATER.
4. packages/db (out of scope here): SQL `RoomSaveRepository` (lease CAS per data-model 3.5, A/B header slot + chunk versions per 3.7/3.7b, `stored_bytes`) and `UsageRepository` upsert. `commitSoloCheckpoint` refuses non-solo, so no durable rows until this exists; Postgres runs stay on the process-memory store.
5. Room header blob (sim checkpoint: wallet, gear) is not persisted by rooms, only dust chunks. SIGTERM "checkpoint every room dirty or not" and the 1.5 ms/tick encode slicing are not done (encode is still all dirty chunks at event time).
6. `bakeHash` check on restore: not done (`bakeCheck` still 0 until the server world is baked).

## Items from the brief already satisfied before this task
- `plot.polished` wire test exists (`shift-room.test.ts:352`); dust streaming to late joiners and in-memory ledger persistence exist (W4-T03/W4-T06 rows say done). STATUS.md line 33 is stale.

## Second-pass review lows (apps/server)
Not done: ShiftCore mixed clocks (`performance.now()` defaults vs `Date.now()` in shift-room; fix = pass `Date.now()` to `new ShiftCore(...)`, `addSeat`, `resumeSeat` at `shift-room.ts` ~182/290/347); `intent.data as never` (~525) needs a justification comment; W5-T07 N5 boundary tests (421,959 / 421,960 B chunk, 32 MiB raw budget). review2 findings S1/S2/N1-N5 are not in apps/server.
