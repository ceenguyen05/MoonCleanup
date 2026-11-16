M1 online integration (mirror dust feed, online onEvent, online sendIntent) / in-review / 2026-11-15 / integrator / Opus 5.5

Done (client only; owned paths apps/client/src/app/**, apps/client/src/visuals/module.ts):
1. Online sendIntent (`remote-room-host.ts`, `online-room.ts`). The protocol already has active C2S `purchase` {requestId, itemId} and `select_tool` {slot}, and the server already handles both (apps/server/src/net/shift/shift-room.ts:228-236, 540-564). So no server or protocol change was needed. `OnlineRoom` keeps the newest consumed (tapped) connection. `OnlineRoom.sendControl(type, payload)` sends on it only when the room is joined or resyncing and not disposed. Otherwise the message is dropped and counted (`controlsSent`/`controlsDropped`). `RemoteRoomHost.sendIntent` maps a purchase to `purchase` and a tool select to `select_tool`, with new stats `intentsSent` and `intentsDropped`. The purchase outcome comes back through the sim's `purchase.completed`/`purchase.rejected` events (item 2), which hud-interaction already settles on.
2. Online onEvent. `OnlineRoom.onSimEvents` now also hands the session-validated `sim_events` batch to `simEventsTap`. RemoteRoomHost turns that into onEvent calls, one per event in server order. It skips the copy while there are no listeners, stops after close, and counts `eventsEmitted`. HUD writer and purchase port listeners now get events online. Audio gets them wherever it listens through hud-writer/events.
3. Mirror dust feed. Note: `DustFeedPort` is consumed only by the `?scene=dust` worksite. The main game and `?scene=moon` render no dust layer today, so this only affects the dust scene. The online room's dust still reaches the readouts.
   - New `VisualsModule.setDustFeed(feed)` (cold path). It disposes the dust worksite and rebuilds it on the new feed: it rebinds the renderer and reapplies quality. It is a no-op for other scenes or the same feed.
   - New `OnlineHookWiring.dustFeed` binder (`online-launch.ts`): open binds `room.feed`, close binds null.
   - boot.ts: VisualsModule is now built before the online hooks. The binder calls `setDustFeed(feed ?? soloFeed)`. In the dust scene the online room gets `sitePlot: DUST_SCENE_SITE`.
   - Also fixed: the publisher-less open path now drops a room whose open was overtaken by a newer open or close.
   Solo cost: none. Nothing runs per frame, and the solo feed is unchanged until a room opens.

Evidence (Node 26.13.1):
- vitest `src/app` + `src/visuals/module`: 18 files, 119 tests passed. The first run had 1 failure in the new test (the fake connection also records the session's `ready` send). The assertion now filters to control types. The re-run of online-room.test.ts passed 12/12.
- New test: purchase/select_tool payloads go on the wire, `sim_events` reach onEvent in order, intents are dropped after leave, and no events arrive after close.
- `tsc --noEmit` (client) exit 0. eslint exit 0 and prettier --check clean on online-room.ts, remote-room-host.ts, online-launch.ts, boot.ts, online-room.test.ts and visuals/module.ts.

NOT RUN: pnpm verify, live browser 2-client check, a real-server purchase round trip, and a GPU check of the dust-scene rebuild (`setDustFeed` has no unit test, because it needs the renderer and scene roots).

Returned to owners (not patched):
- gameplay (apps/client/src/gameplay/module.ts:229): `if (this.onlineRoom === null) this.host?.sendIntent(...)` skips tool select online. Now that RemoteRoomHost.sendIntent sends `select_tool`, drop the guard: `this.host` is the published RemoteRoomHost online. The predictor follows the server's authoritative `equippedTool` (Schema), so prediction stays consistent.
- server (apps/server/src/net/shift/shift-room.ts:549): the rate-limit PURCHASE_RESULT sends `code: "RATE_LIMITED"`. `PurchaseResultPayloadSchema` only allows the lowercase `PURCHASE_REJECT_REASONS`, which includes `"rate_limited"`. The client therefore rejects the message (`controlInvalid`), and no sim event is emitted for it. A rate-limited purchase then stays pending in the HUD until the room host changes. Fix: send `"rate_limited"`. Optional follow-up for the client: map a valid `ok:false` PURCHASE_RESULT to settle the pending purchase. That needs the own seat slot on RemoteRoomHost.

Next steps:
1. Gameplay owner: remove the online guard at gameplay/module.ts:229.
2. Server owner: fix the lowercase code at shift-room.ts:549.
3. Live check (`?scene=dust&perf=1`):
   - `__mcOnline.open`, then `__mcLook.info().dustFeed.online === true`.
   - On close, the Solo feed returns.
   - Buy at the Desk online: wallet delta plus a `purchase.completed` settle.
4. Lead: update STATUS for the online onEvent/sendIntent gaps.
