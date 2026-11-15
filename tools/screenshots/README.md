# @moon-cleanup/screenshots

**Path:** `tools/screenshots` - **Owner roles:** `qa-test-engineer` (harness) and `visual-qa-reviewer` (scene list and comparisons)

## Purpose

Playwright-driven capture of fixed scenes and camera paths from the running client for visual QA, plus image comparison with
`pixelmatch` 8.0.0 / `pngjs` 7.0.0. Two lanes (ADR-0019): CI software-WebGL2 smoke, and local real-GPU baselines. Output goes to
`tools/screenshots/output/` and `diff/` (git-ignored); milestone-approved PNGs are copied by the reviewer to
`docs/visual-reviews/` at native resolution.

## What Fable will build here

`src/scenes/` (scene registry: name, camera path, quality tier, seed, wait-for-ready hook exposed by the client) and
`src/compare/` (diff + report). A `src/capture.ts` entry.

## Key contracts consumed

`@moon-cleanup/shared` (render quality presets, IDs). The client needs a stable "scene ready" hook (a contract change requested
through the lead; module-boundaries "Contract change process").

## Notes

- Rendering varies by OS, driver and GPU: baselines are per machine, never compared across machines.
- Browsers are not installed by `pnpm install`: run `pnpm --filter @moon-cleanup/screenshots install:browsers` once.
- pixelmatch 8 is ESM-only; `@types/pngjs` 6.0.5 is the latest typings (verified 2026-11-12).

## Commands

```
pnpm --filter @moon-cleanup/screenshots install:browsers
pnpm --filter @moon-cleanup/screenshots screenshots   # placeholder -> tsx src/capture.ts
```

## Run (v0)

```
pnpm --filter @moon-cleanup/screenshots screenshots -- S02 --lane ci --port-offset 5 --out docs/visual-reviews/M0/W1   # --lane gpu for real GPU; --step 64, --turntable
pnpm --filter @moon-cleanup/screenshots measure -- <capture-dir>   # re-measure PNGs into sidecars and regenerate index.md
```

Client contract (URL params and `window.__mcReady/__mcStep/__mcInfo`): see `src/harness.ts`.

## Run (VT-M0-12 additions)

```
pnpm --filter @moon-cleanup/screenshots screenshots -- S01,S02,S03,S05,S06 --lane gpu --preview --build --port-offset 9 --tod noon --step 30 --tier B --preset medium --scale floor --out docs/visual-reviews/M0/final
pnpm --filter @moon-cleanup/screenshots screenshots -- S12 --lane gpu --preview --tod noon --step 10 --preset low --scale floor --out <dir>
pnpm --filter @moon-cleanup/screenshots screenshots -- --path P4 --frames 12 --lane gpu --preview --out <dir>   # stepped camera path
```

- `--preview` (+ `--build`) builds the client and runs `vite preview` on port 5173+N; without it the harness attaches to `--url`. The sidecar records `serve.mode` (`dev` or `production`).
- `--out` accepts `/c/...`, `/mnt/c/...` or Windows paths; relative paths resolve against the directory you typed the command in.
- `tod` is mapped to each scene's own knobs (`src/scenes/registry.ts`) and the sun is verified after load; an unsupported scene/tod pair throws. `--allow-unverified-tod` passes unknown scenes through.
- Scene `S12` is the HUD page (`?scene=hud-test`). Sidecars carry ROI measures (`measure.rois`), knobs, sun, EV100, Earth phase.

## Wrap guard and scratch dist (M0 close-out)

- Every capture is checked for a wrapped / repeated-band frame (top k rows == bottom k rows, k 16..34 % of height, band must have content). On a hit it re-screenshots, then (single-scene captures) reloads and re-steps the scene; if all attempts are wrapped it throws `WrappedFrameError`. The sidecar field `wrapGuard` records `result` (`clean` / `recovered` / `failed`), each attempt (band rows, DPR, readback ms) and a note. Code: `src/wrap-guard.ts`; tests: `src/wrap-guard.test.ts`.
- `--client-out <abs dir>` with `--preview [--build]` builds and serves a scratch dist instead of `apps/client/dist`.
- Sidecar `knobs.aa` now falls back to the post chain (`fxaa`/`smaa`/`traa`); `knobs.notReported` lists the knobs the client hooks do not expose yet (currently `dustRingTexelCm`, `particlePool`; `shadowMapSize` and `adaptationMultiplier` are reported since M1).
- S05 ramp views: `S05ramp` (view `shadeSlope`) and `S05slope` (view `slope`), sun from `--tod` (noon 60), azimuth 200. Run: `pnpm --filter @moon-cleanup/screenshots screenshots -- S05ramp,S05slope --lane gpu --url http://localhost:<5173+N>/ --preset low --tod noon --scale floor --out <dir>`. The sidecar `measure.rois` has `probe16:rampShadow` / `probe16:slopeShadow` (16 px) and `probe:*` (48 px).
- `--readback cdp|playwright` (default cdp): lossless CDP capture, about 0.45 s per frame vs 0.9-3.7 s via page.screenshot; byte-identical PNG on `typical`. A one-time warm-up runs before the first scene. `typical` is a registered scene id (noon = scene default sun 38 deg). Optional sidecar fields shadowMapSize, dustRingTexelCm, particlePool, adaptationMultiplier, particlesLive are read from `__mcLook.info()` / `__mcInfo()` when a build reports them.

## DPR pin and HUD measure (M0 harness fixes)

- `src/readback.ts` pins the surface scale with `Emulation.setDeviceMetricsOverride` (DPR = the emulated one) before the CDP capture. Before: the clip scale left `window.devicePixelRatio` at the OS display scale (1.5) after the first shot, so DPR-reactive pages re-rendered at 1.5 (S12 readout read "Device pixel ratio 1.5" in DPR 1 and 2 frames).
- `src/dpr-check.ts`: after every capture the page DPR must equal the requested DPR and, on S12, `[data-testid=readout-dpr]` must read it (explicit wait, no sleep); otherwise the capture throws. Sidecar field `dprCheck`.
- `src/hud-measure.ts`: sidecar field `hudMeasure` (S12 only): `panelsOffDevicePx` and per-hairline `rowsOverHalfPeak` / `peak`.
