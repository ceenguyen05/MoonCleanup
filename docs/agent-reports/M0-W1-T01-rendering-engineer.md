# M0-W1-T01 Renderer bootstrap

Status: in-review (implemented; not wired into `app/boot.ts`; Tier A/B verdicts and real-harness captures NOT RUN) / 2026-11-12 / rendering-engineer, Fable 5.2

## Done

`render` ClientModule on three r187 `WebGPURenderer` (auto WebGL2), section 2.1 detection, tier + preset, frame loop,
HDR `RenderPipeline` skeleton with AgX, device-loss recreation, QA harness hooks. Usage and hooks for other roles:
`apps/client/src/render/README.md`.

## Files (all under `apps/client/src/render/`)

`backend.ts`, `tier.ts`, `gpu-classes.json`, `blocklist.json` (empty: no recorded driver failure), `quality-service.ts`,
`url-options.ts`, `viewport.ts`, `render-scale.ts`, `renderer-host.ts`, `frame-loop.ts`, `harness-hooks.ts`,
`three-renderer.ts`, `pipeline.ts`, `scene-roots.ts`, `smoke-scene.ts`, `module.ts`, `index.ts`, `README.md`;
tests `backend.test.ts`, `tier.test.ts`, `renderer-host.test.ts`, `frame-loop.test.ts`, `module.test.ts`.
No new dependencies. Nothing outside `render/**` was edited.

## API (barrel `apps/client/src/render/index.ts`)

- `new RenderModule({ container, search?, savedPreset?, smokeScene?, trackTimestamp?, log? })`: `ClientModule<RenderServices>`;
  `init` registers `renderer` (the module itself, `RenderRendererService`), `sceneRoots`, `quality`; emits
  `quality.changed` then `render.backendSelected`; throws `RenderUnsupportedError` (step 8).
- `new FrameLoop({ modules, scheduler, getQuality, viewport?, input?, simPredict?, simClock?, onError? })`:
  `start/stop`, `setManual`, `step(n, dt)`, `whenFrameCount`, `lastStepMs`, `frameTimeStats`, `setSpansEnabled`.
- `installHarnessHooks(window, { loop, renderer, quality, capture })`: sets `__mcReady`, `__mcStep`, `__mcInfo`.
- `renderer.setPipelineStages({ hdr, display, dispose })`, `onLost / onRecreated / onFatal`, `readStats(out)`.
- URL: `?backend=webgpu|webgl2`, `?preset=`, `?dpr=` (replaces device DPR; preset cap still applies), `?scale=floor|ceil`,
  `?scene=smoke`, `?capture=1`. `?tier`, `?tod`, `?seed`, `?hud`, `?view` are not render's.

## Evidence (Windows 11, Node 26.13.1, file state = working tree 2026-11-12 17:45)

- `pnpm exec tsc -p tsconfig.json` (apps/client): exit 0. `pnpm exec eslint src/render`: exit 0 (zero ban-list hits).
  `prettier --check apps/client/src/render`: clean. `pnpm exec vitest run src/render`: 5 files, 87 tests pass
  (detection steps 1-5 and 8 with mocked adapters, tier/preset tables, device loss with mock renderers, frame order,
  spans, manual stepping, module boot with mocked `navigator.gpu`).
- Browser run through a throwaway page in the session scratchpad (stand-in composition root, Vite dev, Playwright
  Chromium 960x540 DPR 1, `?scene=smoke&capture=1`, 30 fixed steps). Intel UHD 620 only:
  - `webgpu` vs `?backend=webgl2`, same preset: max channel difference 0 (Low) and 1 (Medium), 0 channels over 8.
    Background max channel 0 (black clear). Mesh centre 189,168,145; 2 draws, 21 triangles; `mc:render:update` 0.7-1.2 ms.
  - Detection without override: `backend=webgpu tier=B preset=medium reason=core-adapter gpuClass=integrated reversedZ=true`.
  - `WEBGL_lose_context.loseContext()` on the live canvas: new canvas, old one removed, one canvas in the page,
    `lossCount` 1, frame identical to the run without a loss (max difference 0).
  - SwiftShader lane (`--use-angle=swiftshader`, webgl2): renders, no console errors; versus the UHD 620 frame 125 channels over 8 (edge pixels).
  - Console: Chrome's "powerPreference is ignored on Windows" warning on WebGPU runs; one 404 on the full-Chromium
    runs that I did not identify (absent on the headless-shell lane, the scratch page has no favicon).
  - Captures are in the session scratchpad only (`scratchpad/out/*.png`), not in the repo.

