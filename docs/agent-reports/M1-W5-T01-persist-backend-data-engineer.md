# M1-W5-T01 persist (backend-data-engineer)

Status: item 2 (room header blob) done and tested. Item 3 (encode slicing) was already done earlier; I re-verified it. Item 1 (real bake hash) is done (2026-11-15). No git, no installs, no servers left running.

## 1. Real bake hash at server start: DONE (unblocked 2026-11-15)

- `TERRAIN_BAKE_HASH` is now exported from `@moon-cleanup/world` (`packages/world/src/height/bake-hash.ts`, checked against `assets/terrain/manifest.json` by `tools/terrain-bake/src/bake-hash.test.ts`).
- `apps/server/src/app/server.ts`: `DurableShiftDustStore` now gets `bakeHash: options.bakeHash ?? TERRAIN_BAKE_HASH`, so every checkpoint header carries the real bake hash and a save written for another bake is refused (`save_corrupt`, 4108) with the real save untouched. Saves with no stored hash (written before this) still load. `@moon-cleanup/world` was already in `apps/server/package.json`; no install, no lockfile change.
- Test: `apps/server/src/persistence/persistence.test.ts` "stamps the real TERRAIN_BAKE_HASH": a save of that bake restores, a save of a bake differing by one nibble is refused with the commit count unchanged. (The earlier tests cover the same refusal with synthetic hashes.)
- Caveat kept: the server world is still `createShiftWorld()` (flat ground), so the stamp states the bake the world will use, not yet the world the room simulates. `bakeCheckOf(hash)` as `ShiftRoomDeps.bakeCheck` is still open (needs the baked server world).
- No end-to-end HTTP test of the refusal: the load runs in room creation after the join route, which needs a Colyseus WebSocket client.

## 2. Room header blob persistence: DONE

The wallet now survives a room restart.

- `packages/db/src/repositories/room-header.ts` (new). Codec `room-v1`: a flags byte, then the optional 32-byte bake hash, then the optional float64 wallet (at most 41 bytes). The decoder rejects bad flags, wrong lengths and NaN or negative wallets.
- `room-v0` (empty blob or a 32-byte hash) is still read, so existing rows load. New writes use `room-v1`. No migration is needed; `codec` is a text column.
- `room-types.ts`: new `RoomHeaderState {walletLm}`. `RoomCheckpointInput.state?` and `RoomSnapshot.state` are added, plus `ROOM_HEADER_CODEC_V0`. `chunks` may be empty, which is a header-only checkpoint.
- `room-postgres.ts` and `room-memory.ts` both encode and decode through the codec. A bad wallet is rejected with a `RangeError` before any write. A header that fails its CRC or decode is still refused as `RoomSaveCorruptError`.
- Server:
  - The `ShiftDustStore` port gets `save(..., state?)` and `loadState?`.
  - `MemoryShiftDustStore` and `DurableShiftDustStore` implement both.
  - `ShiftDustPersistence` gains `restoredState` and `setStateProvider`. It writes a header-only checkpoint when only the wallet changed, still at most every 30 s and only when dirty.
  - The baseline is the stored wallet, or the starting wallet for a never-saved Contract, so a pristine room never writes a header.
  - `ShiftRoom` passes the restored `walletLm` to `ShiftCore` and registers the provider (`core.sim.wallet`).
- Open: gear and anything else in the sim are not persisted. That needs the MCSV header envelope from the sim, which does not exist yet; `ShiftCore` only accepts `walletLm` to restore.

## 3. Encode slicing: already DONE (W5-T01b)

Re-verified, not changed. `ShiftDustPersistence.encodeSliced` encodes in 1.5 ms slices with a macrotask yield, and its tests still pass.

## Tests added

- `packages/db/src/repositories/room-header.test.ts` (new): codec round-trip, malformed input, v0 read, encode validation.
- `room-suite.ts` (runs against both memory and PGlite SQL): state round-trip, header-only checkpoint, last header wins, `bakeHash` and `state` null when omitted, negative or non-finite wallet rejected with nothing written.
- `room-postgres.test.ts`: the codec expectation changed from `room-v0` to `room-v1`.
- `apps/server/src/persistence/persistence.test.ts`: store round-trip of state across instances, including a header-only save.
- `apps/server/src/net/shift/shift-ledger.test.ts`: persistence writes nothing when unchanged, writes a header-only checkpoint when the wallet changed, restores it; `ShiftCore` starts with the restored wallet.

