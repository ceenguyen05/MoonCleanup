# M1 dust wanted fix re-review (B1) - code-reviewer

**Verdict: APPROVED** (B1 closed; no new findings).

## Checked
- **No leak.** `applyDeltas` (`remote-dust.ts:176-180`) calls `removeWanted(p)` for every Polished delta, also when the
  client ledger was already Polished. Server side, `shift-core.ts:699` says a Polished plot gets no ledger answer and
  `dust.plots` carries its state, so the Polished delta is the signal that ends the want. The backlog is deduplicated,
  so a late delta only delays the removal. `installSnapshot` still resets `wanted`.
- **No regression for non-Polished deltas.** They skip the new line (the `continue` follows it) and take the unchanged
  path (`slotOf` guard, then L0 overlay write). The new cost on a Polished delta is one `length > 0` check, so
  `applyFrame` stays allocation-free in the steady state.
- **2 s re-request.** `nextRequest` no longer returns the Polished plot, so it falls through to `wantedChunks` and chunk
  repair is served again. A ledger answer still removes the plot via `applyBytes:202` (unchanged).
- **Chunk DUST_REQUEST repair.** Only `wanted` is touched. `wantedChunks`, `pendingChunk` and `benign` are unchanged,
  and the detail-answer handler in `check` still closes the chunk want.
- **Test.** `remote-dust.test.ts:370-401` flags a plot via a detail check (`wantedCount` 1), applies a Polished
  `dust.plots` delta, and expects `wantedCount` 0 and `nextRequest` 0. Without the fix, `wanted` keeps the plot, so
  `wantedCount` stays 1 and `nextRequest` encodes a plots request. The test fails at the `wantedCount` 0 assertion.
  `wantedChunks` is empty in this test, so the count really measures `wanted`. Checked by reasoning only; no source
  edit.
- **Run.** Node v26.13.1, `apps/client` `vitest run src/net`: 7 files passed, 61 passed, 1 skipped (pre-existing).

## Non-blocking
- None new. N5 (server `snapCount`) remains open for the server owner, as the author stated.
