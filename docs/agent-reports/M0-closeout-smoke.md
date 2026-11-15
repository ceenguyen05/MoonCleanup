# M0 close-out: post-deploy smoke script

Role: qa-test-engineer (bots). Date 2026-11-14. Node v26.13.1 (fnm prefix).

## Result: PASS (local), not yet run against Render/Vercel

New command (HOSTING_GUIDE section 5 automation):

```
pnpm --filter @moon-cleanup/bots smoke --server-url https://<service>.onrender.com --client-origin https://<project>.vercel.app --expect-env production
```

Files (all under `tools/bots`): `src/smoke/analysis.ts` (CSP/CORS inspection, next-step text, report rendering),
`src/smoke/smoke-deploy.ts` (the checks), `src/smoke/cli.ts` (args, exit codes 0/1/2/3), `src/smoke/analysis.test.ts`
(6 tests), `package.json` (`smoke` script), `README.md` (section rewritten). Output goes to
`tools/bots/results/smoke/smoke-deploy-<stamp>.{json,md}`.

## Production join path chosen

`NET_SPIKE=0` means no LoadTestRoom. The only room a production server registers is **HelloRoom**
(`apps/server/src/net/game-server.ts`, `helloRoom` defaults true), joined by `POST /v0/hello/join` (REST seat
reservation, then `consumeSeatReservation` over wss). Bots send the real Origin header, so the WebSocket upgrade
exercises `ALLOWED_ORIGINS`. HelloRoom has no movement/clean/sell, so the "walk and clean" part is replaced by PING/PONG
plus Schema state (`state.players`) for the hold. When the M1 `shift` room replaces the route, edit `HELLO_JOIN_PATH`
and the join body in `smoke-deploy.ts`.

## Checks

healthz (waking message, protocol match, optional env match), readyz (polls for Neon wake), CORS preflight (allowed
origin accepted, foreign refused), CSP (fetches the Vercel page, `connect-src` must allow https and wss to the server),
join N guests (HELLO, protocol, one room, `players == N` everywhere), 60 s hold (3 of 3 connected, PONG >= 80 %, RTT
p50/p95), forced leave and rejoin (count dips and recovers, PONG after rejoin). Each failure prints a NEXT line in plain
English (ALLOWED_ORIGINS, vercel.json connect-src, DATABASE_URL direct string, ENV_NAME, rate limit and
CLIENT_IP_HEADER, build mismatch).

## Evidence (local server, port offset 4: server 2571, fake client origin 5199 serving a CSP header)

| Run | Outcome |
| --- | --- |
| Healthy, `--hold 60` | 7 PASS in 62 s, exit 0; 3/3 connected, pongs 30/30, RTT p50 1 ms, rejoin 236 ms |
| Client origin not in ALLOWED_ORIGINS | exit 1: CORS FAIL (ALLOWED_ORIGINS advice), CSP FAIL (unreachable origin), join FAIL with the "WebSocket upgrade refused / ALLOWED_ORIGINS" advice |
| Server down, `--wake-max 8` | exit 1: "server is waking" message, retries every 5 s, then FAIL with Render-logs advice |

`pnpm exec tsc` and `eslint src/smoke` clean; vitest 6/6. Server and fake origin were stopped afterwards; no listener on
2571/5199 and no leftover node process.

## Limits and notes

- Not exercised against real Render, Neon or Vercel: the cold-start wait (about 60 s), real CSP match and Neon
  `powered-off` polling are covered by logic and unit tests only. A first real run is the true proof.
- Reconnect is leave plus fresh seat (HelloRoom has no `allowReconnection`, so the 60 s seat hold cannot be exercised
  yet). A held-seat reconnect check belongs with the M1 room.
- Hold keeps traffic tiny (pings only); it does not measure snapshot rate or tick time (use `spike-16` with the isolated
  window for that).
- Per-IP limits: 3 joins plus 1 rejoin per run is well under the 30 joins/min and 8 sockets caps, but 3 room creations/min
  per IP applies, so wait a minute between repeated runs only if the first run created rooms and failed midway.
- Smoke never writes saves or touches the database beyond `/readyz`.
