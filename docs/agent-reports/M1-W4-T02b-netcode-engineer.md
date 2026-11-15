# M1-W4-T02b: binary REST adapter, ShiftRoom wiring, allocation trace (netcode-engineer)

Task / status: M1-W4-T02b / DONE, ready for review / 2026-11-14 / netcode-engineer / Opus 5.5
Scope: `apps/server/src/net/**`, `apps/server/src/app/**` only. No packages, api, client, STATUS or git.

## 1. Binary REST seam (T07b adapter brief), uWS and Node
- `net/http-routes.ts` (shared `executeRoute`):
  - Routes with `rawBodyMaxBytes` get `rawBody` (empty when there is no body) and no JSON parse. They use their own limit; every other route keeps 16 KB.
  - Pre-checks run before any byte is buffered, in this order:
    1. No `Bearer ` -> 401 `UNAUTHORIZED`.
    2. Media type is not `application/octet-stream` (parameters ignored) -> 400 `BAD_REQUEST`.
    3. Declared length over the limit -> 413.
    4. `RawBodyGate` (4 per process, 1 per IP) is full -> 503 `RETRY_LATER` + `retry-after: 5`. The slot is held until the handler returns, and is also released on abort or timeout.
  - `BodyBuffer` copies each chunk into ONE buffer sized from the capped content-length (no concat). Chunked bodies are counted as they stream.
  - 30 s read deadline (`BODY_READ_TIMEOUT_MS`), then the connection closes. This applies to every body read.
  - An answer sent before the whole body arrived closes the connection.
  - `binary` is written verbatim:
    - uWS: `end(view)` inside `cork`.
    - Node: a `Buffer` view, `content-length` = byteLength.
  - `responseHeaderPairs` writes each header name once, and the handler's value wins, so there is exactly one content-type. Errors stay JSON. No new codes.
  - uWS now also mounts `PUT`.
- `net/node-http.ts`: same reader (stream backpressure, pause on overflow, `close`/`error` -> aborted) and the binary writer.
- `net/cors.ts`: `access-control-expose-headers: x-save-pages, retry-after` on non-public CORS answers. Allowed headers and methods are unchanged.

## 2. ShiftRoom wiring + join ticket
- `app/server.ts` passes `shift: { data: loadGameData(), world: createShiftWorld(), verifyToken: account.verifyToken, membership: createShiftMembership(repo), stats }`.
  - `createShiftWorld()` is the Standard grid on flat ground, matching the client's current `solo-host.ts` world. The real bake waits for `apps/server/src/world`.
  - `createShiftMembership` uses `repo.getMembership` + `getProfile`. It returns null (403) for banned members, deleted Contracts and **solo** Contracts (ADR-0031).
- `_authToken`: the cited contracts report has no ruling on this, so I followed security.md §3 ("URL carries only the reservation id"):
  - `JoinTickets.grant` keeps the ticket server-side, keyed by the reserved sessionId (capped, fails closed -> 503).
  - `ShiftRoom.onAuth` calls `redeemSession` and never reads or logs the URL token.
  - `joinTicket` stays in the response (schema unchanged). **Contracts-architect: confirm, or drop/repurpose the field.**

## 3. The ~1.1 KiB/tick allocation
Measured on Node 26.13.1 with the V8 sampling heap profiler (32 B interval, GC-collected objects included) after 2,000 warm-up ticks, plus `total_allocated_bytes`.
- `total_allocated_bytes` per 1,200-tick window:
  - ShiftCore: 1724, 2015, 1038, 737.
  - Bare sim with a listener: 1328, 2905, 1510, 941.
  - Bare sim without a listener: 1699, 2867, 994, 1085.

  Core and bare sim cannot be told apart, so the T02 heapUsed gap was JIT/tiering noise.
- Sampled allocation inside `apps/server/src/net/shift/**` was zero. **No fix needed in our code.**
- The steady source is `packages/sim`, at function level (the profiler does not map lines under tsx):
  - `stepAvatar` (movement/avatar.ts), about 720 B/tick for 6 actors.
  - `stepToolHead` (tools/tool.ts), 0-260 B/tick, plus its callees `headPhase`, `smoothstep01`, `quantiseSegment` -> `plot-grid toPlotLocal/walk`.
  - `turnToward`.
  - These look like boxed doubles. Hand-off: gameplay-systems-engineer.

