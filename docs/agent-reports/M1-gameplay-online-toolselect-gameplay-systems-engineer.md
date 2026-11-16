M1 gameplay: online tool select + dust-scene mirror check / in-review / 2026-11-16 / gameplay-systems-engineer / Sonnet 5.5

## Changes (apps/client/src/gameplay only)
- module.ts:229 dropped the `onlineRoom === null` guard: `this.host?.sendIntent({ kind: "select_tool", slot })` now runs online too (host = published RemoteRoomHost). Solo path and per-frame allocations unchanged (one removed null check).
- gameplay.test.ts: new "tool select intent" tests (Solo and online-slot module both reach host.sendIntent; stats.intents counted).
- solo-prediction.test.ts: new "input -> screen direction under each render mapper" tests.
- input/bindings.ts: prettier --write only (file was already modified by another writer and failed format check).

## Dust-scene mirror (STATUS line 59)
The axis flip is not a live bug in gameplay/**: it is the intended compensation. `PlotFrameMapper.mirrored` (camera-rig.ts:261, det(e,n,t) < 0) sets `InputState.mirrored` (module.ts:146), which flips strafe (input-state.ts:361), mouse turn (:254) and pad look (:310); boot.ts:368 wires the mapper for `?scene=dust`. The new tests verify the end-to-end chain (rig forward/up mapped through the mapper, screen-right = F x U): D strafes screen-right and mouse +x turns screen-right at yaw 0, 1, 2.5, 4, for both the standard tangent frame and the mirrored plot frame. They pass, so input is not mirrored on screen. If the dust scene still looks mirrored to the eye, the cause is the scene's own geometry/terrain handedness (visuals/dust), not input; I did not find a file:line there and did not edit visuals/render. STATUS line 59 is stale and can be updated by the lead.

## Evidence (Node 26.13.1 via fnm PATH)
- vitest src/gameplay: 5 files, 57 tests pass.
- client `tsc --noEmit`: clean (an earlier run hit a TS1005 syntax error in ui/online/online.test.tsx:388 from another writer mid-edit; gone on rerun).
- eslint apps/client/src/gameplay: clean. prettier --check apps/client/src/gameplay: clean.

## Not run
No on-device play check of tool select over a real Colyseus room; test uses a fake host.
