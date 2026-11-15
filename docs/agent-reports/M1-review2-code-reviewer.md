# M1 review 2: correctness pass on areas the first reviews did not cover (code-reviewer)

Status: partial; delivered at the turn limit / 2026-11-15 / code-reviewer / Opus 5.5. Read-only, no git, no source edits.
**No tests were run.** Every finding comes from reading the code.
Scope read:
- `packages/sim/src/room/checkpoint.ts`, plus `restoreCheckpoint` / `captureCheckpoint` (`moon-room-sim.ts:528-661`)
- `packages/sim/src/movement/avatar.ts:255-597`
- `packages/protocol/src/codec/dust-messages.ts`, `dust-wire.ts:1-105`, `bits.ts`, `frame-writer.ts:120-424`
- `packages/protocol/src/session/session.ts:380-884`
- `apps/client/src/sim-host/{fixed-step,input-queue,checkpoint-store,create-local-room-host}.ts`
- The adapter `apps/client/src/net/room-session.ts:440-515`

Note: `checkpoint-store`, `input-queue`, `fixed-step` and locks live in `apps/client/src/sim-host/`, not in apps/server.

## Verdict
No blocking defects confirmed. There are 2 low-to-medium issues (S1, S2) and some low-severity hardening notes. The first review's B1 (Detailing cooldown debt) looks fixed: `tools/tool.ts:211-224` now floors the debt at 0.

## Findings, ranked

**S1 (medium, multiplayer only; confirmed by reading): a timed-out connect attempt is counted as a failure twice.**
- Where: `session.ts:752` (tick → `onConnectFailed`) marks the attempt failed, but nothing cancels it in the adapter.
- When that same attempt later rejects (`room-session.ts:461-466`, `gen === attempt` because no new `connect` has run yet), the adapter calls `core.onConnectFailed` again.
- `session.ts:485-509` has no `attemptInFlight` guard, so `connectFailures` is incremented a second time.
- The same happens through `onClosed`: `session.ts:536` is skipped when `attemptInFlight` is false, and the fall-through at `:559-561` counts again.
- Effect: the backoff steps ahead, and the session returns to `waking` or fails `connect_failed` after about half the configured attempts. This hits hardest on Render cold starts.
- Fix: in `onConnectFailed` (connecting branch), return early when `!this.attemptInFlight`. Alternatively, the adapter bumps `attempt` on timeout. Add a test: timeout, then a late failure, gives one count.

**S2 (low-medium, latent): the dust log/snapshot encoder accepts input its own decoder rejects.**
- Continuations: `writeLogEntry` / `encodeSnapshotRaw` (`dust-messages.ts:365-383, 527-560`) do not cap total continuations at `DUST_LOG_MAX_CONTINUATIONS` (4096, enforced on decode at `:399`). A plot log of 256 chains × 255 continuations encodes fine.
- Actor slot: `writeLedgerRaw` (`:269`) writes any `actorSlot & 0xff`, but `readLedgerRaw` rejects slots above 15 (`:307`).
- Impact: one oversized log or bad slot makes `decodeSnapshotRaw` return null for the whole snapshot. The client then loops on `snapshot` resyncs and never reaches `ready`.
- There is no producer yet, so this is latent. Make the encoder return 0/null under the same caps, and add a round-trip test at the caps.

**N1 (low, plausible): the Web Lock leaks if host construction throws.**
- Where: `create-local-room-host.ts:64-83`. The lock is acquired before `new LocalRoomHostImpl(...)`, which runs `spawnWorker`.
- If the constructor throws (Worker blocked by CSP, an unsupported module worker), `onDispose` never runs. `held` never resolves, so the tab keeps `mc-solo:<id>`.
- Every retry in that tab then fails with `SimHostLockedError`.
- Fix: wrap the construction in try/catch and call `lock.release()` on failure.

**N2 (low): IndexedDB connection lifecycle.**
- `checkpoint-store.ts:126`: `onblocked` rejects, but the open request is still pending. If it succeeds later, that `IDBDatabase` is never closed, and the session has already fallen back to memory.
- `:129`: after `onversionchange` closes the db, every later `save` throws `InvalidStateError`. It surfaces as a write failure, with no reopen and no fallback to memory.
- Suggest: on `onblocked`, wait instead of rejecting, or close the late `onsuccess` result. Mark the store dead after a version change so the host falls back to memory.

