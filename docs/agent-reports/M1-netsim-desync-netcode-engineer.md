# M1 netsim desync triage (netcode-engineer)

Task: M1 netsim desync / status: done (in-review welcome) / 2026-11-16 / netcode-engineer / Opus 5.5

Verdict: (b) **netsim artifact**, not a client/server netcode bug. Client/server code unchanged.

Root cause: `tools/netsim/src/conditioner/proxy.ts` (old `pipe`) scheduled one `setTimeout(at - performance.now())` per
TCP chunk. `DirectionConditioner` returns monotone delivery times, but chunks clamped to the same `at` got different
delays, and Node computes timer expiry from the loop's cached integer-ms clock plus per-duration lists. So a later chunk
could fire first and **reorder the TCP byte stream**. Whole WebSocket frames swapped, which explains all 3 symptoms:
serverTick/ack regressions, and a delta FRAME decoded against the wrong SlotTable (decode failure). It also explains the
1006 on first connect (handshake bytes reordered). The bots' heuristic is correct: it resets on rejoin (`onJoined`).

Done: per-direction FIFO with a single drain timer (order preserved, the queue head blocks the chunks behind it, the end
is queued in order).

Next: the 96 late inputs rejected at 120 +/- 30 ms with 1 % loss stalls are expected input-steering behaviour under
loss stalls. If they matter, tune the bots/steering lead margin. Not a desync.

Files: tools/netsim/src/conditioner/proxy.ts, tools/netsim/src/conditioner/conditioner.test.ts

Evidence (Node v26.13.1 via fnm PATH prefix, current tree):
- New regression test "never reorders chunks under heavy jitter": FAILED on the old proxy (out-of-order 360..387),
  passes now. `vitest run src/conditioner` 5/5. `tsc --noEmit`, `eslint src` and `prettier --check src` are clean (tools/netsim).
- Smoke, 6 bots, 30 s, netsim typical (NOISY, shared laptop): **desync 0** (was 12). Snapshot 10.29 Hz, frame gap p95 127 ms,
  RTT p50/p95 141/316 ms, 1.31 KB/s per bot, tick p95 0.84 ms, 0 drops, 0 overruns.
  Results: tools/bots/results/M1-shift/smoke-6b-typical-fifo.{json,md}. Ports 2571/2581 free afterwards.

Blockers: none.

Commit suggestion: fix(netsim): drain each proxy direction through one FIFO timer so TCP chunks never reorder
