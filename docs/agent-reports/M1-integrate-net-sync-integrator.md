# M1 integrate net + sync hooks (integrator)

**Status: PARTIAL.** Date: 2026-11-15. Owner: integrator (Opus 5.5). No git was run. `packages/sim` and the goldens were not touched. I stopped early at the coordinator's request.

## Done

### W4-T04 online-room wiring (online rooms only)

**Online chunk: `apps/client/src/app/online-room.ts`**
- Only `online-launch.ts` loads it, through a dynamic `import()`.
- It builds three things:
  - `RoomSession` with `expectDustSnapshot: true`;
  - a `RemoteDust` mirror on `createRoomDustLedger(grid, data, {tickHz 20, 1024 slots, zeroEvents})`, with `clearDirty: false`;
  - `OwnAvatarPredictor` on `createSimConfig` and flat ground.
- Hooks:

| Event | What the room does |
| --- | --- |
| `onDustSnapshot` | `installSnapshot`, then a feed rebuild |
| `onFrame` | `applyFrame` + forward the frame's strokes to the feed; keyframe (or not started) → `predictor.start`, otherwise `predictor.reconcile(view.self, view.ackInputSeq)` |
| `onBytes` | `applyBytes`; an installed ledger triggers a feed rebuild |
| `sendInput(cmd)` | INPUT carries the previous input plus the current one in a preallocated buffer, with exact-length bodies built once; then `predictor.predict` with the clamped wire values |
| `setEquippedTool` | `predictor.setTool` |
| `frame(dtMs)` | `updateInterpolation` + `predictor.decay` |

- DUST_REQUEST: a 500 ms poll sends `nextRequest()` at most once per **2.5 s**. The server bucket is 0.5/s with burst 1, measured on arrival; the extra 0.5 s is margin for network jitter.
- If the server's hello rates are not 20 Hz / 10 Hz, the room reports a problem.

**Dust feed: `MirrorDustFeed`**
- It is a visuals `DustFeedPort` over the mirror ledger:
  - live strokes are forwarded;
  - ledger-zero events are forwarded;
  - Polished plots are found on the dirty list, because RemoteDust empties the Polished queue;
  - after a snapshot or a ledger install, every resident tile is rebuilt on the next `pump()`;
  - the dirty list is drained in `pump()`.

**Main chunk: `online-launch.ts`**
- `openOnlineRoom()` does the dynamic import.
- `createOnlineDevHooks()` installs `__mcOnline.open(contractId, accessToken)`, `close()` and `stats()`. Boot installs them only with `?perf=1` or in dev; production installs nothing.

**Per-frame hook: `modules.ts`**
- `AppNetModule.update` calls `online.current?.frame(dt*1000)`. In solo this is one null check.
- `dispose` disposes the room.

### W5-T08 sync hooks

**`app/save-sync-wiring.ts`**
- `createLocalInstallPort`: stop the host with `conflict_resolved` (no final checkpoint) → `store.save(record, dust?)` → start the host again. The host is restarted even if the write fails, and the error is then rethrown.
- `storeReader`: the read side for the sync module.
- `createSummaryProvider`: playtime = simTick / 20; Shine and wallet come from the UI store.
- `deviceLabelOf`: gives the platform family only.
- `saveEventForwarder`: the host's save events go onto the app bus. Before this, `save.checkpointed` never reached the bus.
- `bindSaveSyncRequests`: each request is handed to the sync once, then cleared.

**`boot.ts` (normal game launch only)**
- The host gets `onSaveEvent`.
- `startSoloHost` is restartable.
- `startCheckpointSync` dynamically imports `../sync` and `../sim-host` **after** the host start. It opens the main-thread store on `moon-cleanup-solo`, builds `createSaveSync` and runs `clockIn(id, {maxWaitMs: 0})` in the background.
- The token source is signed out (`null`), because no client sign-in exists. The sync therefore tracks checkpoints but holds its queue.

