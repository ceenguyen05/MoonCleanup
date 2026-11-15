# M1 dust snapshot pacing (netcode-engineer)

Status: DONE. Closes the open mismatch in `M1-snapshot-cap-contracts-architect.md`. Scope: `apps/server/src/net` only.

## Problem
`ShiftCore.sendDust` sent every DUST_SNAPSHOT slice in one tick. Above about 125 KB deflated the uWS/ws backpressure rule (`WS_MAX_BACKPRESSURE_BYTES` = 128 KB) closed the socket. The 64-slice ceiling is 261,568 B.

## Fix
- Slices are paced against the socket's buffered amount. `ShiftSink.buffered(seat)` is new, and `shift-room.ts` implements it with `socketBufferedBytes` (new file `net/socket-buffer.ts`). It reads `ref.bufferedAmount` on `ws` and `ref.ws.getBufferedAmount()` on uWS. Unknown or closed sockets read 0.
- `ShiftCore.pumpSnapshot` sends the oldest pending slices while `buffered + sent this call + slice + 8 B overhead` stays within `WS_BULK_SEND_CEILING_BYTES`. That ceiling is 96 KB, or 3/4 of the cap. The other 32 KB is reserved for frames, events and streamed ledgers that keep flowing, so the snapshot cannot cause the close by itself.
- The per-seat queue is the slice array that the snapshot build already makes (standalone copies), plus an index. Nothing is allocated on the tick path. A seat with no pending snapshot pays one null check. Other clients' work is unchanged.
- A healthy client has an empty buffer, so a typical snapshot (15-25 KB, worst about 80 KB) still goes out in the same tick as before, and the existing stroke-ordering rule holds. Only a snapshot over the headroom, or a slow socket, spreads over later frame ticks.
- Streaming of DUST_LEDGERs and dust-interest refresh wait until the last slice is out.
- A resync request, hide, hold or leave drops a half-sent snapshot. The next snapshot is built fresh, still limited to one per 2 s.
- The ceiling is never below one full slice, so a paced snapshot always makes progress.
- Limits are unchanged: `WS_MAX_BACKPRESSURE_BYTES` and the transport sweep or close rules are untouched. A stalled client stops receiving slices at the ceiling, then the existing rule drops it once frames push it over 128 KB. New constants are in `net/limits.ts`.

## Decision for the lead
`netcode.md` 9.1 says at most 2 slices per frame. I did not add that fixed per-frame cap. At 2 per frame, every ordinary join snapshot (4 to 6 slices) would span several frames. During that window the client skips FRAME strokes, because it applies none before the snapshot installs, and it would lose them. Gating on buffered bytes keeps ordinary joins on the single-tick path. The doc line should be reworded to "paced against the socket buffer". I did not edit docs.

## Stale-window handling (paced snapshots only)
When a snapshot has to be paced, the frames sent during the transfer carry strokes the client discards.
- When pacing starts, the core records each snapshot ledger's version.
- When the last slice is out, any ledger whose version changed has its `sent` mark cleared. The interest pass then re-queues it as a DUST_LEDGER, which replaces the stale copy on the client.
- Counter `dustSnapshotCatchUps` counts these.
- Residual, counter `dustSnapshotStale`: a plot Polished during the window has no ledger left to resend. Far-away moon-wide `dust.plots` L0 deltas in the window are skipped by the client too. Both are cosmetic and only reachable with snapshots above about 96 KB, which real play (about 37 ledgers, 15-25 KB) does not produce. A full fix needs a client change (buffer FRAME dust sections until the snapshot installs). That is outside my paths, so I am flagging it.

## Tests
New `shift/shift-dust-pacing.test.ts` (9 tests), with the socket modelled as a byte counter that drains at a fixed rate and the real `terminateBackpressured` rule:
- A 64-slice (261 KB) snapshot to a 120 KB/s client completes in order, with no terminate and a peak buffer at or below 128 KB.
- A typical snapshot to an unconstrained client leaves in one tick (no pauses).
- A sink without `buffered()` never exceeds the ceiling per tick.
- A stalled client stops at the ceiling, is not closed by the snapshot, and is terminated by the existing rule once frames overflow it.
- A paused seat does not change other seats' frames.
- A resync supersedes a half-sent snapshot.
- Ledgers changed mid-pacing are re-sent as DUST_LEDGER after the last slice.
- `socketBufferedBytes` unit test (ws, uWS, throwing uWS, undefined).

## Evidence
- `apps/server`: tsc clean, `eslint src/net` clean.
- `vitest src/net`: 16 files, 165 tests pass. The earlier baseline was 15 files and 156 tests.
- No changes to `apps/client`, `packages/sim`, `packages/protocol` or goldens.

## Files
- `apps/server/src/net/limits.ts`
- `apps/server/src/net/socket-buffer.ts` (new)
- `apps/server/src/net/shift/shift-core.ts`
- `apps/server/src/net/shift/shift-room.ts`
- `apps/server/src/net/shift/shift-dust-pacing.test.ts` (new)
