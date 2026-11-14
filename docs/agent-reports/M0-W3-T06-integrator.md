# M0-W3-T06 integrator (M0 closing integration)

Status: **in progress; steps 1-4 done (with open items below), step 5 (`pnpm verify`, `format:check`) see bottom** / 2026-11-12 / integrator, Sonnet 5.5. One Intel UHD 620 laptop (Chrome 157, headed): **no Tier A/B claim**.

## Wiring changes (all inside `apps/client/src/app/**`, `apps/client/vite*`)
- `app/boot.ts`: registers `new VisualsModule({ search })` after `render` and `new UiModule<ClientServices>({ store, win, search })` in place of `AppUiFlushModule` (removed from `app/modules.ts`). Module order is still the fixed `CLIENT_MODULE_IDS` order (render, visuals, net, ui, debug present).
- `app/launch-policy.ts` (+ `launch-policy.test.ts`, 5 tests): `planScene` (smoke mesh only for hello-world/smoke/hud-test/unknown ids; `bench|verify` stay in render, `s01|s05|s06` in visuals), `wantsTimestampQueries` (`trackTimestamp` only when `perf` is on, `navigator.gpu` exists and `?backend` is not `webgl2`), `integratedGpuPreset` (integrated GPU class never starts above Low unless `?preset=` is explicit). Applied right after the render module init (`applyIntegratedGpuDefault`), so visuals sees the final preset; event `quality.changed` source `detect`.
- `apps/client/vite/terrain-assets.ts` (new, plugin from the T07 follow-up, typed, no `any`) + `apps/client/vite.config.ts` (`plugins: [terrainAssets(repoRoot)]`, import with `.ts` extension to silence the native config loader warning). Verified: dev serves `/assets/terrain/manifest.json` (200, 7,082 B), `/assets/terrain/raw/ldem_16.img` falls through to the SPA html (not exposed); `vite build` emits `assets/terrain/{manifest.json, height-cube-256.3b5a..bin 601,663 B, height-cube-1024.0d70..bin 7,918,107 B, horizon-map.0600..bin 6,977,254 B}` and nothing else; `size:check` first-load group **15.43 MB gzip of 20.00** (the terrain adds about 15.5 MB raw; headroom 4.6 MB: if more assets land, move the 1024 cube/horizon map under `assets/deferred/`, lead decision).
- Quality default (step 3): UHD 620 detects as webgpu tier B, class `integrated`, recommended Medium; with the policy it starts on **Low (SMAA, 2 cascades 1024, scale range 0.5-0.75)**. Evidence: `?scene=bench`, `s01`, `s05`, `s06` on webgpu all report `preset=low`; webgl2 is tier C and Low natively. URL override: `?preset=low|medium|high|ultra` (existing `url-options`, wins over the policy) and `?scale=floor|ceil` (pins the dynamic-resolution end).

