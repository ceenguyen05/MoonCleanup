# M1-W2-T03 review: render infra (dynres, warm-up, module, three-renderer)

Review / **CHANGES REQUESTED** / 2026-11-15 / code-reviewer, Opus 5.5. File state: working tree of 2026-11-15 ~22:55 (uncommitted on top of b7c4221). Read-only; terrain/** ignored.

Scope/lenses: `apps/client/src/render/{dynres.ts,warmup.ts,module.ts,three-renderer.ts}`, tests `infra.test.ts`, `dynres-pace.test.ts`. Lenses: correctness (oscillation, NaN, hitching), hold misuse/leaks, per-frame allocation, device loss, banned APIs.

## Blocking

1. **A leaked hold makes every later warm-up last 60 s.** `warmup.ts:158-159`, `:130`, `module.ts:643-652`. A hold that is never released (for example terrain init throws between `holdWarmup()` and release, with no try/finally) times out at `maxHeldMs`, but `state.holds` stays 1. After that, no warm-up can settle (`settled` needs `holds === 0`), and each one runs to `elapsed >= maxHeldMs`. So every preset change, stage change or device recreate keeps dynres frozen (`module.ts:872`) and holds `whenPipelinesReady()` ("Applying settings") for 60 s. Reproduced: boot ended at 60003 ms with timedOut and holds=1, then a preset warm-up with a stable count took 60003 ms. The README promise that "a forgotten hold never blocks play for good" does not hold. Fix: on the held timeout, set `holds = 0` and bump a generation counter, and make release handles carry that generation so stale handles do nothing. Add a test for it.
2. **The refresh estimate only goes down and is missing on the interval signal, so the scale is pinned at the floor below 60 Hz.**
   - `dynres.ts:239` lowers `refreshMs` but never raises it, and `reset()` (`:164-177`) does not clear it.
   - On the interval signal, `module.ts:879-886` uses `paceTargetMs` = 16.7 ms with no refresh floor at all.
   - Scenario: a UHD 620 laptop on battery with Chrome Energy Saver (30 fps cap), or a 50 Hz panel. The display limit is read as GPU load. The scale drops to 0.6 and stays there, and `floorHint` falsely offers "Lower preset?".
   - Reproduced: interval at 50 Hz and 30 Hz, frames on time, gives scale=0.6 and floorHint=true after 30 s. GPU at 5 ms, display going from 60 to 30 Hz, gives 1 → 0.6 with paceLimited, and still 0.6 after `reset()`, with paceTarget still 16.7.
   - Fix: give the interval signal the same refresh floor. Let the estimate rise again (for example re-estimate it per full window, or drop it in `reset()` and after a stall).

## Non-blocking

3. **Device loss during a warm-up keeps the old warm-up's start time.** `module.ts:748,765` and `warmup.ts:103-113`: `begin("device")` changes nothing while the warm-up is running. If 8 s or more have passed since the start, the new renderer's first frame ends the warm-up by timeout. Its pipelines are then counted as runtime creations, the waiters resolve early, and `pipelinesReadyMs` includes the time the device was gone. Reproduced: warm-up started at 0, recreate at 9 s, and the first frame completed it with timedOut. Fix: restart the clock in `handleRecreated`.
4. **On a partial window the p90 is the maximum.** `dynres.ts:225`: with 5-9 frames (below about 18 fps), the rank is the largest value, so a single hitch after a clear causes a 0.1 down step. Low risk at the 60 fps target.
5. **`whenPipelinesReady()` never resolves after a fatal host error.** `module.ts:486-488` only logs, so a UI gated on it hangs without showing an error. Resolve or reject the waiters there.

## Checked, no finding

- **Banned APIs:** none in `render/**`. The only renderer is `WebGPURenderer` from `three/webgpu`.
- **Per-frame allocation:** none. `stepDynamicResolution`, `sample` (in-place `Float32Array.sort`), `stepWarmup` and the `dynamicResolution` getter all reuse existing objects. Strings are built only when an event fires.
- **NaN and Infinity:** the guards at `dynres.ts:194` and `module.ts:679` hold.
- **Oscillation:** the step-down (0.1) and step-up (0.05) bands and the reverse lock prevent a limit cycle. Failed probes back off up to 64 s.
- **Device loss:** the three handler is replaced (`three-renderer.ts:58-63`), the pipeline is disposed and rebound, the scale and dynres are reset, and the preset drops on every 2nd loss.

## Report honesty

The claims match the code. `vitest run src/render` gave 14 files and 217/217. This ran under Node 22.20, because the PATH prefix did not take effect; there was an engine warning, but the result is the same. The WebGL2 runtime-pipelines FAIL is reported honestly, and holds are not wired yet.

Repro script: `C:\Users\caseyn\AppData\Local\Temp\claude\430d3d07c3d5e4f4\19e746ed-0596-4022-b8f3-0fb4ccf0d212\scratchpad\repro\repro.ts` (run it with Node 26 on copies of `dynres.ts` and `warmup.ts`).
