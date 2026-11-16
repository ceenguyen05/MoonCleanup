# M1 dust path and save sync security review (netcode-security-reviewer)

Scope: `apps/server/src/net/shift/**` (shift-dust.ts, shift-core.ts dust paths, shift-room.ts handlers, shift-persistence.ts), `packages/protocol/src/codec/dust-messages.ts` (request and check codecs), `apps/client/src/net/remote-dust.ts`, `apps/client/src/app/save-sync-wiring.ts`, `apps/client/src/sync/save-sync.ts` (resolveConflict), `packages/db/src/repositories/room-header.ts`, `room-postgres.ts`, `apps/server/src/persistence/durable-dust-store.ts`, `apps/server/src/api/checkpoints/service.ts` and `commitSoloCheckpoint` (overwrite). Read-only. No git. No secrets seen in the files read.

## Verdict: APPROVED (no blocking finding). Recommended fixes F1 and F2 before a public demo; the rest are low or notes.

Nothing found that lets a client gain unearned state, corrupt the ledger, crash or stall a room, or bypass auth. Findings ranked below.

## Findings

### F1 (Medium, non-blocking). One 1 s control message forces a full multi-KB snapshot every 2 s: small-request to large-reply amplification
- Path: `shift-room.ts:548-562` (`handleVisibility`, bucket `visibility` 1/s burst 1, `limits.ts:47`) -> `shift-core.ts:418-423` (`setHidden(false)` always calls `requestKeyframe`, even when already visible) -> `shift-core.ts:603-612` (`requestDustSnapshot`) -> `shift-core.ts:666-691` (build + send).
- Exploit sketch: a seated client that has painted heavily around its avatar (up to `DUST_SNAPSHOT_MAX_LEDGERS` = 1024 ledgers within 60 m, about 1 KB each raw) sends `visibility {hidden:false}` once per second. Each 2 s window the server builds a snapshot (`buildSnapshotRaw` loops all ledger slots, sorts, encodes, deflate level 6) and sends it, up to ~100+ KB per snapshot. A `{hidden:false}` is about 20 bytes. Five hostile seats in a 6 seat room means one build per frame tick most ticks (the one-build-per-tick cap holds) and egress of several hundred KB/s per room against the free tier.
- Bounds that already exist: `SNAPSHOT_MIN_INTERVAL_S` 2 s per seat (`shift-core.ts:667`), one build per frame tick (`:670`), moon-wide part cached, and a client that never completes (it resets `snapSlices` each second, `:606`) only starves itself. Measured storm cost 43 ms/s for 6 seats (follow-up report), so this is not a stall, but it is the cheapest egress lever a client has.
- Fix: a per-seat egress cap for dust bytes (for example a token bucket of snapshot bytes per minute that closes with RATE_LIMITED on sustained excess), or a longer cooldown (10 s) for `hidden:false` while already visible, or make `hidden:false` on a visible seat not request a snapshot unless the client asks via a dedicated, stricter-limited resync.

### F2 (Low). DUST_REQUEST chunk detail answered from "all plots" when the seat has no `dustSent` yet; any chunk id readable
- `shift-core.ts:722` passes `seats[slot].dustSent` (null until the first snapshot is built via `sentOf`), and `shift-dust.ts:455-466` with `sent === null` lists every Opened ledger of the chunk (up to 256, about 2.8 KB reply to a 3 byte request, 0.5 req/s max, so about 1.4 KB/s).
- Impact: plot hash and version of Opened plots of any chunk, before the seat has a snapshot. Plot states are already public moon-wide in the snapshot, so this is minor disclosure plus a small amplification. Fix: skip the answer when `dustSent === null` (a client without a snapshot has nothing to compare).
- Related nit: `pendingChecks` stores `(slot, chunkId)` until the next frame tick (`shift-core.ts:597-599, 718-725`); if the seat is reused in that window the new occupant gets the answer. Harmless (public data, one frame).

