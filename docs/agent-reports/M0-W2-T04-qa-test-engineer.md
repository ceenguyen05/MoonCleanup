# M0-W2-T04 - Headless bots v0, netsim v0, `spike-16` (6 bots, local)

Status: **in-review**. 2026-11-12, qa-test-engineer. Port offset 4 (server 2571, netsim proxy 2581).

**Done**
- `tools/netsim`: seeded local TCP proxy (`src/conditioner/{rng,profiles,conditioner,proxy}.ts`, `src/cli.ts`). Profiles clean, good (40 ms), typical (120 +/- 30 ms RTT, 1 % loss), bad (250 +/- 50, 5 %), outage (5 s hold at 30 s), coldstart (first client chunk held 8 s). Loss is a TCP stall (RTO max(200 ms, 2 RTT)) with head-of-line ordering. 4 tests (determinism, ordering, mean delay and loss rate, outage window, proxy relay).
- `tools/bots`: SDK bot (`src/clients/bot.ts`), input-clock steering (`steering.ts`), `spike-16` scenario (`scenarios/spike16.ts`), report builder and server-log parser (`reports/report.ts`), CLI (`src/cli.ts`). `pnpm bots -- spike-16 --url http://localhost:2571` works (script is `tsx src/cli.ts`). Refuses non-local URLs without `--allow-hosted`. 7 tests incl. a closed-loop model of the server input path (steered recovers after a stall, naive does not).
- Fix for the T03 harness finding: the bot steers its seq from the acked seq in every FRAME (target gap = ceil(RTT/tick) + 3; skip when 4+ over, send two when thin, hard resync when the server's substitutions got ahead). Server buffer depth stays 2-3. Inputs are now accepted after stalls.
- Checks: tsc, eslint, prettier clean for both tools; vitest 11 tests pass.
- README run commands updated in both folders.

**Corrected live numbers** (6 bots, 90 s each, loopback, Node 26.13.1, run via `apps/server/src/net/spike/run-spike.ts server`; server and bots in separate processes; raw JSON/MD in `tools/bots/results/M0-W2-T04/run-<profile>-<tick>-<snap>.*`). Server bytes out per client per s from room-stats windows:

| | clean 20/10 | clean 30/20 | typical 20/10 | typical 30/20 |
| --- | --- | --- | --- | --- |
| FRAME B/s | 2,266 | 4,278 | 2,273 | 4,357 |
| DUST B/s | 599 | 632 | 599 | 632 |
| Schema patch B/s (T03 was ~0 after first window) | **125** | **248** | 125 | 246 |
| PONG B/s | 6 | 6 | 6 | 6 |
| **Total** | **~2.99 KB/s** | **~5.16 KB/s** | ~3.00 KB/s | ~5.24 KB/s |
| Snapshot rate achieved | 10.03 | 20.03 | 10.09 | 20.16 |
| Server tick p50 / p95 / max (ms) | 0.18 / 0.62 / 3.0 | 0.23 / 0.43 / 1.7 | 0.20 / 0.62 / 1.6 | 0.25 / 0.64 / 2.6 |
| CPU % of 0.1 quota median / max (noisy) | 16 / 28 | 24 / 34 | 22 / 41 | 25 / 66 |
| Late-dropped / substituted inputs | 12 / 18 | 16 / 16 | 316 / 285 | 1,071 / 1,035 |
| Frame inter-arrival p95 / max (ms) | 115 / 127 | 79 / 106 | 126 / 382 | 92 / 339 |
| RTT p50 / p95 / max (ms) | 31 / 32 / 34 | 31 / 32 / 33 | 141 / 236 / 374 | 142 / 315 / 590 |
| Unexpected drops | 0 | 0 | 0 | 0 |

Versus T03: the totals rise by about 0.25 KB/s (20/10: 2.75 to ~3.0) and about 0.5 KB/s (30/20: 4.65 to ~5.2). Strokes and patches now stay in the stream. Hosted bandwidth: 20/10 about 3.0 KB/s x 6 x 3600 = ~65 MB/h for a full room; 30/20 is about 112 MB/h (the lead should re-check the budget rows). Memory: server RSS fell over the runs (first window includes startup), heap +/- 5 MB, no growth signal in 90 s; this is not a leak test.
Late drops under typical 30/20 are about 6 % of inputs (loss stalls of 240 ms exceed the 3-tick lead; the steering recovers by resync). That is expected jitter behaviour, not the old permanent failure.

**NOT RUN**
- 10-minute run: all live runs were 90 s (and a 60 s smoke). Command for the full run: start the server with `--duration 700 > server.log`, then `pnpm bots -- spike-16 --url http://localhost:2571 --server-log server.log` (defaults: 600 s, typical, 20/10, reconnect-at 0.5).
- The scripted reconnect was only exercised in the 60 s smoke (7 joins, 0 unexpected drops; late 227 of 7,386 inputs including the rejoin); the four reported runs used `--reconnect-at 0`.
- bad / outage / coldstart profiles: unit-tested only, not run live. Netsim stats line is not captured on Windows (child is terminated, not signalled), so the report's netsim field is null here.
- Toxiproxy configs, 16 bots (the spike room caps at 6), sell/buy/robot actions and desync (the spike protocol carries input only), hosted run (not authorized), 0.1-CPU container.
- Wiring request (not my path): `apps/server/src/app/server.ts` still does not pass `loadTest: { enabled: env.netSpike, stats }` to `createGameServer`; I used the T03 `run-spike.ts server` harness, which does the same. Real-server start needs ENV_NAME=local, PERSISTENCE_DRIVER=memory, JWT_SECRET and REFRESH_TOKEN_PEPPER (32+ chars, throwaway), ALLOWED_ORIGINS=http://localhost:5177, PORT=2571, NET_SPIKE=1 once wired.

**Notes**
- `tools/bots/results/` now holds the M0-smoke and M0-W2-T04 outputs; the lead decides whether to git-ignore it.
- The bots package.json still lists `@colyseus/loadtest` (unused). No installs were made.
- All server, bot and netsim processes are stopped (ports 2571/2581 have no listeners).

Files: `tools/netsim/{README.md,package.json,src/**}`, `tools/bots/{README.md,package.json,src/**,results/**}`.
