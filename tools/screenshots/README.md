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
