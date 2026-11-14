Task: M0 build-config fixes / status: done / 2026-11-13 / devops-engineer (Sonnet 5.5)

Done
1. Client production build no longer emits source maps. `apps/client/vite.config.ts`: `sourcemap` is off by default; `MC_SOURCEMAP=hidden` (maps, no sourceMappingURL comment) or `MC_SOURCEMAP=true` (linked) opt in for Sentry/CI-evidence builds. `MC_SOURCEMAP` added to turbo.json build `env` so the cache key tracks it.
2. `tools/perf` device-report: floor row now uses the preset's spec scale ceiling (low 0.75, medium 0.85, high 1.00) instead of hard-coded `scale=1`; `--scale <n>` pins an explicit value. Report header label now says what was used ("preset spec ceiling (...)" or "pinned N"). Table Scale column reports the scale the page actually applied.

Files: apps/client/vite.config.ts, turbo.json, tools/perf/src/device/run.ts, tools/perf/src/cli.ts, tools/perf/src/device/device.test.ts. No apps/client/src edits; vercel.json untouched by me.

Evidence (Node 26.13.1 via fnm PATH prefix)
- `pnpm build` in apps/client: OK. dist has 0 `.map` files and 0 `sourceMappingURL` references; dist 17 MB. Terrain plugin output present (assets/terrain: 3 hashed .bin + manifest.json), fonts/hub/index.html present.
- tools/perf: tsc --noEmit clean, eslint clean (device, cli, vite.config), vitest 28/28 pass (new tests: scaleFor/scaleModeLabel, and a drift guard comparing PRESET_SCALE_CEIL with dynres.scaleMax in packages/shared quality.ts). prettier --check clean on edited files.
- No dev server left running.

Not verified
- CSP: vercel.json is unchanged by me, but CSP behaviour was not tested in a browser or via `vercel dev`.
- KTX2: dist contains no KTX2 files at present, so only the terrain asset path was confirmed.
- device-report was not executed end to end (needs a headed GPU browser); the scale change is covered by unit tests only. Old reports in tools/perf/results/device-reports were produced at scale=1 and carry the old "ceil" label.
- Sentry source-map upload is not wired; when it is, build with MC_SOURCEMAP=hidden in a non-deployed step and delete maps before publish.

Blockers: none.
Commit suggestion: fix(build): drop production sourcemaps and use preset scale ceiling in device-report
