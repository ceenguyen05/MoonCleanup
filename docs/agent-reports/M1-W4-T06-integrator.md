# M1-W4-T06 two-client online loop, client side (integrator)

**Status: in-review (core loop PASS in-process; netsim N/A; entry-chunk split NOT applied, measured worse).** Date: 2026-11-15. Model: Opus 5.5. No git. Not touched: `net/`, `packages/*`, `visuals/`, sim goldens, apps/server.

## Done

### 1. RemoteRoomHost: `apps/client/src/app/remote-room-host.ts` (online chunk)
- `RemoteRoomHostImpl implements RemoteRoomHost` (client/room-host v1) over an `OnlineRoom`.
- `sendInput` goes to `OnlineRoom.sendInput`, which handles the wire plus own-avatar prediction.
- `onFrame` hands out the raw protocol FRAME messages (type byte first, the same layout as Solo frames):
  - a fixed pool of 3 buffers (`FRAME_MAX_BYTES + 1`);
  - refcounted `release()`;
  - a frame is dropped and counted when every buffer is still held;
  - `tick` / `ackInputSeq` are taken from the session view.
- `state` comes from the session phase plus `dust.ready`:

  | Session phase | Host state |
  | --- | --- |
  | `idle`, `waking`, `connecting`, `joining` | `booting` |
  | `joined`, `resyncing` | `loading` until the mirror is ready, then `running` |
  | `reconnecting` | `loading` |
  | `failed`, or closed by the server | `failed` |
  | closed by `close()` | `closed` |

- **Reconnect handling:**
  - SDK seat-hold reconnects stay inside `RoomSession`.
  - On a *retryable* failure the host calls `session.retry()` after `retryAfterMs` (default 2 s), at most 3 times (`stats.autoRetries`).
  - A reconnect's keyframe restarts the predictor and its snapshot reinstalls the mirror (existing `OnlineRoom` handlers).
- `rttMs` reads the session clock.
- `close()` leaves, then disposes.
- The raw FRAME comes from `tapFrames()` in `online-room.ts`: a delegating `RoomConnection` wrapper around `consume`. It calls the session's FRAME handler first, then the tap. `OnlineRoom` gained `frameTap` and `statusListener` fields (status fires on phase changes and on snapshot install).

### 2. Lobby → room → `roomHost` service: `online-launch.ts`, `boot.ts`
- `createOnlineDevHooks(..., { publisher: roomHost, auth: () => loadGuestAuth() })`. The online entry UI's `open(contractId, token)` now:
  1. loads the chunk (`openRemoteHost`);
  2. pauses a running Solo `LocalRoomHost`;
  3. publishes the RemoteRoomHost. Gameplay already rebinds on `onChange` and uses the slot's predictor for the pose.
- `close` publishes the previous host again and resumes it. An open still in flight when `close` is called is cancelled by a generation counter.
- Token source:
  - the first join uses the token from the UI;
  - forced refreshes and reconnects ask the shared `GuestAuth`.
  - Before, the token was fixed and could never refresh.
- `stats()` now includes the host's state, rtt and counters.

### 3. Real `gameDataVersion`: `app/game-data-version.ts`
- The version is `gd1-` plus the FNV-1a 32 hash of the canonical (key-sorted) JSON of `RAW_GAME_DATA`.
- It replaces `buildVersion.slice(0, 32)` in `boot.ts startCheckpointSync`. game-data is dynamic-imported in that existing background `Promise.all`, so the first frame pays nothing.
- **Proposal (game-data owner):** export this as a constant from `@moon-cleanup/game-data`, so the server's `knownGameDataVersions` can come from the same source.

### 4. Dust mirror seam (no visuals/ or sim-host edits)
- The mirror is `OnlineRoom.feed: MirrorDustFeed`. It implements the visuals `DustFeedPort` with the same target methods as sim-host `DustViewTarget`: `onStroke`, `onLedgerZero`, `onPolished`, `rebuildAll`.
- Its ledger (`feed.ledger: WorldDustLedger`) satisfies sim-host's `DustLedgerReadView`, the same read API `SoloDustView` exposes.
- **Exact seam to plug it in:** `boot.ts` passes `dustFeed` into `new VisualsModule({ search, dustFeed })` once, at construction. The online feed therefore needs either:
  - (a) a swappable feed on `VisualsModule` / the dust scene (`setDustFeed(port | null)`, visuals owner); or
  - (b) a delegating `DustFeedPort` in app that forwards to the Solo view or `room.feed`.

  I did not do (b), because the dust scene binds its atlas target only once and the grid / site must match. It needs a visuals-owner decision.

### 5. Remote avatars → animation pool: `app/remote-avatars.ts` (online chunk)
- `RemoteAvatarFeed.provider` is an `AnimInputProvider` for `AnimationModule.bind`. It is allocation-free.
- On the slot-0 call it rebuilds the map from pool slots to avatar entity slots (`table.kind === ENTITY_KIND_AVATAR`).
- Position comes from the interpolation buffer. Velocity is a smoothed estimate. Facing follows horizontal velocity above 0.2 m/s. A new entity in a slot sets `teleport`.
- Not bound in boot: `AnimationModule` is not registered there yet (boot.ts: "modules without an implementation yet ... are skipped"). It should be bound when animation is registered.

