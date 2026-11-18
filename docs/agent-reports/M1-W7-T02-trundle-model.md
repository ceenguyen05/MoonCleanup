# M1-W7-T02 Trundle model + Task A spawn facing (technical-artist) - PARTIAL

2026-11-18. No git, no STATUS.md edits, solo-avatar/animation/poser untouched. Node 26 via fnm alias.
Processes: every Vite and headed Chrome I started was stopped (runA.sh kills Vite; Chrome closed by script). Blender was never started. gpu.lock released after each capture.

## Task A UPDATE: DONE (supersedes the "not yet fixed" text below)
Root cause: sim `headingBasis` uses reference axis +X (yawFrame 1) when |y| > 0.8 (the pole, where the spawn is), so yaw 0 = +X there; `sphereBearingDeg` assumes +Y. Fix: `simHeadingBearingDeg` in `initial-facing.ts` (sim frame), used by boot. New test covers the pole case (21/21 pass with boot-wiring, tsc clean).
Look-check: `scratchpad/shots/A-after.png` (UHD 620, Medium, `?perf=1&onboarding=0`, 1280x720): spawn yaw now -2.44 rad, Receiving Gates, Assay Counter and lamp poles in view. Yaw 0 before showed bare regolith.
COMPASS FIX DONE (authorized): `boot.ts` now uses `simHeadingBearingDeg` for ParcelFeed + ObjectiveMarkers bearings (boot-wiring assertion changed first, failed, now passes). Second latent bug fixed in `app/menu-writer.ts` `UiFrameBridge`: the compass heading was written only on change, so a strip that mounted after the first heading stayed at 0 (transform never set); it is now re-sent ~2/s (idempotent). Tests: boot-wiring, menu-writer, initial-facing pass; `src/app` 189 pass, 1 known readout-writer 5 s timeout. Look-check `scratchpad/shots/A-compass.png`: strip shows S..W (heading 220 deg), apron pin dead centre where the gates/counter are. Caveat: the cardinal letters are the sim yaw frame (+X at the poles), not +Y north; fine for navigation, not a geographic N.
(Previously) OPEN BUG (now fixed above): HUD compass / objective-marker bearings (`sphereBearingDeg`, objective-markers, parcel-feed) use the +Y frame, so near the pole they point wrong (apron "dead ahead" while it was behind). Needs ui/app owner.

## Task A - original findings (historical)

Files (new/edited, all client-side, sim untouched so goldens 1076468633 / 4164540033 / world-ledger 1159199513 cannot change):
- NEW `apps/client/src/app/initial-facing.ts` (`InitialFacing`: once, after first pose + stations, sets live look yaw toward the Assay Counter, Desk fallback; never overrides a player who already looked).
- NEW `apps/client/src/app/initial-facing.test.ts` (3 tests) and `boot-wiring.test.ts` "Initial camera facing" (boot uses `new InitialFacing(` and `this.facing?.pump()`).
- `apps/client/src/app/boot.ts`: import, `interactionPump.facing`, construction next to `bridgeInput`, pump call.
- Results: vitest initial-facing + boot-wiring 20/20 pass; apps/client tsc clean.

Real-GPU findings (UHD 620, Medium, `?perf=1&onboarding=0`, own vite 5396; shots in the session scratchpad `shots/`):
- At spawn the pose is (43.5, 1999.19, 36.4), yaw 0; the home pad/Assay Counter is at (0, 2000, 0), 57 m away. Nothing is visible at yaw 0 (A-spawn20.png).
- Scanning yaw by 0.8 rad steps, the Receiving Gates/lamp poles appear centred at yaw about 3.9 rad (S4.png), not at 0.
- Holding W at yaw 0 moves the avatar toward +x (43.5 -> 70.6 over 8 s), i.e. AWAY from the pad. So the sim's yaw-0 heading is not the `sphereBearingDeg` north (the compass says the apron is dead ahead at 0 degrees, which is wrong for both movement and render). My current `InitialFacing` uses `sphereBearingDeg`, which yields about 0 here, so it does NOT yet fix the view. This is likely a latent compass/marker bearing bug too (Assay Counter marker points the wrong way).
- Next step: compute the yaw from the render/sim heading actually used (via the rig's `headingBasis` + the gameplay mapper: yaw = atan2(delta . east_h, delta . north_h) of the station relative to the feet, in the same frame the camera uses), or measure the exact offset from the walk vector; then rerun the capture. Keep the fix client-side. Report the compass bearing discrepancy to the lead (outside my paths).

## Task B - authored Trundle GLB: NOT STARTED
Only the earlier procedural blockout (4 meshes / 2 materials, `visuals/vfx/vehicles/trundle-model.ts`) exists. Left: Blender script in `assets/models/vehicles/`, pipeline compress + budgets, ASSET_LICENSES row, loader with procedural fallback, VT-M1-35 turntable via the lab, front/side real-GPU capture (drum spray grains, night lamps; `?onboarding=0`).

## Left, in order
1. Fix Task A yaw computation (above), rerun the one real-GPU look-check.
2. Task B steps above.
