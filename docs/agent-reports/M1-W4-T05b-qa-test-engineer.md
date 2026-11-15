# M1-W4-T05b qa-test-engineer: harness leftovers (tools/screenshots only)

Status: partial / 2026-11-14. Stopped on lead request. I could not find a QA "W4-T05 report with 12 non-blocking items" (the W4-T05 reports are backend); I worked from `M0-closeout-harness-guard.md` and the brief's named items. tools/perf and tests/e2e were not touched.

## Done
- Readback speed: `src/readback.ts`, CDP `Page.captureScreenshot` (lossless, `optimizeForSpeed`, clip scale learned from the first frame because the surface returns at the OS 150 % scale). About 0.45 s per capture vs 0.9-3.7 s with `page.screenshot`. PNG byte-identical to Playwright's on `typical` (mean abs diff 0, max 0). `--readback playwright` restores the old path; falls back automatically if CDP fails. Warm-up before the first scene (about 0.8 s once).
- Bug: pnpm's bare `--` swallowed the first scene id (capture wrote 0 files silently). Fixed in `parseArgs`; also throws when no scene is given.
- `typical` registered in `src/scenes/registry.ts` (noon = scene default sun 38 deg, morning/dawn via `sun=`), sun is verified.
- Sidecar hooks: `shadowMapSize`, `dustRingTexelCm`, `particlePool`, `adaptationMultiplier`, `particlesLive` are read from `__mcLook.info()` then `__mcInfo()` when present; `knobs.notReported` lists only the missing ones. No harness change is needed once the client reports them.
- Checks: tsc clean, eslint clean, prettier applied, vitest 5 files / 42 tests (3 new in `src/closeout-b.test.ts`). Real captures S05/typical/S01 Low webgpu on port offset 5 (preview 5178, stopped). README updated.

## Not done
- S05 shadow probes: the harness cannot fix them. In a Low capture `probe:slopeShadow` luma is 170 (lit) while the ramp canopy shadow is visible at the right of the frame, so the client probe point is off. Not diagnosed.
- tools/perf, tests/e2e leftovers and the other "12 items": not reviewed (no list found).
- Wrap-guard not applied to `captureSequence`/`capturePath` (unchanged).

## Product-code requests (apps/client/src/visuals)
1. Add to `__mcLook.info()` (numbers): `shadowMapSize`, `dustRingTexelCm`, `particlePool`, `particlesLive`, `adaptationMultiplier`.
2. S05 `slopeShadow` probe in `s05-shadow-lab.ts` (`rampShadow`) misses the canopy shadow at sun 60 / az 200; check the projected point against the rendered shadow.
3. Rendering-engineer: first-wrap cause still unreproduced (see M0 harness-guard report).
