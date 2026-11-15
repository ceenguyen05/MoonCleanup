# M0 close-out: netcode / server trust-boundary re-review (netcode-security-reviewer)

- **Date:** 2026-11-14. Read-only. No source edits, no git.
- **Scope:** `apps/server/src/net/**` (transport selection, uWS and ws adapters, node-http, http-routes, admission, client-ip, cors, hello room and join route, spike room hooks) and the netcode-relevant parts of `apps/server/src/ops/env.ts`. I also read the Colyseus 0.18.28 sources these depend on (`@colyseus/ws-transport` WebSocketTransport/WebSocketClient, core `Server.listen`, `bindRouterToTransport`, `runBeforeUpgrade`, `createAuthContext`).
- **Inputs:** `M0-transport-fallback.md`, `M0-risk-review-netcode-security-reviewer.md` (B1, N1-N11) and `M0-netcode-fix-batch.md`.
- **Concurrency:** another worker is editing `ops/**` (env validation, room-stats). I reviewed only the current env.ts lines that matter for netcode and did not touch ops.

## Verdict

**PASS for M0 (no blocking findings).**

- The fixes for B1 and N1-N6, plus N11, are present and hold on **both** transports.
- The `TRANSPORT=ws` fallback has protections equivalent to the uWS path, with small, documented timing differences.
- The AT_CAPACITY contract matches: `packages/shared/src/api/rest.ts:170,213` and `net/admission.ts:208-219`.
- Five non-blocking findings follow. Fix NB1 before multiplayer is promoted on the public Render URL (M1 shift room).

## Evidence

- **Focused tests:** `vitest run src/net/{transport,game-server-ws,admission,admission-ws-rooms,cors}.test.ts` on Node 26.13.1: 5 files, 49 tests passed.
- **Live probes:** I wrote two scripts in my scratchpad (`probe-ws.mts`, `probe-ws-long.mts`) and ran them with tsx against `createGameServer({transport:"ws"})` on port 0. The server was shut down afterwards. Results:
  - **Bad handshake:** an upgrade with an allowed Origin and an invalid `Sec-WebSocket-Key` gets 400 from `ws`, but the per-IP slot stays claimed. After 3 bad handshakes (cap 3 in the test), a valid upgrade got **429**. The slots dropped to 0 after 10.5 s. This confirms NB2.
  - **Duplicate header:** a duplicate `True-Client-IP` on the ws upgrade is keyed to `unknown`. This confirms NB3.
  - **Idle TCP connection:** a connection that never sends a byte was closed after **29.6 s**. This confirms NB4.
  - **Long-lived socket:** a socket with a real HelloRoom seat survived 47 s on the ws path, so it was not killed by `requestTimeout` 15 s. Its slot was released on close (count 1 -> 0).
  - **Idle seat:** the socket never sent the Colyseus join acknowledgement or any app message, yet it held its seat the whole time. This is the evidence for NB1.
- **Secrets:** I grepped `apps/server` for connection strings, private keys, JWTs and DSNs. The only hits are test fixtures (`hunter2`, `u:p@h`) and the placeholder in `.env.example`. **No real secret was found.**

## Fix verification (prior findings)

| Item | Status | Where |
| --- | --- | --- |
| B1 room/client ceilings | OK | `admission.ts:183-206` (serialized queue `:123-127`); both join routes call `admission.reserve` |
| B1 per-IP socket cap | OK on both transports | `game-server.ts:115-124` (shared `beforeUpgrade`); uWS `uws-transport.ts:33-42`; ws `ws-transport.ts:46-51` (the same `context` object reaches `beforeUpgrade` and `connection`, verified in Colyseus `listenForUpgrade`) |
| B1 backpressure | OK (ws: 1 s sweep) | uWS `uws-transport.ts:49-50`; ws `ws-transport.ts:72-80` (`terminate` emits `close`, so the slot is released) |
| N1 blank CLIENT_IP_HEADER | OK | `ops/env.ts:209-211` (local only); socket mode on REST `node-http.ts:198` / `http-routes.ts:255`; upgrade `client-ip.ts:59-72` |
| N2 `unknown` bucket | OK | `admission.ts:49-83`, `hello-join-route.ts:21,34` |
| N3 malformed `%` | OK on both | uWS `http-routes.ts:237-264`; Node `node-http.ts:178-186` -> `executeRoute` 400 (`http-routes.ts:138`) |
| N4/N5 request spam, PING overflow | OK | `hello-room.ts:130-132,153-156`; `spike/load-test-room.ts:224-225` |
| N6 spike 30/20 | OK | per the fix batch, with a test |
| N11 placeholder secrets | OK (production only) | `ops/env.ts:44-47,220` |
| Colyseus router on ws | OK | Stripped synchronously in the listen callback (`ws-transport.ts:56-63`) after `bindRoutes` (core `Server.mjs:89-96`); `prereadRequestBodies` runs only in `serverless()`. A test asserts that `/`, `/matchmake` and `/__healthcheck` return 404 |
| Transport selection | OK | `transport.ts:97-123`: `uws`/`ws` failures are fatal, and `auto` logs one warning (first line of the error, max 200 chars, no secrets). A bind failure rejects on both (`ws-transport.ts:107-122`, `uws-transport.ts:64-71`) |

