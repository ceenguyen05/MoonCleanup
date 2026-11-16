# M1 Plot Card batch review (code-reviewer)

2026-11-15 / code-reviewer / Opus 5.5. Working-tree state: uncommitted batch on main.
Scope: correctness and regressions only. Covers Plot Card label/clear, pad bindings and migration, toggle/hold setting, boot wiring, online near-parcel mask. `apps/client/src/render/**` excluded.

## Verdict: APPROVED (no blocking findings)

## Non-blocking findings (highest severity first)
1. **Blur while D-pad Up is held can toggle the camera a second time.** `InputState.clear()` (input-state.ts ~L301-312) runs `padDown.fill(0)`, so the next `setGamepad` poll sees the held button as a new press (L265). That press sets `padPlotPending` again, so after 0.3 s the camera toggles again, or the release toggles the Plot Card. The generic re-press was already there before this batch, but a hold now has a visible side effect. Fix: suppress the Plot Card pad button until it is released after a `clear()`.
2. **A frame hitch can turn a tap into a hold.** `advance()` adds the raw, unclamped `t.dt`. One long frame (over 0.3 s, e.g. tab return or a shader compile) makes a quick tap a camera toggle. Fix: clamp the dt per frame, or time the hold from timestamps.
3. **Hold mode with mixed inputs can leave the card stuck open.** Holding C opens the card (`plotCardShown`). A pad tap then closes it, and releasing C flips it again, so the card reopens and stays open. Low impact.
4. **Hold mode makes a wheel binding to plotCard do nothing.** `wheel()` calls press and release in the same call, which nets zero flips. Low impact.
5. **`tapFrames` stateTap has no stale-room guard.** online-room.ts ~L93-105: the session callback checks `room !== r`, but `stateTap` runs regardless, so a stale connection could still feed `noteState`. In practice Colyseus stops sending after leave. Low impact.
6. **Test gap: plot label.** `plotLabel` duplicates `IcoPlotGrid.chunkOf`/`localIndexOf` (packages/world/src/grid/plot-grid.ts:419-437). I checked by reading that the maths matches, but no test compares the two. Suggest a parity test where importing world is allowed.

## Checked (OK)
- **Pad12 tap/hold:** a menu (`setSuspended`), `clear()` and a press inside a menu all drop the pending state. The release after a hold does nothing. No allocation.
- **Hold mode (keys):** two keys bound to plotCard are counted; key auto-repeat is de-duplicated (`downKeys`). A press while suspended followed by a release after the menu closes produces no stray flip. The menu closes the card in `UiFrameBridge.pump`.
- **Migration:** the rewrite group is applied all-or-nothing and only to untouched defaults. It is skipped if plotCard already has a pad binding, and other rebinds are kept. It is idempotent: after a failed rev save, the rerun is skipped because Pad8 is no longer `cameraMode`. Fresh installs store rev 2. A corrupt table is reported and defaults are used.
- **Prefs:** the mode is loaded at boot and passed to `UiModule` (Settings shows the live value). `choosePlotCardMode` applies and saves it, and a save failure is reported. Unknown stored values are ignored and reported.
- **ShiftState append:** the field is the last field, so existing indexes are unchanged. Nothing in production calls zod `.parse()` on ShiftState. Old client with new server: the reflection decoder ignores the extra field. New client with old server: the field is `undefined` and the event fallback is used. The server sets the mask in `buildState`, so late joiners get it in the full state, and frame ticks update it only when it changes. The server's bit k (`MoonRoomSim.nearParcel`) matches the client's k.
- **Late join:** the session registers `onStateChange` (room-session.ts:559), which fires on the first full state. `noteState` replaces the collected set from the mask.
- **Solo cost:** one extra branch in `advance()`. The label is recomputed only when the plot changes. `clearNearParcels` runs once when the source goes away. The online files are lazy-loaded.

## Evidence (Node 26.13.1)
- client vitest (gameplay/input, input-settings, online-readouts, online-room, plotcard-parcels-clear, controls, parcel-feed): 7 files, 59 passed.
- server vitest (shift-state, shift-core): 2 files, 14 passed.
- shared vitest (protocol-v1, sim): 2 files, 21 passed.
- pnpm verify, browser and live 2-client checks: NOT RUN.

## Not reviewed
- ParcelFeed `nearSource` switching between solo and online in boot.ts (whether online readouts become the source after the one-time clear).
- SettingsPanel rendering and strings.
- What the new server and protocol test files assert (only their pass/fail status).
- remote-room-host `readouts` getter integration with ReadoutLink.
- render/**.
