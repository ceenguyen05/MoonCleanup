# M0-W1-T05 Screenshot harness v0 + measure + Playwright smoke

Status: in-review (implemented; real-GPU/WebGPU lane NOT RUN, no client hooks yet) / 2026-11-12 / qa-test-engineer, Sonnet 5.5

## Done
- `tools/screenshots`: capture harness (`src/capture.ts`, `harness.ts`, `naming.ts`), `measure/` (luma patch, 10-90 % edge width, RMS Sobel, CIELAB b*, PNG disk size, star count, temporal variance, non-black fraction), `measure/cli.ts`, generated `index.md`. Scene list left to visual-qa-reviewer (`scenes/types.ts` only).
- Lanes: `--lane ci` (headless Chromium, SwiftShader, forces webgl2) / `--lane gpu` (headed Chrome, WebGPU flags). Wait on `window.__mcReady`, no sleeps. PNG size = CSS x DPR (asserted). One sidecar JSON per PNG (scene, tier, preset, backend, DPR, commit, frame-time sample, `texPoolMB` placeholder, measure results with rects). Frame-stepped mode (fixed dt 1/60, N frames) + PNG sequence; turntable (8 views x noon, night-near).
- `tests/e2e`: `playwright.config.ts` (lane via `MC_LANE`, ports 5173+`MC_PORT_OFFSET`, starts client dev server unless `MC_CLIENT_URL`), `specs/smoke.spec.ts`. package.json edits: `screenshots`/`measure` scripts; e2e `test:e2e` no longer `--pass-with-no-tests`. No new deps.

## Integrator contract (M0-W1-T06)
URL params: `scene, backend(webgpu|webgl2), preset, dpr, tier, tod, seed, hud(0|1|dbg), scale(floor|ceil), view(0-7), capture=1`.
Window hooks (type `McHooks` in `tools/screenshots/src/harness.ts`): `__mcReady: boolean`; `__mcStep(n, dt): Promise<void>` in `capture=1` mode; `__mcInfo` (object or fn: backend, gpu, frameTimeAvgMs/P95Ms, drawCalls, triangles, texPoolMB, placeholderAssets). Backend must be console-logged (contains "backend"). `MC_REQUIRE_CANVAS=1` turns the canvas/ready/non-black/backend asserts on (annotation-only against the current stub, which has no canvas).

## Evidence (Windows, Chromium installed, node 22)
- `tools/screenshots`: vitest 15/15 pass (8 synthetic-chart measure tests, naming examples from 6.6, URL/lane/args, real-Chromium capture against a fake client: native 640x400@2 PNG, sidecar, index.md, 3-frame sequence); tsc and eslint clean.
- `tests/e2e` (MC_PORT_OFFSET=5, ci lane, vite dev client): 2 passed, 1 skipped (`/healthz`, no `MC_SERVER_URL`); tsc and eslint clean. First run took ~1.9 min (dev-server cold start).
- Run: `pnpm --filter @moon-cleanup/screenshots screenshots -- S02 --lane ci --out docs/visual-reviews/M0/W1`; `pnpm test:e2e`.

## Blockers / Next
- gpu lane and the real-client canvas/backend asserts are NOT RUN until the client implements the hooks; integrator sets `MC_REQUIRE_CANVAS=1` in CI then.
- READMEs not yet updated with the run lines (listed above).
