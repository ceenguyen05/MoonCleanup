# M1-W4 archive-on-hash-mismatch (backend-data-engineer)

Status: server/db part already implemented (earlier work); verified, no new code needed. Wire notification NOT done (needs a decision).

## Found in tree
- `packages/db/migrations/0004_w5_room_save_archives.sql`: additive (two new tables, one index, FKs unqualified for search_path). Expand-only, safe on Neon.
- `RoomSaveRepository.archiveRoomSave(owner, reason)` in room-types.ts; memory (`room-memory.ts`) and Postgres (`room-postgres.ts`) implementations; lease-guarded single transaction, verbatim move, nothing deleted. Admin restore CLI: `restore-archive-cli.ts`.
- `DurableDustStore.load` (apps/server/src/persistence/durable-dust-store.ts ~222-246): on bakeHash mismatch it archives, bumps `counters.archives`, logs a warn, returns `[]` (fresh room). Rollback-unreadable header still fails closed (`bake_unverifiable`).

## Evidence
- `packages/db` vitest (repositories + migrate): 7 files, 127 passed, 2 skipped (no real Neon needed).
- `apps/server` vitest persistence: 2 files, 27 passed (includes archive cases).

## Update: `saveArchived` wired (owner/coordinator decision: optional one-shot field on HELLO)
- Schema (the HELLO schema lives in shared, not packages/protocol): `packages/shared/src/protocol/payloads.ts` `HelloPayloadSchema.saveArchived: z.literal(true).optional()`. PROTOCOL_VERSION unchanged. Old clients' zod objects strip the unknown key (tested with `.omit`).
- Server: `DurableShiftDustStore.takeArchived(contractId)` (one-shot, set in `load` only when archive really moved rows); `ShiftDustStore.takeArchived?` port; `ShiftDustPersistence.restore` sets `archivedOnRestore`; `shift-room.ts` `onJoin` sends `{...hello, saveArchived: true}` to the FIRST joiner only; reconnect and later joiners get plain HELLO.
- Tests: payloads.test.ts (absent/true/false/old-schema), persistence.test.ts (takeArchived true then false). Shared + server persistence/ledger vitest pass; tsc clean in shared and apps/server.
- Client consumption point: `apps/client/src/net/room-session.ts` ~line 531, where `HelloPayloadSchema.safeParse(payload)` succeeds and `core.onHello(now(), hello.data)` is called. Read `hello.data.saveArchived === true` there and surface a one-time "world was rebuilt; archived, starting fresh" notice via the existing kind/error channel (UI worker). `onHello` in packages/protocol session ignores the extra field.
- Not covered: no room-level integration test of the actual HELLO send (the logic is 6 lines in onJoin).

## (superseded) Gap: client is not told
Nothing on the wire says "archived, starting fresh"; grep shows `archived` only inside server persistence. Proposed minimal additive field (not implemented; protocol is contracts-architect territory and the client edit is out of my scope):
- Server: `DurableDustStore.load` records `archivedOnLoad: {archiveId}` for the contract (one-shot, like `loadState`), room reads it and includes `saveArchived: true` in the join/welcome message (or a one-shot room event `save_archived`).
- Client: show a one-time "world was rebuilt; starting fresh" notice.
Decision needed: welcome-field vs event. Say which and I will wire the server side.

## Other backend/DB gaps
- Big (blocked on Cee): room-postgres against real Neon (needs a test DB URL/secrets; PG-level tests currently run on the local/test schema only).
- No small gaps found in scope. Archive tables have no retention policy (storage counts against the 1 GB cap); suggest a manual admin purge later.