**N8/N9 (client and devops), spot check only:** rg found no `launchSearch` in `apps/client/src/app/boot.ts` and no `fs`/`deny` in `apps/client/vite.config.ts`. So N8's prod gate still looks **unwired** and N9 still looks **open**. Both are low severity and outside this review's scope; the owner should confirm.

## Blocking

None.

## Non-blocking

### NB1 (medium, before public multiplayer). One IP can hold every MAX_CLIENTS seat indefinitely

- **Where:**
  - `admission.ts:25,188-191`: there is a per-IP socket cap of 8 but no per-IP seat cap, with `MAX_CLIENTS` 12.
  - `hello-room.ts`: there is no idle or handshake timeout (review B1(d) was not done).
  - Transport auto-ping keeps silent sockets alive (ws pings every 3 s, uWS sends pings automatically).
- **Scenario, from one IP with a forged allowed Origin:**
  1. Make 8 `POST /v0/hello/join` calls, opening 8 sockets that never send an app message. They hold 8 seats; the probe held one for 47 s with only auto-pongs.
  2. Re-reserve the other 4 seats every ~15 s (the reservation lifetime). That is about 16 joins a minute, under the 30/min limit.
  3. Every legitimate join then gets `503 AT_CAPACITY` for as long as the attacker keeps going.
- **Impact:** a multiplayer denial of service. Rooms do not crash, no state is gained, and solo play is unaffected.
- **Fix:**
  - In `Admission.reserveNow`, cap live seats plus reservations per IP (for example 2, or 6 for one room).
  - In rooms, close with `leave(4104)` when there is no join acknowledgement or app message within about 10 s, and after N minutes without input.
  - M1 auth adds per-account limits.

### NB2 (low). A failed ws handshake holds the per-IP slot for 10 s

- **Where:** `game-server.ts:122` claims the slot before `ws.handleUpgrade` validates the key and version. When `handleUpgrade` aborts, `connection` never fires, so the slot is freed only by the timer (`admission.ts:149-153`).
- **Scenario:** 8 malformed upgrades lock that IP out for 10 s, which was confirmed live. The attacker can only lock out itself, unless traffic lands in the shared `unknown` bucket (see NB3).
- **Fix:** before claiming, check `sec-websocket-key` against `^[A-Za-z0-9+/]{22}==$` and require version 13. Alternatively release the slot from a `socket.once("close")` hooked in `beforeUpgrade`.

### NB3 (low). Client-IP header parsing differs between REST and the ws upgrade

- **Where:** REST takes the **last** duplicate header (`node-http.ts:80-84`). The ws upgrade reads `Headers.get`, which joins duplicates as `a, b`; `sanitizeIp` rejects that, so the request is keyed `unknown` (`client-ip.ts:64-66`).
- **Scenario:** if Render passes a client-sent `True-Client-IP` through as an extra header line, any client can move its upgrades into the shared `unknown` socket bucket (8). That lets it starve the bucket for real `unknown` users. It cannot bypass its own cap.
- **Fix:** use one rule on both paths. The simplest is to treat any comma in the configured header as `unknown` on REST too. This still depends on the open N1 live check that Render's edge **overwrites** the header.

### NB4 (low). On the ws path, idle and incomplete HTTP connections live up to about 30-45 s (uWS closes them at about 10 s)

- **Where:** `ws-transport.ts:89-92`. `headersTimeout`/`requestTimeout` are only checked every `connectionsCheckingInterval`, which defaults to 30 s; the probe measured 29.6 s. Separately, `node-http.ts:210` does not force `connection: close` on an incomplete GET.
- **Scenario:** many silent TCP connections each pin a file descriptor for about 30 s. On this path, TCP connections have no per-IP cap.
- **Fix:** add `connectionsCheckingInterval: 2_000`, and optionally `server.maxConnections`. Close on any `!req.complete`.

### NB5 (low, hygiene)

- **413 error code:** 413 responses use `error:"BAD_REQUEST"` (`http-routes.ts:142,148`), but the contract has `PAYLOAD_TOO_LARGE` → 413 (`rest.ts:178,217`).
- **Missing `retry-after`:** the 429 responses (`hello-join-route.ts:40`, `admission.ts:197`) have none.
- **Backpressure test gap:** no test covers the ws backpressure sweep, and no fake-timer test shows that an opened socket keeps its slot past 10 s.
- **For M1:** Colyseus' ws `buildAuthContext` reads `_authToken` from the URL (`WebSocketTransport.mjs:37`). The M1 auth design must not use URL tokens.

## Not covered

- Colyseus' uWS transport internals were not re-read; the prior review and passing tests cover them.
- ops room-stats and the stats reporter are being edited by another worker.
- packages/protocol codecs: N7 was not re-checked.
- app/** wiring was not read this pass; the fix batch states that env limits reach `createGameServer`.
- The live Render header behaviour (N1) is still unverified.
