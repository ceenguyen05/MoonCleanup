# M0 netcode fix batch (netcode-engineer)

Status: COMPLETE for the narrowed scope: server items B1, N1, N2, N3, N4/N5, N8 and the SNAPSHOT_HZ decision
(2026-11-13). Source findings: `M0-risk-review-netcode-security-reviewer.md` and `M0-W2-T04-longrun-qa-test-engineer.md`.
Local only; room cap 6. The coordinator moved bots items (a) and (b) to another worker and cancelled live runs. Only
unit and real-uWS integration tests were run.

## Items

| Item | Status | Files | Test |
| --- | --- | --- | --- |
| B1 admission | DONE | `apps/server/src/net/admission.ts` (new), `game-server.ts`, `hello-join-route.ts`, `spike/spike-join-route.ts`, `app/server.ts`, `net/index.ts` | `net/admission.test.ts` (B1 blocks) |
| N1 blank CLIENT_IP_HEADER | DONE | `ops/env.ts`, `net/client-ip.ts`, `net/http-routes.ts`, `net/game-server.ts`, `app/server.ts` | `ops/env.test.ts`, `net/cors.test.ts`, `net/admission.test.ts` (N1) |
| N2 unknown bucket | DONE | `net/admission.ts` (`IpRateLimiter`), both join routes | `net/admission.test.ts` (N2) |
| N3 malformed `%` in `:param` | DONE | `net/http-routes.ts` | `net/admission.test.ts` (N3, real uWS), `net/cors.test.ts` |
| N4 request spam / N5 PING overflow | DONE | `net/hello-room.ts`, `net/spike/load-test-room.ts` | `net/admission.test.ts` (N4/N5) |
| N6 (bonus) spike 30/20 | DONE | `net/spike/options.ts` | `spike/load-test-room.test.ts` (30/20 gets 400) |
| N8 terrain URL params in prod | DONE in policy; **boot.ts wiring needed (lead)** | `apps/client/src/app/launch-policy.ts` | `app/launch-policy.test.ts` |
| N9 Vite `/@fs/` exposure | NOTE ONLY | owner devops/client: `server.fs.deny` in `apps/client/vite.config.ts` | n/a |
| (c) SNAPSHOT_HZ divide rule | DONE: rule kept and documented | `ops/env.ts` header comment, `spike/options.ts` | `ops/env.test.ts` (30/20 refused, 30/15 accepted) |
| (a) resync on clean loopback | ROOT CAUSE FOUND; handed to the bots worker | `tools/bots/src/clients/steering.ts` | see below |
| (b) spike16 join retry | MOVED to the bots worker | | |

### B1 details

