# M0 quiet-machine runs (qa-test-engineer, 2026-11-13)

Status: DONE (lead closed Run 2 from the saved device report after the worker hit a usage limit). All numbers provisional (Windows loopback, tsx, laptop).

## Run 1: post-fix clean 30/15, 600 s, 6 bots: PASS
Real server entry (tsx, NET_SPIKE=1, ENV_NAME=local, memory, throwaway secrets, port 2571), `pnpm bots -- spike-16 --netsim none --tick 30 --snap 15 --duration 600 --bots 6`. Files: `tools/bots/results/M0-quiet/M0/clean-30-15-postfix.{json,md}`, `tools/bots/results/M0-quiet/clean-30-15-postfix.server.log`. Server stopped after (2571 no listener).

| Metric | Post-fix (now) | Pre-fix 30/15 (T04) | Budget |
| --- | --- | --- | --- |
| Tick p50 / p95 / max | 0.13 / 0.514 (worst 1 s window p95 0.514) / 3.58 ms | 0.16 / 0.72 / 4.41 | p95 <= 3.5: PASS |
| KB/s per client, mean | 2.95 (bot side), 3.03 (server windows) | 2.92 | |
| KB/s per client, worst window | 4.57 (server log, ~10 s windows, 59 windows) | 4.69 | <= 5.0: PASS (0.43 headroom) |
| Snapshot rate | 15.00 Hz | 15.00 | |
| Resyncs / unexpected drops | 5 / 0 (7 joins, 1 scripted reconnect) | 10 / 0 | |
| Event loop p99 max / CPU max of 0.1 quota | 35 ms / 46.9 % | 75 % (typical run) | |
| Bot heap growth | 1.8 MB | | |

Verdict: bandwidth peak essentially unchanged (4.57 vs 4.69, within noise), still tight against 5.0; tick better. Late-input drops, desync, server RSS remain n/a in the spike protocol.

## Run 2: device report (UHD 620, 2026-11-13, scale pinned 1.0 = worst case; provisional)
Files: tools/perf/results/device-reports/8503205715bc.{json,md} (anonymous). Tier detector chose webgpu / tier B / preset low. Bench: webgpu low 28.1 fps (frame p50/p95 34.8/53.1 ms, GPU p95 33.5), webgpu medium 24.2 fps (41.1/55.0), webgpu high 9.2 fps; webgl2 medium 28.8 fps (31.1/60.2). S01 (stand-in ground) 2.9-3.8 fps on every preset. Six webgl2 cells FAILED with page.goto timeouts (bench low/high, s01 low/medium/high) = NOT MEASURED, probably backend=webgl2 page recreation + contention; rerun needed. Verdicts: every captured row FAILs the budgets at scale 1.0 (expected on an iGPU at full resolution); the shipped default uses the dynamic render-scale controller (typical scene sustains ~30 fps on Low at 0.75, see M0-W3-T08), so these are worst-case numbers, not the play experience. Tier A/B rows stay provisional/BLOCKED until run on matching hardware.
## Run 2b: six failed webgl2 cells re-run (provisional, UHD 620, scale pinned 1.0)
Cause: `oneRun` used `page.goto(..., {waitUntil:"load"})` with Playwright's default 30 s; the Vite dev server transforms modules on first request and the webgl2 boot on the iGPU can miss `load` by seconds (bench medium happened to fit). Fix (tools/perf/src/capture/runner.ts only): `waitUntil:"commit"`, timeout = readyTimeoutMs (60 s in device-report), retry once; readiness is still the app's `__mcReady` (and `__mcBench.ready`) wait right after. No goto timeouts on re-run. (Five cells were listed as failed, rerun 5: bench low/high, s01 low/medium/high; bench medium came from Run 2.) Files: tools/perf/results/device-reports/8aea5f4a797d.{json,md} (anonymous, no user/path strings; contains only these 5 cells).

| Scene / backend | Low | Medium | High |
| --- | --- | --- | --- |
| bench webgpu | 28.1 fps, p50/p95 34.8/53.1 ms | 24.2 fps, 41.1/55.0 | 9.2 fps |
| bench webgl2 | 25.5 fps, p95 78.6 ms | 28.8 fps, 31.1/60.2 | 13.1 fps, p95 113.1 |
| s01 webgpu | 2.9-3.8 fps (all presets, Run 2) | | |
| s01 webgl2 | 4.9 fps, p95 421.3 | 4.7 fps, p95 383.6 | 3.7 fps, p95 321.4 |

Preset chosen by the game's detector: webgpu / tier B / low. Budget rows (provisional): iGPU floor Low WebGL2 bench FAIL (p95 78.6 vs 33.3 ms, 25.5 vs 30 fps, draws 378 vs 350); s01 FAIL (p95 421 ms, 4.9 fps). All other captured rows FAIL at scale 1.0 as in Run 2; Tier A/B and WebGPU rows have NO DATA in the 2b file (Run 2 holds them). Worst-case iGPU at full resolution, not the play experience. Note s01 ground at 3-5 fps on every preset/backend is the real outlier to investigate (render-perf), separate from the scale controller.
Cleanup: dev server and browsers exited with the run; no node/vite of mine remains; temp logs removed.
