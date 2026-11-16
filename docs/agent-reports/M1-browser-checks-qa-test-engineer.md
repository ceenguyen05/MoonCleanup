# M1 browser-only checks (qa-test-engineer)

Date 2026-11-15. Headless Chromium, **software WebGL2 (SwiftShader), not real GPU**; Node 26; dev server :5461 (stopped). No src edited.
Tools: `tools/screenshots/src/smoke/browser-checks.mjs <baseUrl> [soakSec]` (output `tools/screenshots/output/browser-checks/result.json`), `apps/client/e2e/readout-bench.test.ts` (`pnpm exec vitest run e2e/readout-bench.test.ts --disableConsoleIntercept`, NODE_OPTIONS=--expose-gc).
Harness note: the app exposes no UI store and no Settings opener. The script wraps the dev response of `ui-store.ts` via a Playwright route to publish `window.__qaStore` and dispatches `menus.open settings`. In the shipped app nothing opens Settings yet (only the sandbox preview does).

## Results
1. **Gamepad capture: PASS (software-GPU).** Injected `navigator.getGamepads` + `gamepadconnected`; clicked the Hop pad cell ("A" -> "Press a button..."), pressed Pad9 -> cell "Start", note "Hop is now Start.", stored `"Pad9":"jump"`, controls screen stayed open (no nav leak).
2. **Persisted settings reload: PASS.** UI size 130 -> localStorage `mc.settings.hudScalePct=130`, `--mc-hud-scale` 1 -> 1.3 and still 1.3 after reload; quality Medium saved, selected after reload and `__mcInfo.preset=medium`; Hop key Space -> J and pad A -> Start both restored after reload. 0 console errors. (An earlier run showed errors only because I dispatched a nonexistent action; test bug, fixed.)
3. **Worker readout profiling: PASS (numbers).**
   - Browser (software-GPU, main thread ~1 fps so gap/timing unreliable): message `t:"ro"` ~836 B JSON each; idle and walking 0 msgs in 15 s (change-only works); 6 hop/lamp/plot-card toggle rounds gave 6-9 msgs in ~16-22 s (0.4/s). Main handler cost below timer resolution (<=0.1 ms, mean 0.017 ms in one run).
   - Node, real sim + real `ReadoutSampler`, 120 s scripted workload: 47 posts (0.39/s, never above 10 Hz), 791 B/post (~310 B/s), full sample 29 us mean (about 0.03% of one core at 10 Hz), not-due early-out ~0.66 us, unchanged-sample allocation ~740 B/call (Node heapUsed delta; about 7 KB/s at 10 Hz; includes JIT warm-up noise).
   - Not measured: structured-clone deserialize cost on main, real-GPU numbers, worst-case 10 Hz continuous change.

## Defects / notes
- N1: no player-reachable Settings entry in the full app (only via store dispatch), so checks 1-2 were driven programmatically, not by clicking a menu button.
- N2: the readout sampler allocates ~740 B per due call even when nothing changed (worker thread, 10 Hz); small, but not zero-alloc.
- Readout bench file lives in `apps/client/e2e` and is picked up by `pnpm test` (runs ~9 s); move or tag it if too slow.
