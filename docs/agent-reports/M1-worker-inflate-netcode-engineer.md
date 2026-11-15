# M1 worker-side dust snapshot inflate (netcode-engineer)

Status: DONE. Scope: `apps/client/src/net` only, plus tests. Date: 2026-11-15. No git. No edits to `app/`, `visuals/`, `gameplay/`, sim, protocol or goldens.

## What changed

The protocol `ClientSession` inflates a DUST_SNAPSHOT synchronously inside its slice handler, and `net/` cannot edit it. The offload therefore sits in front of the session and leaves the session unchanged.

1. `DustOffload` (`dust-offload.ts`) assembles the slices itself with `SnapshotAssembler`. It posts the deflate stream to a worker, keeps copies of the slices, and **holds back** everything that arrives behind the snapshot: FRAME, DUST_LEDGER, DUST_CHECK and further slices. PONG is never held.
2. When the worker answers, the offload re-feeds the retained slices to the session. The session's `inflate` (`DustOffload.inflate`) returns the worker's output instead of inflating, so stats, `checkReady` and `onDustSnapshot` behave as before.
3. The offload then replays the held messages **in arrival order, each with its original arrival timestamp**, so interpolation timing is preserved. A second snapshot that arrives while the first is inflating queues the same way.
4. Fallbacks use the existing sync `inflateRaw`:
   - no worker attached;
   - stream under 2 KB deflated (`OFFLOAD_MIN_DEFLATED_BYTES`);
   - worker error;
   - 3 s timeout, after which the worker is abandoned;
   - hold-back queue at 512 (nothing is dropped; the hold ends with a sync inflate).

   A worker verdict of "corrupt" reaches the session as an invalid snapshot, so it counts and resyncs as before.
5. Worker files, spawned only online:
   - `inflate.worker.ts`: module worker entry.
   - `inflate-worker-core.ts`: message contract, `runInflateJob`, shape validation.
   - `inflate-worker-client.ts`: `new Worker(new URL(...), { type: "module" })`.

   `room-session.ts` dynamic-imports the client on `start()` and only when `Worker` exists and no custom `inflate` is given.
   - New option `inflateWorker`: a factory (tests), or `false` to turn the offload off.
   - New `RoomSession.dustOffload`: the stats object, or null when off.
6. The solo path constructs nothing. The files are online-only like the rest of `net/`. The hot path while no snapshot is inflating costs one id comparison per bytes message and two comparisons per frame.

## Stale window and the dust.plots / Polished loss

Server pacing (M1-dust-pacing) spreads a large snapshot over several frame ticks. FRAMEs applied between the first and last slice carry strokes and `dust.plots` deltas the snapshot does not include, and the client skips them. A hold-back from the first slice would delay every entity update for the whole transfer (seconds on a slow client), so I did not do that. The fix is a client-only detect and resync:

