# M1 S05 ramp view variants in the screenshot harness

Task: S05 view variants / status: done / 2026-11-15 / qa-test-engineer / Sonnet 5.5

## Done
- `S05ramp` (view `shadeSlope`) and `S05slope` (view `slope`): sun from `--tod` (noon = 60), `az=200`. Registry: `tools/screenshots/src/scenes/registry.ts` (`S05_VIEWS`). Presets come from `--preset low|medium`; backend from the lane (webgpu on gpu).
- New tight ROIs `probe16:<id>` (16 px) next to `probe:<id>` (48 px) in `src/measure/rois.ts`, so `probe16:rampShadow` / `probe16:slopeShadow` are in sidecar `measure.rois`.
- README: run line, and the stale "unreported" line corrected. Run: `pnpm --filter @moon-cleanup/screenshots screenshots -- S05ramp,S05slope --lane gpu --url http://localhost:<5173+N>/ --preset low --tod noon --scale floor --out <dir>`.

## Evidence
- vitest 7 files / 47 tests (one new test: URL for S05ramp/S05slope, plain S05 unchanged; vt12 ROI list updated), tsc 0, eslint 0, prettier clean.
- Capture, Low webgpu, Vite dev server (port 5182, N=9), 1920x1080 @1: `probe16:rampShadow` 88.96, `probe16:slopeShadow` 88.96 (48 px: 88.95), `slopeLit` 170.6. Matches the 88-89 expected. PNG viewed: the canopy shadow sits on the ramp face, probe inside it.
- PNG + sidecar: `tools/screenshots/output/m1-s05-variants/`.

## Not run
- Medium capture (variant is preset-agnostic; command above), webgl2, production build. Scratch dev server was stopped.

## Next
- visual-qa-reviewer: capture Low and Medium with the command above for VT-M0-16 re-record.