### F3 (Low). Plot DUST_REQUEST bypasses the stream interest radius
- `shift-core.ts:591-596`: any plot id below `plotCount` is enqueued (ids are validated in `decodeDustRequest`, `dust-messages.ts:118-127`; at most 8 per request, 0.5 req/s). The client can fetch full ledgers (texels, contributions with actor slots) of regions it is nowhere near. They are credit limited (`DUST_STREAM_BYTES_PER_S` 8 KB/s, `:692-706`) and the next scan forgets them, so cost is bounded.
- Impact: bypasses interest filtering, but the data is cosmetic and the same ledger data is public to all seats (dust is shared state). Optional hardening: only enqueue plots whose centre is within the seat's radius plus margin, or that sit in a chunk the seat's last check flagged.

### F4 (Low, robustness, client). A wanted plot that the server never answers still blocks chunk repair
- B1 from the code review is fixed for the Polished case: `remote-dust.ts:176-180` calls `removeWanted` when a Polished delta arrives.
- Still open: `nextRequest` (`remote-dust.ts:225-231`) serves wanted plots before wanted chunks and never gives up. A plot enqueue dropped because the server queue is full (`shift-core.ts:624-627`), or a plot whose ledger was freed without Polishing, keeps the plot wanted until the next snapshot, and chunk repair stalls. Add an attempt counter (drop after about 3 requests) and a test. Not an exploit by the client; a malicious server is out of scope.

### F5 (Low). `dust_interest` re-scans on every message
- `shift-room.ts:245-251`, `shift-core.ts:438-448`: the radius is clamped to 60..220 by `z.int().min().max()` (`world/dust.ts:451`, NaN and Infinity are rejected by zod), then `setRadius` invalidates the scan. At the control bucket of 10/s burst 20, a client forces up to 10 full interest scans per second over the ledger slots (bounded by the pool). Low cost. Optional: ignore the message when the radius is unchanged.

### F6 (Low, persistence). Bake identity check fails open for headers without a bake hash, and per-chunk `bakeCheck` is 0
- `durable-dust-store.ts:213`: refusal only when `snapshot.bakeHash !== null && !== this.bakeHash`. A legacy header with no bake hash (room-v0 empty or room-v1/v2 without flag bit0) plus chunks loads under a build that stamps saves. Only this server writes room headers, and a v3 header written by this build always carries the hash (`room-postgres.ts:259`), so the realistic exposure is old rows. Consider failing closed when chunks exist and the hash is null (or an explicit one-time migrate).
- `shift-room.ts:103,167`: `bakeCheck` defaults to 0 and `app/server.ts` never passes it, so the per-chunk byte in `DustRestoreJob` gives no protection; the header hash is the only guard.
- Note: `server.ts:175` stamps `TERRAIN_BAKE_HASH` while `server.ts:206` builds `createShiftWorld()` (flat ground, "until the server world API loads the bake"). The stamped hash does not prove the world the room actually ran; harmless today but make sure it is a conscious decision.

### F7 (Note, save overwrite)
- `commitSoloCheckpoint` with `overwrite: true` (`postgres.ts:790, 855-857`) skips the fast-forward compare-and-set, deletes all chunk rows and writes a full snapshot. Guards that remain: Holder only, `shiftType` solo, live-room lease check (`:751`), `generation > newestSeq` (`:809`), minimum interval, hard size cap, bounded inflate with a process-wide budget (`service.ts:241-275`), playtime and profile-credit plausibility capped by wall clock (`service.ts:305-349`). A hostile client can only overwrite its own solo Contract and cannot raise credit. A stale second device clobbering newer progress is possible only after the user picks `keep_local` in the prompt (`save-sync.ts:1104-1141`), which backs the server copy up first. By design (ADR-0031); no finding.

