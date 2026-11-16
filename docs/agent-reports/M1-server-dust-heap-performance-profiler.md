# M1 server dust heap profile (performance-profiler)

Status: done (analysis only; no source edit). Verdict: NOT a leak, no fix needed; one optional ShiftCore micro-fix noted.

Machine: Windows 11 Pro 10.0.26200, Node 26.13.1, vitest 5.1 (vite 8 / oxc transform), shared with other running agents (numbers noisy). Method: temporary copy of the dust-budget harness (6 seats, SWEEP, 20 Hz, 60 s, 20 s warm-up), V8 sampling heap profiler via node:inspector (256 B interval, minor+major GC objects included), and a gc()-bracketed retained-heap check (`--expose-gc`). The temp test was deleted; the tree is unchanged by me.

## Numbers (heapUsed delta over 60 s of sweeping, 3 runs, unforced GC)
- Sampled runs: 4076 / 2877 / 2807 KiB, profiled run 2758 KiB (earlier test report: about 4 MB/min).
- gc()-bracketed, retained after full GC (includes the live core): walk 423 / 98 / 69 KiB, sweep 124 / 136 / 45 KiB; raw deltas in those runs 1.3-9.6 MiB (pure young-gen/new-space garbage, run to run noise from GC timing).
- Conclusion: retained growth is about 0.05-0.14 MiB/min, i.e. nothing leaks. The "4 MB/min" is garbage allocated between scavenges (about 65 KB/s for the whole room, about 11 KB/s/seat) and is reclaimed by minor GCs.

## Top allocation sites in 60 s (sampled, rounded KiB; line numbers are of the oxc-transformed code, so about 10-100 lines off source)
1. `ShiftCore.refreshDustInterest` (shift-core.ts source ~607-632): 1567 KiB. plotDot/centerDirectionInto verified allocation-free in isolation (2M calls: 720 B). The cost is boxed double locals (len, ux, uy, uz, cosIn, cosOut, dot) while the function is below TurboFan, about 215 B per seat-tick.
2. `subarray` / Uint8Array views: about 1.1 MiB. Mostly the harness itself (`inputBody` makes a view per seat per tick, 7,200 per min) plus `receiveInput` shift-core.ts:~348 and `newInput` input-sequencer.ts:25 (about 50 KiB).
3. Sim: `emit` moon-room-sim.ts:~1964 (222 KiB), `acceptStroke` :~1008 (196 KiB), `plotAt`/`fullPath` plot-grid.ts:173/195 (170 KiB), stroke event objects.
4. Ledger streaming (shift-dust.ts): `nodeDeflateRaw` deflateRawSync creates a Zlib stream per ledger (ZlibBase, Zlib, Duplex, processChunkSync, validators, events: about 330 KiB); `ledgerInput` (shift-dust.ts:171-184: new contributions array, 1 KiB `texels` Uint8Array and the header object per streamed ledger) about 60 KiB; `writeLedgerRaw` (protocol dust-messages.ts:275) 38 KiB.

## Proposed fixes (none applied)
- shift-dust.ts `ledgerInput`: hoist one reusable 1,047 B `texels` buffer and one contributions array (length reset to 0) as fields. Safe because the input is consumed synchronously by `encodeDustLedger`. But `ledgerInput` is also used by `buildSnapshotRaw`, which collects many inputs before encoding, so it needs a separate `ledgerBody`-only path (`ledgerInputInto`). Saves about 60 KiB/min, under 2 percent of the total; not worth a test-covered change now. I did not make it.
- shift-core.ts `refreshDustInterest` (not mine to edit): throttle to every 4th tick per seat (interest radius 60+ m moves at most about 1 m per 4 ticks) or keep ux/uy/uz in an instance scratch object. Would remove the single largest site (1.5 MiB/min). Owner: netcode/server owner.
- Deflate: a per-ledger `deflateRawSync` stream is inherent to node:zlib; only a persistent `zlib.createDeflateRaw` would avoid it, at a complexity cost. Not recommended.

## Verdict vs performance-budgets.md
- Section 6 server budgets: no heap-growth figure exists for a room; relevant limits are RSS <= 300 MB, V8 cap 384 MB, tick p95 <= 3.5 ms, GC stall <= 50 ms. 65 KB/s of short-lived garbage is a few scavenges per minute at most and is far from any of these; retained growth about 0.1 MiB/min is flat. PASS (informational; performance-reviewer decides).
- The "no per-frame allocation" rule (section 5/7) applies to the client; the server tick is allowed small garbage. Dust path `noteDirty` stays allocation-free.
- Recommend closing T04 Next item 4 as "garbage, not a leak"; the dust-budget test's `heapDeltaKiB` is not a reliable signal (unforced GC) and should not be asserted on without `gc()` brackets.

Tests run: none needed (no edit). Files: this report only.
