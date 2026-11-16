# M1 persistence v3: netcode-security re-review

Task / status: re-review complete / 2026-11-16 / netcode-security-reviewer / Opus 5.5
File state: working tree on main at b7c4221 plus the uncommitted diff (git diff, read-only).
Prior review: docs/agent-reports/M1-online-persist-review-netcode-security-reviewer.md (B1 blocking, N1-N4).
Scope: packages/db room-header.ts (v0-v3), room-types/room-postgres/room-memory; ShiftCore captureSharedMeta /
restoreSharedMeta; shift-persistence.ts (state capture order, dirty rules); shift-room.ts (restore wiring,
rate_limited); durable-dust-store.ts (state hand-off, ignoredHeaderCodec, bake refusal); server.ts TERRAIN_BAKE_HASH;
shift-dust.ts moon-wide cache plus the one-snapshot-per-frame cap in shift-core.ts.

## Verdict: APPROVED (no blocking findings)

## B1 re-verified: CLOSED
- The header carries the parcel mask with the wallet (room-header.ts:93-100). A room restores both together
  (shift-room.ts:202-206 -> shift-core.ts:277-278 -> moon-room-sim.ts:537, masked to parcelCount <= 8, :533).
- A legacy room-v1 wallet without a mask is skipped and logged (shift-persistence.ts:221-228). The persisted mask
  covers every parcel (nearParcelsMask caps at 8, which is also the sim cap).
- Test: shift-ledger.test.ts:230 "collected Near Parcel stays collected across a room restart".

## One-shot payout audit (farm / double pay on restart or crash)
- The wallet has exactly 3 income paths in the sim: Stamp (moon-room-sim.ts:1317), Near Parcel (:2075) and dust sale
  (:2134). No achievement, milestone or refund path credits Lumens.
  - Stamps come from ledger plot state, which is in the chunks. The restore clears the dirty and queue state before the
    sim exists (shift-room.ts:159-161, shift-persistence.ts:275).
  - Parcels are covered by the mask.
  - Sales need cargo. Cargo and pucks are never restored (restoreSharedMeta passes an empty PLAYERS section and no
    pucks, so moon-room-sim.ts:1019 builds a fresh CargoStore). Carried dust is lost, never duplicated.
- Crash window fix verified (shift-persistence.ts:383-388). The wallet, mask and META are captured synchronously
  before the first chunk is encoded. Every chunk written in that checkpoint is encoded at the same time or later.
  Chunks that are not dirty have not changed since an earlier encode. A failed save re-marks its chunks and leaves
  `savedState` unchanged (:359-363). Header and chunks commit in one transaction (room-postgres.ts:229-293). So a
  crash can lose a payout, never pay one twice.
- META vs header: both are captured in the same synchronous block, so they agree. A refused META leaves the
  post-purchase header wallet and loses the gear (loss only). A restored META sets the wallet, mask and gear from one
  consistent snapshot (moon-room-sim.ts:1031-1058). The restore is atomic: everything is decoded and validated before
  the commit.
- Restore before the first seat: restoreSharedMeta runs inside onCreate after `await persistence.restore()` and
  before any join is possible. It also throws if `activeSeats > 0` (shift-core.ts:321).
- The restored sim tick (moon-room-sim.ts:1032) is safe for ShiftCore. All of its tick uses are relative
  (lastSnapshotTick = -1e9, lastActiveTick deltas), and the save cadence uses `tick % simTickHz`.

## Header / META codec bounds
- Bounds are checked before any read or allocation: the flags must match an allowlist for each codec version, and
  mask-without-wallet and META-without-mask are refused. The META length must be 1..8192, the total length must match
  exactly, and the wallet must be finite and in [0, MAX_SAFE_INTEGER] (this closes N4). The META version must be
  >= 1. The section is copied, not aliased (room-header.ts:122-165).
- A row tagged room-v2 whose blob sets bit3 is refused as corrupt (no downgrade confusion). A CRC or rawSize mismatch
  is refused before decoding (room-postgres.ts:186-190). The META is then validated in full by a bounds-checked
  reader that never throws (checkpoint.ts:248-256, 367-416). A refusal is logged and the room still starts
  (shift-room.ts:213-217).
