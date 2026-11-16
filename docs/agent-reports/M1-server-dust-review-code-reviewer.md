# M1 server dust review (code-reviewer)

Scope: `apps/server/src/net/shift/shift-dust.ts`, `shift-core.ts` (dust paths), client `apps/client/src/net/remote-dust.ts`,
tests `shift-dust.test.ts`, `shift-dust-interest.test.ts`, `src/world/dust-budget.test.ts`. Three edits: (a) cached
moon-wide snapshot part, (b) 5 s DUST_CHECK chunk summary + client repair, (c) exact-skip `scanInterest` with the
`dustScan.invalidate()` rule. Read-only review; nothing outside this file was edited.

**Verdict: CHANGES REQUESTED** (one blocking client defect, B1).

## Evidence (Node v26.13.1, PATH prefix)

- `apps/server`: `vitest run src/net src/world`: 188 passed, **1 failed**: `dust-budget.test.ts:180` "6 cleaning
  seats + a resync storm" measured 9.46 ms/s against the 8 ms/s limit while 20 workers ran in parallel. Run alone it
  passes (2/2). See N1.
- `apps/client`: `vitest run src/net`: 7 files, 60 passed, 1 skipped.

## Blocking

### B1. A wanted plot that gets Polished stays wanted forever and blocks all chunk repair (remote-dust.ts)

- `remote-dust.ts:261`: a detail answer adds a plot to `wanted`.
- `remote-dust.ts:200/274`: the only removal is `removeWanted` when a DUST_LEDGER for that plot arrives, or the
  `wanted` reset in `installSnapshot` (`:144`).
- Server side, `shift-core.ts:696-699`: a requested plot that was Polished meanwhile gives `ledgerBody(plot) === null`.
  The server sets `sent = 0` and sends nothing.
- `applyDeltas` (`remote-dust.ts:176-178`) installs the Polished state but never calls `removeWanted`.
- Result: from then on, `nextRequest` (`:224-226`) returns that plot every 2 s until the next snapshot (which comes only
  on resync, reconnect or unhide). Because wanted plots go before wanted chunks, `wantedChunks` is never served again,
  so chunk repair is dead for the rest of the session.
- How likely: the plots a detail check flags are the ones being cleaned right now (that is what makes a hash drift).
  Being Polished within the 2 s request window plus one frame is realistic.