## Evidence (Node 26 PATH prefix)

- `packages/db`: `vitest run src/repositories` 5 files, 105/105 (includes the PGlite SQL suite). `tsc --noEmit` clean. `eslint src/repositories` clean. Prettier applied.
- `apps/server`: `vitest run src/net/shift src/persistence src/app` 9 files, 75/75. `tsc --noEmit` clean. `eslint src/net/shift src/persistence src/app` clean. Prettier applied.
- The full server suite and the sim allocation test were not run.

## Left open

- `bakeCheckOf(hash)` as `ShiftRoomDeps.bakeCheck`, once the server world is baked.
- Gear and other sim state in the room header (MCSV envelope).
- `room-postgres` tests run on PGlite, not a Neon test schema (`_aN`); a run against real Postgres is still not done.

## Evidence 2026-11-15 (bake hash wiring, Node 26)

- `apps/server`: `vitest run src/persistence src/app` 3 files, 33/33. `tsc --noEmit` clean. `eslint src/app src/persistence` clean. Prettier unchanged.

## Review fix (2026-11-16, netcode-security review B1, N3, N4 + purchase casing)

- **B1 closed and proven by a regression test.** The collected Near Parcel mask is now saved next to the wallet and restored into the sim when the room is created. Header codec `room-v2` adds flag bit2 plus one mask byte (the mask is only valid with the wallet). `room-v1` and `room-v0` are still read. The new test `shift-ledger.test.ts` "review B1" runs a full room lifetime twice through the ShiftRoom wiring (restore, ShiftCore built from the header, seats, ticks, `close`). The first run pays one parcel. The second run restores mask 1, pays nothing (zero `collectible.found` events), and the wallet stays at one parcel's worth.
- **Legacy policy:** a `room-v1` header (wallet, no mask) has its wallet restore skipped (start wallet, mask 0) and logged with a warning. The stored header stays the dirty baseline, so the next checkpoint rewrites it as `room-v2`. `room-v1` was never deployed (uncommitted diff), so in practice no wallet is lost.
- **Wallet bound (N4):** the codec rejects wallets above `ROOM_WALLET_MAX_LM` (= MAX_SAFE_INTEGER, the sim checkpoint cap). The server clamps a restored wallet to `SHIFT_RESTORED_WALLET_MAX_LM` and logs it. game-data has no wallet-cap constant; adding a tighter cap is a balance decision.
- **Rollback (N3):** a header codec this build cannot read loads the chunks and comes back as `RoomSnapshot.ignoredHeaderCodec`. The durable store logs a warning ("header state reset"), so the reset is no longer silent. A pre-fix server still cannot read `room-v2`; it resets the wallet and parcels together, so nothing can be farmed.
- **Smallest additive sim change:** `MoonRoomSimOptions.nearParcelsCollected?: number` (bits past the parcel count are masked off). The server also gets `ShiftCoreOptions.nearParcelsCollected` and a `spawnDirection` test seam.
- **Purchase casing:** a rate-limited purchase now answers `purchase_result {ok:false, code:"rate_limited"}`, typed as `PurchaseResultPayload`. It used to send "RATE_LIMITED", which the client schema dropped. The test in `shift-room.test.ts` sends a burst of 12 and schema-parses every result.
- Evidence (Node 26.13.1): db `room-header`, `room-postgres`, `room-memory` 3 files 42/42. Server `shift-ledger`, `shift-room`, `shift-state`, `shift-core`, `src/persistence` 5 files 56/56. Sim `exploration`, `room-sim`, `checkpoint` 76/76. `tsc --noEmit` clean in db, sim and server. eslint clean and prettier applied on all 15 changed files. Full `pnpm verify` not run.
- Next: gear/upgrade persistence (needs the sim MCSV envelope, N1). Re-bake policy / distinct non-retryable close for `bake_mismatch` (N2). An audit of other one-shot payouts (achievements, tricks) for the same restart farm.

## One-shot reward audit + gear persistence (2026-11-16, review follow-up to B1 / N1)