## Steps and gates
| Step / gate | Result | Evidence |
| --- | --- | --- |
| 1 wiring typecheck/lint/tests | PASS | `tsc -p apps/client` clean, `eslint src/app` clean, `vitest run src/app` 12 passed (2 files) |
| 1 scene routes | PASS for s01, s05, s06, bench, hud-test, hello world; **S02/S03 NOT ROUTED** | see mismatches |
| 2 terrain plugin | PASS | above (curl + `vite build` + `size:check`) |
| 3 UHD 620 default | PASS for preset (Low). **Adaptive render-scale NOT DONE (no hook possible in `app/`)** | see open items |
| 4 e2e smoke, `MC_PORT_OFFSET=5 MC_LANE=gpu MC_REQUIRE_CANVAS=1 MC_CLIENT_URL=http://localhost:5178/ playwright test` | PASS (2 passed, 1 skipped = /healthz without MC_SERVER_URL) | non-black canvas, `__mcReady`, backend logged, 0 console errors |
| 4 routes with 0 console errors (scratch driver, 1280x720, headed Chrome; `scratchpad/routes.mjs`) | PASS 0 console errors / 0 page errors on: hello world, `scene=s01`, `s05`, `s06`, `bench`, `hud-test&hud=0`, `bench&perf=1` on webgpu; `s01`, `s05`, `bench`, `bench&perf=1` on `backend=webgl2` | `__mcBench.ready` true on both bench lanes, `terrain=real`, webgl2 `perf=1` run has 0 warnings (the `beginQuery` warnings are gone) |
| 4 harness capture S01, S05 through the real app | CAPTURED, looked at | `docs/visual-reviews/M0/integration/S01-noon-tierB-low-webgpu-1280x720@1-nohud.png`, `S05-...` (+ json sidecars, `index.md`); `pnpm --filter @moon-cleanup/screenshots screenshots --scene S01,S05 --lane gpu --port-offset 5 --preset low --tier B --step 30`. Both render sky, Earth, props, lit clean/dust ground. Not a VT verdict (the harness passes no sun/time params; S05 default view shows the lab at its default sun, shadows barely visible). |
| 4 `?perf=1` HUD capture | CAPTURED | `docs/visual-reviews/M0/integration/S01-perf-hud-tierB-low-webgpu-1280x720@1-hud.png`: HUD reads webgpu, tier B, low, scale 0.75, GPU timestamp-query render p50 64.2 ms, draws 181, 0 console errors. The app overlay (`#mc-overlay`, top-left) is drawn under the HUD (cosmetic overlap). |
| 4 server graceful shutdown (programmatic) | PASS | `vitest run src/app` in `apps/server`: 5 passed (`shutdown.test.ts` SIGTERM drains once and exits 0, exits 1 on budget/throw; `server.test.ts` boots, `/healthz`, `/readyz`, drains). Real SIGTERM on Windows stays N/A. |

### Provisional frame times on this UHD 620 (headed Chrome 1280x720, rAF intervals over 10 s after 8 s warm-up, 1 run each, machine shared; rAF is vsync-quantised)
| Scene | Backend | Scale | p50 / p95 ms |
| --- | --- | --- | --- |
| S01 Low | webgpu | 0.75 (resting) | 66.7 / 83.4 |
| S01 Low | webgpu | 0.5 (`scale=floor`) | 49.9 / 50.2 |
| S01 Low | webgl2 | 0.75 | 66.7 / 66.8 |
| S01 Low | webgl2 | 0.5 | 33.3 / 50.1 |
| S05 Low | webgpu | 0.5 | 50.0 / 50.2 |

**The look scenes do not reach 30 fps on this iGPU even at Low and the 0.5 floor on webgpu.** Together with T07's follow-up (webgpu GPU render p50 about 2x under the visuals rig vs the v0 look) this is the main M0 perf risk. HUD GPU p50 64 ms at 0.75 on S01. Not a Tier A/B result.

