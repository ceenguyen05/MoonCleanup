# M1 dust wanted fix (B1) - netcode-engineer

Status: B1 fixed. N5 not fixed (server-side only, out of scope).

## Change
- `apps/client/src/net/remote-dust.ts` `applyDeltas`: a Polished delta now calls `removeWanted(p)` (guarded by
  `wanted.length > 0`, so the hot path pays one length check). A requested plot that became Polished no longer stays in
  `wanted`, so it is not re-requested every 2 s and the chunk repair is not blocked.
- `apps/client/src/net/remote-dust.test.ts`: new test "a wanted plot that becomes Polished is dropped from the wants".
  A detail check puts the plot in `wanted` (`wantedCount` 1); a dust.plots Polished delta then makes `wantedCount` 0
  and `nextRequest` return 0.

## N5
`snapCount` lives in `apps/server/src/net/shift/shift-core.ts` (`requestDustSnapshot`). I was told not to touch server
files, so the one-line `seat.snapCount = 0` fix is left for the server owner.

## Evidence (Node v26.13.1)
- `apps/client` `vitest run src/net`: 7 files, 61 passed, 1 skipped (pre-existing skip).
- `tsc --noEmit` (apps/client): clean. eslint and prettier on both touched files: clean.