## Evidence (Node 26.13.1 via fnm prefix, this file state)
- `tsc --noEmit -p apps/server`: clean. `eslint src/net src/app`: clean. `prettier --check`: clean.
- `vitest run src/net src/app`: **15 files, 140 passed**.
  - New `net/raw-body.test.ts` runs 8 tests on each transport plus 1 cross-transport test, 3 consecutive green runs. It covers:
    - Exact 1,052,674 B body echoed byte-identical (0x00/0xff/CRLF pattern).
    - Empty and chunked raw bodies.
    - Limit + 1 -> 413, both declared and chunked.
    - 401 and 400 answered while the body was never sent.
    - The 1/IP and 4/process caps -> 503 + `retry-after: 5`.
    - A slow body closed at the deadline with its slot released.
    - JSON routes still limited to 16 KB.
    - One content-type header and the expose-headers present.
    - uWS and Node bytes and headers identical.
  - Other tests: `cors.test.ts` (gate, buffer, header dedupe), `shift-core.test.ts` (grant/redeem), `shift-room.test.ts` (URL token ignored, seat without a grant refused), `server.test.ts` (wired join: 200 holder, 401, 403 stranger, 403 solo).
- Tick starvation: during 4 concurrent max-size uploads, a 20 Hz timer was at most 12.8 ms late on uWS and 15.3 ms on Node. The client ran in the same process, so these are upper bounds.

## NOT RUN
- Real browser fetch / CORS expose-headers in a browser.
- The api checkpoint handlers through the live adapter (they still read the old header carrier; backend-data-engineer is switching them).
- netsim, Render 0.1-CPU, ShiftRoom on uWS.
- `pnpm verify` (not requested).

Files: `apps/server/src/net/{http-routes,node-http,cors,cors.test,raw-body.test}.ts`, `net/shift/{join-ticket,shift-join,shift-room,shift-room.test,shift-core.test}.ts`, `app/{server,server.test}.ts`.

## Update: review fixes (M1, L2 from M1-W4-T02-review-netcode-security-reviewer.md)
Status: DONE, ready for re-review / 2026-11-14.

**M1 fixed.** An upload slot is now granted only after the token is verified.
- `executeRoute` runs the cheap synchronous checks first: Bearer prefix (and at most 4,096 chars), content-type, then the declared length.
- It then opens the body **held**:
  - uWS: `onData` is still attached synchronously, followed by `res.pause()`. Chunks that arrive anyway go to a stash of at most 64 KB; more than that closes the connection.
  - Node: no `data` listener yet, so the stream is not flowing.
- It verifies the token through the new `rawBodyAuth`. The composition root passes `account.verifyToken` (one HMAC per upload, REST path only, never the tick).
- Only then does `RawBodyGate.tryAcquire(ip, account)` run. Limits: 4 per process, 1 per address, 1 per account. IPv6 addresses are grouped by /64 (`ipSlotKey`).
- New minimum-throughput rule (`watchBodyRead`, shared by both transports): a raw body averaging under 32 KB/s after 5 s is closed and its slot freed. A trickling client now holds a slot about 5 s instead of 30 s. The 30 s hard deadline still applies.
- No verification cache. It is not needed at one HMAC per upload.

**L2 fixed.** The Node `HTTP_REQUEST_TIMEOUT_MS` is now `BODY_READ_TIMEOUT_MS + 5 s` (35 s, was 15 s). Both transports therefore cut uploads at the same shared 30 s deadline and minimum rate.

**Evidence (Node 26.13.1):**
- tsc, eslint and prettier (`src/net`, `src/app`) are clean.
- `vitest run src/net src/app`: **15 files, 148 passed**. `raw-body.test.ts` has 25 tests and was green in 3 consecutive runs.
- New tests, on uWS and Node:
  - A forged Bearer gets 401 while the declared body was never sent. It takes no slot, and 4 forging addresses cannot block a real upload.
  - Second upload from the same account -> 503.
  - Same /64 -> 503; a different /64 -> 200.
  - A trickling body is closed at the 300 ms test grace, well before the 10 s deadline, and its slot is freed.
  - `ipSlotKey` unit cases.
  - The ws transport's `server.requestTimeout` is above 30 s.
- `server.test.ts`: on the live checkpoint route, a forged token gets 401 from the adapter and a real token passes it.

NOT RUN: the review's live trickle repro against uWS's 10 s idle timeout with real 9 s gaps (covered here by the shortened test grace).
