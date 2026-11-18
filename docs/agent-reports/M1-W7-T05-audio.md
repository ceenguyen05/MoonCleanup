# M1-W7-T05 audio pass 2 (audio-engineer, Sonnet 5.5, 2026-11-17)

Status: in-review; audio-only edits in `apps/client/src/audio/**`. Browser CPU, listening, loudness NOT RUN (no GPU/browser allowed).

## Perf pass (read of router, player, voice-manager, music, buffer-store paths from the earlier pass plus new code)
- Per-frame: `update()` is throttled to 30 Hz, no allocation; router tick, ducker and music tick use indexed loops and reused objects.
- New event paths are allocation-free: shared `placed` options object, shared `OTHERS_OPTS`, reused step/drive/work param objects, fixed 4-entry other-vehicle table. Only `avatar.landed` builds one small object per landing (rare).
- Nodes: gain/panner pooled; one BufferSource per voice (Web Audio limit). Voice cap tier 40/24, node budget test <=150 still passes.
- Synthesis is already off-thread (Worker) with idle-time context creation (T05b). Remaining main-thread synthesis: pad slices (~5 ms cold per 1024 samples) in `MusicDirector.tick`; suggested next step is moving pads to the worker if a browser trace shows it.

## Implemented (W7-T05 gap: contract v1.1 events were not consumed)
- `avatar.stepped` -> `avatar.footstep` (own centred; others only when `placement` present, rolled off and panned).
- `vehicle.motion` -> own `vehicle.drive_loop` (speed01, load01) and `vehicle.work_loop` (workIntensity01, started/stopped at 0.02); other vehicles loop only when placed and moving, max 4, end on stop event or 0.6 s silence. Seated idle pitch now 0.15 (was fixed 0.4).
- `audio.cue` plays `payload.id` (placement honoured); `audio.settings` -> `setMono` and new `setCaptions` (`onCaption` now fires only while captions are on, default off).
- `placement` honoured on `tool.stroke_contact`, `avatar.jumped`, `avatar.landed`; `dot.message.syllables` used (clamped 1..32), hash fallback kept.
- Tests (event-router.test.ts, +5): handled-event set, footsteps, vehicle.motion own/other/cap/idle, audio.cue/settings, syllables.

## Evidence (Node 26)
- `vitest run src/audio`: 6 files / 65 tests PASS. `eslint src/audio` clean. prettier applied.
- `tsc -p tsconfig.json --noEmit` whole client: see lead note below.

## Needed from others (not edited)
- gameplay: emit `avatar.stepped`, `vehicle.motion` (<=10 Hz, final zero event), `placement` on actor events; ui: emit `audio.cue` (ui.click, hover, clock_in, panel_open...) and `audio.settings` once after settings load.
- contracts-architect: next wave may merge `AUDIO_EVENT_CUES_V1_1` into `AUDIO_EVENT_CUES`; the router already handles both (extra list `AUDIO_EXTRA_EVENTS`).
- Still no `daynight` far-side flag (declined), so `farSide01` stays 0.

## Not run / limits
Browser CPU <= 0.3 ms, real Worker bundle, listening/loudness/true peak, Opus/AAC (procedural, scope ruling A2 still lead's call). Boot wires audio only behind `wantsAudio` query (boot.ts, not mine).
