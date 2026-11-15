# M1-W3-T01b Real dust ledger in the Solo sim-host: save, sliced restore, goldens (gameplay-systems-engineer)

Task / status: **in-review** / 2026-11-14 / gameplay-systems-engineer / Fable 5.2
Node 26.13.1 (fnm PATH prefix), Windows 11, headless Chromium (Playwright). No git used. `packages/world` source and shared contracts untouched. No server or browser left running.

## Done

- **Dust survives a reload.** The Solo worker builds a `WorldDustLedger` and passes it to `MoonRoomSim` as `ledger`. A checkpoint stores the sim sections and the dust chunk payloads in **one IndexedDB transaction** (new object store `dustChunks`, key `[contractId, chunkId]`, database version 2; old records stay and load without dust). On boot the chunks are restored before `sim.restoreCheckpoint`.
- **Restore is sliced:** `DustRestoreJob.run(2 ms)` with a message-task yield between slices (with a zero timeout the same 3,000-ledger restore took 1.1 s in the Node lane). It runs in the worker during `loading`, before any tick.
- **Checkpoint:** capture (sim sections + `encodeDustChunks`) is synchronous between two ticks, so both are one instant; deflate, gzip and the write follow asynchronously. Only dirty chunks are written. The first checkpoint of a game that did not come out of this store writes every non-pristine chunk and deletes the Contract's other rows, so rows of an unreadable older save cannot leak in.
- **Without IndexedDB** the host keeps the chunk rows next to its header copy and hands both to the rebooted worker.
- **Untrusted input:** capped inflate (`DUST_CHUNK_LAYOUT_MAX_BYTES`), bad chunks are skipped and reported through `onRestoreProblem` ("dust chunks: ..."), the rest of the save loads; a save the sim rejects resets the ledger.
- Tick path: the ledger's Polished / Opened / dirty-plot queues are counted and emptied every tick; 1,024 ledger slots are reserved before play.

## Deviation from the brief (deliberate)

The brief says store, then `clearChunkDirty`. I clear the marks **at capture** and put them back if the write fails. Ticks run while the bytes are compressed and written; clearing afterwards would erase the mark of a stroke that landed in a captured chunk meanwhile, and that stroke would be lost on reload.

## Goldens

| Golden | Value | Change |
| --- | --- | --- |
| `GOLDEN_REPLAY` (stand-in ledger) | stateHash 4037918216 | **Unchanged.** `MoonRoomSim` without `ledger` still runs `ApproxDustLedger`; the existing sim tests keep using that path |
| `GOLDEN_REPLAY_WORLD_LEDGER` (new, real ledger) | stateHash 634894361, strokeHash 2027053455, strokes 3975, grams 67192, dustHash 4087304160, ledgers 25, polished 0 | Same script and sim code. Grams 56640 to 67192 because the two ledgers remove different amounts per stroke; the state hash follows the Dust Cells. Strokes and strokeHash are identical. dustHash is new |
| sim-host parity tests | no constant | Reference sim now uses the real ledger; they also compare `dustHash` |

`polished` is 0: this replay does not cover the Inspector's Stamp (the `packages/world` vectors do).

## Evidence (this file state)

- `packages/sim`: tsc 0, eslint 0, prettier clean, vitest **80 / 80**; browser lane Chromium 2 / 2 (both goldens identical to Node).
- `apps/client`: tsc 0, eslint and prettier clean on `src/sim-host`; `vitest run src/sim-host src/app/solo-host.test.ts` **34 / 34**; worker lane Chromium **5 / 5** (real-ledger golden inside a module Worker, IndexedDB reload).
- Hash identity across a reload: (a) sim level, 10 reloads into a fresh sim and fresh ledger end on the recorded golden; the control without dust chunks does not. (b) Host level, checkpoint, crash, reboot: state hash and dust hash equal, then 500 ticks in parity with a sim that never reloaded. (c) Chromium, IndexedDB, new worker: equal, then 500 ticks in parity.
- Allocation (heap profiler, 6 sweeping actors, sim + world frames): **4.2 B/tick**, pool growths 0, nothing from the ledger in the top sites.
- 3,000 ledgers in 24 chunks (Node lane, 3 runs): restore 153 to 163 ms in 69 to 73 slices; full-save capture 20 to 26 ms; a later checkpoint of one full chunk (256 ledgers) **1.8 ms** capture; worker tick p95 0.10 ms.

## Not met / limits

- **Restore slices overshoot the 2 ms budget:** longest slice 3.3 to 4.3 ms (Node), 3.1 ms (Chromium, 4 ledgers, cold). Not on a frame or tick path, but above the stated budget.
- Capture is not sliced (it must be one instant). It runs right after a tick, so it uses idle time before the next one; a full save of 3,000 ledgers takes 20 to 26 ms and happens only after a restore from host copies or a damaged restore.
- A full chunk is 277,429 B raw, above today's `DUST_CHUNK_PAYLOAD_MAX_BYTES`. It is stored and restored locally and counted in `dustChunksOversize`; uploading it depends on the contracts change in progress.
- One row per chunk and one header record locally, not the "newest and previous" pair of data-model 3.7c.
- Every plot is Highland and none Empty (no class bake yet).
- Not run: Firefox, WebKit, root `pnpm verify`, a real browser tab on the deployed build.

## Next

1. gameplay-systems-engineer: Stamp payout and `plot.polished` / `plot.opened` in the sim. The queues are emptied in `worker-core.ts` `tickOnce`; the consumer goes right above that.
2. Server host: build the ledger with the same levels and areas (`sim-host/dust-ledger.ts` is a candidate to move into `packages/sim`).
3. Netcode / upload owner: the two chunk versions and the oversize chunk.

## Files

`apps/client/src/sim-host/{dust-ledger.ts (new),worker-core.ts,checkpoint-store.ts,messages.ts,local-room-host.ts,save-envelope.ts,sim-checkpoint.ts,test-support.ts,sim-host.test.ts,browser/golden.worker.ts,browser/sim-host.worker-lane.ts}`, `packages/sim/test/{golden/cases.ts,golden/replay.ts,support/world.ts,unit/alloc.test.ts,unit/dust-reload.test.ts (new)}`, this report.

Blockers: none.

Commit suggestion: `feat(sim-host): run the real dust ledger in the Solo worker and persist dust chunks with local checkpoints`
