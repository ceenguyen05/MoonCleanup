Task M0 transport fallback (uWebSockets.js -> Colyseus ws) / done (pending lead review) / 2026-11-13 / netcode-engineer / Opus 5.5

Done: env TRANSPORT=auto|uws|ws (default auto; blank=auto; trimmed, case-insensitive; invalid -> readable error,
exit 1). auto lazily imports the uWS adapter; on any import/native-load/construction failure it logs ONE warn line and
boots Colyseus' WebSocketTransport behind our own Node http server with the same protections via the shared
`executeRoute` pipeline: 16 KB body limit (declared and streamed) -> 413 + `connection: close`; bad percent-encoding
in `:params` -> 400; exact-allowlist CORS, `/healthz` `*`, preflight on every path; trusted client-IP header rules
(socket mode = TCP peer); 404 fallback with Colyseus' router (`/`, `/__healthcheck`, `/matchmake`) stripped inside
the listening callback; origin 403 + per-IP socket cap 429 at upgrade (shared `beforeUpgrade`); room-create rate +
AT_CAPACITY 503 via Admission (unchanged); 2 KB payload; 128 KB backpressure (1 s sweep); header 10 s / request 15 s
timeouts; bind failure rejects. TRANSPORT=uws failure is fatal (no silent fallback). `createGameServer` is async and
exposes `transport`. ops/env.ts NOT edited (TRANSPORT parsed in net/transport.ts, read in app/index.ts).

Log lines (pino `msg`, live bundle runs):
- default/auto with uWS: `[net] transport=uws` (info), then `game server listening` / `server ready` with `"transport":"uws"`.
- TRANSPORT=ws: `[net] transport=ws (TRANSPORT=ws)` (info).
- auto fallback: `[net] transport=ws (uWebSockets.js unavailable: <first line of error, max 200 chars>)` (warn; also fields `transport`, `mode`, `reason`).

Packaging: apps/server/package.json: `uWebSockets.js` (same pin b1092c7) dependencies -> optionalDependencies; added
`@colyseus/ws-transport: 0.18.5` (already in the lockfile as core's optional peer; ws 8.22.2/express 5.3.0 already
present). `pnpm install --lockfile-only` diff only: apps/server importer gains `@colyseus/ws-transport` and an
`optionalDependencies` block for uWS; snapshot `uWebSockets.js@...` gains `optional: true`. No new packages, no
lifecycle scripts, allowBuilds/overrides unchanged. build.config.mjs: `splitting: true`, outdir `dist` (entry still
`dist/index.js`, chunks in `dist/chunks/`, dist cleaned first); `uWebSockets.js` stays external and is imported only
by the lazy uws-transport chunk (verified: entry has no uWS import). Not verified: pnpm skipping a FAILED git-tarball
fetch of an optional dep on Render (pnpm documents skipping failed optional deps; watch first build log).

Files: apps/server/src/net/{transport,uws-transport,ws-transport,node-http,limits,transport.test,game-server-ws.test}.ts
(new); net/{http-routes,game-server,index,admission.test,game-server.test}.ts, net/spike/{load-test-room.test,run-spike}.ts;
apps/server/src/app/{server,index,server.test}.ts; apps/server/{package.json,build.config.mjs,.env.example}; pnpm-lock.yaml;
docs/architecture/environments.md (TRANSPORT row).

Evidence (Node 26.13.1, Windows): tsc 0; eslint 0; prettier clean on touched files. Under heavy machine load (Fable
capture) app/server.test.ts' 5 s boot budget failed (10.4 s): the lazy adapter import now sits inside startServer and
vitest cold-transforms it there. Fix: that test warms `import("../net/uws-transport")` in beforeAll; the bundle itself
boots in 0.17-0.24 s. After the fix: vitest 14 files / 137 tests pass, 2 consecutive full runs (one under load)
(uWS suites pinned `transport: "uws"`; uws-boot unchanged; new: transport.test.ts env parsing + fallback decision,
game-server-ws.test.ts 24 total incl. origin 403, declared+chunked 413, bad-percent 400, per-IP cap 429 + release,
AT_CAPACITY 503 retry-after 30, HelloRoom join + HELLO, Colyseus router stripped, EADDRINUSE rejects).
`pnpm install --frozen-lockfile --offline`: up to date. `node build.config.mjs` OK. Live `node apps/server/dist/index.js`
(ENV_NAME=local, memory, throwaway secrets, port 2571), stopped after each: default -> uws, TRANSPORT=ws -> ws,
auto with uWS resolution blocked by an `--import` hook -> ws + warn line; each: /healthz 200
`{"ok":true,...,"env":"local"}`, denied-origin upgrade 403, /matchmake 404; port 2571 free afterwards.

HOSTING_GUIDE section 7 replacement (lead applies; guide was being edited concurrently) for the paragraph starting
`**uWebSockets.js (server transport).**`:
"**uWebSockets.js (server transport).** `uWebSockets.js` is an optional dependency installed from a GitHub tarball during the Render build. If the tarball cannot be fetched or the native addon cannot load, the server boots on Colyseus' built-in `ws` transport with the same protections (slightly more CPU per socket). The runtime log shows which one is live: `[net] transport=uws` (normal) or the warning `[net] transport=ws (uWebSockets.js unavailable: <reason>)`. To get uWS back, use **Manual Deploy -> Clear build cache & deploy**. `TRANSPORT=uws` makes a missing uWS fatal; `TRANSPORT=ws` forces the fallback."
Also row at line ~388 ("fatal today") can be closed; line 140 "uWebSockets.js install error" -> "`[net] transport=` line".

Blockers / requests: (a) ops/env.ts owner: add TRANSPORT to ServerEnv + describeEnvForLog (then app/index.ts passes
env.transport); (b) contracts-architect: optional `transport: "uws"|"ws"` in HealthResponse to show it on /healthz (log only now).

Commit suggestion: feat(server): fall back to the Colyseus ws transport when uWebSockets.js cannot load