- `noteFrame` (called from the session's `onFrame` host callback) records FRAME dust applied while a snapshot is partly received. After install, if that dust is newer than the snapshot's version, `takeGap()` is true.
- `RoomSession` then waits 2.1 s, because the server allows one snapshot per seat per 2 s, and calls the new `ClientSession.requestSnapshotResync(nowMs)` (protocol, below). It enters `resyncing`, drops frames until a keyframe, sends one `visibility {hidden:false}` request, and retries by the normal resync rules.
- It is bounded: at most 2 gap resyncs in a row (`DUST_GAP_MAX_RESYNCS`), then `stats.dustGapAccepted++`. It is skipped while the tab is really hidden or the room is gone.
- A normal join (single-tick snapshot) never has a gap, so nothing changes there.
- Counters: `session.stats.dustGapResyncs`, `session.stats.dustGapAccepted`, `dustOffload.gaps`.

Residual: the resync resets entity slots for one round trip (the same as any stall resync). Only snapshots above about 96 KB reach it.

## Protocol changes (coordinator follow-up, `packages/protocol`)

1. `countOpened` (`codec/dust-messages.ts`) now reads `PlotState.Opened` from a module constant instead of per plot. Behavior is identical; protocol tests are green (10 files, 123 tests). Measured on 163,842 plots: 13-17 ms before, about 0.6 ms after (hoisted copy). Through the real session path, the decode of the 251 KB inflated snapshot dropped from p50 23 ms to **p50 1.08 ms, max 1.35 ms** under vitest. The first, cold decode in a process still shows about 16 ms (JIT), and a cold `RemoteDust.installSnapshot` shows about 15 ms (it was 114 ms before the constants hoist). So the apply step is near 1 ms warm, and not proven under 1 ms cold; I could not measure a production browser.
2. New `ClientSession.requestSnapshotResync(nowMs): boolean` (`session/session.ts`). It does nothing and returns false outside the room or while the tab is hidden. Otherwise it runs the existing `beginResync("snapshot")` path. New test in `session.test.ts` covers: idle returns false, the request goes out once with reason `snapshot`, frames are dropped until a keyframe, the join completes on keyframe plus snapshot, `ready` is sent once, and a hidden tab returns false. This replaces the hidden-then-shown hack; `RoomSession` uses it.

## Bundle check (`vite build` of apps/client, output to the scratchpad, not dist)

- The build succeeds. The worker splits into its own chunks: `inflate.worker-*.js` 3.7 KB (module worker), `inflate-worker-client-*.js` 0.4 KB, `dust-offload-*.js` 4.7 KB (loaded on demand). The string `dust-inflate` and `maxHeldDepth` appear only in those chunks.
- First build, with `DustOffload` imported statically: entry chunk `index-*.js` 2,050,243 B and it contained the offload code. I then made `room-session.ts` import the offload and the worker client by dynamic `import()` on `start()`, and the barrel re-exports only types. Second build: entry **2,042,331 B** (7.9 KB smaller than the static variant; the offload is no longer in it).
- A true before-this-task baseline could not be built (no git, per the rules). The entry already carried `RoomSession`, `RemoteDust`, `inflateRaw` and the codecs from before this task: `modules.ts` and `online-room.ts` import the `../net` barrel statically (rolldown reports `INEFFECTIVE_DYNAMIC_IMPORT` for `guest-auth` and sim for the same reason), and the barrel is shared. What this task adds to the entry is only the small gap-resync and activation code in `room-session.ts`, about 1 KB or less; I did not isolate the exact byte count. Getting the pre-existing online code out of the entry needs `app/modules.ts` to import `../net/session` directly instead of the barrel, which is outside my scope.
- Safe activation: the offload loads in the background, so a join in progress uses the sync inflater. It switches on when no snapshot is part-way through the session (checked on load, on connect, and after each snapshot installs). Tests wait for it with `vi.waitFor`.

## Tests

**New tests (23, all passing)**

- `dust-offload.test.ts`: 14 tests, using a **real worker thread** (`node:worker_threads` running zlib).
  - Ordering and hold-back replay for 220 messages: the held trace equals the expected arrival order.
  - **worldHash equality**: the offloaded client's `worldHash` equals the server's and equals the synchronous reference client's (same trace, same plot states).
  - A resync snapshot arriving mid-inflate.
  - Large snapshot: 51 slices, 206 KB deflated, 251 KB raw.
  - Fallbacks: worker error, timeout (fake timer), null verdict, `reset()` with a late reply, queue overflow, small stream inline, no worker, duplicate and invalid slices, gap detection (3 cases), the session-facing `inflate` cap.
- `room-session.test.ts`: 3 new integration tests with a manual worker port.
  - Frames queue behind the snapshot and apply after it: handler order is F100, S, F102, F104, and the phase joins only on the answer.
  - The gap resync: one resync request, only after 2.1 s.
  - A failing worker factory falls back to the sync inflater.

**Fixture**: `dust-test-server.ts` (new, not shipped) is the authoritative MoonRoomSim plus ledger, extracted from the `remote-dust.test.ts` fixture.

## Numbers (Windows laptop, vitest, 6 runs, worker thread)

| Measure | Result |
| --- | --- |
| Main thread, per slice push (51 slices) | p50 0.005 ms, p99 0.154 ms, max 0.242 ms |
| Main thread, final slice (assemble 206 KB + post to worker) | p50 0.37-0.59 ms, max 0.6-1.2 ms (two runs) |
| Main thread, held message push (copy) | within the slice-push row above |
| The same inflate on the main thread | 20.8 ms (vitest; about 6.5 ms in plain node, per the earlier report) |
| Hold, last slice to apply (worker spin-up included) | max 86 ms |

Assertions: p50 and p99 per push under 1 ms, final-slice p50 under 1 ms.

Hold-back adds a fixed delay of roughly the worker round trip (a few ms) to FRAMEs that arrive during a join or resync. This happens only then.

**Main-thread work that remains after the offload**: the session decode and `RemoteDust.installSnapshot`; see "Protocol changes" above (warm decode about 1 ms, cold install about 15 ms under vitest).

## Checks (apps/client)

- apps/client: `tsc --noEmit` clean, `eslint src/net` clean, `prettier --check` clean, `vitest run src/net src/app`: 16 files, 133 tests pass.
- packages/protocol: `vitest run` 10 files, 123 tests pass; tsc, eslint and prettier clean on the touched files.
- `vite build`: succeeds (see above).
- Not run: real browser, netsim, `pnpm verify`.

## Files (all under `apps/client/src/net/`)

- New: `dust-offload.ts`, `dust-offload.test.ts`, `inflate-worker-core.ts`, `inflate.worker.ts`, `inflate-worker-client.ts`, `dust-test-server.ts`
- Edited: `room-session.ts`, `room-session.test.ts`, `remote-dust.ts` (constants hoisted), `index.ts` (type-only barrel exports for the offload)
- Protocol: `packages/protocol/src/codec/dust-messages.ts` (`countOpened`), `src/session/session.ts` (`requestSnapshotResync`), `src/session/session.test.ts`

## Next

1. A browser run should confirm the worker chunk loads on Vercel.
2. Optional, `app/modules.ts`: import `../net/session` instead of the barrel to take the pre-existing online code out of the solo entry chunk.
