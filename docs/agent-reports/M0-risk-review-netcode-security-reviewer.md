# M0 risk review: netcode-security-reviewer

- **Scope:** M0 high-risk server net/app/ops code, protocol codecs, db, client net/launch-policy, Vite terrain plugin.
- **Method:** static review plus reading the Colyseus 0.18.28 / uWS dependency sources; no server was run (another worker is timing a live server).
- **Not redone:** tooling supply chain (T02 review) and the git hook (T04 reviews).
- **Status:** COMPLETE. All four scope areas were reviewed.
- **Tests run:** cheap unit tests only: `vitest run codec/ping codec/bits codec/spike ops/env.test net/cors.test app/launch-policy.test` → 6 files, 53 tests passed.

## Verdict

**CHANGES REQUESTED.** There is one blocking finding for any public or Render deploy that has HelloRoom enabled (B1). It does not block local-only M0 development. Everything else is non-blocking hardening or a latent issue. No secrets were found in the reviewed files.

## Blocking

### B1. Room and connection admission is not enforced. One IP can grow rooms and sockets without limit (free-tier CPU/memory DoS)

- **Where:**
  - `apps/server/src/app/server.ts:64-72`: `MAX_ROOMS` is used only for the `/readyz` `admitting` flag.
  - `apps/server/src/net/hello-join-route.ts:45-49` and `spike/spike-join-route.ts:43-47` call `matchMaker.joinOrCreate` with no room or client ceiling.
  - `apps/server/src/net/game-server.ts:86-91`: `beforeUpgrade` checks only Origin.
  - `MAX_CLIENTS` (`ops/env.ts:58`) is validated but never read (rg finds no consumer).
- **Spec:**
  - security.md §5 requires "Concurrent WebSockets per IP: 8, reject at upgrade".
  - netcode.md §15 and environments.md make `MAX_ROOMS` a hard ceiling and `MAX_CLIENTS` the admission limit.
- **Exploit sketch:** this needs no browser, because a non-browser client forges `Origin`.
  1. Loop `POST /v0/hello/join` with `{protocolVersion:<current>, clientBuild:"x"}` up to 30 times a minute from one IP.
  2. For each reservation, open `wss://host/<processId>/<roomId>?sessionId=<id>` with `Origin: <allowed origin>` and keep the socket open. uWS auto-pings (`sendPingsAutomatically`), and any WS library auto-pongs, so the 120 s idle timeout never fires.
  3. Every 6 seats `joinOrCreate` creates a new HelloRoom with its own 20 Hz `setSimulationInterval` and `broadcastPatch`.
  4. After about 10 minutes: roughly 300 sockets and 50 rooms ticking on a 0.1-CPU, 512 MB instance. Add up to 1 MB of send backpressure per non-reading socket (Colyseus transport default `maxBackpressure`).
  5. The `/readyz` probe reports `admitting:false`, but nothing refuses joins. More IPs, or the shared `unknown` bucket (N2), make it worse.
- **Fix:**
  - **(a)** In both join routes, before `joinOrCreate`, refuse with 503 `{error:"AT_CAPACITY"}` (4105 semantics) when either limit is reached:
    - `matchMaker.stats.local.roomCount >= env.maxRooms` and no existing room has a free seat. The simplest form: refuse `create` when at the ceiling.
    - Connected clients plus pending reservations `>= env.maxClients`.
    - Pass `maxRooms`/`maxClients` into `createGameServer`.
  - **(b)** In `beforeUpgrade`, resolve the client IP with `resolveClientIp`, using the same header as REST, and track open sockets per IP in a `Map`. Decrement on close; reject with 403/429 above 8.
  - **(c)** Set the transport's `maxBackpressure` to about 64-128 KB, and `closeOnBackpressureLimit: true` if the transport passes it through.
  - **(d)** Optionally, add an idle-input timeout in HelloRoom (no app message for N minutes → `leave(4104)`).
  - **Tests:** the 4th room-create is refused at `MAX_ROOMS=3`, and the 9th upgrade from one IP is refused.

