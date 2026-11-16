# M1 online/persistence batch: netcode-security review

Task / status: review complete / 2026-11-15 / netcode-security-reviewer / Opus 5.5
File state: working tree on main at b7c4221 plus uncommitted diff (git diff read-only).
Scope: ShiftState v1.1 `nearParcelsCollected` (shared protocol + sim shift-state, server shift-state.ts/shift-room.ts),
shift-persistence.ts room state, durable-dust-store.ts, packages/db room-header/room-postgres/room-memory/room-types,
server.ts bakeHash default, client online-room/remote-room-host/online-readouts/parcel-feed.

## Verdict: CHANGES REQUESTED (1 blocking)

### B1 (blocking, authority): persisting the wallet without parcel state lets a player farm Near Parcels for Lumens
- What's wrong: the room now saves `walletLm` (shift-persistence.ts:278-307, shift-room.ts:201/205), but the
  collected-parcel mask is not saved. `MoonRoomSim.parcelsCollected` starts at 0 in every new room
  (moon-room-sim.ts:388). In a room it is only restored by the sim checkpoint (moon-room-sim.ts:1033), and rooms
  never load one; ShiftCore takes only `walletLm` (shift-core.ts:263). Each parcel pays `parcelLm` (30 Lm,
  collectibles.json:4; moon-room-sim.ts:2069).
- Exploit: join a private Contract, walk over the Near Parcels (MVP count, up to 8, 30 Lm each), then leave. The room
  empties and disposes, and `persistence.close` writes the wallet (shift-room.ts:387). Rejoin: the restored wallet is
  kept and the parcels are uncollected again. Repeat for unlimited Lumens. Before this diff a restart reset the wallet
  too, so nothing could pile up. The new wallet persistence is what makes the farm possible.
- Fix options: (a) save the parcel mask in the room-v1 header next to the wallet (add a flag bit, pass it to ShiftCore
  and the sim options) and add a restart test; or (b) don't restore the wallet until the MCSV envelope persists every
  one-shot reward. Before restoring the wallet, check every other one-shot payout too.

### Non-blocking
- N1 (save integrity, already-known gap): spending is lost on restart. Purchases lower the persisted wallet, but the
  gear/upgrades bought are not saved (persist report line 27). Players lose both the Lumens and the item when a room
  restarts. Track it with B1.
- N2 (refusal path): the server now always stamps `TERRAIN_BAKE_HASH` (server.ts:175). The server world is still flat
  (persist report caveat). Any re-bake makes every stamped room save permanently refused: `bake_mismatch` becomes
  `save_corrupt` and then a 503 retry (durable-dust-store.ts:213-215). Confirm that policy before saves pile up, or
  give the player a distinct, non-retryable close reason.
- N3 (rollback compat): a pre-diff server ignores the `room-v1` codec (it matched only `room-v0`). Its bakeHash is then
  null, it loads the chunks, and its next checkpoint writes room-v0. The wallet silently resets on rollback. Nothing is
  refused or corrupted.
- N4 (bounds): `decodeRoomHeaderV1` checks finite and >= 0 but has no upper bound (room-header.ts:63). The sim
  checkpoint caps at `MAX_SAFE_INTEGER` (checkpoint.ts:434). Use the same cap for consistency.

## Verified OK
- Trust boundary: the wallet and the parcel mask are computed on the server only. Purchase and select_tool go through
  zod plus a token bucket on the server (shift-room.ts:228-236, 544-560). The client never sends a bakeHash or state.
- Schema v1.1: the field is appended (field index stable), the client reads it through reflection, and it is optional
  in the zod schema. The client adapter treats a missing or malformed mask as unknown (remote-room-host.ts
  shiftStateViewOf, online-readouts.ts:135-148).
- Stale connections: the tapFrames left-flag plus the connGen guard block late patches and FRAMEs. `sendControl`
  requires a joined/resyncing phase and the newest connection.
- DB: drizzle with bound parameters only. The v1 header is exact-length, rejects bad flags/NaN/negative values, and is
  CRC-checked. A bad wallet is rejected before any write (memory and SQL). An empty-chunk header-only commit is safe
  (room-postgres.ts:276).
- Solo hot path: the ParcelFeed change adds one boolean and no allocations. `nearParcelsMask` allocates nothing.
  The online adapter allocates only per Schema patch.
- Evidence: Node 26.13.1. db `room-header` + `room-postgres` tests: 25/25 pass. Server `shift-ledger`, `persistence`,
  `shift-state` tests: 35/35 pass.

## Not covered
- Full SIGTERM drain-ordering test.
- online-readouts.ts outside noteState/noteEvents.
- boot.ts/ui wiring of clearNearParcels.
- Whether any other one-shot reward (beyond parcels) can be farmed.
