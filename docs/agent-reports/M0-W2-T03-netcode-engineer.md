# M0-W2-T03 — Netcode spike: LoadTestRoom (6 players, local only)

Status: **in-review**. One harness finding is still open (see Blockers 1). 2026-11-12. netcode-engineer, Opus 5.5.

**Done**
- `LoadTestRoom`:
  - Thin Colyseus adapter over a transport-free `SpikeEngine`.
  - Capped at 6 seats (`MAX_PLAYERS_PER_ROOM`).
  - Registered only when `createGameServer({ loadTest: { enabled, stats } })` is passed `enabled: true`. NET_SPIKE defaults to 0.
  - REST join at `POST /v0/spike/join`. Options are zod-validated and bounded: `tickHz` 20|30, `snapshotHz` 10|15|20|30 (≤ tickHz), `bodies` ≤ 64, `robots` ≤ 64. Rooms are filtered by these options.
- Fixed-step loop:
  - Drift-compensated, with at most 3 catch-up steps, then the clock slips and an overrun is counted.
  - Frames are scheduled by Bresenham, so non-divisor rates work (30/20 sends every 1 or 2 ticks).
  - Each tick runs in `batchMessages`, so FRAME, DUST and the Schema patch go out as one write per client.
- Synthetic work per tick, following netcode §15:
  - INPUT-shaped decode and validation.
  - 32 kinematic bodies with a 6-sample height stub.
  - 32 robots.
  - Staggered horizon interest.
  - A per-client bit-packed frame (Self 20 B, slot changes, FULL/DELTA records per §4.5, strokes, events) with a 1,000 B cap and spill.
  - Schema `SpikeState` with 6 avatar records, encoded once (no StateView).
  - SPIKE_DUST every 4th tick: L0 plots, intents, checks and ledger bytes.
- Inputs:
  - Token bucket of 1.5×/2× tickHz.
  - u16 sequence window, late-drop, substitution, and a double-step when the backlog is above 4.
  - More than 50 violations in 10 s, or inbound traffic above 8 KB/s sustained for 5 s, closes with 4104.
  - Malformed messages are dropped and counted.
- Metrics:
  - `RoomStats`: tick timings and wire bytes per type, counted at `client.raw` (Colyseus framing plus the WebSocket header).
  - A `spike-loop` line every 10 s: tick lateness, overruns, socket writes, GC, RSS.
- `packages/protocol`:
  - `BitWriter`/`BitReader`.
  - Spike codecs with golden, round-trip and fuzz tests.
  - DataView removed from the hot codecs, because each DataView was an allocation per call.

**Evidence** (Windows laptop, Node 26.13.1, loopback, port 2570; server and clients in separate processes; other agents' workloads may have run)

| | 20/10 | 30/20 |
| --- | --- | --- |
| Tick p50 / p95 / max (steady 10 s windows) | 0.23–0.28 / 0.56–2.16 / 4–126 ms | 0.25 / 0.40–0.65 / ≤ 1.65 ms |
| Wire B/s/client: FRAME + DUST (+ PONG) | ≈ 2,140 + 599 = **≈ 2.75 KB/s** | ≈ 4,010 + 632 = **≈ 4.65 KB/s** |
| Socket writes/client/s | 10.4 | 23 |
| CPU % of 0.1 quota (`process.cpuUsage`; noisy) | 5–41 % | 19–58 % |
| Event-loop p99 / tick lateness p95 / overruns | 130–183 ms / 68–88 ms / 1 (host stall) | 34–43 ms / 15 ms / 0 |
| `/healthz` under load p50 / p95 / max | 8 / 141 / 188 ms | 1.4 / 2.6 / 7.5 ms |
| Client frame inter-arrival p50 / p95 / max | 99 / 188 / 530 ms | 49 / 78 / 105 ms |
| GC max (minor / major), RSS | 0.3 / – ms, 96 MB | 2.5 / 13.5 ms, 108–145 MB |

Engine-only bench (`run-spike.ts bench`, 6 busy seats, 20k ticks), µs/tick and body B/s/client:

| Rates | µs/tick | Body B/s/client |
| --- | --- | --- |
| 20/10 | 85–100 | 2,704 |
| 30/15 | 82 | 3,673 |
| 30/20 | 94–112 | 4,637 |
| 20/20 | 117 | 4,581 |
| 30/30 | 142 | 6,549 |

**Allocation (benchmark note):** the inspector sampling heap profiler, including collected objects, measured about 11–13 B/tick, mostly frame-view cache warm-up. Before the fixes it was about 4–9 KB/tick, caused by `Math.hypot`, doubles boxed across calls, and a DataView per codec call.

**Tests and checks**
- `vitest` `apps/server/src/net`: 5 files, 45 tests. This includes the 16-client churn, the 7th join going to a new room, inputs and acks, malformed input, per-type bytes, coalesced writes, and NET_SPIKE off returning 404.
- `packages/protocol`: 3 files, 22 tests.
- `tsc` is clean for the server and protocol.
- eslint and prettier are clean on the touched paths.

**NOT RUN**
- No 0.1-CPU container run and no hosted run (owner said local only); no hosted CPU claims.
- No netsim or 10-minute soak. That is T04.
- 30/15, 30/30 and 20/20 were benched only, not live-run.

**Blockers / requests**
1. **Harness finding (open).** The spike clients send inputs at tickHz with no clock steering. After the first stall, the server's substitutions put `lastConsumedSeq` ahead of the client for good. From then on, every real input is dropped as late (7,170 accepted against 7,146 late), the avatars go neutral, and stroke and Schema-patch bytes vanish from the live runs; patches appear only in the first window.
   - The integration test, which sends inputs reliably, does show patches continuing.
   - The live byte rows are therefore about 0.25 KB/s low for strokes and up to 0.2 KB/s low for Schema.
   - Fix: the client leads the server tick by 2–3 (§5.1 steering), in T04 bots and the M1 client.
2. **ops `RoomStats`.** A near-zero final window printed `cpuPercentOfQuota: 5000`, and CPU % is noisy on Windows (backend owner).
3. **Integrator.** In `app/server.ts`, pass `loadTest: { enabled: env.netSpike, stats }` to `createGameServer`.
4. **Rates.** For local feel, recommend 30/30 locally (bench only) and 30/15 hosted (evenly spaced, ≈ 3.7 KB/s). 30/20 jitters 33/67 ms, and `env.ts` rejects it anyway (SNAPSHOT_HZ must divide SIM_TICK_HZ).

**Next:** T04 bots with input lead and steering, then re-measure strokes and patches.

Files: `apps/server/src/net/spike/*` (options, synthetic-world, frame-encoder, spike-engine, load-test-room, spike-join-route, run-spike, index, 2 tests); `apps/server/src/net/{game-server.ts,game-server.test.ts,index.ts}`; `packages/protocol/src/{index.ts,codec/bits*.ts,codec/spike*.ts}`. Logs are in the session scratchpad (not committed).

Commit suggestion: `feat(net): NET_SPIKE LoadTestRoom with synthetic 6-player load, spike codecs and local metrics`