## Non-blocking

### N1. Empty `CLIENT_IP_HEADER` silently falls back to trusting `true-client-ip`, and the socket address is never used

- **Where:**
  - `ops/env.ts:6,186,208` documents that an empty value means "use the socket address" and returns `null`.
  - `app/server.ts:85` omits the option when it is `null`, so `game-server.ts:100` uses `DEFAULT_CLIENT_IP_HEADER`.
  - `net/client-ip.ts` has no socket-address path at all.
- **Effect:** an operator who blanks the variable for a deploy without a header-rewriting edge gets a server that trusts a client-supplied `True-Client-IP`. An attacker can then rotate per-IP rate-limit buckets freely, which defeats the 30/min join limit and amplifies B1.
- **Fix:** pick one behaviour.
  - Either reject an empty `CLIENT_IP_HEADER` in env validation, which security.md §5 implies by forbidding socket-address keying.
  - Or implement the socket path: pass `res.getRemoteAddressAsText()` into `HttpRequest.remoteAddress` when the header is `null`.
  - Update the env.ts comment either way.
  - Also confirm on the live Render check (M0-W3-T01) that Render's edge **overwrites**, not appends or passes through, a client-sent `True-Client-IP`. Until then, per-IP limits are only as strong as that edge behaviour.

### N2. Missing-header requests share one `unknown` bucket at the normal limit, with no log

- **Where:** `net/client-ip.ts:21,29`, `hello-join-route.ts:39`.
- **Spec:** security.md §5 asks for a *tighter* limit for `unknown` plus a log once per minute.
- **Effect:** today `unknown` gets the same 30/min, and it is a single shared bucket. One unknown-path abuser locks out every other unknown-path user, and nobody notices.
- **Fix:**
  - Use a separate limiter for `unknown`, for example 10/min.
  - Add a rate-limited `logger.warn({clientIpHeader}, "client ip header missing")`.
  - Add a test asserting the tighter limit.

### N3. A latent process crash from malformed percent-encoding in `:param` routes

- **Where:** `net/http-routes.ts:142-144`. `decodeURIComponent` runs synchronously in the uWS handler, **before** `res.onAborted` (line 147) and with no try/catch.
- **What happens:** a `URIError`, for example from `/v1/contracts/%E0%A4%A/join`, escapes the uWS callback. uWS then aborts on "Returning from a request handler without responding or attaching an abort handler is forbidden!" (the string is confirmed present in the bundled `uws_linux_x64_137.node`). That is std::terminate, so the whole process and every room dies.
- **Why latent:** no M0 route has a `:param` (`/healthz`, `/readyz`, `/v0/hello/join`, `/v0/spike/join`). The first M1 route (`POST /v1/contracts/:id/join`) would make it **blocking**.
- **Fix:**
  - Attach `res.onAborted` first.
  - Wrap the header/param copy in try/catch, and on failure `send(...400 BAD_REQUEST...)`.
  - Use a safe decode helper that returns `null` on `URIError`.
  - Add a unit test with a malformed `%` sequence on a param route.

### N4. `ROOM_REQUEST` frames for unknown types bypass the violation counter and reflect the type string

- **Where:** Colyseus `RoomMessages.onRequest` (core 0.18.28 `build/RoomMessages.mjs:166-191`). An unknown type gets an `ERROR` reply that embeds the client-supplied type string (up to about 2 KB). It never reaches `onMessage("*")`, so `hello-room.ts:103` / `load-test-room.ts:190` `violation()` never counts it.
- **Effect:** the only limit is `maxMessagesPerSecond = simTickHz*4` (80/s). That allows about 160 KB/s of 1:1 reflected egress per socket without a kick.
- **Note:** `nanoevents` and `validators` are null-prototype in 0.18.28, so `__proto__`/`constructor` types are safe.
- **Fix:**
  - Set `onUnhandledMessage` on the rooms, or override it, to count a violation.
  - Or lower `maxMessagesPerSecond` to the real per-connection budget (netcode.md §11), for example `simTickHz + PING_MAX_PER_SECOND + small slack`.