## Checked, no finding
- **Request codec**: `decodeDustRequest` requires 3..20 bytes, id byte, count 1..8, plot ids below `plotCount`, chunk id below `CHUNK_COUNT`, exact length and zero padding (`dust-messages.ts:114-132`). `receiveDustRequest` rejects bodies that do not fit its 32 byte scratch (`shift-core.ts:581`). No allocation from a client-supplied length. Duplicate plot ids in one request collapse via mark 2 (`:594`).
- **Rate limits**: `dustRequest` 0.5/s burst 1 (`limits.ts:38`), malformed or over-rate counts as a violation, 50 per 10 s closes the socket (`limits.ts:51`, `shift-room.ts:632-642`); inbound bytes limited (`:614-630`). `pendingChecks` is capped at 12 entries (`shift-core.ts:597`).
- **Per-seat state is fixed size**: `dustSent` one byte per plot (163,842 B), `streamQueue` 1024 entries, snapshot slices at most 64, `snapPlots`/`snapVersions` 1024. Nothing grows with client input. `requestDustSnapshot` resets queue head/tail, `snapCount`, `dustSent` on seat reuse (`shift-core.ts:603-612`, addSeat `:373`).
- **Chunk id on the server**: `checkDetailBody` re-checks `chunkId < l.chunkCount` and treats the pole chunk as 2 plots (`shift-dust.ts:458-459`); an out-of-range plot reads as state 0 and is skipped.
- **Mask and state trust**: no client-to-server path carries `nearParcelsCollected`, wallet or Opened state. The mask is computed from the sim (`shift-room.ts:465, 676`); restored values come only from the server-written header and are clamped (`shift-persistence.ts:280-299`).
- **Header codec v0-v3** (`room-header.ts`): unknown flag bits rejected, flag dependencies enforced, exact length check, meta length 1..`ROOM_SIM_META_MAX_BYTES`, wallet finite and bounded, meta bytes copied. `room-postgres.ts:185-189` checks `rawSize` and CRC before decoding; undecodable header throws `RoomSaveCorruptError` and refuses the room; a newer header codec fails closed when a bake hash is stamped (`durable-dust-store.ts:216-231`). Chunks are inflated with `maxOutputLength` and verified by size and CRC (`room-postgres.ts:124-131`); an invalid newest version falls back, never forward.
- **TERRAIN_BAKE_HASH refusal**: mismatch of a non-null hash raises `save_corrupt` and releases the lease (`durable-dust-store.ts:213-214, 243`); rows stay untouched.
- **Client dust**: `applyBytes` decodes through the bounded codecs and counts invalid messages; `WANTED_CHUNKS_MAX` 16, `wanted` cap 64, `benign` map capped (`remote-dust.ts:41-42, 252, 263, 272`).
- **Queue and mark logic**: all writers of `dustSent` invalidate the scan (per the code review); held seats are skipped (N4); `snapCount` reset (N5).

## NOT covered (honest gaps)
- Colyseus 0.18 `Room.onMessageBytes` internals (how non-Uint8Array payloads or oversize frames on the bytes channel are rejected before `handleDustRequest`); only located at `@colyseus/core/build/Room.mjs:970, 1509`, not read.
- `assembleCopy`, `copyToStoreShapes`, `readLocalCopy`, the IndexedDB `CheckpointStore.save` atomicity and `DOWNLOAD_MAX_PAGES` / `HEADER_RAW_MAX_BYTES` values on the client; only the control flow of `resolveConflict`, `installServerCopy` and the wiring was read.
- `online-room.ts` request spacing (the comment at line 129 claims it respects the 0.5/s bucket; not verified), and whether a legitimate client at exactly 2 s spacing can hit a violation through network jitter (a single violation is harmless, 50 per 10 s needed).
- Auth, JWT, CORS, join tickets, REST rate limits, `shift-join.ts`, `join-ticket.ts`, input sequencing, `pumpSnapshot` backpressure beyond the ceiling logic.
- Fuzz or property tests of `decodeDustRequest`/`decodeDustCheck`/`decodeDustLedger`: not checked for existence in this pass.
- Test runs: none executed by me; relied on the two context reports.
