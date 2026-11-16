# M1 client online fixes (review non-blocking 1, 3, 4) - netcode-engineer

Status: done. Finding 2 skipped as instructed (dev scene only).

## Changes
1. `apps/client/src/app/online-room.ts` `sendControl`: while the session is `resyncing` the control is held in a bounded queue (`HELD_CONTROLS_MAX` = 8) and flushed in order when the phase returns to `joined`. The queue is dropped (counted in `controlsDropped`) when the session goes `failed` or `closed`, or the room is disposed. A full queue returns false (counted), so nothing is lost silently. New stat `controlsHeld`. Only `joined` sends straight to the socket.
2. `apps/client/src/ui/online/online-model.ts` `parseInviteLink`: an invalid `/join/<x>` path now falls back to `?join=`. A valid path code still wins.
3. `apps/client/src/app/online-launch.ts` + `remote-room-host.ts`: new `RemoteRoomHostImpl.gaveUp` (failed with no auto-retry pending). The open hook watches the host's state. On a terminal failure it unbinds animation, local slot and the dust feed (Solo source returns). A manual retry that recovers rebinds. `close()` unsubscribes the watcher. A failure with a retry pending does not unbind, so no flicker.
4. `visuals/module.ts` not touched (setDustFeed needed no change).

## Tests added
- `online-room.test.ts`: resync hold, order, cap, flush on keyframe + snapshot, drop on leave.
- `online-launch.test.ts` (new): refused join (404) unbinds dust and animation by itself.
- `online.test.tsx`: the `/join/bad` to `?join=` fallback, and path-wins.

## Evidence (Node 22 shell)
- vitest `src/app src/ui src/visuals`: 391 of 392 pass. The one failure was `round5-wiring.test.ts` (Solo worker read-outs). It hit the 5 s timeout under parallel load (5451 ms) and passes alone (6 of 6). Not in my files. `shadow-filter.test.ts` was green in this run.
- Focused: online-launch + online-room + ui/online: 44 of 44 pass.
- client `tsc --noEmit`: clean. eslint on the 7 touched files: clean. prettier (`--end-of-line auto`, as the working tree is CRLF) on the touched files: clean after `--write` of the two test files.

## Notes
- The HUD pending state is not cleared if the queue is dropped on a terminal failure. The host then goes `failed`, and the purchase port rebinds and clears pending on a host change. `RoomHost.sendIntent` still returns void; changing it would touch the shared contract, so I left it.
