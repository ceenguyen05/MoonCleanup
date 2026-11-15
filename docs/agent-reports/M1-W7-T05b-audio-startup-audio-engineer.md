# M1-W7-T05b audio startup (audio-engineer, Sonnet 5.5, 2026-11-14)

Status: implemented in `apps/client/src/audio/**` only; checks below PASS.

## Changes
- `AudioEnv.idle?(fn)` (new, optional). `browserEnv.idle`: 800 ms after init, then `requestIdleCallback` (timeout 1500 ms), plain call if rIC is missing. Without `idle` the module uses `later(.., 500)`.
- `AudioModule.prepare()` (run from that idle hook): `createContext()` (suspended), graph, BufferStore, Worker renderer start, voice manager, player, music director, and prewarm queueing all happen here, off the gesture path.
- `unlock()` on the first gesture now only calls `ctx.resume()` and then `afterRunning` (beds, music set). If idle has not run yet, or early creation threw, it builds on the gesture as before (fallback). The gesture listener is re-armed on `onstatechange` as before; visibility suspend/resume is unchanged.
- Cues, loops and `play()` are dropped while the context is not `running`. Without this, events before resume would queue and burst out on resume.
- Allocations: `BufferStore.get/has` use interned key strings (no template string per play); `MusicDirector.renderSlice` iterates a fixed set list instead of `pads.keys()` (no iterator per 30 Hz tick). The third item, one BufferSource per voice, is unavoidable in Web Audio and unchanged.

## Measurements (Playwright Chromium 1.65, headless, Windows dev machine, blank page; not the game)
- Before (gesture path): `new AudioContext({latencyHint:"interactive"})` 299 ms main-thread block (matches the 267-329 ms in the integrator report).
- After (gesture path): `resume()` 0.4 ms synchronous and 0.4 ms to resolve.
- The 299 ms construction cost still exists; it moved to idle after boot. It could still land in the first seconds of solo play (800 ms timer, then idle), so it is a one-time hitch there instead of at the click. If that matters, the lead can set the idle delay later, for example after the loading screen finishes or the first frames render.
- Worker spawn and buffer prewarm now start at idle, not at the gesture. Buffer "decoding" is procedural synthesis in the Worker, so there is no codec decode.
- NOT RUN: the actual game page (`AudioModule` still needs registering in `app/**`, not mine; I did not measure a long task in the full app), UHD 620, Firefox, Safari. Chromium headless reported `running` immediately without a gesture, so autoplay-blocked behaviour was not exercised in a browser; it is covered only by fake-context tests (suspended until `resume()`). Safari and Firefox allow creating a context before a gesture, but that was not verified here.

## Tests
New in `module.test.ts` (7): idle builds suspended and the gesture only resumes (no second construction); prewarm starts at idle with no sound; cues dropped while suspended; gesture fallback when idle never ran; fallback when early creation throws; re-arm on suspend before the first gesture; no build after dispose. `FakeEnv` gained `idle`/`runIdle`.

## Evidence
- `tsc --noEmit` (client): PASS
- `eslint src/audio`: PASS
- `prettier --write src/audio`: applied and clean
- `vitest run src/audio`: 6 files, 60 tests PASS
- `pnpm verify` not run, as instructed.

## Suggested cue/contract changes
None.
