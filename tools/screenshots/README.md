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