**`solo-host.ts`**
- `stop(reason?)` now returns a Promise and accepts a close reason.

**sim-host (brief-authorised)**
- `StoredDustChunk.crc32?` added.
- The worker records the CRC32 of each chunk's uncompressed payload at checkpoint, using the same IEEE CRC as sync.
- The barrel exports `openCheckpointStore`, `IdbCheckpointStore`, `MemoryCheckpointStore`, `isQuotaError`, and the types `CheckpointStore`, `StoredCheckpoint`, `StoredDustChunk` and `DustChunkWrite`.

## Tests (Node 26.13.1, apps/client)

- `tsc --noEmit`: clean.
- `eslint src/app src/sim-host src/net src/sync`: clean.
- `vitest run src/app src/sim-host src/net src/sync`: **17 files, 156/156 pass**.
- New `online-room.test.ts` (4 tests), using a fake connection:
  - snapshot → mirror ready;
  - keyframe → predictor start;
  - INPUT bodies of 11 and 21 B, with the redundant input;
  - reconcile replays 1 input;
  - the DUST_CHECK mismatch sends 1 request per 2.5 s, and the request decodes;
  - the feed rebuilds and forwards Polished;
  - a source check that boot and modules never statically import the online chunk.
- New `save-sync-wiring.test.ts` (5 tests):
  - install order stop → save → start, also when the write fails;
  - the dust CRC round-trips through the store;
  - a rebase keeps the dust rows;
  - summary;
  - request hand-off;
  - the bus forwarder.

**Not run:**
- `pnpm verify`;
- a vite build / bundle-split check (the solo-chunk exclusion is checked only by the source test);
- browser, 2-client, netsim and real-server runs;
- a sim-host test that asserts the CRC value on worker-written rows (only the store round-trip is tested);
- prettier `--check` on the new files.

## Not done / mismatches for owners

1. **net (netcode-engineer):**
   - `RoomSession` has no DUST_REQUEST send. The app wraps `consume` to keep the `RoomConnection` and calls `sendBytes` itself, while the phase is `joined`. Proposal: add `RoomSession.sendDustRequest(body)`.
   - Schema `equippedTool` is not exposed. `setEquippedTool` exists but nothing calls it yet. Proposal: an `onSchema` / `equippedTool` callback.
   - The `RemoteRoomHost` facade (room-host contract) is not implemented, so the `roomHost` service never publishes a remote host.
2. **No client auth or lobby UI.** Online rooms can be reached only through the dev hook. The sync token source is signed out, so nothing uploads until an auth owner supplies a `TokenSource` and calls `notifyAuthChanged()`.
3. **Mirror dust feed into the visuals scene not plumbed.** No `?scene=dust&online=1` route exists. The visuals module takes its feed at construction, so a swappable feed is needed.
4. **No gameplay/input module.** Nothing calls `OnlineRoom.sendInput` or `roomHost.sendInput` in the game.
5. **`gameDataVersion` is taken from `VITE_BUILD_VERSION`** (truncated to 32 characters). A real game-data version constant should replace it.
6. **The SaveSync "hostRunning" / install-under-a-running-host rules are trusted from the sync module.** The app-side restart path is covered only by the unit test.

## Files

**New**
- `apps/client/src/app/online-room.ts`
- `apps/client/src/app/online-launch.ts`
- `apps/client/src/app/save-sync-wiring.ts`
- `apps/client/src/app/online-room.test.ts`
- `apps/client/src/app/save-sync-wiring.test.ts`

**Edited**
- `apps/client/src/app/boot.ts`
- `apps/client/src/app/modules.ts`
- `apps/client/src/app/solo-host.ts`
- `apps/client/src/sim-host/checkpoint-store.ts`
- `apps/client/src/sim-host/worker-core.ts`
- `apps/client/src/sim-host/index.ts`

**Recommendation:** accept as wiring-complete for the hooks above. Feature-complete needs net items 1, auth (2) and input (4). Then run one browser 2-client run and a vite build chunk check.
