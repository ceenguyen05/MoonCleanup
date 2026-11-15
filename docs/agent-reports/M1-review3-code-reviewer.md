# M1-review3: code-reviewer (online client netcode and second-pass sim/sim-host files)

Status: **PASS with findings, partial.** No blocking defect was confirmed. One medium-severity race (F1) should be fixed or covered by a test before the restore flow is called done. I ran out of turns, so **I did not run any focused tests**. Every result below comes from reading the code and tracing values by hand. None of it is test evidence.

## Findings (ranked)

### F1 (medium): installing a save while the Solo host is still booting can overwrite the installed copy or leave no host
- `apps/client/src/app/solo-host.ts:191-198`: if `stop()` runs while `createLocalRoomHost` is still pending (`host === null`), it returns `Promise.resolve()` at once.
- `solo-host.ts:175-177`: the pending host then finishes booting and calls `created.close("clock_out")`.
- `apps/client/src/sim-host/local-room-host.ts:295`: `clock_out` means `finalCheckpoint = true`.
- `apps/client/src/app/save-sync-wiring.ts:42-49`: the install port treats the host as stopped, writes the installed copy, then calls `startHost()`.

Two outcomes are possible:
- (a) The late final checkpoint of the old host overwrites the copy that was just installed.
- (b) The old host still holds the Web Lock `mc-solo:<id>`. The lock request uses `ifAvailable` (`create-local-room-host.ts:44-56`), so the new host fails with `SimHostLockedError` and the player has no host.

When it happens: the user resolves the "Which copy?" prompt (restore, or use the server copy) before the worker host has finished booting. The window is narrow, but the result is lost progress or no game.

Suggested fix: have `stop()` wait for the in-flight creation and close that host with the requested reason. Add a test where `stop("conflict_resolved")` is called before `createLocalRoomHost` resolves.

### F2 (low-medium): if IndexedDB fails on the main thread, a restore silently does nothing
- `apps/client/src/app/boot.ts:410-413`: `openCheckpointStore("auto")` falls back to `MemoryCheckpointStore`.
- The install port then writes into main-thread memory, which the worker host never reads.
- After the reboot the host starts from its own store, but the sync controller reports the install as successful.
- `onProblem` is raised when the store opens, but the restore result itself does not say it failed.

Suggested fix: refuse the install (reject it) when `store.kind === "memory"`.

### F3 (low-medium): the server can build a dust snapshot the client refuses
- `packages/protocol/src/codec/dust-messages.ts:61-62`: the comment says "256 KB" but the value is `1 << 20` (1 MiB).
- `encodeSnapshotRaw` (`:540`) accepts up to `DUST_SNAPSHOT_MAX_LEDGERS = 1024` ledgers. Each ledger is at least about 1,050 bytes, so a full snapshot is about 1.07 MB.
- The client inflates with a 1 MiB cap and returns null on anything larger. A snapshot with roughly 998 or more ledgers would therefore be refused on the client.
- Today's worst case is about 250 KB, so this is latent, not live.

Suggested fix: cap the total raw size in the encoder, or make the two limits agree.

### F4 (low): in the predictor, the unknown-ack path replays from the wrong state
- `apps/client/src/net/predictor.ts:164-172`: when there is no history entry for `ackSeq`, the code keeps the current timers and `prevButtons` and only overwrites the fields Self carries.
- The replay of `ack+1..` therefore starts from present-time timers and the newest input's buttons. A jump or hop press can be missed or appear twice.
- The doc comment at `:153-155` says the state "restarts from Self", which the code does not do.
- Impact is a small one-off misprediction after history loss.

### F5 (low): the correction statistic can be computed against an old prediction
- `predictor.ts:164-167`: replays only rewrite `hist` for `ack+1..last`, never for `hist[ack]`.
- A repeated ack (server starved of inputs) measures `lastCorrectionM` again against the original, uncorrected prediction.
- This affects statistics only.

### F6 (low): strokes reach the dust view before the dust snapshot arrives
- `apps/client/src/app/online-room.ts:104-109`: `needRebuild` starts `false`.
- If a target is bound before the snapshot, `onFrameApplied` forwards strokes to it even though `RemoteDust.applyFrame` skipped them (`remote-dust.ts:135-138`).
- The snapshot's `invalidate` then triggers a rebuild that heals the view, so the effect is a brief visual glitch.
- Suggested fix: initialise `needRebuild = true`, or gate on `dust.ready`.