**N3 (low, plausible): a stale snapshot can satisfy a resync.**
- `beginAwaitKeyframe` (`session.ts:818-828`) resets the table and interpolation but not `SnapshotAssembler`.
- A snapshot already in flight from before a resync (visibility, decode error) can complete afterwards. It sets `snapshotDone` / `dustReady` with pre-resync dust.
- The server answers the resync with a newer snapshot version, which then replaces it, so the window is short.
- Suggest resetting the assembler there, or recording the version expected after a resync.

**N4 (low): checkpoint validation gaps (local trust only).**
- `checkpoint.ts:796`: `detailCooldownMs` has an upper clamp but no lower bound. This is harmless now because `tool.ts:211` floors it at 0.
- `:435-437`: `copiesBought` has no upper bound. A crafted save can set about 2^31 copies. I did not check what the price formula does with that (Infinity or NaN). Bound it if the price math is not overflow-safe.
- `encodeCheckpointMeta` (`:333-337`) silently drops gear keys after the first 64 (sorted) and levels above 255. Confirm the catalog stays under 64 keys, or throw instead of dropping silently.

**N5 (info): InputQueue duplicate handling.**
- `input-queue.ts:39` checks for late inputs only against the last consumed seq, so a duplicate of a still-queued seq is queued twice.
- No impact today: MessagePort delivery is ordered and exactly-once.

## Checked OK
- `fixed-step.ts`:
  - The absolute schedule is right, and dropping after a stall sets `granted = target`, so there is no spiral.
  - The re-base every 2^20 ticks is exact.
  - `delayMs` / `alpha` are correct, and nothing allocates.
- `input-queue.ts`:
  - The SoA ring wraps correctly.
  - Taps are OR-folded on double-step and on overflow.
  - It repeats up to the configured count, then goes neutral with yaw and pitch kept.
  - The late window is computed mod 65536.
- `avatar.ts`:
  - Timers are decremented only while above 0.
  - The divides by |p| and |f| are guarded by restore validation: radius ≥ R/2, facing in 0.5..1.5.
  - Scratch arrays are module-level, and there are no libm calls beyond sqrt/ceil.
- `checkpoint.ts` / restore:
  - It decodes, validates and only then commits.
  - It rejects truncated or trailing bytes, unknown flags, NaN or out-of-range reals, and duplicate slots or gear keys.
  - It checks the size caps before parsing and `tickHi < 2^21`.
  - Writer and reader use the same field order (verified field by field).
- `bits.ts`:
  - 32-bit masks and sign extension are correct.
  - Writes never go past capacity, and reads never go past the limit.
- `dust-wire.ts`: the chain header is 136 bits, so every chain stays byte-aligned.
- `dust-messages.ts`:
  - DUST_REQUEST lengths (3..20 B) are right.
  - Counts are checked against the remaining bits/bytes before allocating.
  - Inflate is capped (ledger: `LEDGER_RAW_MAX_BYTES`; snapshot: 1 MiB).
  - The assembler is bounded to 64 slices.
- `frame-writer.ts`:
  - Space for each atomic record is checked before writing.
  - Empty sections are rewound.
  - The section count byte is patched for entities and strokes.
  - Nothing allocates.
- `session.ts` `onFrame`:
  - The wrap-safe tick compare is correct.
  - The keyframe gate is correct.
  - It does not allocate.

## Not done
- No vitest runs or reproductions (S1 and S2 are worth a focused test each).
- Not read:
  - `frame-reader.ts`
  - `input.ts`
  - `checkpoint-upload.ts`
  - `session.ts:1-380` (config and defaults)
  - `local-room-host.ts` beyond what the first review covered
  - the server `shift/input-sequencer.ts`
- Scope and modification-time check of touched files: not done.

## Next
- protocol owner: S1 guard plus test; S2 encoder caps plus round-trip test at the caps.
- sim-host owner: N1 try/catch release; N2 IndexedDB lifecycle.