- Encode: memory and SQL validate the same way (room-memory.ts:149-153; room-postgres.ts:259 is inside the
  transaction, so a throw rolls back). The worst-case capture is about 4.3 KB (64 gear keys x 66 B + fixed + tools),
  under 8192. encodeCheckpointMeta silently skips out-of-range entries and never throws on runtime state.
- SQL: drizzle with bound parameters only. The codec is chosen by a JS string compare. No string-built SQL was added.

## Dust cache / snapshot cap
- No cross-room leak: the cache lives on the instance, and each ShiftCore builds its own ShiftDust (shift-core.ts:294).
  The moon-wide part (plot states and Opened bytes) is the same for every seat of the same Contract, as designed. The
  per-seat interest part is unchanged.
- Not stale:
  - `noteDirty` runs on every tick with a non-empty dirty-plot list (shift-core.ts:779), before that list is cleared
    (:791).
  - `moonWide()` also bumps the generation if a dirty list is pending (shift-dust.ts:117).
  - The only clear outside the tick (the persistence restore) happens before the cache exists, and the first build is
    forced (cacheGeneration = -1).
  - Every ledger change (strokes, intents, pool growth) happens inside `sim.step`, which runs before
    collectDirtyPlots.
  - The reused cache arrays are rebuilt in full, and encodeSnapshotRaw copies them.
- Cap (shift-core.ts:649-655): seats that fail the 2 s minimum interval `continue` before claiming the frame's build
  slot. So one hostile seat that resyncs constantly gets at most 1 build per 2 s and cannot starve the others (there
  are many more frame ticks per 2 s than seats).
- rate_limited fix: PurchaseResultPayload now uses the lower-case reason (shift-room.ts:560-564).

## Non-blocking
- N2 (still open, now live): every save is stamped with TERRAIN_BAKE_HASH (server.ts:175). After any re-bake, every
  stamped private Contract is refused (`save_corrupt`, durable-dust-store.ts:213-215). The player gets a retryable
  error, but the refusal is permanent. Decide the re-bake policy, or add a distinct non-retryable close, before saves
  pile up on Render.
- N5 (rollback): when the header codec is unknown, the room loads it with `bakeHash: null` (room-postgres.ts:216-220,
  durable-dust-store.ts:213). That also skips the bake-mismatch refusal for that load, and the next checkpoint
  overwrites the newer header with v3. This is logged and cannot be farmed (the wallet, parcels and gear all reset
  together). Only servers write the codec.
- N6 (data loss, not authority): a future `SIM_CHECKPOINT_META_VERSION` bump refuses every stored META
  (moon-room-sim.ts:988). That silently wipes all purchased gear across rooms, while the lowered wallet is kept. Add a
  META migration, or keep the version reader, before bumping it.
- N7 (data loss): `sameState` ignores META (shift-persistence.ts:71-73), so a change only to the holster or
  achievement mask is written only with the next dirty chunk or wallet change. The impact is loss only, and small.
- N8 (robustness): if `captureSharedMeta` ever threw inside `encodeSliced`, the rejection is not caught on the
  `void this.save()` path (shift-persistence.ts:302, 348). On Node 26 an unhandled rejection kills the process. No
  current runtime state makes it throw. Consider a `.catch` that logs and counts a save failure.

## Evidence (Node v26.13.1, PATH prefix)
- packages/db `vitest run src/repositories`: 5 files, 109/109 pass (room-header, room-memory, room-postgres via
  PGlite, memory, postgres).
- apps/server `vitest run` shift-ledger, shift-dust, shift-core, shift-room and src/persistence: 6 files, 62/62
  pass. These include the B1 restart, legacy-skip/clamp, N1 META restart, refused-META, crash-window and real
  TERRAIN_BAKE_HASH tests.

## Not covered
- Full SIGTERM drain ordering and a live Postgres or Render run.
- How the client handles the v1.1 `nearParcelsCollected` field (already reviewed in the prior batch).
- validateCheckpointMeta field by field (I relied on the decode bounds and the existing sim checkpoint tests).
