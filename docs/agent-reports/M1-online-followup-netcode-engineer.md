M1 online follow-up (stale-room guard, ShiftStateView adapter) / in-review / 2026-11-15 / netcode-engineer / Opus 5.5

Done:
1. Stale-room guard (`online-room.ts`). `tapFrames` takes an optional `live()` predicate. It also marks a connection dead once `leave()` was called on it or its `onLeave` fired. The frame tap and the state tap fire only on an open connection. `OnlineRoom` gives each consumed connection a generation, `live = gen === connGen && !disposed`, so a late patch or FRAME from a left, replaced or disposed room never reaches the read-outs or the host. The session's own callbacks are still delegated untouched (they keep their own `room === r` guard).
2. ShiftStateView adapter (`remote-room-host.ts`). New `shiftStateViewOf(state, tick, contractId, shiftType)`. It reads reflected MapSchema/ArraySchema containers through `forEach` and plain test maps/records. Players are sorted by slot, vehicles by entity id, and beacons are padded to 12. Ill-typed scalars get neutral values. `nearParcelsCollected` is copied only when it is a u8 and is left absent on a pre-v1.1 server. `OnlineRoom.shiftStateTap` feeds the host, which builds a view only while it has listeners and stops after `close()`. New stats `shiftStatesEmitted` and `shiftStatesInvalid`. HUD/menu writers now get online ShiftState (wallet, contract, elapsed).

Solo cost: none. Only the lazy online chunk changed. The adapter allocates online only, at most once per Schema patch (10 Hz, sent only when something changed).

Evidence (Node 26.13.1):
- vitest: online-room, online-readouts, online-loop.integration and src/net gave 10 files, 75 passed, 1 skipped. New tests:
  - Left room: a late patch or FRAME is ignored.
  - Disposed room: a late patch is ignored.
  - tapFrames: a replaced connection and an `onLeave` that fired are ignored.
  - Schema-like state: the view passes `ShiftStateViewSchema`, the mask is copied, the field is absent on an older server, there is no build without listeners, and nothing is emitted after close.
  - Real-server two-client loop: hostA's view passes the schema, has 2 players, and its mask equals `readouts.collectedMask`, with the mask authoritative.
- tsc --noEmit (client) exit 0. eslint exit 0 and prettier --check clean on the 4 touched files.
NOT RUN: pnpm verify, live browser 2-client check, netsim.

Online blockers (STATUS line 76 re-checked; listed, not built):
- Visuals dust feed: boot.ts:285-469 binds only the Solo `createDustFeedPort`. `room.feed` (MirrorDustFeed) is never swapped into `VisualsModule.dustFeed` while online. Owners: app/boot plus visuals.
- Control intents online: `RemoteRoomHost.sendIntent` drops every intent (counted), so purchases (hud-interaction.ts:244) and tool select do nothing online. This needs a RoomSession control-intent send (my net path) plus server handling (apps/server/src/net). Needs a brief.
- `onEvent` is not fed online: `sim_events` go only to the read-outs and are not turned into RoomSimEvents (my path; next follow-up).
- Stale in STATUS: a remote room host exists. Gameplay has an online input path (gameplay/module.ts `onlineRoom`). A guest sign-in flow exists (net/guest-auth.ts, ui/online). `gameDataVersion` is now derived (app/game-data-version.ts). The lead should re-verify and update STATUS.

Files: apps/client/src/app/online-room.ts, online-room.test.ts, remote-room-host.ts, online-loop.integration.test.ts.