### Audit: one-shot reward sources across a ShiftRoom restart
There are only three wallet credits in the sim: the Stamp (`moon-room-sim.ts:1317`), Near Parcels (`:2075`) and dust sales (`:2134`). The server pays nothing on any sim event; no handler for `achievement.unlocked`, `shine.milestone` or `plot.polished` adds value.
- **Stamp / `plot.polished`: safe.** Plot state comes from the dust chunks, which are persisted. The restore drops queued Polished and Opened events (`shift-persistence.ts` `truncateEventQueues(0,0)`), and the sim constructor clears both queues (`moon-room-sim.ts:478-479`). A polished plot stays polished, so its Stamp cannot be paid twice.
  - **Crash window: FIXED.** The header state used to be read *after* the sliced chunk encode. A periodic save could therefore store a wallet that already held a Stamp or sale for dust the stored chunks still showed. A crash before the next save would then pay it again on restart. The state (and the sim META) is now captured before the first chunk is encoded, so the worst case loses a payout and never doubles one. Test: "captures the header state before the first chunk is encoded".
- **Dust sales: safe.** Swept dust leaves the persisted ledger. Cargo in Dust Cells and pucks is not persisted, so a restart loses it and pays nothing. The same ordering fix applies.
- **Shine milestones / Contract Fulfilled (100 %): safe.** These are announcements only, with no payout. `shineNext` is rebuilt from the restored `shinePolished` (ctor `:568`, restore `:1056`).
- **Achievements: safe (cosmetic only).** They are events only and carry no Lm. `addActor` resets the per-slot tracker (`:696`), so leave/rejoin can re-announce a toast even without a restart. That behaviour existed before this work. Nothing is paid. If a later profile layer pays for unlocks, it must deduplicate per player.
- **Near Parcels: fixed earlier** (review B1, `room-v2` mask).
- **Promotions Board (Stamp Premium etc.) / Roosts / tools / suit gear:** these were lost on restart (N1). That cost the player but could not be farmed. They are now persisted (below).
- **Contracts (REST create/join):** grant nothing.

### N1 gear persistence: DONE (no sim change)
- **Header codec `room-v3`** (`packages/db/src/repositories/room-header.ts`). It adds flag bit3 with the sim META section after the mask: u16 version, u16 length (1..8192 = `SIM_CHECKPOINT_META_MAX_BYTES`, checked in a test), then the bytes. The section is valid only together with the wallet and the mask, and it is copied on decode. The new `ROOM_HEADER_CODEC_V2` keeps v2 readable, and v1/v0 still read too. A v3 header without the section is byte-identical to v2. A pre-v3 server sees `room-v3` as an unknown codec: wallet, parcels and gear reset together and it is logged (N3 path), so nothing can be farmed.
- **Server (`shift-core.ts`):**
  - `captureSharedMeta()` = `sim.captureCheckpoint().meta`, only at write time, so the tick does not dirty the header.
  - `restoreSharedMeta()` = `sim.restoreCheckpoint` with an empty PLAYERS section. It runs only before the first seat and throws otherwise.
- **Restore (`shift-room.ts`):** the room restores the META after building the core from the header wallet and mask.
  - The META brings back Standard Issue tools, Repeat Requisition copies, suit gear, board levels, Roosts, wallet, parcels and the tick (the sun clock continues).
  - If the section is refused, the room keeps the header wallet and mask and logs a warning.
  - Per-slot keys (`ach.N`, holster) are reset again by `addActor`.
- **Dirty signal:** the dirty check is still wallet + mask. Every purchase lowers the wallet, so it also triggers the gear write. The one gap is a price-0 purchase, which only a 100 % discount could produce.
- **Tests:**
  - db: v3 round-trip, malformed sections, v2/v3 byte compatibility, `room-v2` relabelled row read via SQL.
  - server: "review N1" runs two full room lifetimes. The tool and `gear.holster_rig` bought in room 1 are refused on re-buy in room 2 (`already_owned` / `max_level`), the wallet equals the amount left after spending, and the tick continues. A further test covers a refused META.

### Evidence (Node 26.13.1)
- **db:** `vitest run src/repositories` 5 files, 109/109.
- **server:** `vitest run src/net/shift src/persistence` 7 files, 71/71. Re-run of `shift-ledger` after the last fix: 14/14.
- **sim:** `test/unit/checkpoint.test.ts` 53/53. Sim source is unchanged.
- `tsc --noEmit` clean in db and server. eslint clean and prettier applied on all 12 changed files.

