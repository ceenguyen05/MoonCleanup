# M0-W1-T06 (+ M0-W0-T05) Integration: hello-world client + server

Status: **PARTIAL / verify FAIL (defects in other owners' paths)** / 2026-11-12 / integrator (Sonnet 5.5). Node 26.13.1, Windows 11, Intel UHD 620.
Client and server composition roots work end to end; `pnpm verify` is red only because of two defects outside my paths (section "Returned to owners").

## Wiring changes (my paths only)

Client `apps/client/src/app/`: `boot.ts` (replaces stub; `bootApp()` + `boot()`), `config.ts` (VITE_* + `?wake ?hud`), `event-bus.ts`, `service-registry.ts`,
`ui-store.ts` (queued actions, publish <= 15 Hz), `services.ts` (`ClientServices extends RenderServices`, `REQUIRED_SERVICES`), `modules.ts`
(`AppNetModule` adapter around `createNetSession`, `AppUiFlushModule` placeholder until the real ui module), `overlay.ts` (DOM: build, backend,
tier, preset, server state + RTT; `data-*` hooks), `error-boundary.ts` (banner, fatal and unsupported screens, window error/unhandledrejection), `app.test.ts` (7 tests).
- Module order = `CLIENT_MODULE_IDS`; only render, net, ui exist (the rest are absent, not stubbed). Frame loop = render's `FrameLoop`. `installHarnessHooks` called after `loop.start()`.
- Net wakes on first `pointerdown`/`keydown` (never on load, netcode 10); `?wake=1` wakes at boot with `allowAutomation` for e2e. `input`, `sim`, `assetLoader` services are NOT registered (no owners yet).
- `smokeScene: true` is passed to `RenderModule`: the hello scene is the built-in parity mesh (otherwise the canvas is black and the e2e non-black check fails).
- Overlay hidden for `?capture=1` unless `?hud=1|dbg`; `?hud=0` hides.

Server `apps/server/src/app/`: `index.ts` (entry: env -> fail fast, uncaught/unhandled -> fatal log + exit 1), `server.ts` (`startServer`: env, logger, process probe + StatsReporter,
lazy `createDbConnection`, `createHealthRoutes`, `createGameServer`, listen; `/healthz` live as soon as the port binds), `shutdown.ts` (SIGTERM/SIGINT: draining flag, game server
shutdown, db close, 25 s budget, exit 0/1), `shutdown.test.ts` (3), `server.test.ts` (1: boot on a free port, health/ready 200, drain turns `/readyz` 503, shutdown closes the listener).
Sentry is not initialised (no policy/redaction decision yet): NOT DONE, listed below.

## Contract versions and consumers (as wired)

| Contract | Version | Consumed by the app |
| --- | --- | --- |
| `client/module` | v0 | ServiceRegistry impl, module order, `ClientServices` narrowing (compiles without casts) |
| `events/catalog` | v0 | EventBus impl; overlay listens `render.backendSelected`, `quality.changed`; net adapter listens `net.status` |
| `ui/store` | v0 | `createUiStore`; overlay subscribes, net adapter dispatches `session.set` |
| `api/rest` | v0.1 | server health routes mounted through `createGameServer` |
| render/net/ops module barrels | M0-W1 | as in the T01/T02-T04 handoffs |

`render.backendSelected` semantics (asked in T01): the render module re-emits it when a recreated renderer lands on another backend or tier; the contract comment (`events/catalog.ts` "Emitted once") says once. My app only mirrors the latest value so both work; contracts-architect should reword the comment to "at boot and again when a recreated renderer changes backend or tier" (proposal, not edited). 

## Gates (raw numbers)

| Gate | Result | Evidence |
| --- | --- | --- |
| client tsc / eslint / vitest | PASS | tsc exit 0; eslint clean; 7 files, 97 tests pass (incl. 7 in app) |
| server eslint / vitest | PASS | eslint clean; 8 files, 78 tests (incl. 4 in app) |
| server tsc | **FAIL** | 9 x TS5097 `packages/db/src/*.ts` imports end in `.ts`; `apps/server/tsconfig.json` lacks `allowImportingTsExtensions` (verified: with it added in a temporary tsconfig, tsc is clean) |
| client `vite build` | PASS | 235 modules, `dist/assets/index-*.js` 1,126.58 kB (316.95 kB gzip); chunk > 500 kB warning (three bundled in one chunk); `size:check` not run |
| server esbuild build | PASS (build) / **FAIL (run)** | `node build.config.mjs` writes 3.7 MB, but `node dist/index.js` fails: `SyntaxError: Identifier 'createRequire' has already been declared` (banner collides with a bundled import). Fix in `apps/server/build.config.mjs`: banner `import { createRequire as __mcCreateRequire } from "node:module"; const require = __mcCreateRequire(import.meta.url);`. With that banner (applied through the esbuild CLI, not committed to the file) the server booted: `bootMs` 110, `/healthz` 200, `/readyz` 200 (`dbState` not-configured, memory mode), env log redacted |
| Playwright smoke (ci lane, offset 5, `MC_REQUIRE_CANVAS=1`, `MC_SERVER_URL=http://localhost:2572`) | PASS | 3 passed (16.8 s): title/no console errors (10.2 s), canvas non-black + `__mcReady` + backend logged (13.3 s), `/healthz` (143 ms). First cold run failed (black canvas before `smokeScene`; cold vite) |
| Local client <-> server join with RTT | PASS | Playwright probe `?wake=1`: overlay `server connected | rtt 14 ms` (later 110 ms under SwiftShader load); backend webgl2, tier C, preset low |
| Harness capture, ci lane | PASS (mechanics) | `smoke-noon-tierA-high-webgl2-1920x1080@1-nohud.png` + sidecar, 2 draws / 21 triangles; in scratchpad `.../scratchpad/shots/`. Filename and sidecar say tier A/high because the harness writes the requested labels, not the detected tier (actual: C/low). **Not a Tier A claim.** |
| Harness capture, gpu lane (headed Chrome, UHD 620) | PASS (mechanics) | backend `webgpu`, gpu `Intel UHD 620 D3D11`, avgMs 5.81 (stepped, not a perf verdict), 2 draws; scratchpad `shots-gpu/`. One 404 console error (probably favicon; not identified) |
| `pnpm verify` (`turbo run lint typecheck test build`) | **FAIL** | first run aborted at shared typecheck (9 ok / 29); second run with `--continue`: 49 of 52 tasks successful; failed: `@moon-cleanup/server#typecheck`, `@moon-cleanup/shared#typecheck`, `@moon-cleanup/shared#test`. Log: `%TEMP%\verify2.log` |

## Returned to owners (not edited by me)

1. **devops-engineer** `apps/server/tsconfig.json`: add `"allowImportingTsExtensions": true` (and `"erasableSyntaxOnly": true` like `packages/db/tsconfig.json`). Blocks server typecheck as soon as the server imports `@moon-cleanup/db`.
2. **devops-engineer** `apps/server/build.config.mjs:16` banner: `createRequire` duplicate identifier; the bundle cannot start. Use the aliased import above.
3. **game-data / contracts owner** `packages/shared/src/config/bundle.schema.test.ts` (lines 719-783: TS2790 `delete` of non-optional, TS2344 at 751-752) and 2 failing tests: "v1-shaped tables (no v1.1 optional fields) still parse", "logistics: the Field Gate is a Bale acceptor...". Not touched by this task (config contract v1.2 work).
4. **netcode-engineer** `apps/client/src/net/session.ts`: Colyseus SDK warns `onMessage() not registered for type 'hello'`; register a HELLO handler (or ignore explicitly).
5. **qa-test-engineer** `tools/screenshots`: (a) `pnpm ... screenshots -- smoke` passes a literal `--` that swallows the scene (use `--scene smoke`); (b) sidecar/filename tier and preset are the requested labels, record `__mcInfo().tier/preset` instead; (c) `tests/e2e/specs/smoke.spec.ts` test 1 has a 60 s limit that a cold Vite start can exceed on SwiftShader.
6. **contracts-architect**: reword `render.backendSelected` comment (above); no catalog event for device loss (T01 request) still open.

## NOT RUN / open

- SIGTERM drain on a real signal: Windows does not deliver SIGTERM to a Node handler. Covered by unit tests (budget, exit codes) and by `startServer().shutdown()` test; real-signal run NOT RUN (needs Linux CI/Render). The 25 s budget and "SIGTERM saves" (no persisted state in M0) are not exercised against live rooms.
- Real database: `/readyz` against Postgres BLOCKED (no database); memory mode only.
- Netsim, bots, bandwidth and perf gates: N/A for hello world (no measurement run; frame times above are SwiftShader/stepped noise).
- Tier A/B/C verdicts, WebGPU device loss, DPR > 1, resize in browser: NOT RUN. Colyseus 6th/7th client room cap exercised only by T04 unit tests (cap = 6), not by the app.
- Sentry (client and server): not initialised. `input`/`sim`/`assetLoader` services, real net/ui modules: not present.
- VT-M0-01 / VT-M0-09: captures exist (above) for visual-qa review; no verdict by me. Reviews (`code-reviewer`, `netcode-security-reviewer`) not requested by me.
- Rerun after fixes 1-3: `pnpm verify` (one final run) and the live server boot from `dist/index.js` (`ALLOWED_ORIGINS`, JWT/pepper >= 32 chars, `PERSISTENCE_DRIVER=memory`, `PORT=2572`).

## Recommendation

Do not mark M0-W1-T06 done yet. After owners fix items 1-3, rerun `pnpm verify` and one server start from `dist/index.js`; everything else in the card (composition roots, overlay, error boundary, `__mcReady`, smoke, join with RTT, capture on both backends) is demonstrated above.