### N5. The PING rate-limit overflow is dropped but never counted as a violation

- **Where:** `hello-room.ts:145-148`, `load-test-room.ts:368-371`.
- **Effect:** a client can send 80 PINGs/s indefinitely. Each one costs a dispatch, but there is no reply, so egress is fine. This is cheap work, but it is unbounded duration abuse that netcode.md §11 says should close with 4104.
- **Fix:** call `this.violation(client)` on overflow (it trips at more than 50 per 10 s).

### N6. The spike options accept a `snapshotHz` that does not divide `tickHz` (spike only, `NET_SPIKE=1`)

- **Where:** `net/spike/options.ts:28`. The refine checks only `<=`, so `{tickHz:30, snapshotHz:20}` passes. The env path (`ops/env.ts:157`) and `assertRates` require divisibility.
- **Effect:** an uneven frame cadence in measurements. This is not a security issue, because the spike is refused in production (`ops/env.ts:172`).
- **Fix:** refine `o.tickHz % o.snapshotHz === 0`.

### N7. `BitReader.skipBytes` accepts negative and non-integer counts

- **Where:** `packages/protocol/src/codec/bits.ts:176-183`.
- **Effect:** none today, because callers pass constants. Once a decoder passes a wire-derived length, a negative or NaN value could move `bitPos` backwards or make it NaN, which turns into an infinite-loop or garbage risk.
- **Fix:** guard with `if (!Number.isInteger(bytes) || bytes < 0) { this.error = true; return; }`. Do the same for `readBits` with `bits` outside 1..32.

## Checked and OK

- **REST body handling** (`http-routes.ts`):
  - The 16 KB cap applies both to the declared Content-Length and to the streamed total. Chunks are copied, and the `onData` listener is attached synchronously.
  - Malformed JSON returns 400, and handler errors return 500 with no stack.
  - Unknown paths get a 404 via a fallback registered after Colyseus' `listen()`. Colyseus' unbounded body buffering in `bindRouter` is shadowed by that fallback, and `exposedMethods = []`.
  - uWS's HTTP idle timeout bounds slow bodies.
  - `JSON.parse` `__proto__` keys are own properties, and zod strips unknown keys.
- **CORS** (`cors.ts`): exact allowlist, `*` rejected at build time, no credentials, `Vary: Origin`. Only `/healthz` is public. Preflight returns no headers for a disallowed origin.
- **WebSocket upgrade:**
  - Origin is enforced before the socket opens. A missing Origin is refused.
  - The inbound payload cap is 2048 B.
  - Colyseus requires a live seat reservation. The ~53-bit `sessionId` and the 15 s reservation make hijacking impractical.
- **`client-ip.ts`:** right-most XFF entry, a length and charset filter on the value, never the left-most entry.
- **Protocol version:** checked by equality in `onJoin` and closed with 4100 plus `{serverProtocol, serverBuild}`. The `BUILD_ID` max keeps the close reason ≤123 bytes (`payloads.ts:70-73`). `JoinOptionsSchema` bounds `protocolVersion` to u16 and `clientBuild` to a charset/length.
- **Room cap 6:** `maxClients = MAX_PLAYERS_PER_ROOM` in both rooms, plus a seat-index guard in LoadTestRoom (`load-test-room.ts:205-209`). `game-server.test.ts:226` covers it.
- **Codecs** (`ping.ts`, `spike.ts`, `bits.ts`): exact or maximum length checked before reading, no allocation from wire lengths, range checks (−128, pitch, button mask), and the dust header must match the body length exactly. Writers clamp NaN/Infinity. Readers never throw.
- **Colyseus message path** (verified in source):
  - Malformed msgpack makes only that client leave.
  - Truncated type fields do not throw (`decode.number` returns `undefined` and routes to `*`).
  - Handler throws are caught in `#dispatch`.