### Next
- The board-level restart is covered only through the same META key path. `node.densifier` was refused in the test's single-tick buy, probably by the race window or a prerequisite. A board-node regression test, which needs a node with no prerequisite bought on its own tick, is still open.
- Full `pnpm verify` not run. The concurrent dust-module writer (a88ea30f00b10fee0) should re-run the server suite after merging. I touched `shift-persistence.ts`, `shift-core.ts`, `shift-room.ts` and `durable-dust-store.ts`.
- N2 (bake_mismatch close policy) is still open.

## Hardening (re-review N5-N8, 2026-11-16)
- **N7 META-only dirty (fixed).** `metaSignature()` (shift-persistence.ts) blanks the day phase (byte 3) and tick (bytes 8..15) of META v1; `savedMetaSig` is the baseline (the META the sim started with, so a pristine room writes nothing). `maybeSave` probes at most every 5 s (`SHIFT_META_PROBE_INTERVAL_MS`, one capture per room per 5 s, event time); `save()`/`close()` always probe, so a change inside the throttle window is still written. A failed write keeps it dirty. Unknown META version: signature null, META-only check off (wallet/chunk writes unaffected). A test pins the offsets against the real sim.
- **N8 encode/capture throw (fixed).** `save()` now has a `.catch` (logs "shift dust checkpoint encode failed", counts `saveFailures`, backoff via `retryAtMs`). `encodeSliced` re-marks already-encoded chunks dirty on a throw. A synchronous `store.save` throw is a failed write too. The next checkpoint retries and writes everything.
- **N5 unknown header codec (fixed, fail closed).** `DurableShiftDustStore.load`: when the header codec is unreadable and the build stamps saves (`bakeHash` set), the room is refused `save_corrupt` ("bake_unverifiable"), lease returned, nothing written, logged at error. Without a bake hash the N3 behaviour stays (dust loads, header reset, logged). Effect: a rollback to a build older than the newest codec refuses those Contracts until roll-forward, instead of silently resetting wallet/gear and overwriting the newer header. Legacy headers with no stored bake hash (v0, pre-stamp) still load and are stamped at the next checkpoint (deliberate).
- **N6 (log and note only).** shift-room.ts logs "sim META version changed: purchased gear ... lost" on `unsupported_version`; note on `ShiftRoomState.simMeta`. No migration.
- **Finding, not fixed (not my paths):** `ShiftRoomDeps.bakeCheck` is never set by `server.ts` (always 0), so the chunk-level bake byte is not enforced at all; only the header-level hash protects. Wiring it to `TERRAIN_BAKE_HASH`'s first byte is a one-line change in `apps/server/src/app/server.ts` (devops/lead).
- **Tests added:** `apps/server/src/net/shift/shift-persistence-hardening.test.ts` (8), `apps/server/src/persistence/rollback-bake.test.ts` (2).
- **Evidence (Node 26.13.1):** db `src/repositories` 109/109; server `src/persistence` 25/25; `src/net/shift` 81/82, the one failure is `shift-dust.test.ts` "5 s DUST_CHECK chunk summary" (`chunkChecksSent` 209 vs 8), in the other agent's in-flight shift-dust/shift-core work, not persistence. tsc (server) clean; eslint and prettier clean on changed files.

### N2 options brief (permanent bake mismatch after a re-bake) for the lead
Today every save stamped with the old `TERRAIN_BAKE_HASH` is refused (`save_corrupt`, retryable-looking but permanent) after any re-bake.
1. **Refuse + distinct non-retryable close (status quo plus clarity):** safest for data, but players are locked out of their Contract forever.
2. **Archive and start fresh:** on mismatch, rename/copy the rows to an archive slot (or mark the Contract `archived_bake`) and start a pristine world with an explicit client notice; wallet/gear reset. Data kept for manual recovery.
3. **Re-bake migration:** only valid if the bake change is terrain-only and chunk geometry is unchanged; needs a per-bake compat list. Costly; only worth it for a planned re-bake.
**Recommendation: 2**, behind the owner's OK on the reset, with a non-retryable close code for case 1 until then. Deadline is Nov 17: if no re-bake is planned before it, leave as is and freeze `TERRAIN_BAKE_HASH`.
