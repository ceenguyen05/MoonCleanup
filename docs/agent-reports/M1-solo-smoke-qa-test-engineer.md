# M1 solo smoke (first real-browser run): qa-test-engineer

Date 2026-11-15. Status: PARTIAL. Headless Chromium 158, software WebGL2 only (no WebGPU adapter: "No available adapters").
Dev server :5190 (stats) and production build via `vite preview` :5191 (chunks); both stopped. No product code edited.
Tools added: `tools/screenshots/src/smoke/solo-smoke.mjs` (`node ... <baseUrl> <query> [soakSec] [webgl2|webgpu]`) and `turn-dir.mjs`.
Output JSON/PNG: `tools/screenshots/output/solo-smoke/`.

## Results
| Check | `?play=1` | `?scene=dust&bot=0` |
|---|---|---|
| Boots, pointer lock on first click | PASS | PASS |
| Canvas changes within 2 rAF of holding W | PASS (pixel-profile; avatar position not directly observable) | PASS |
| Mouse-right turns right on screen | PASS (dx +4px: content shifts left, -5/-6 col; -dx reverses, +6) | PASS (-5, then +5/+5) |
| Tool hold changes dust | NOT PROVEN: delta 3836 in prod play=1, 0 on dev and dust scene | NOT PROVEN (0) |
| Console errors | prod: none. dev: ERR_CONNECTION_REFUSED (guest auth to localhost:2567, no server) | none |
| Online launcher visible | PASS (133x40 px, `data-testid=online-launcher`) | PASS |
| Online chunks loaded in solo (prod network list) | none (no net/online chunk) | none |
| Heap growth 60 s (dev, post-gc) | 64.1 -> 66.3 MB (+2.2 MB, flat after 30 s) | 99.8 -> 101.0 MB (+1.2 MB) |
| Frame ms p50/p95 (SwiftShader) | 123 / 142 (~8 fps) | 320-380 / 400-1300 (~2-3.5 fps) |

Frame times come from software rendering at renderScale 0.55, tier C. They say nothing about real GPUs and prove no budget either way.
Heap allocation is JS-heap only; per-frame allocation rate was not measured (no allocation profiler).

## Findings / defects
1. **D1 (minor):** `?play=1` in production makes solo POST `/v1/auth/guest` to `http://localhost:2567` (two requests) at boot, even with no server. In deployed solo this is an automatic network call to the Render service, which may cold-start or fail. Check it matches the intended "Nothing goes online" copy and does not block the solo path. Repro: open `?play=1` on the preview build and watch the network tab.
2. **D2 (harness gap):** no client hook exposes avatar pose, tool-stroke acks or dust revision. So "position changes on the next frame" and "strokes reach the worker" are checked only by pixels. Request: a `__mcGameplay()` readout (pose x/y/z/yaw, last input seq, stroke count, dust revision), dev/perf only. With it, the tool check becomes deterministic.
3. **D3 (inconclusive):** tool hold produced no pixel change on the dust scene or on dev. Either the tool is not equipped or active at that point, the effect is under the 240x135 sampling, or strokes do not reach the worker. Needs the D2 hook.
4. **D4 (minor):** `WebGL: INVALID_OPERATION: beginQuery: a query is already active` warnings (dev and prod, repeating) from GPU timer queries on the SwiftShader WebGL2 path. They are warnings, not errors, but they are noise in the console.
5. Production build has no `__mcStats` (debug module is dev/perf only), so p50/p95 in production need `?perf=1`.
6. Not covered: WebGPU path (no adapter in headless; run `solo-smoke.mjs ... webgpu` on a real-GPU machine or via the gpu lane), real-GPU frame times.

Next: lead to decide D1 and request D2; rerun on real GPU.