- No test covers it (the tests at `remote-dust.test.ts:237-349` all end with a ledger arriving).
- Fix (author's choice):
  - In `applyDeltas`, when a delta is Polished, call `removeWanted(p)`.
  - And/or drop a wanted plot after N unanswered requests.
  - Add a test: detail mismatch, then a Polished delta for that plot, then `wantedCount === 0` and the chunk request is
    served.

## Non-blocking

### N1. CPU budget test is flaky under parallel load
`dust-budget.test.ts:180` failed in the full suite (9.46 ms/s vs 8) and passed in isolation. It is a wall-clock budget
measured on the UHD 620 laptop while 20 vitest workers compete for CPU. Suggestions:
- run it in its own process, or with a retry or best-of-N, or
- gate it behind a perf flag.

If it stays as it is, it can fail the one final `pnpm verify` for reasons unrelated to the code.

### N2. The detail answer is not limited to what the client holds, so a mismatch pulls out-of-interest ledgers
- The summary hashes only `sent[plot] === 1` ledgers (`shift-dust.ts:418`).
- `checkDetailBody` (`shift-dust.ts:444-460`) lists every Opened ledger of the chunk, up to 256.
- On the client, `check` (`remote-dust.ts:258`) treats every listed plot it does not hold as a mismatch and fetches it.
- So whenever a chunk summary differs, for example because of hysteresis-forgotten ledgers that the client still holds
  (the case the `benign` memo was written for), the client fetches every ledger in that chunk it never held, 8 per 2 s.
  These fetches use the 8 KB/s stream credit that in-radius ledgers need.
- The next interest pass forgets those ledgers again (`sent = 0`). The pair then drifts with the player's own strokes in
  that chunk, and the cycle repeats roughly every 5 s while two players clean in one chunk more than a radius apart.
- This is bounded, not a tight loop, but it works against the interest radius.
- Suggestion: pass `sent` to `checkDetailBody` and list only `sent[plot] === 1` plots, matching the summary. Or keep a
  mark 3 ("client holds a possibly stale copy") that counts in the summary and re-queues when the plot enters the radius
  again.

### N3. The moon-wide cache key ignores ledger resets (latent)
- `ShiftDust.generation` only moves on `noteDirty` or when the dirty list is non-empty (`shift-dust.ts:146,156`).
- `WorldDustLedger.reset()` and `resetPlot()` (`packages/world/src/dust/ledger.ts:917,932`) change L0 without marking
  dirty. `reset()` bumps only `l0Version`.
- Today no server code calls them after the cache is built: restore runs in `onCreate` before any seat (checked with
  rg). So the cache is not stale now.
- Hardening: key the cache on `ledger.l0Version` as well. It bumps in `markDirty` (`ledger.ts:641`) and in `reset`. Then
  a future mid-room reset or restore cannot serve stale plot states.

### N4. Held seats keep running the interest pass and fill their stream queue
- `tick` calls `refreshDustInterest` for every active seat (`shift-core.ts:545-547`). Only `hidden`, a pending snapshot
  and in-flight snapshot slices skip it (`:635`). A held seat still enqueues hits.
- `sendDust` never drains a held seat (`:655`). Once `STREAM_QUEUE_MAX` is reached, every `enqueue` calls
  `invalidate()` (`:624`), so the seat does a full, non-skipped scan every 0.5 s until it resumes. On resume,
  `requestDustSnapshot` throws the queue away.
- It is harmless but wasted work. Suggestion: add `seat.held` to the early return at `:635`.

### N5. Stale `snapCount` after a dropped paced snapshot
- `requestDustSnapshot` (`:603-611`) and the hidden/held drop (`:657`) clear `snapSlices` but not `snapCount`.
- If the next snapshot leaves in one tick (not paced, so `recordSnapshotVersions` is skipped), `forgetStaleSnapshotLedgers`
  runs over the old snapshot's plots and versions. It zeroes `sent` for those that changed, which causes a redundant
  DUST_LEDGER re-send.
- The data is still correct; only bytes are wasted. Suggestion: set `seat.snapCount = 0` in `requestDustSnapshot`.

## Checked, no finding

- **Every writer of `dustSent`, radius and ledger allocations** (rg `dustSent|sentOf|dustScan|configureDustScan`):
  - snapshot build `fill(0)`: `:673-674` invalidates.
  - `requestDustSnapshot`: `:609-610` invalidates.
  - stream drain `sent = 1/0`: `:697-698` invalidates.
  - `forgetStaleSnapshotLedgers`: `:795-796` invalidates.
  - full queue in `enqueue`: `:624` invalidates.
  - radius changes go through `setRadius`, which resets `valid` (`shift-dust.ts:83-87`).
  - `enqueue` writing 2 (from scan hits or a plots request) removes a plot from the watched set, so it is conservative.
  - A new ledger bumps `ledgersAllocated`, so a skip cannot hide it. A slot reused for a different plot also bumps it.
    Freeing a ledger only removes a constraint.
- **Exactness of the angle math**:
  - |Δdot| = |d·Δu| ≤ |Δu| for unit d.
  - Mark 0 outside: gap = cosIn − dot; mark 1: gap = dot − cosOut.
  - The skip needs |Δu|² < (gap − 1e-12)². gap = 0 gives slack 0, so it never skips.
  - The hysteresis edge is strict in both directions.
  - Teleports, respawns and rejoins are covered because the skip compares against the last scanned direction.
    `addSeat` and `resumeSeat` also reset it through `configureDustScan` and `requestDustSnapshot`.
  - Hidden seats invalidate and return. Unhiding goes through `requestKeyframe`, then `requestDustSnapshot`.
- **Snapshot cache**: rebuilt whenever the generation changes. `opened` is reused only when its length matches and is
  then fully rewritten. The persistence restore (`shift-persistence.ts:302-335`) clears the dirty list, but runs before
  the first seat and the first lazy build. The test at `shift-dust.test.ts` asserts that the hit and build counters move.
- **Chunk-check fairness**:
  - Snapshots: at most one build per frame tick. A seat is eligible again only after `SNAPSHOT_MIN_INTERVAL_S`, so a
    low slot cannot starve the others.
  - Checks: a seat that just built is re-armed 5 s later, so seats that are due together are served on consecutive
    frame ticks.
- **Hot path**:
  - `scanInterest` allocates nothing in steady state: typed scratch, and the direction cache grows only with the pool.
  - The skip path is arithmetic only.
  - `noteDirty` allocates nothing.
  - `chunkCheckBody` and `checkDetailBody` allocate small arrays at event time (every 5 s or per request), which is
    acceptable.
  - This is the room path. The solo path does not run ShiftCore dust sync.
- **Boundaries**: `node:zlib` is used only in `apps/server`. The client imports no server or db code.
