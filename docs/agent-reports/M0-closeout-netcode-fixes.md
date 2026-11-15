# M0 close-out: netcode fixes (netcode-engineer)

- **Date:** 2026-11-14. Scope: `apps/server/src/net/**` and its tests only. No git, no STATUS/task edits, no ops/app edits.
- **Source:** `M0-closeout-netcode-security-review.md` (NB1-NB5).
- **Status:** DONE for NB1, NB3, NB4, NB5 and the ws backpressure test. NB2 deferred (see below). N8/N9 are already wired.

## Changes

| Item | Change | Where |
| --- | --- | --- |
| NB1 per-IP seat cap | `Admission` counts live seats (joined clients plus unconsumed reservations) per client IP and refuses over the cap with `429 RATE_LIMITED` (`message: "seats per ip"`) plus `retry-after: 15`. Default `MAX_SEATS_PER_IP = MAX_PLAYERS_PER_ROOM` (6): a household or demo table behind one NAT can still fill a room; solo uses one seat. Liveness is read from Colyseus (`room.clients.getById` or `room.hasReservedSeat`), so no room hooks are needed and stale records are pruned lazily. Configurable via `AdmissionLimits.maxSeatsPerIp`. The NET_SPIKE load-test route is exempt (its bots share one IP; the route is refused in production). | `admission.ts`, `spike/spike-join-route.ts` |
| NB1 idle timeout | New `IdleWatch` (no timers, no per-sweep allocation). HelloRoom closes a seat with `4107 IDLE_TIMEOUT` when no valid app message arrives within 10 s of the join (the client sends its first PING on join), or after 120 s of silence (generous: throttled background tabs). Swept once a second from the fixed step. Limits are room options (`helloIdle` on `createGameServer`) and constants `HANDSHAKE_TIMEOUT_MS`, `SILENCE_TIMEOUT_MS`. The M1 shift room should reuse `IdleWatch` plus its own AFK rule. | `idle-watch.ts`, `hello-room.ts`, `game-server.ts` |
| NB3 duplicate client-IP header | One rule on both transports: a repeated request header is joined with `, ` (`addHeader`), on the uWS copy and the Node `rawHeaders` copy. REST now matches the upgrade's `Headers.get`: a duplicated edge header is an invalid address and keys the shared `unknown` bucket. A joined `x-forwarded-for` still resolves to its right-most entry. | `http-routes.ts`, `node-http.ts` |
| NB5 413 code | 413 responses use `PAYLOAD_TOO_LARGE` (contract `api/rest` v0.1.2). | `http-routes.ts` |
| NB5 retry-after | Added to every 429: per-IP join limiter (seconds until window reset from `msBeforeNext`, `IpRateLimiter.check`), room-creation limiter, seat cap (15 s), spike join, and the upgrade socket-cap 429 (5 s). | `admission.ts`, `hello-join-route.ts`, `spike/spike-join-route.ts`, `game-server.ts` |
| NB5 backpressure test | Sweep body extracted as `terminateBackpressured` (unit test) and the running transport's real 1 s sweep is tested by injecting a stuck fake socket into `wss.clients`. | `ws-transport.ts`, `seat-cap-idle.test.ts` |
| NB4 | `connectionsCheckingInterval: 2000` on the ws-path http server, so idle or half-sent connections fall to about 10 s instead of 30-45 s. Not separately probed live; it is the Node option the review named. | `ws-transport.ts` |

## Deferred

- **NB2** (failed ws handshake holds the per-IP slot for 10 s): not trivial and safe on both transports. A `sec-websocket-key` pre-check in the shared `beforeUpgrade` depends on how the uWS transport builds the `Request`, which I did not verify. The attacker only locks out its own IP (and `unknown`, now harder to reach via NB3). Left as is.
- **Env wiring:** `apps/server/src/app/server.ts` passes only `{ maxRooms, maxClients }`; the seat cap uses its default (6). If Cee wants an env knob, `MAX_SEATS_PER_IP` in `ops/env.ts` plus one field in `app/server.ts` (outside my paths).
- LoadTestRoom (NET_SPIKE) has no idle watch; it is a dev tool. M1: seats held for reconnection are not counted by the seat cap yet (hello/spike rooms hold none).

## Client N8 / N9

Both are wired; the reviewer's spot check was stale or missed them.
- N8: `apps/client/src/app/boot.ts:140` computes `launchSearch(win.location.search, import.meta.env.PROD)` and passes the filtered search to `RenderModule` (line 143) and `VisualsModule` (line 149). Tests `app/launch-policy.test.ts` and `app/boot-wiring.test.ts` pass (10 tests).
- N9: `apps/client/vite.config.ts` has `server.fs.deny` (defaults repeated plus terrain raw/cache/fixtures and `tools/.bin`), verified live in `M0-hardening-followups.md`.

No client edit was needed.

## Evidence (Node v26.13.1 via the fnm prefix)

- `vitest run` in `apps/server`: 19 files, **205 tests passed** (`src/net`: 10 files, 97 tests; new file `seat-cap-idle.test.ts`).
- `tsc --noEmit -p apps/server`: clean. `eslint src/net`: clean. `prettier --check src/net`: clean.
- New or extended tests:
  - Seat cap: refusal at the cap with `retry-after: 15`, other IPs unaffected, slot freed on leave, solo unaffected.
  - Idle: through the real HelloRoom, a silent seat gets 4107, a pinging seat survives and later gets 4107 once silent. `IdleWatch` unit tests cover handshake, silence, removal and a throwing client.
  - NB3: duplicate `true-client-ip` gives `unknown` on REST (uWS and ws) and on the ws upgrade.
  - NB5: 413 body is `PAYLOAD_TOO_LARGE` (uWS and ws); `retry-after` on the join limiter 429 and the upgrade 429; backpressure unit plus live-sweep tests.
- Existing tests adjusted: the N2 and room-creation tests now set `maxSeatsPerIp: 100`, because the default 6-seat cap fires before the limiter they test.

## Files

- `apps/server/src/net/idle-watch.ts` (new), `admission.ts`, `hello-room.ts`, `hello-join-route.ts`, `game-server.ts`, `http-routes.ts`, `node-http.ts`, `ws-transport.ts`, `index.ts`, `spike/spike-join-route.ts`.
- Tests: `seat-cap-idle.test.ts` (new), `admission.test.ts`, `game-server-ws.test.ts`, `game-server.test.ts`.
