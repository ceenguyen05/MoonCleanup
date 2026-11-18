# M1 solo-avatar edge cases (review finding 4)

Status: done.

## Changes (apps/client/src/app/solo-avatar.ts)
- Held tool is seeded from the host's last `shiftState` on host rebind (`SoloAvatarFeed.resetFrom`). It is read structurally, because `RoomHost` has no such field.
- `jumped` now fires on a seq change or a rising edge of the predictor flag. A jump on a frame where seq did not advance is no longer dropped, and a held flag is not replayed.
- Stale telemetry: if no new serial arrives for `STALE_TELEMETRY_S` (0.25 s), work stops. Only a new serial resumes it.
- Vehicle entry resets serial tracking, so phase re-anchors to the sim phase after exit.
- `dispose()` nulls the unsubscribe handles.
- No per-frame allocation. The new state is scalars only.

## Tests (apps/client/src/app/solo-avatar.test.ts, 13 pass)
- Jump edge cases and tool seeding.
- Work lifecycle:
  - Works on fresh telemetry for the current tool.
  - Stops on a stalled serial and resumes only on a new serial.
  - Stops when telemetry is absent or invalid.
  - Stops on tool switch and resumes only when telemetry matches the new tool.
  - Stops on vehicle entry and re-anchors afterwards.
  - Heap-delta check over 20k frames.

## Done
- Focused vitest (Node 26): 13/13 pass.
- `tsc --noEmit` for apps/client shows no errors in solo-avatar files.

## Not run
- Full `pnpm verify`, GPU and browser checks.

## Limits
- The allocation test is a coarse heap-delta heuristic.
- The 0.25 s stale threshold assumes telemetry frames at 20 Hz.
- Dispose idempotency was fixed, but no dedicated dispose test was added; `SoloAvatarModule` needs a full three/animation setup.
