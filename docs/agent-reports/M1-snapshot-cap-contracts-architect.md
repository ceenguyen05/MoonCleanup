# M1 snapshot cap review (contracts-architect)

Status: PASS with one open mismatch for the server owner (not a regression from the cap change).

## Findings
- The 1.5 MiB `DUST_SNAPSHOT_MAX_RAW_BYTES` is consistent. Worst legal ledger-only snapshot is 1,024 x 1,070 B + plot states + remaining bytes. That is about 1.30 MB at the standard grid and about 1.42 MB at `1 << PLOT_ID_BITS` plots, so it fits under 1,572,864 B.
- No doc stated the 1 MiB value. The only other 1 MiB constants are unrelated: `SAVE_HEADER_MAX_BYTES`, `CHECKPOINT_PART_MAX_BYTES`, and the world-and-dust-simulation.md tile tables.
- The 32 MiB owner-decision inflate cap is the REST checkpoint-upload budget (`CHECKPOINT_RAW_BUDGET_BYTES`). It is a separate path and unchanged.
- Per-message limits are unaffected, because slices stay at most 4,096 B and the raw cap does not change that.
  - Server to client slices are at most 4,096 B (`DUST_MESSAGE_SLICE_MAX_BYTES`).
  - Client to server messages are at most 2,048 B (`WS_MAX_PAYLOAD_BYTES`), which is inbound only.
  - The client `OUTBOUND_MAX_BYTES` is outbound only.
- Bandwidth budgets are unchanged. The snapshot is a one-off at join or resync, and the real blocking part is at most about 80 KB deflated (WDS 5.4). The ongoing rates are untouched.

## Open mismatch (pre-existing, flagged not fixed; server code is out of my paths)
- `WS_MAX_BACKPRESSURE_BYTES` is 128 KB and `ShiftCore.sendDust` queues all snapshot slices in one tick. The docs say at most 2 slices per frame.
- A deflated snapshot above about 125 KB would therefore close the socket. That is below both the 150 KB doc bar and the 64-slice ceiling of 261,568 B.
- Real snapshots (about 37 ledgers within 60 m) stay far below it, so this is unreachable in play today.
- Recommended fix for the server owner (netcode): pace slices (at most 2 per frame, per netcode 9.1), or lower the server's own slice limit to about 30.

## Changes
- `packages/protocol/src/codec/dust-messages.ts`: comment only (separates the 32 MiB checkpoint cap and states the slice ceiling). No value change, no version bump.
- `packages/protocol/src/codec/dust-messages.test.ts`: new test "snapshot caps are mutually consistent".
  - Checks the cap is 1.5 MiB.
  - Checks the worst-case arithmetic stays under the cap.
  - Checks that a snapshot with every plot Opened and 1,024 full ledgers encodes above 1 MiB.
  - Checks the slice-count ceiling arithmetic.
- `docs/architecture/world-and-dust-simulation.md` 5.4: new "Hard caps" paragraph (the caps, the 32 MiB distinction, and the backpressure mismatch).

## Evidence
- `packages/protocol`: 10 files and 122 tests pass, and tsc is clean.
- `apps/server` `src/net`: 15 files and 156 tests pass.

## Consumers
None must change for the cap. The server owner should decide the backpressure mismatch above.
