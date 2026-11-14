# M0-W2-T01 performance-profiler report

Status: implemented, unit-verified; browser/GPU capture NOT RUN. Hardware is one Intel UHD 620 laptop: every capture is provisional, no Tier A/B claim.

## Delivered
- `apps/client/src/debug/` (card-owned path; not `perf/`): `DebugModule` (ClientModule id `debug`), F3 DOM HUD (4 Hz, only while visible), `PerfCollector` (typed-array rolling windows, no per-frame allocation), `stats.ts`, `camera-path.ts`, `snapshot.ts` (schema 1), `index.ts`.
- Window hooks: `__mcStats()`, `__mcStatsReset()`, `__mcCameraPath(spec|null)`, `__mcPerfHud(visible?)`. `dispose` removes DOM, key listener and hooks.
- GPU: `renderer.resolveTimestampsAsync` every 8 frames (one in flight), requires `trackTimestamp: true` on RenderModule. Source labeled `timestamp-query` / `timer-query-webgl2` / `none` ("CPU only"); no estimates shown. three r187 gives one render total, not per pass: per-pass GPU ms is `unavailable` (card criterion partly unmet).
- `tools/perf/src`: `cli.ts` (`capture`, `budgets`), `capture/runner.ts` (headed Chrome, adapter flag `--adapter high-performance|low-power|default`, 10 s warm-up + 60 s, N runs, local URL only), `reduce.ts`, `summary.ts` (JSON + Markdown to `tools/perf/results/<milestone>/`), `budgets.ts` (pass/fail/UNVERIFIED with margin, client + download + server), `download.ts`, `machine.ts`, `schema.ts`. `pnpm perf` script now runs the CLI.

## Evidence
- apps/client: tsc clean, eslint clean, vitest src/debug 11/11.
- tools/perf: tsc clean, eslint clean, vitest 13/13. Prettier applied to both.

## Integrator wiring needed (app/** not edited)
1. In `app/boot.ts` register `["debug", new DebugModule({ getLoop: () => loop, startVisible: q.perf==="1" })]` only in dev or `?perf=1` (`loop` assigned after init; getter handles it).
2. Construct `RenderModule` with `trackTimestamp: true` when perf is on.
3. Spec'd `pipelinesAfterWarmup` has no source yet: renders `n/a`/UNVERIFIED until render exposes a counter.
4. Dispose order already reversed by the root.

## NOT RUN
- Real capture (Playwright, headed Chrome, WebGPU) and GPU timestamp verification: not executed, no running client.
- HUD CPU cost (<=0.2 ms) measured in browser: NOT RUN (design: no DOM work except 4 Hz when visible; self cost p95 shown in HUD).
- VT-M0-11 overlay readability: NOT RUN.
- JS heap uses `performance.memory` (Chrome) not `measureUserAgentSpecificMemory`; CPU spans read from FrameLoop.lastStepMs, not `performance.measure` entries.
- Server tick comes from a user-supplied JSON report (`--server-report`); bot-test format not verified.
- `tools/perf/README.md` not updated with flags (usage in `cli.ts`).
- Debug step has no own span value (reported 0).
