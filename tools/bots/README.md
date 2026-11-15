# @moon-cleanup/bots

**Path:** `tools/bots` - **Owner role:** `qa-test-engineer`

Headless bot clients that join a real server (local by default; hosted only in a Cee-approved isolated window and with
`--allow-hosted`) using `@colyseus/sdk` and the `packages/protocol` codecs. v0 targets the NET_SPIKE `LoadTestRoom`.

## Run

Start a server with the spike room, then the bots (server port = 2567 + port offset N; N = 4 gives 2571):

```
# Server: NET_SPIKE=1 build of apps/server (needs the loadTest wiring), or the local harness:
pnpm --filter @moon-cleanup/server exec tsx src/net/spike/run-spike.ts server --port 2571 --duration 700 > server.log

# Bots (default: 6 bots, 10 min, netsim "typical" = 120 ms +/- 30, 1 % loss, 20/10 Hz):
pnpm bots -- spike-16 --url http://localhost:2571 --server-log server.log
# short clean-network control:
pnpm bots -- spike-16 --url http://localhost:2571 --duration 90 --netsim none
```

**Local per-IP limits:** run the server with `ENV_NAME=local` and `CLIENT_IP_HEADER=` blank (the `apps/server/.env.example`
default). The server then uses the TCP socket address as the client IP. If a header name is set, or the bots go through
a proxy that adds `x-forwarded-for`/`x-real-ip`, every request falls into the shared `unknown` bucket (10 joins/min,
8 sockets, 2 room creates/min) and 6 bots plus a rejoin will hit 429. Blank is refused unless `ENV_NAME=local`;
production keeps `true-client-ip` (render.yaml). Per IP the server also allows 8 sockets and 3 room creates/min.

Options: `--duration s` `--bots n` (spike room caps at 6) `--netsim none|clean|good|typical|bad|outage|coldstart`
`--tick 20|30` `--snap 10|15|20|30` `--seed n` `--milestone M0` `--out results` `--server-log file`
`--reconnect-at 0.5` (scripted leave and rejoin of bot 0 at that fraction; 0 disables) `--label name` `--allow-hosted`
`--join-retry-max 60` (joins and rejoins retry with exponential backoff 250 ms to 5 s plus jitter; this is the max total wait in seconds per join, 0 = single attempt; bots dropped by the server, e.g. a restart, rejoin the same way and count as reconnects; each attempt is logged as `[join] bot N: ...`).

With `--netsim <profile>` the runner starts `tools/netsim` as a child process on server port + 10 and points the bots
at it. Pass `--server-log` (local stdout redirect or a pasted Render log export) to merge `room-stats` and `spike-loop`
lines: tick ms, CPU, bytes out by type, rejected inputs, RSS and heap growth.

Output: `tools/bots/results/<milestone>/<label>.json` and `.md` (git-ignored status of `results/` is the lead's call).

## Session reconnect cap

Each bot caps the Colyseus SDK session reconnect at 7 retries (100 ms base, 2 s ceiling, about 9 s of waiting) instead of
the SDK default of 15 retries (about 60 s). After that the bot is reported `dropped` and the scenario's join backoff
(`--join-retry-max`) rejoins it. Verified live: kill the server, restart, bots log `attempt N of 7` and rejoin.

## Post-deploy smoke (`smoke`)

One command for Cee after Neon, Render and Vercel exist (HOSTING_GUIDE section 5). From the repo root:

```
pnpm --filter @moon-cleanup/bots smoke --server-url https://<service>.onrender.com --client-origin https://<project>.vercel.app --expect-env production
```

Options: `--bots 3` (2 to 6) `--hold 60` (seconds) `--wake-max 120` (seconds to wait for a cold server) `--ready-max 60`
`--expect-env production` `--out results` `--milestone smoke`. Exit code 0 = PASS, 1 = a check failed, 2 = bad arguments.
Needs Node 26 (`pnpm exec tsx src/smoke/cli.ts ...` from `tools/bots` does the same). Hosted use is the point of this
tool: it is read-mostly (3 guest joins, pings) and needs no `--allow-hosted`, no secrets and no `NET_SPIKE`.

Checks, each PASS/FAIL with plain-English next steps (CORS, CSP, DB, cold start, wrong build):
1. `/healthz` with a "server is waking" message while a free Render instance cold-starts (about 1 min); protocol must match.
2. `/readyz` 200 with the database up (keeps polling a few seconds for Neon to wake).
3. CORS: preflight from the client origin is allowed and a foreign origin is refused (`ALLOWED_ORIGINS`).
4. CSP: fetches the Vercel page and checks `connect-src` allows https and wss to the server (SKIP when no CSP header).
5. Join: N guests `POST /v0/hello/join` (the room a `NET_SPIKE=0` production server has today: HelloRoom) then wss; every
   bot gets HELLO and all see `state.players == N` in one room.
6. Hold: pings every 2 s for `--hold` seconds; all stay connected, PONGs keep coming, reports RTT p50/p95.
7. Reconnect: bot 0 leaves and rejoins with a fresh seat; the room sees the count dip and recover, PONG works again.

Writes `results/<milestone>/smoke-deploy-<timestamp>.json` and `.md`. When the real `shift` room and join route land
(M1), update `src/smoke/smoke-deploy.ts` (`HELLO_JOIN_PATH`, join body, state check). Unit tests: `src/smoke/analysis.test.ts`.

## Bot behaviour

Seeded random walk with clean/travel phases at 20 Hz. Inputs are steered from the acked seq in each FRAME so the
server keeps a small positive lead (`src/clients/steering.ts`, netcode section 5.1): skip when ahead, two inputs per
message when thin, hard resync when the server's substitutions got ahead. Sell/buy/robots arrive with the real room
(spike messages carry input only). Desync is reported `n/a` until a client sim exists.

## Tests

```
pnpm --filter @moon-cleanup/bots test
```
