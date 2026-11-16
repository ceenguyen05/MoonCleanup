# M1 bots: ShiftRoom scenario (qa-test-engineer)

Status: DONE for wiring + live smoke (1 bot, 6 bots + netsim typical). Open: 12 heuristic desyncs in the 6-bot typical run (see below). All numbers NOISY (laptop i7-8650U shared with other agents; event-loop p99 up to 40 ms; harness start takes ~30 s).

## Done (tools/bots only; apps/server and packages/db read-only)
- `tools/bots/harness/shift-server.mts`: local ShiftRoom server (createGameServer, transport ws, stub tokens `tok-<playerId>`, no DB), loaded from apps/server via createRequire like tools/perf. Emits JSON lines: `room-stats` (StatsReporter), `spike-loop` (room tickStats p50/p95/max, overruns, counters, heap/rss). Graceful stop: write "stop" to stdin. Excluded from tsconfig.
- `src/scenarios/shift-room/shift-bot.ts`: `ShiftBotCore` (seeded walk/clean script, real `encodeInput` bodies, steering reused, FRAME decoded with the real `FrameReader`, desync checks) and `ShiftBot` (REST `POST /v1/contracts/:id/join` with Bearer, SDK `consumeSeatReservation`, byte counting by type).
- `src/scenarios/shift-room/shift-room.ts`: spawns the harness, optional netsim child (profiles none/clean/good/typical/bad/outage/coldstart, port+10), runs N bots, writes JSON and Markdown (tick ms, per-client bytes/s by type, snapshot Hz, RTT, rejected inputs, desync, heap).
- CLI: `pnpm bots -- shift-room --port 2571 --bots 1|6 --duration 30 --netsim none|clean|typical|bad --milestone M1-shift --label name`.
- Small edits: `spike16.ts` exports startNetsim/stopNetsim; `report.ts` desync.count may be a number; `cli.ts` adds the scenario.
- Desync (heuristic, documented in the report): FRAME decode failure + serverTick regression + ack regression + own-position jump over 6 m between frames. It does NOT replay client prediction against the server sim.

## Tests
`pnpm exec vitest run src/scenarios/shift-room` in tools/bots: 6/6 pass (INPUT bodies decode with the server codec and seq increases, seed reproducibility, bad-frame desync count, report merge of harness lines, netsim profile names). `tsc -p` and `eslint src` clean. Node v26.13.1 confirmed via fnm PATH prefix. pnpm verify not run (as instructed).

## Root cause of the 524 (fixed, harness only)
The harness loaded @colyseus/core, shared, game-data and world through require() while the ws transport and apps/server use the ESM builds. That gave two copies (two matchMakers: the transport could not find the room, so 524 "seat reservation expired"; two IcoPlotGrid classes: "world.grid must be an IcoPlotGrid"). Fix: harness imports everything via dynamic import() of the same ESM files. Also added tickets/seatHoldS(30)/MemoryShiftDustStore like shift-room.test.ts. apps/server shift-room.test.ts passes (8/8) in the current tree, so the backend was not at fault.
Other findings: (1) `pnpm bots -- shift-room ...` breaks option parsing (the "--" makes everything positional, so defaults 6 bots/600 s ran). Use `pnpm exec tsx src/cli.ts shift-room --port 2571 --bots 6 --duration 30 --netsim typical` from tools/bots. (2) The harness stops when stdin ends; run it by hand with a held-open stdin (sleep 100 | node ...). (3) Server needs about 30 s to start on this machine.

## Live smoke numbers (30 s each, NOISY)
Results: tools/bots/results/M1-shift/smoke-1b-clean.{json,md}, smoke-6b-typical.{json,md}.
| Metric | 1 bot, netsim none | 6 bots, netsim typical (120 ms +/- 30, 1 % loss) |
| --- | --- | --- |
| Snapshot rate per bot | 10.01 Hz | 10.35 Hz |
| Frame gap p50 / p95 / max | 98 / 114 / 176 ms | 99 / 133 / 427 ms |
| RTT p50 / p95 | 1 / 4 ms | 139 / 361 ms |
| Room tick p50 / p95 / max (tickStats ring) | 0.23 / 0.91 / 28.4 ms (28 ms = noise spike) | 0.34 / 2.26 / 33.3 ms |
| StatsReporter tick p50 / p95 / max | 0.2 / 1.16 / 4.1 ms | 0.32 / 2.54 / 10.8 ms |
| Bytes in per bot (client side) | 0.42 KB/s (FRAME 0.39) | 1.31 KB/s (FRAME 1.24, DUST 0.04, state 0.03) |
| Late inputs / resyncs / skipped sends | 0 / 0 / 0 | 62 / 5 / 47 |
| Server buffer depth p50 / p95 | 4 / 4 | 3 / 5 |
| Desync (heuristic) | 0 | 12 = decode 1 + tick regress 6 + ack regress 5 + jumps 0 |
| Overruns, drops | 0, 0 | 0, 0 (one bot had a 1006 on first connect and rejoined on retry) |
| Server RSS / heap growth (30 s) | -1 / +10 MB | -0.5 / +17 MB |
Compare profiler flat-world lower bound: 6 players about 0.8 KB/s FRAME per client; measured 1.24 KB/s over a netsim link.
Not available: server-side bytes-out by type (StatsReporter reported none for ShiftRoom: it has no recordBytesOut calls in this tree).

## Open
- The 12 desyncs: decode 1 + tick/ack regressions 11 happen only with 6 bots under typical netsim. Suspects: counted at join/rejoin boundaries or the first frames after a seat is created (a delta frame before the keyframe), or the client resync jump. Not diagnosed; clean 1-bot run has 0. Next step: log tick/ack/flags of each flagged frame in ShiftBotCore, rerun 6 bots with netsim none, then typical.
- Desync is a heuristic, not prediction-vs-server comparison.
- Add a valid-FRAME unit test (FrameWriter fixture).
- Not done: 16-bot/10-minute load run; reconnect scripting for the ShiftRoom scenario.

## Next (old)
1. Run the harness alone (`node --import tsx harness/shift-server.mts --port 2571 --duration 120` from tools/bots), check `netstat` bind address, and POST the join with curl using `localhost` and 127.0.0.1; time the first room create.
2. If room creation exceeds the reservation window, warm the room first or raise the seat reservation time in the harness; if onAuth/ticket redemption fails, compare with `apps/server/src/net/shift/shift-room.test.ts` setup (it passes its own `tickets`, `seatHoldS`, `dustStore`; the harness omits them).
3. Once join works: run 1 and 6 bots, 30 s, netsim none and typical; label numbers noisy (other agents running). Reference: profiler flat-world lower bound 6 players about 0.8 KB/s FRAME per client, tick p95 about 0.3 ms.
4. Add a valid-FRAME unit test (needs FrameWriter fixture) so position-jump and regression counters are covered.
