# M1-W3-T08: LocalRoom sim host in a Web Worker

Task / status: M1-W3-T08 / in-review / 2026-11-14 / gameplay-systems-engineer / Opus 5.5

**Done:** `apps/client/src/sim-host` (new). Not wired into `app/boot.ts`. The factory is `createLocalRoomHost(options)` (async; rejects with `SimHostLockedError`), exported from `index.ts`.
- `LocalRoomHostImpl implements LocalRoomHost` (shared client/room-host v1). It adds `onInputEcho` (synchronous local echo for prediction), `sampleInterpolation` (`FrameTimeline` render hook), `stats()`, `requestHash()`, `stepManual()` and a crash test hook.
- Worker (`sim.worker.ts` → `worker-core.ts`): drift-compensated `FixedStepClock` (absolute schedule, catch-up ≤ 4 ticks, then drop and count). `InputQueue` follows netcode §5.1: double-step on backlog with taps kept, repeat ×3 then neutral, late drops. `MoonRoomSim` runs on a cube or flat world. FRAME bytes come from the packages/protocol `FrameWriter` (Self, slot changes, avatar entities, stroke chains; strokes stay pending across skipped frames). Events and ShiftState are sent only on change.
- Messaging: bare transferable ArrayBuffers. There is a pool of 3 frame buffers, and release is deferred until all listeners have run. Pooled 12-byte INPUT buffers. No SharedArrayBuffer.
- Checkpoints: MCSV v1 envelope codec (passes the shared golden vectors), CRC32, gzip via `CompressionStream`, one IndexedDB transaction, memory fallback (the host keeps a copy). Timer every 10 s when the state hash changed, plus pause/suspend/close/hidden. Web Locks, `storage.persist()`, crash → one reboot from the newest checkpoint, `save.*` events.

**Measured** (Node 26.13.1, Chromium/Playwright, this laptop, final file state):
- Worker golden: stateHash **4037918216**, strokes 3975, 56640 g, inside a real module Worker.
- Production worker (fixture cube, IndexedDB) matches direct `MoonRoomSim` over 2,000 ticks (hash 2347366612). The IndexedDB checkpoint committed (112 B gzip).
- Realtime 20 Hz: input → authoritative ack p50 31 ms, p95 56 ms. Worker tick p95 0.4 ms, max 4.4 ms. Host cost per message p95 0.1 ms, max 0.7 ms. 0 frames skipped, 0 pool misses.

**NOT RUN:** UHD 620 numbers, 10-minute heap growth, Firefox/WebKit (binaries not installed), E13 input-to-visual (needs gameplay prediction), RemoteRoomHost parity.

**Known gaps:**
- Restore covers tick, wallet and pose. Tools, holster and Dust Cell are saved (interim META/PLAYERS section version 0) but cannot be restored until packages/sim gains a state import/export codec. This is a request to the sim owner.
- One typed-array view per transferred buffer is the platform floor.
- Ack latency includes up to one tick of wait; the 30 Hz option is open.

**Next:** integrator wires the factory into the `roomHost` service. The sim owner adds the save codec. Performance capture on UHD 620.

Files: `apps/client/src/sim-host/**` (index, messages, fixed-step, input-queue, sample-ring, save-envelope, checkpoint-store, sim-checkpoint, sim-frame-encoder, worker-core, sim.worker, local-room-host, create-local-room-host, frame-timeline, test-support, sim-host.test, browser/{vitest.browser.config, fixture-cube, golden.worker, sim-host.worker-lane}).

Evidence:
- `apps/client`: `tsc -p tsconfig.json` 0 errors. `eslint src/sim-host --max-warnings=0` exit 0. `prettier --check src/sim-host` clean.
- `vitest run src/sim-host`: 12/12 pass.
- `vitest run --config src/sim-host/browser/vitest.browser.config.ts`: 3/3 pass, Chromium.

Commit suggestion: `feat(client): Solo LocalRoom sim host in a module Web Worker with pooled frames and local checkpoints`
