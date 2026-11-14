# M0 dynres GPU timing in production

Task: production dynamic resolution must receive GPU frame times / status: done (focused checks) / 2026-11-13 / rendering-engineer (Sonnet 5.5)

## Done
- Root cause: `reportGpuFrameMs` was called only by the debug module (dev or `?perf=1`), and `trackTimestamp` was requested only
  when that module existed, so production dynres always steered on the frame interval.
- New `render/gpu-timing.ts`: `GpuTimingPump` (resolve three timestamp queries every 16 frames, one request in flight, callbacks bound once,
  forwards render + compute ms to `renderer.reportGpuFrameMs`), `gpuTimingMode(backend, gpuTiming)` (queries only on WebGPU with
  `timestamp-query`; WebGL2 timer queries stay off), `GpuTimingModule` (production hook, no DOM, no window hooks, no HUD).
- `app/boot.ts`: `trackTimestamp` is now requested for perf tooling OR when dynres can run (not `?dynres=off`, `?scale=` pin or capture);
  when the full debug module is absent, `GpuTimingModule` takes the last (`debug`) frame slot (runs after render presented the frame).
- `debug/module.ts`: uses the same `GpuTimingPump` (every 8 frames, records the HUD sample); one implementation, never both modules.
- `render/dynres.ts`: comment only (fallback description). `render/README.md` updated. `render/index.ts`: barrel export of the new file
  (one line outside the file list, in render/ which I own; needed so boot.ts and debug import from the barrel).
- Fallback: no `timestamp-query` (three disables tracking itself) or WebGL2 -> no query, no promise; dynres keeps CPU frame pacing (interval signal).

## Evidence
- `tsc -p tsconfig.json --noEmit` 0 errors; `eslint src/render src/debug src/app` clean; prettier applied.
- `vitest run src/render src/debug src/app`: 17 files / 193 tests passed, including new `render/gpu-timing.test.ts` (sparse resolve, single
  in-flight, WebGL2/no-feature no-op, zero timestamp ignored, rejected resolve recovers, dispose, production module wiring) and the
  existing debug GPU-timing test.
- Production smoke: `vite build` (production mode) to a scratch dir + `vite preview`, Chrome (headed) on the Intel UHD 620, 1280x720, 14 s per case.
  - `?scene=typical`: backend webgpu, tier B, preset low; `window.__mcStats` undefined and no HUD (debug module absent); `__mcDynres()` signal
    went `interval` -> `gpu`, p90 GPU 10.62 ms vs 28 ms budget, scale rose 0.5 -> 0.6. 0 console errors; 5 warnings, none from this change
    (Chrome powerPreference x2, `THREE.BufferGeometry.toNonIndexed` already non-indexed, 2 unused font preloads).
  - `?scene=typical&backend=webgl2`: signal stays `interval`, 0 errors, 1 warning (toNonIndexed), no `beginQuery` warnings.
- Servers and the smoke browser were stopped (port 4173 free; no leftover playwright Chrome).

## Not measured / limits
- CPU cost of `trackTimestamp` + resolve on the render step was not A/B measured (frame loop is vsync-bound at 16.7 ms here); only reasoned:
  one counter per frame, two async resolves per 16 frames. Perf-profiler should confirm with `?perf=1` (`mc:debug:update`, render CPU ms).
- Allocation: pump callbacks are preallocated; promises per resolve (about 4 per 16 frames) are the browser's and not measured with a heap profile.
- A silent WebGPU->WebGL2 fallback inside three with `trackTimestamp: true` (navigator.gpu present but adapter fails) was not reproduced; it may
  log the known `beginQuery` warning (open item already in `launch-policy.ts`). Needs render-module change to expose the decision before creation.
- Only UHD 620 / Chrome; Tier A discrete GPU, other vendors and Firefox/Safari WebGPU not run.
- The GPU signal changes dynres targets to `gpuBudgetMs` (28 ms on Low); tuning of those budgets against real scenes was not revisited.

## Files
`apps/client/src/render/gpu-timing.ts` (new), `render/gpu-timing.test.ts` (new), `render/index.ts`, `render/dynres.ts`, `render/README.md`,
`apps/client/src/debug/module.ts`, `apps/client/src/app/boot.ts`.

## Blockers
None.

Commit suggestion: fix(client): feed production dynamic resolution with sparse GPU timestamp timing