- **Serialized admission.** Every seat reservation from `/v0/hello/join` and `/v0/spike/join` passes through one queue in `Admission.reserve`, so the limits stay exact under concurrent joins.
  - **Client limit.** Joined clients plus live reservations (the sum of the room listings' `clients`, which Colyseus raises at reservation) must be below `MAX_CLIENTS`. Otherwise the route returns **503** `{error:"ROOM_FULL", message:"at_capacity:clients"}` with `retry-after: 30`.
  - **Room limit.** When no room with a free seat matches and `roomCount >= MAX_ROOMS`, the route returns **503** `at_capacity:rooms`.
  - **Room-creation rate.** Each IP may create 3 rooms per minute (the `unknown` bucket gets 2). Over that, the route returns **429** `{error:"RATE_LIMITED", message:"room creation"}`. Joining a room that already has free seats is never rate-limited this way.
- **Socket cap.** Each IP may hold 8 concurrent WebSockets, refused with **429 at upgrade**.
  - A slot is claimed in `beforeUpgrade`.
  - It is held from socket open until close, through an `AdmittingTransport` subclass that hooks `onConnection` and the wrapper's `close`.
  - If an accepted upgrade never opens, the slot is released after 10 s.
- **Send buffer cap.** `maxBackpressure` is 128 KB with `closeOnBackpressureLimit` (the transport default was 1 MB).
- **Wiring.** The real env is used: `startServer` passes `{maxRooms: env.maxRooms, maxClients: env.maxClients}`. `/readyz` `admitting` now also checks `ccu < MAX_CLIENTS`.
- **Tests.**
  - The 4th room at `MAX_ROOMS=3` is refused, and the room count stays at 3.
  - At `MAX_CLIENTS=8`, the 9th reservation is refused.
  - With 12 concurrent joins at `MAX_ROOMS=1`, exactly 6 succeed and 1 room exists.
  - Room-creation 429 is per IP and does not block joins into free seats.
  - From one IP, 8 upgrades get 101 and the 9th gets 429. Another IP still gets 101. Slots return to 0 after close, and a new upgrade then gets 101.
- **Contract proposal (contracts-architect).** Add `AT_CAPACITY` to `API_ERROR_CODES` in `packages/shared/src/api/rest.ts`. Until then, the refusal uses the existing `ROOM_FULL` code plus a message, which matches netcode.md §12 (4105 ROOM_FULL / AT_CAPACITY).

### N1 / N2 / N3 / N4 / N5 details

- **N1: blank `CLIENT_IP_HEADER` is "socket mode".** The TCP peer address is used and no header is trusted.
  - Env validation refuses socket mode unless `ENV_NAME=local`, with the message "CLIENT_IP_HEADER: may be blank (socket address) only when ENV_NAME is local".
  - REST reads `res.getRemoteAddressAsText()` synchronously.
  - At upgrade, Colyseus only exposes `context.ip`, which prefers forwarding headers. So in socket mode, any `x-real-ip`, `x-forwarded-for` or `x-client-ip` header puts the request in the `unknown` bucket.
  - **Local runs** (bots, browser dev) should set `CLIENT_IP_HEADER=` (blank). Otherwise every local request shares the tighter `unknown` bucket: 10 joins/min, 8 sockets, 2 room creates/min. The `.env.example` change belongs to devops.
- **N2: `unknown` bucket.**
  - Joins: 10/min for `unknown` vs 30/min (hello) and 60/min (spike) per known IP.
  - Sockets: 8. Room creates: 2/min.
  - A warning is logged at most once a minute per limiter.
- **N3: malformed `:param` encoding.** `res.onAborted` is now attached first. The header and param copy sits in a try/catch, and `safeDecodeURIComponent` returns `null`, so the route answers **400** `malformed path`. The test fires `%E0%A4%A`, `%`, `%zz` and `%C0%80` at a real uWS server, then checks that a good request still gets 200.
- **N4 / N5: request spam and PING overflow.**
  - `onUnhandledMessage` now counts ROOM_REQUEST frames of unknown type as violations. PING overflow is also counted as a violation in both rooms.
  - Tests: 60 unknown `room.request()` calls close the client with 4104, and 60 PINGs in under 1 s close it with 4104.

### N8 details

`launchSearch(search, production)` in `launch-policy.ts` drops `terrainBase` and `terrain` when `production` is true; dev builds pass the search through unchanged.

**Not effective until wired.** `apps/client/src/app/boot.ts` is outside this batch's write scope, so it still passes raw `win.location.search` to RenderModule and VisualsModule. The lead or client owner needs to:

- add `const search = launchSearch(win.location.search, import.meta.env.PROD);`
- pass `search` to `RenderModule` and `VisualsModule` (`boot.ts:135` and `:141`).

### (c) SNAPSHOT_HZ decision

The divide rule stays, and **30/15 is the high-rate profile**.

- A tick-aligned frame on every Nth tick keeps snapshot spacing, input acks and interpolation timing uniform.
- 30/20 alternates 33 ms and 67 ms frame gaps, and it measured about 5.2 KB/s per client in T04, over the 5.0 KB/s ceiling.

The decision is documented in the `ops/env.ts` header. The spike join schema now enforces the same rule (N6). The engine's 30/20 scheduler test still runs by building the options directly.

### (a) Resync root cause (handed over)

I modelled the server with the real `SpikeEngine` and the real `steer()`: zero latency, jittered timers, 12,000 ticks (scratchpad `resync-sim.ts`).

- **Before the fix:** with the bot ticking 20 ms after the server tick, the bot resyncs on every frame (50 % of ticks) and the server queue sits at depth 0.
- **Why:** the server consumes the next queued input first-in, first-out and accepts any seq ahead of the last one consumed. A jump to `ack + target` therefore adds no queued input. The next frame acks the jumped seq, the gap is 0 again, and the bot resyncs again. Because the jump makes the gap look healthy, the "send two" branch never fires.
- **Fix:** on resync, set the seq to `ack + 1` and send 2 inputs.
- **After the fix:** 1 resync per run in every phase and jitter tried (jitter 0-30 ms; phase 1, 10, 20, 25 and 49 ms), with depth held at 2-3 and no late drops beyond the first.

I applied this to `tools/bots/src/clients/steering.ts` before the scope change. The steering test file has since been updated to match (6 tests pass). A live before/after measurement is still owed by the bots worker.

## Test evidence (same state, 2026-11-13)

- `apps/server`: `tsc --noEmit` exit 0. `vitest run src/net src/ops src/app`: 11 files, 106 tests passed. Net tests now bind port 0 (`game-server.test.ts`, `load-test-room.test.ts`), so they cannot collide with live runs on 2571.
- `apps/client`: `vitest run src/app/launch-policy.test.ts`: 7 tests passed.
- `packages/protocol`: 3 files, 22 tests passed (no changes there).
- `tools/bots`: 3 files, 15 tests passed.
- `eslint` on every changed path: exit 0.
- Not run: `pnpm verify` (the lead runs it once per integration state).

## Live runs

**NOT RUN** (cancelled by the coordinator). Port 2571 status:

- PID 13532 (tsx `src/app/index.ts`, parent 18524, started 05:34:21) is still listening, with no clients connected at 05:51.
- It is **not mine**: I started no servers. The start time matches the qa-test-engineer long-run queue (`clean-30-15`).
- My `taskkill` attempt, made at the coordinator's request, was **denied by the permission classifier** as interfering with another workload. The owner or lead must stop it.
