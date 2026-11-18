# M1-W3-T07 Solo tool telemetry (gameplay-systems-engineer)

Status: implemented, focused tests pass. Partial until visually verified (GPU/browser not used, owned by another agent).

## Done
- `apps/client/src/sim-host/messages.ts`: FRAME trailer extended 8 -> 40 bytes with a private tool block (flags, tool code, phase u16, period ms, input seq, head x/y/z f64). FRAME protocol and shared RoomHost unchanged.
- `apps/client/src/sim-host/tool-telemetry.ts` (new): `writeToolTelemetry` (worker) and `readToolTelemetry` into reused `ToolAnimSnapshot`. Phase = ((seq - seqAtToolDown) & 0xffff) * stepMs % periodMs / periodMs (same formula as sim tool.ts); detailing phase from disc cooldown. No allocation (scratch typed arrays).
- `worker-core.ts` `sendFrame` writes it with the sim's actual stepped `input.seq`; `local-room-host.ts` decodes in `onFrameBuffer`, exposed as `LocalRoomHostImpl.toolAnim`.
- `app/solo-avatar.ts`: feed reads optional `toolAnim` structurally (no sim-host import). Sets toolActive, toolPhase (advanced by render dt within one tick for smoothness), toolPeriodS, toolInContact, headTarget (via render mapper) and headValid. No data, stale tool code, or inactive means no work animation (nothing fabricated).
- No sim edits: `MoonRoomSim.toolState(slot)` and `config` already public. Nothing in `packages/sim` touched, so GOLDEN_REPLAY (1076468633 / 4164540033) unchanged by construction (not re-run).

## Tests
- New `sim-host/tool-telemetry.test.ts` (3), new case in `app/solo-avatar.test.ts`. `vitest run src/sim-host src/app/solo-avatar.test.ts`: 4 files, 44 tests pass. `tsc --noEmit` on apps/client clean.

## Not run / limits
- Full `pnpm verify`, sim goldens, browser/visual check of the scrub (animation consumer of toolContactFrac uses default 0.7 which matches sim 70% contact).
- Feed requires `setTool` from shift state to match telemetry tool code; first frames before shift state show held tool only.
- Frame buffer grows 32 bytes (pool of 3, negligible).