### F7 (low, not checked): plot ids in dust deltas have no bounds check here
- `apps/client/src/net/remote-dust.ts:152-160`: `applyDeltas` indexes `l.state[p]` and calls `installPolished(p)` without checking that `p < plotCount`.
- It is safe only if the frame decoder bounds `dustPlots.plotId`. I did not check `frame-reader.ts`.

### F8 (low): type and validation hygiene
- `remote-dust.ts:82`: `r as never` hides any mismatch between `StrokeRecordOut` and the `applyStroke` parameter, and has no comment explaining why. A structural adapter type would be better.
- `apps/client/src/net/session.ts:156`: the seat reservation from the M0 hello route is cast rather than zod-validated. The rule is zod validation at edges.

### F9 (low): restored saves can leave other joined players' Dust Cells over capacity
- `packages/sim/src/room/moon-room-sim.ts:620-628`: a joined actor with no record in the checkpoint gets the new `cellLevel` but keeps its old `cellGrams`, with no clamp.
- If the restored gear lowers the capacity, that actor's Cell can sit above its cap.

### F10 (low): the host is not rebooted if stopping it fails
- `save-sync-wiring.ts:42`: `stopHost()` is called outside the `try`, so a rejection skips `startHost()`.
- In practice `close()` never rejects (it races a timeout and catches errors), so this does not happen today.

## Checked by reading and hand-tracing, no defect found
- **`inflate-raw.ts`:**
  - The bit buffer never carries more than 7 bits, so discarding it at a stored block is correct.
  - `maxBytes` is enforced before the output grows, and back-references are checked against the output start.
  - HLIT and HDIST limits match zlib, and over-subscribed codes are rejected.
  - Every loop consumes input or fails, so a corrupt stream terminates.
- **Detailing cooldown (`packages/sim/src/tools/tool.ts:203-225`):**
  - Traced at 20 Hz with 2-tick strokes and a 450 ms period: gaps alternate 400 and 500 ms.
  - No debt builds up while airborne, and the cooldown resets on tool-down.
  - It is hashed (`moon-room-sim.ts:505`), checkpointed as i32 and clamped to `periodMsMax` on restore (`checkpoint.ts:796`). A negative stored value is healed by the floor on read.
- **`checkpoint.ts`:**
  - The record size of 273 + 4 x toolCount bytes matches the documented layout.
  - The reader latches on overrun; NaN fails the range checks.
  - Restore runs decode, then validate, then commit, so a rejected checkpoint changes nothing (`moon-room-sim.ts:565-650`).
- **`predictor.stepWith`:** matches `MoonRoomSim.stepActor` (`:683-726`) except for `swapTicks`, which the predictor deliberately does not model (documented).
- **`fixed-step.ts`:** ticks dropped after a stall are counted, and the re-base keeps the schedule exact.
- **`input-queue.ts`:** a skipped input's button presses carry into the next one, the late window includes exact duplicates, and there is no allocation after construction.
- **`checkpoint-store.ts`:** the header and dust chunks are written in one strict readwrite transaction, and `onversionchange` closes the connection.
- **`guest-auth.ts`:** one request at a time, one retry with the stored token after 409, the account is forgotten on 401, and tokens never go in a URL or log.
- **Solo pays no netcode cost:**
  - `online-room.ts` is reached only through the dynamic `import()` in `online-launch.ts:15`.
  - `guest-auth` is deep-imported in the background sync chunk (`boot.ts:399`).
  - Nothing online is constructed in solo.

## Not reviewed or not run
- No focused tests were run. The test files (`*.test.ts` next to each source file) were not checked for meaningfulness.
- `avatar.ts` was read only at lines 95-354.
- "Codec encode" (`frame-writer.ts`, `input.ts`) was not reviewed, and neither was the `inputBody1`/`inputBody2` length assumption at `online-room.ts:237-238` (11 bytes per input).
- The `frame-reader` bounds behind F7 were not checked.

## Next
- Fix F1 and add the test described there.
- Decide F2: refuse the install when the main-thread store is memory.
- Optional: F3 limit alignment and F6 init flag.
- Re-review F1 with a focused test run.