- **Env** (`ops/env.ts`):
  - Secrets need at least 32 characters.
  - Error messages carry keys only.
  - `describeEnvForLog` masks the database URL, CA, JWT secrets, pepper and Sentry DSN.
  - `NET_SPIKE=1` is refused in production. Memory persistence is allowed only locally.
- **Entry** (`app/index.ts`): an env failure prints keys only. The fatal handlers exit 1.
- **Shutdown** (`app/shutdown.ts`): idempotent, 25 s budget under Render's 30 s SIGKILL, clears its timer, and errors exit 1.
- **Health** (`api/health.ts`):
  - `/healthz` exposes env name, build, protocol version and uptime. That is acceptable: build and protocol are needed for the mismatch UX.
  - `/readyz` exposes `schema` (`prod`), `dbState` and room counts. This is low-sensitivity, but consider dropping `schema`/`dbState` from the public body or answering them only to allowlisted origins (minor).
  - The DB probe is cached for 10 s and coalesced, so `/readyz` cannot be used to hammer Aiven.

### N8. Client URL params can point the bench and look-dev terrain loaders at an attacker origin in production builds

- **Where:**
  - `apps/client/src/render/bench/options.ts:64`: `terrainBase` is taken verbatim, and absolute URLs are allowed.
  - `apps/client/src/visuals/lookdev/s01-approach.ts:95-98`: `?terrain=<base>` is passed to `loadTerrain`.
  - `apps/client/src/app/launch-policy.ts:12-14,27-30` routes `bench`, `verify` and the look-dev scenes with no `import.meta.env.DEV` gate.
  - `render/bench/terrain-loader.ts:66-76` builds `${baseUrl}${manifest.file}` with no file-name check. Compare the plugin's `PAYLOAD` regex.
  - `render/bench/terrain-cube.ts:57,91` inflates before checking any size limit.
- **Sketch:** a link to `https://<prod>/?scene=bench&terrainBase=https://attacker.onrender.com/`.
  - The `vercel.json` `connect-src` allows `https://*.onrender.com`. The per-environment meta CSP that narrows this to the exact server origin (security.md §4.4) is **not implemented**: rg finds no CSP in `index.html` or `vite.config.ts`.
  - So the victim's tab fetches an attacker manifest and attacker binaries, and inflates them on the main thread. A deflate bomb crashes or freezes the tab, and the attacker can show spoofed terrain.
- **What it cannot do:** run script (the files are parsed as data), send credentials (no cookies; the refresh token lives in `localStorage` and is not attached to fetches), or touch the server.
- **Severity:** low.
- **`/@fs/`:** it only works on the Vite dev server. In production, `terrainBase=/@fs/...` is just a same-origin 404 that falls back to the stand-in.
- **Fix:**
  - Gate `bench`/`verify`/look-dev routing and the `terrainBase`/`terrain` knobs behind `import.meta.env.DEV`, or a `VITE_ENABLE_DEV_SCENES` flag that is off in production.
  - Otherwise, accept only same-origin relative paths: `new URL(v, location.origin).origin === location.origin`.
  - Validate manifest `file` against `^(height-cube-(256|1024)|horizon-map)\.[0-9a-f]+\.bin$`.
  - Cap the inflated size, for example from the header `n`/`m` before inflating, by aborting the stream past the expected length.
  - Implement the §4.4 meta CSP (owner: devops/client).

### N9. In dev, the Vite server exposes `assets/terrain/raw` through `/@fs/` even though the plugin never serves it

- **Plugin:** `apps/client/vite/terrain-assets.ts` is sound.
  - It serves only exact names from the manifest allowlist (`includes(name)`), so `../`, encoded traversal and `raw/` all fall through to `next()`.
  - The bundle emits only the listed files.
  - A malformed `%` throws inside the connect middleware, which connect catches (500), so there is no crash.
