# M1 verify round 4 (qa-test-engineer)

- verify (--concurrency=3 --continue): 49/52 tasks ok. Failed: client#test, screenshots#lint, server#test.
- client#test: 773 pass, 1 fail, 1 skip. FAIL src/render/dynres-pace.test.ts > "tolerates a few slow frames: 3 of 30 over the frame period is not 'over'": expected [] got [{atMs:1516.67, scale:0.75}]. Deterministic (fails in isolation). Source defect candidate in render/dynres.ts (pace guard steps down on 3/30 slow frames). Not fixed.
- server#test in verify: game-server.test.ts HelloRoom "sends HELLO ... answers PING" timed out 30000 ms. Passed in isolation (21/21) and in the full standalone server suite (28 files, 347/347). Classified flake (load under parallel verify).
- screenshots#lint: 15 errors in tools/screenshots/src/smoke/solo-smoke.mjs (window/document/requestAnimationFrame/getComputedStyle no-undef; diffBytes, p1 unused). Needs browser globals env or eslint-disable for page.evaluate bodies, plus removing unused vars.
- format:check: FAIL, 23 files (e.g. apps/client animation/avatar-animator.ts, foot-ik.ts, low-g-ik.test.ts, app/install-guard.ts, solo-host.ts, sim-host/*, vite.config.ts, client package.json; server app/server.ts, game-server.ts, shift-dust-pacing.test.ts, persistence.test.ts; db room-*.ts; protocol dust-messages.test.ts; sim cargo/checkpoint.ts; tools/screenshots smoke/solo-smoke.mjs, turn-dir.mjs). Fix: prettier --write.
- vite build: OK (5.3 s). Entry index-*.js 759,700 B (was 736,465, +23,235). vendor-three 1,063,271 B; sim.worker 362,810; vendor-react 360,993; vendor-online 169,929. size:check: first-load 15.78 MB gzip vs 20.00 MB limit, PASS. No per-chunk entry threshold exists in the script.
- Other packages all pass (config 187, shared 471, protocol 123, game-data 59, world 105, sim 153, db 129+2 skipped, bots 26, netsim 4, screenshots 47, perf 28, terrain-bake 23, balance-sim 17, asset-pipeline 11).
- Known flakes (dust-offload, admission-ws-rooms, uws-boot, seat-cap-idle, AN-M1-09): none failed.

## Rerun after fixes (dynres pace guard fix, screenshots lint fix, prettier on 23 files)
- pnpm verify --concurrency=3 --continue: 52/52 tasks successful, no failures, no flakes hit.
- format:check: clean. screenshots lint: clean (solo-smoke.mjs, turn-dir.mjs got browser-global headers; unused vars removed).

## Rerun 3 (menus UI / input gating / own avatar feed)
- verify: 52/52 successful. format:check: 2 files failed (client online-loop.integration.test.ts, tools/screenshots ui-menus-capture.ts), prettier --write applied, now clean.
- Solo smoke (vite dev :5199, ?play=1, webgl2 swiftshader, 15 s soak): no console errors, no pageerrors. Warnings only: WebGPU "No available adapters" (expected headless), ReadPixels stall, font preload unused, and "WebGL: INVALID_OPERATION: beginQuery: a query is already active for target" x2 (render timer-query overlap; low priority, render owner). Launcher visible, pointer lock ok, walk/mouse/tool change the frame. Swiftshader frame ~140 ms p50 (not a perf signal).
- Desk-with-E not exercised: smoke script has no hook for avatar position/Desk; needs a scene/teleport hook.

## Desk smoke (qa-test-engineer, round 5)
- New: `tools/screenshots/src/smoke/desk-smoke.mjs` (run: start `pnpm --filter @moon-cleanup/client exec vite --port 5421 --strictPort`, then `node tools/screenshots/src/smoke/desk-smoke.mjs http://localhost:5421/`; exit 1 on failure). Output: `tools/screenshots/output/solo-smoke/desk.json` (+ desk.png, best effort).
- Dev/perf-only hooks (absent in production): `__mcGameplayTeleportDir(x,y,z)` (gameplay/module.ts; shifts the PRESENTED avatar only, the sim avatar is not moved, purchases need no proximity), `__mcStations()` (app/boot.ts), and `?lm=N` fresh-game wallet (app/boot.ts `devWallet`; solo starts with 0 LM so nothing was buyable).
- Result (webgl2 swiftshader, :5421): all 8 checks pass: walk before, teleport, E opens `menu-requisitions_desk`, Holster Rig row present, Enter buys (wallet 500 -> 400, row status owned), Escape closes, walk after, no console errors.
- Notes: success shows no HUD notice (only rejections do), so the wallet change is the assertion. Vite does a dep-optimise full reload on first load, so the script tolerates a missing hook briefly. Screenshot while the Desk is open can time out under swiftshader (caught).

## Round 5: desk-smoke regression after integrator Round 5 (qa-test-engineer, 2026-11-15)
Status: DONE. No product defect: the failure was in the smoke script.

- **Root cause:** `desk-smoke.mjs` read `walletBefore` through `innerText` ("500\nLUMENS AVAILABLE", CSS uppercase and line break applied) but waited on `textContent !== walletBefore` ("500Lumens available"). The two always differ, so the wait returned at once and `walletAfter` was read before the purchase reached the UI. A real browser run with worker-message and DOM polling showed the chain works: click -> `intent purchase` -> worker `purchase.completed` (walletLm 400) -> `ss` walletLumens 400 -> Desk shows 400 / row `owned` about 0.7 s after the click. Pass 6 passed only because the UI flushed faster then. The readout channel, C rebind, controls-port, settings-storage, ui-intents and menu input gating are not involved.
- **Fix:** `tools/screenshots/src/smoke/desk-smoke.mjs` waits on `innerText !== walletBefore`, so both sides use the same text. No app, sim or UI source changed. Goldens are untouched because no sim code changed.
- **"Row button timeout" in later runs:** did not happen in 7 runs this session. It was most likely machine load during Pass 7; there is no evidence of a code cause.
- **Evidence (own server, vite :5470, Node 26.13.1):** desk-smoke 3/3 runs exit 0, every check ok, wallet 500 -> 400, `no-console-errors` []. solo-smoke `?play=1&perf=1` 15 s: exit 0. eslint on desk-smoke.mjs: 0. vitest, tsc and app eslint were not re-run because no app source changed (the Pass 7 batch evidence still applies). The dev server was killed (PID 37688; 0 listeners). The temporary debug script was deleted.
- **Regression test:** the fixed smoke is the regression check. No unit test applies because the bug was in the harness.
