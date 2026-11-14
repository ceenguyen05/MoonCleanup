# M0-W1-T04 — Colyseus on uWS, HTTP routing, HelloRoom, client connect

Status: **blocked (dependency fixes)**. Code is implemented and tested locally. 2026-11-12. netcode-engineer, Opus 5.5.

**Done**
- Server `createGameServer({ port, routes, allowedOrigins, logger, rates, serverBuild, clientIpHeader?, helloRoom? })` serves Colyseus 0.18.28 on `@colyseus/uwebsockets-transport` 0.18.5. It also exposes `gracefullyShutdown()`, which never exits the process. Colyseus' own signal and `uncaughtException` hooks are off.
- HTTP uses **plain uWS handlers, not Colyseus' router**, because the router path on uWS:
  1. buffers POST bodies with no size limit.
  2. drops the peer address and takes the client IP from the left-most `X-Forwarded-For` entry (security §5 M14).
  3. applies one global set of CORS headers, including `Allow-Credentials: true` and a 30-day max-age.
  4. leaves unknown paths hanging (verified).
  5. allocates `Request`/`Response` objects for every call.

  The adapter enforces a 16 KB body limit (413), returns 400 for bad JSON and a 500 without a stack trace for handler errors. It reads the client IP from the edge header (or the right-most `X-Forwarded-For` entry). `/healthz` sends `Access-Control-Allow-Origin: *`. Unknown paths and `/matchmake` return 404. uWS keeps the **last** registration of an identical pattern, so the catch-all routes are mounted after `listen()`.
- CORS uses an exact allowlist with `Vary: Origin`, never sends credentials, and caches preflights for 600 s. The WebSocket upgrade returns 403 when the origin is missing or not allowed.
- `HelloRoom` (maxClients = `MAX_PLAYERS_PER_ROOM` = 6):
  - REST seat reservation at `POST /v0/hello/join` (zod-validated, 30 joins/min per IP). Public matchmake methods are disabled with `exposedMethods = []`.
  - Sends HELLO with the rates. A protocol mismatch closes with **4100** and a `ProtocolMismatchInfo` reason.
  - Answers PING with PONG (2 per second, using the PONG codec with a reused buffer).
  - Drops and counts unknown or malformed messages. More than 50 violations in 10 s closes with 4104.
  - `patchRate = null` with a manual `broadcastPatch()`, and `autoBatchMessages` is on.
- `packages/protocol` has a PING/PONG codec checked against the golden vectors, plus fuzz and wrap tests.
- Client `createNetSession`:
  - Probes `/healthz` with a 3 s timeout every 3 s and moves through `asleep → waking → connecting → connected → lost`.
  - Emits `net.status`; an RTT update re-emits the current state.
  - Reserves a seat over REST, then calls `consumeSeatReservation`, then runs PING/PONG.
  - Includes a `shouldProbe` guard (webdriver/bot/prerender/hidden).

**Colyseus 0.18 checks (§18)**
- Close codes are 4000, 4001, 4002, 4003 and 4010. None clash with 4100–4199.
- `exposedMethods = []` rejects public matchmake calls ("invalid method").
- `reserveSeatFor` rejects the 7th seat ("full"). A seat reservation can be used only once.
- Manual patching works with `patchRate = null`. A frame send plus `broadcastPatch()` inside `batchMessages` goes out as **one** `ws.cork` per client (test).
- The Schema handshake works between the SDK client (5.0.47) and the server (5.0.48): state decodes.

**Evidence** (Node 26.13.1, port 2571)
- `apps/server` net tests: 28/29 pass. `uws-boot.test.ts` **fails by design** (blocker 1).
- `apps/client` net tests: 3/3 pass.
- `packages/protocol` tests: 10/10 pass.
- `tsc` is clean for server, client and protocol. `eslint` on the three paths is clean.
- Bandwidth and CPU (bytes/s and ms/tick) were not measured; no netsim or bot run.

**Blockers (devops, sequential install)**
1. `uWebSockets.js#v20.71.0`: `ESM_wrapper.mjs` imports `./index.js`, which does not exist. Every ESM import fails, including the server bundle. Fix: re-pin to `github:uNetworking/uWebSockets.js#v20.70.0`. Its wrapper imports `./uws.js`, and linux 137/147 binaries were confirmed; the win32 147 download timed out during the check.
2. Transport 0.18.5 imports the optional peer `uwebsockets-express` and rejects a Deferred that nothing awaits. Node exits at boot (reproduced). Fix: either `pnpm patch` (add a no-op `.catch` on the Deferred) or alias it to an empty stub in the esbuild bundle.

`net/testing/uws-esm-fix.ts` works around both problems **in tests only**.

**Next**
- The integrator wires the composition roots:
  - Server: `createGameServer` with the env rates and the backend's `/healthz` and `/readyz` routes.
  - Client: `createNetSession` with `wake()` on first interaction.
- For local single-player feel, consider `SIM_TICK_HZ=30` / `SNAPSHOT_HZ=15`.
- 16-player assumptions remain in the netcode §14/§15 budgets and the §11 rate notes. Concurrent WebSockets per IP is not enforced yet.

Files: `apps/server/src/net/*`, `apps/client/src/net/*`, `packages/protocol/src/{index.ts,codec/ping*.ts}`.

Commit suggestion: `feat(net): Colyseus uWS server factory, HelloRoom, REST seat join and client wake session`