- **Vite itself:** Vite's default `server.fs.allow` is the detected workspace root, so `/@fs/<abs>/assets/terrain/raw/...` and any other repo file are served by the **dev** server. The render README even recommends `/@fs/`.
- **Exposure:** localhost only (no `server.host`), dev only, and never in `dist` or preview. It is low risk, but it contradicts the intent that "raw must not be reachable".
- **Fix:** set `server.fs.deny: [".env", ".env.*", "*.{crt,pem}", "**/assets/terrain/raw/**", "**/assets/terrain/cache/**"]` in `vite.config.ts`, or narrow `server.fs.allow` to `apps/client` plus `packages`. Update `render/README.md:111-134` now that the plugin serves `/assets/terrain/`.

### N10. The migrate CLI does not require `DATABASE_CA_CERT` outside local (TLS asymmetry with the server)

- **Where:** `packages/db/src/config.ts:41-56` and `connection.ts:55`.
- **Asymmetry:** the server env refuses to run without a CA when `ENV_NAME != local` (`ops/env.ts:165`). The Render build migrate step accepts a missing CA. In that case `ssl` is never set, so postgres.js uses only what the URL's `sslmode` says. That means no TLS, or `require` without verifying the CA or hostname, which contradicts security.md §4.3.
- **Fix:** in `planMigrationFromEnv`, treat a missing `DATABASE_CA_CERT` as invalid unless `ENV_NAME === "local"`. Add a test.

### N11. The `.env.example` placeholder secrets pass validation

- **Where:** `apps/server/.env.example:40,45`. Both placeholders are 32 characters or longer.
- **Effect:** a production env copied from the template would boot with publicly known JWT and pepper values.
- **Fix:** in `ops/env.ts`, reject values containing `replace-me` (or any known placeholder) when `ENV_NAME === "production"`.
- **Note:** this is not a real secret leak; the values are placeholders. No real secret was found anywhere in scope.

### Checked and OK (rest of the scope)

- **DB:**
  - The only raw SQL is `create schema if not exists ${sql(config.schema)}` (identifier-escaped, `SAFE_SCHEMA_RE` plus the `prod|staging` allowlist) and the probe `select 1`. Everything else goes through Drizzle.
  - Migration 0000 is forward-only DDL.
  - The migrate retry stops after 12 attempts, and only unreachable error codes are retried.
  - `rejectUnauthorized: true` is set whenever a CA is given.
  - Errors are logged by code only, and the CLI prints no URL.
- **Logging:** the pino hooks deep-redact secret-named keys, URIs, PEM blocks and tokens (`ops/redact.ts`). The Colyseus logger is the same pino instance.
- **Client net** (`net/session.ts`):
  - Server URLs come only from `VITE_SERVER_*` and are protocol-checked (`app/config.ts:31-43`); no URL param affects them.
  - `/healthz` is zod-validated.
  - Requests carry no tokens or credentials.
  - Minor: the `/v0/hello/join` reservation JSON is cast, not validated. Add a zod schema before M1's authenticated version.
- **`launch-policy.ts`:** scene ids are matched against fixed lists, and the backend/preset knobs are enums. No injection.

## Next

1. **B1** (server-net owner): enforce `MAX_ROOMS`/`MAX_CLIENTS` at both join routes and the per-IP WebSocket cap at `beforeUpgrade`, and lower `maxBackpressure`. Do this before any hosted deploy with HelloRoom.
2. **N3** before the first `:param` route lands (M1 contracts join).
3. **N1/N2** with the live Render header check (M0-W3-T01).
4. **N8/N9** (client/devops): dev-gate the debug scenes and terrain URL knobs, and add `fs.deny` and the meta CSP.
5. N4-N7, N10 and N11 as hardening.