## Mismatches returned to owners (not edited)
1. **technical-artist** (`apps/client/src/visuals/index.ts`): `S02Scene` / `S03Scene` (`visuals/lookdev/s02-first-stroke.ts:55`, `s03-distance-ladder.ts:45`) and their `LookdevSceneOptions` are not exported by the barrel and `VisualsModule` does not route `?scene=s02|s03` (`module.ts` only builds S01/S05/S06). `app/` cannot import them (deep import banned, rule 6). Fix: export them plus a `createLookdevScene(id, options)` or route them in `VisualsModule`. Until then `boot.ts` logs `console.warn` for s02/s03 and shows the hello-world mesh (`scenePlan.unrouted`).
2. **rendering-engineer** (`render/module.ts`): (a) no public setter for the render scale: `RenderScale.set()` is private to `RenderModule` and no dynamic-resolution controller exists, so the "adaptive scale floor" cannot be wired from `app/`. Smallest proposal: `RenderModule.setRenderScale(scale): number` (calls `RenderScale.set` then `pipeline.setRenderScale`) and a controller driven by the debug collector's GPU p90 (rendering-pipeline section 9); Low on an `integrated` class should rest at `scaleMin` (0.5) until the controller exists. (b) `defaultPresetFor` returns Medium for integrated webgpu; the app overrides to Low (`recommendedPreset` and the `[render] ... preset=medium` boot log still say medium: the boot log line prints before the override). (c) `trackTimestamp` is fixed at runtime creation, so a silent WebGPU to WebGL2 fallback inside `host.start()` (no `?backend=`) still tracks timestamps; expose the decision before runtime creation or let the driver set it after start.
3. **ui-ux-motion-designer** (`ui/module.tsx`, font preload links): Chrome warns `The resource ... inter-latin-wght.woff2 ... was preloaded but not used within a few seconds` on every webgpu route (warning, not an error; the HUD is empty on these scenes so no text uses the fonts). Preload only when a font is needed, or use `fetchpriority`/`font-display` without preload.
4. **technical-artist**: `THREE.BufferGeometry.toNonIndexed(): BufferGeometry is already non-indexed.` warning on s01/s05 (webgl2 lane; source not located).
5. **qa-test-engineer**: `tests/e2e/specs/smoke.spec.ts` only visits `/`; the S01, bench and webgl2-lane routes are covered by my scratch driver, not by a spec. `tools/screenshots` `parseArgs` treats the pnpm `--` separator as a flag, so `pnpm ... screenshots -- S01 S05` silently drops `S01`; use `--scene S01,S05`, and relative `--out` resolves against `tools/screenshots`.
6. **devops**: `apps/client/vite.config.ts`/`vite/terrain-assets.ts` are not covered by a tsconfig and `@types/node` is not a client devDependency (the plugin imports `node:fs`/`node:path`; Vite bundles the config so it works).

## Open items / NOT RUN
- Adaptive render-scale (see mismatch 2a): NOT DONE; exact next step is the rendering-engineer `setRenderScale` plus controller, then set the integrated-class resting scale in `app/launch-policy.ts`.
- `/visual-check M0` matrix (S01, S02, S03, S05, S06, S12 across tiers), `/perf-check`, `/bot-test` spike-16, E1-E11 table and `/release-checklist` go/no-go for v0.1.0: NOT RUN here (the matrix needs S02/S03 routing and Tier A/B hardware is BLOCKED, Q21; the perf and bot gates are separate lead-run gates).
- Real SIGTERM on Windows: N/A.

## Processes
My Vite (port 5178) is stopped at the end of the run. A **leftover Vite on port 5181 (PID 37268, `apps/client/node_modules/vite/bin/vite.js --port 5181`) belongs to an earlier worker**: not killed; lead should stop it if no longer needed.

## Step 5
- **`pnpm verify` (turbo lint typecheck test build): PASS**, `Tasks: 52 successful, 52 total` (36 cached, 56.7 s), run once on the final state after my last edit (client build prints only the known framer-motion `"use client"` rolldown warnings).
- **`pnpm format:check`: FAIL, 55 files, none are source**: 22 `tools/perf/results/M0/**` run JSONs, 28 `docs/visual-reviews/M0/lookdev/**` (sidecar JSONs + the scratch `driver/*.mjs|ts` scripts), 5 `docs/agent-reports/M0-W3-T04-evidence/*.json`. All are other workers' captured evidence. Fix (owner devops-engineer / lead): add those result/evidence folders to `.prettierignore` (preferred, they are machine output) or run `prettier --write` on them. My own files (`apps/client/src/app`, `vite.config.ts`, `vite/`) and the new `docs/visual-reviews/M0/integration/**` are clean.

## Recommendation
Wiring is complete and runs on both backends with 0 console errors; `pnpm verify` green. Do not mark the T06 row done yet: S02/S03 routing, the adaptive render scale and the perf finding (look scenes 15-20 fps on UHD 620 even at Low/0.5 on webgpu) are open, and the `/visual-check` matrix, `/perf-check`, `/bot-test` and the release checklist were not run in this task.
