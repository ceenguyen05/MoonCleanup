# M0-W2-T06 integrator report

2026-11-12, integrator (Sonnet 5.5), port offset 5. Card name is `M0-W2-integration.md`; the lead asked for this filename.
Status: wiring DONE; all runtime smokes PASS; `pnpm verify` **FAIL** (one lint failure in another worker's in-progress path, see Mismatches). Machine: one Intel UHD 620 laptop, so no Tier A/B claim.

## Wiring changes (app/** only)
- `apps/client/src/app/boot.ts`: `DebugModule` (from `../debug`) registered last, only when `import.meta.env.DEV` or `?perf=1`. The HUD starts visible only with `?perf=1`. `getLoop` is a getter for the `FrameLoop`, which is created after module init. `RenderModule` now gets `trackTimestamp: perfEnabled`. `?scene=bench` and `?scene=verify` are routed inside `RenderModule` (it creates the bench scene and drops the smoke mesh), so no extra app-side route code was needed. `ClientModule<RenderServices>` assigns to the `ClientServices` registry map with no cast.
- `apps/server/src/app/server.ts`: passes `loadTest: { enabled: env.netSpike, stats }` to `createGameServer`.
- `apps/server/src/app/server.test.ts`: new test: `POST /v0/spike/join` is 404 with `netSpike:false`, 400 (route exists) with `netSpike:true`.

## Gate results
| Gate | Result | Evidence |
| --- | --- | --- |
| client tsc / eslint (src/app, src/debug) / vitest | PASS | tsc exit 0; eslint exit 0; vitest 11 files / 133 tests |
| server tsc / eslint src / vitest | PASS | tsc 0; eslint 0; vitest 11 files / 95 tests (was 94; +1 spike-route test; `src/app` 2 files / 5 tests) |
| prettier on `src/app` (both apps) | PASS | "All matched files use Prettier code style" |
| client `vite build` | PASS | 274 modules; `dist/assets/index-*.js` 1,295.03 kB, 389.98 kB gzip (chunk-size warning, expected: render + bench + debug in one chunk) |
| server build (`pnpm build`) | PASS | `dist/index.js` 3.8 MB |
| e2e smoke `MC_PORT_OFFSET=5 MC_REQUIRE_CANVAS=1 pnpm test:e2e` | PASS | 2 passed, 1 skipped (`/healthz` test skips without `MC_SERVER_URL`); 29.1 s; CI (SwiftShader) lane |
| `?perf=1`, `?scene=bench&draws=350&preset=medium`, `?scene=bench&draws=200&preset=low&perf=1`, plain: browser smoke | PASS | Scratch script (session scratchpad `smoke.mjs`), Vite dev on 5178. CI lane (SwiftShader, webgl2): 0 console/page errors in all 4 pages; `__mcStats` present, HUD text rendered with `?perf=1`, GPU source `timer-query-webgl2`, `window.__mcBench` present on bench pages. GPU lane (headed Chrome, UHD 620, webgpu): `?perf=1` HUD "webgpu / tier B / medium / FPS 60.0, frame p50 16.7 / p95 19.1 ms", GPU source `timestamp-query`; bench+perf "FPS 51.9, p50 19.0 ms"; 0 errors on every page after the first-load 404 below |
| NET_SPIKE=1 spike via real server entry | PASS | `apps/server/dist/index.js` with NET_SPIKE=1, ENV_NAME=local, port 2572 (log "NET_SPIKE=1: LoadTestRoom registered"); `pnpm bots -- spike-16 --duration 60 --netsim none` 6/6 connected; results `tools/bots/results/M0/M0-W2-T06-integrated-clean-20-10.{json,md}`: 10.01 Hz snapshots, server tick p50/p95/max 0.2 / 0.651 / 4.623 ms, CPU % of 0.1 quota median/max 21.9 / 42.1 (noisy, Windows), event-loop p99 max 40.9 ms, 2.98 KB/s per bot (FRAME 2.29, DUST 0.58, patch 0.11), 7 joins / 0 unexpected drops, 1 scripted reconnect. Local, no CPU cap, loopback; not a hosted or 0.1-CPU number |
| `pnpm verify` (once) | **FAIL** | turbo: 28 of 40 tasks successful before abort. Only failure: `@moon-cleanup/client#lint` on `apps/client/src/render/verify/rows-gpu.ts` (6 errors: 5x "Unused eslint-disable directive" at 1:1 for no-unsafe-assignment / member-access / call / argument / return, and 16:3 `'PlaneGeometry' is defined but never used`). The remaining 12 tasks were aborted, not failed: output `scratchpad/verify.log`. Not re-run (single-verify rule and the file is mid-edit by another worker). |
| Docker `--cpus=0.1` spike | NOT RUN | optional; no Docker use attempted |
| first `/perf-check` capture (bench v0 results file via `tools/perf`) | NOT RUN | exact next step: `pnpm perf capture` against `?scene=bench&perf=1` on the gpu lane (headed Chrome); the HUD and `__mcStats` hooks it needs are now wired. `/verify` PASS depends on the verify scene task finishing |
| `spike-16` 10-minute run | NOT RUN | 60 s only, as the lead specified |

## Mismatches / defects returned to owners (not edited)
1. **render verify (rendering-engineer, worker a41c221b89157b085, concurrent):** `apps/client/src/render/verify/rows-gpu.ts:1` has five unused `eslint-disable` directives and `:16` has an unused `PlaneGeometry` import. Blocks `pnpm verify`. Fix, then run verify once.
2. **ops RoomStats CPU bug (backend owner, `apps/server/src/ops/room-stats.ts:52-133`):** a near-zero final window can print `cpuPercentOfQuota: 5000` (T03 report). Not in my paths, not fixed.
3. **ENV_NAME stale `staging`:** `EnvNameSchema` lives in `@moon-cleanup/shared` (imported at `apps/server/src/ops/env.ts:8`), and the doc comment at `apps/server/src/ops/logger.ts:13` still says "local | staging | production". Both are outside my paths; contracts-architect (schema) and backend owner (comment). `DB_SCHEMA_NAMES` `staging` at `ops/env.ts:15` is intentionally kept per its comment.
4. **Favicon 404 (client shell owner):** the first page load in headed Chrome logs "Failed to load resource: 404" because `apps/client/index.html` has no favicon link and `public/` has no favicon. Not an app/ issue.
5. **Bots default origin (qa-test-engineer):** bots send `Origin: http://localhost:5177` unless configured, so a server started with another `ALLOWED_ORIGINS` makes every join fail with an unhelpful 1006. Suggest a clearer error or a `--origin` flag in `tools/bots` (README note). Also: the run reported 1965 steering "resyncs" on a clean loopback network (T04 reported far fewer late drops); worth a look by the owner.
6. **Production bundle:** `?perf=1` works in production builds because debug is bundled (390 kB gzip total). The card says registered "in dev or with `?perf=1`", so this follows it; the size budget owner may want it code-split later.

## Open issues
- Verify must be re-run once after item 1 is fixed (nothing in app/ affects it: client lint on `src/app` and `src/debug` is clean, server lint/tests pass).
- Card acceptance still open: `/perf-check` first capture, `/verify` PASS, optional Docker run.

## Processes
Vite (5178), the spike server (2572) and the browsers were stopped; `netstat` showed no listeners on 2572, 5178 or 2582 before verify.

## Recommendation
Do not mark M0-W2-T06 done until item 1 is fixed and `pnpm verify` is green. Wiring and runtime smokes are good. The first `/perf-check` capture should then run on the gpu lane.

## Cleanup (2026-11-12)

- Room-stats CPU: `cpuPercentOfQuota` divided CPU delta by a few-ms final window (5000 %). Now returns 0 below `MIN_CPU_WINDOW_MS` (1000 ms) or for non-positive/NaN input; regression test in `apps/server/src/ops/stats.test.ts`.
- ENV_NAME `staging`: lives in `packages/shared/src/api/rest.ts:66` (`ENV_NAMES = ["local","staging","production"]`); not edited. Needed change: drop `"staging"` (then update `docs/architecture/environments.md:101` and any shared test). `ops/logger.ts` comment fixed; `DB_SCHEMA` `staging` stays (documented as valid but unused).
- Favicon: `apps/client/public/favicon.svg` + `<link rel="icon">` in `index.html`.
- Bots: default origin now `http://localhost:5173` (server `.env.example` value), new `--origin` flag, and join failures print a message naming ALLOWED_ORIGINS/the origin used.