### 6. Two-client integration test: `app/online-loop.integration.test.ts`
- **Server:** the real `startServer` (apps/server) runs in-process with memory persistence and the `ws` transport. It is loaded by a computed `file://` URL, so client `tsc` never compiles server sources.
- **Lobby path:** the UI's `createContractsApi` does create Private Shift → B `joinByCode`.
- **Rooms:** two `OnlineRoom`s go through the real `colyseusConsume` (Colyseus SDK).
- **Origin header:** the test swaps in a WebSocket subclass that sends `Origin`, as browsers do. The server refuses upgrades without an allowed Origin, and Node's undici sends none.
- Assertions:
  - both clients are joined with mirrors ready;
  - A's host is `running`;
  - each client sees one avatar entity;
  - B's animation feed sees A move more than 0.5 m;
  - after 3 s of A sweeping, both mirrors' `worldHash` are equal and differ from the start;
  - A's host emitted frames.

### 7. Entry-chunk split (coordinator add-on): measured, NOT applied

| Same tree state, `vite build` | Entry `index-*.js` | Notes |
| --- | --- | --- |
| Barrel import (current) | **2,042,264 B** | 22 chunks; game-data (`src-*.js` 79,845 B), `rest`, `messages` and `dust-wire` are lazy |
| `modules.ts` / `services.ts` deep-import `../net/session` | **2,101,464 B (+59 KB)** | online code moved out (`net-*.js` 40,010 B, `guest-auth` 2,621 B), but rolldown hoisted game-data plus the `rest`, `messages`, `close-codes` and `limits` chunks into the entry (18 chunks) |

- The deep import makes the entry bigger, so I reverted it. `modules.ts` and `services.ts` are unchanged.
- Artifacts are in the scratchpad: `build-before2/`, `build-after2/`.
- Root cause: rolldown's chunk merging once `net/` becomes a shared lazy chunk. `apps/client/package.json` has no `"sideEffects": false`, and `net/room-session.ts` has top-level non-pure code (`S2C_BYTES_IDS` / `S2C_CONTROL` built with `flatMap`).
- Proposals:
  1. **devops** (root config): `"sideEffects": false` in apps/client package.json, or a `manualChunks` / `advancedChunks` group that keeps `packages/game-data` out of the entry. Then redo the deep import.
  2. **net owner:** wrap the two top-level tables in `room-session.ts` in lazy getters, so the barrel tree-shakes.

## Evidence (apps/client, Node from fnm default)
- `tsc --noEmit -p apps/client`: clean.
- `eslint src/app`: clean.
- `prettier --check src/app`: my files are clean. `install-guard.ts` and `solo-host.ts` are flagged; I did not edit either.
- **Two-client loop:** `vitest run src/app/online-loop.integration.test.ts` passed 3 times (13–15 s). The last run printed:
  - `movedSeenByB` 6.68 m; animB present 1;
  - worldHash 0 → 1407168939, equal on A and B;
  - A: 61 inputs sent, 0 dropped, 36 frames, 1 keyframe, 1 snapshot, last correction 0.0005 m;
  - B: 36 frames, 1 snapshot;
  - hostA: `running`, 36 frames emitted, 0 dropped, 0 auto-retries.
- `vitest run src/app src/gameplay src/net`: 21 files, 164 of 165 passed. The one failure was `gameplay/solo-prediction.test.ts` "allocate nothing per frame" (a heap measurement under full-suite load). Run alone, it passed 6 of 6, twice. It is not in my paths.
- New test `game-data-version.test.ts`: 2 tests, included in the run above.

## N/A / not run
- **Netsim 120±30 ms / 1% loss: N/A.** `tools/netsim/toxiproxy/` is empty: no toxiproxy binary, so the proxy cannot run.
- `pnpm verify`, browser 2-client run, Vercel/Render deploy check: not run.
- The test compares the worldHash of the two client mirrors, not the server ledger. The server room's internals are not reachable through `startServer`.

## Open / owners
1. **net:** `RoomSession` has no control-intent send, so `RemoteRoomHost.sendIntent` only counts (`intentsDropped`). Proposal: `RoomSession.sendIntent(intent)`.
2. **net:** `onShiftState` and `onEvent` are registered but never fed. They need a Schema → `ShiftStateView` adapter and `sim_events` routing (`handlers.onControl`).
3. **visuals:** swappable dust feed (seam 4a above).
4. **animation/lead:** register `AnimationModule` in boot, and on room open call `bind(createRemoteAvatarFeed(room).provider, ground, radius)`.
5. **devops/net:** the entry-chunk split (section 7).
6. **server/security, FYI:** WS upgrades without `Origin` are refused. This is correct for browsers; non-browser bots need the header.

## Files
- **New:** `apps/client/src/app/{remote-room-host.ts, remote-avatars.ts, game-data-version.ts, game-data-version.test.ts, online-loop.integration.test.ts}`
- **Edited:** `apps/client/src/app/{online-room.ts, online-launch.ts, boot.ts}`. `modules.ts` and `services.ts` were edited and then reverted.