## Not run / not proven

- Not wired: `apps/client/src/app/boot.ts` is still the stub, so `pnpm verify`, `tests/e2e` and `tools/screenshots`
  against the real client were not run. Production `vite build` of the render barrel not run (dev server only).
- `webgpu-compat`, Tier A, Ultra, DPR > 1 on a real display, a real WebGPU device loss (only the WebGL context loss
  was forced in a browser; the WebGPU path is covered by mocks only), window resize in a real browser.
- VT-M0-01 / VT-M0-09 need the visual-qa capture through the harness after wiring; my numbers above are a smoke.
- Frame-time numbers above include software/dev-server noise; no perf verdict.

## Decisions to confirm (lead / contracts-architect)

1. `render.backendSelected` is re-emitted when a recreated renderer runs on another backend or tier. The contract
   comment says "emitted once"; say if it must stay strictly once (one line in `module.ts` `handleRecreated`).
2. Update order uses one `update` per module: `input` (callback) -> net -> `simPredict` (callback) -> gameplay ->
   animation -> terrain -> visuals -> render -> audio -> ui -> debug. Input and sim are callbacks because they are not ClientModules.
3. Unknown GPUs are Tier B; on WebGPU the tier classifier also reads the WebGL renderer string, because Chrome
   often hides the adapter device name. `?backend=webgpu` skips the software-adapter and blocklist checks.
4. Not in this task: 3-second lobby benchmark (section 2.3), dynamic-resolution control law (section 9; only range,
   clamp and pins exist), `assetLoader` service, Sentry context for the capability line (the app owns Sentry).
5. Contract request: no catalog event for device loss; modules use `renderer.onLost / onRecreated` for now.
6. `gpu-classes.json` patterns are my reading of section 2.3, tested on 21 sample strings, not on real devices.
7. The host gives up after 5 losses (`DEFAULT_MAX_DEVICE_LOSSES`, my number) and calls `onFatal`.

## Wiring handoff (integrator, M0-W1-T06)

```ts
import { FrameLoop, RenderModule, RenderUnsupportedError, installHarnessHooks, parseRenderUrlOptions,
  type RenderServices } from "../render";

const render = new RenderModule({ container }); // container needs a CSS size; the canvas becomes its first child
// init modules in CLIENT_MODULE_IDS order; render registers renderer / sceneRoots / quality itself
try { await render.init({ services, events }); } catch (e) { if (e instanceof RenderUnsupportedError) showUnsupportedPage(); throw e; }
const quality = services.get("quality");
const loop = new FrameLoop<ClientServices>({ modules, scheduler: render.scheduler, getQuality: () => quality.current,
  viewport: render.viewportSource, onError: reportToErrorBoundary });
loop.start();
await installHarnessHooks(window, { loop, renderer: render, quality, capture: parseRenderUrlOptions(location.search).capture });
```

- `ClientServices` must extend `RenderServices`. Do not call `resize` yourself: the loop polls the viewport and calls
  `resize` on every module. Do not pre-register `renderer` or `quality`; a pre-registered `sceneRoots` is reused.
- Overlay: `render.backend / tier / forced`, `quality.current.preset`, `render.backendDecision.reason`. The module
  already logs one `[render] backend=...` line (the e2e smoke looks for "backend").
- `render.onFatal(showErrorScreen)`; dispose order: `loop.dispose()` first, then modules in reverse.
- `__mcStep` advances one frame per display frame (three advances its node frame once per rAF).

## Blockers

None for this task. Next: integrator wiring, then the harness captures on both backends.

Commit suggestion: `feat(client): render module with WebGPURenderer bootstrap, frame loop and HDR pipeline skeleton`
