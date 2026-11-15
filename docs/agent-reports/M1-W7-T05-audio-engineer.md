# M1-W7-T05 audio-engineer

Status: in-review (listening quality NOT RUN) · 2026-11-14 · Sonnet 5.5

## Done
- `apps/client/src/audio/**`: `AudioModule` (ClientModule), `AudioGraph` (10 buses + duck gains, limiter, mono sum, channel filters: ground = helmet-muffle low-pass + 150 ms air gate, contact high-shelf, relay/radio band-pass), `VoiceManager` (tier cap 40/24, per-cue maxVoices/cooldown, priority steal with 30 ms fade), `CuePlayer` (pooled gain/panner nodes, distance rolloff, pan, loops with smoothed updates), `EventRouter` (subscribes exactly to `AUDIO_EVENT_CUES`), `Ducker` (DOT, stamp/Railshot, panel, vehicle), `MusicDirector` (pad + pulse + melody layers, bar-quantised crossfades, hold music, melody on 4-bar boundary), procedural recipes for all 63 cues (`recipes.ts`, `music-recipes.ts`; each has a `note` documenting its source), autoplay unlock on first gesture, visibility fade+suspend/resume, re-arm on interrupted state, UI store sync (volumes, panel muffle/hold), caption hook (`onCaption`), `setMono`.
- Ledger row added to `docs/ASSET_LICENSES.md` (original, procedural; no files, no downloads).

## Evidence (apps/client, Node 26.13.1)
- `tsc -p tsconfig.json --noEmit` whole client: PASS (0 errors). `eslint src/audio`: PASS. `prettier --check src/audio`: PASS.
- `vitest run src/audio`: PASS, 5 files / 46 tests (bus routing, muffle/air gate, ducking, volumes, voice stealing/cooldown/caps, node budget <=150, event-to-cue mapping for every table event, unlock/visibility/dispose, recipes finite/-3 dBFS/deterministic/loop seams).
- Measured (cold, Node): `update` 0.64 us/frame; pad slice (1024 samples) was 4.9 ms at 4096 cold; slowest one-shot renders: stinger_fulfilled 118 ms, ui.clock_in 95 ms, suit_bed 62 ms.
- Listening quality, loudness (-18 LUFS), true peak at master, in-browser CPU <=0.3 ms, real AudioContext behaviour: NOT RUN.

## Not done / risks
- Opus/WebM + AAC fallback: N/A (no audio files; zero download). Hook stays for M2 recorded assets.
- Render hitch risk: runtime synthesis of long cues blocks the main thread up to ~100 ms per cue (spread one per timer tick after unlock, but not off-thread). Next: pre-render to Opus via `tools/audio-pack` or move rendering to a Worker. First play of a not-yet-prewarmed cue renders synchronously.
- No drive-layer (L3) music; Glide Rail/crowd aggregate beds; spatial low-pass per voice; night-mode compressor; HRTF (equal-power pan only).
- Dev audition page not added (needs `debug/module.ts`). Instructions: in the console/debug hook call `audioModule.unlock()` then `audioModule.play("assay.ka_ching", { big: true })`; `audioModule.diagnostics` for voices/memory.
- Not wired: composition root must construct `new AudioModule({ env: browserEnv(window) })` and register it in order (after `net`, before `ui`). `src/audio/index.ts` exports it.

## Contract requests (contracts-architect)
1. Event `audio.cue { id, params }` (presentation) so UI/gameplay never call the module for ui.click/ui.hover/ui.clock_in; plus `audio.settings` for mono and captions toggles (UiSettingsState has no mono/captions).
2. `avatar.stepped { actorSlot, surface, speed01 }` presentation event for footsteps (no event drives `avatar.footstep` now).
3. Vehicle motion state (`speed01`, `load01`) event for `vehicle.drive_loop`/`work_loop` (loop currently fixed at speed 0.4).
4. Positions for non-own sources (distanceM/pan) on actor events, or a listener/emitter position service; others' sounds are currently unspatialised at 0.5 gain.
5. DOT text length or syllable hint on `dot.message` (syllables now derive from a hash of `textId`).
6. `daynight` far-side flag for `ambience.suit_bed.farSide01`.

Files: `apps/client/src/audio/{module,graph,player,voice-manager,event-router,ducking,music,music-recipes,recipes,dsp,cue-params,buffer-store,webaudio-types,fake-audio,index}.ts` + `*.test.ts` (5), `docs/ASSET_LICENSES.md` (1 row).
Commit suggestion: feat(audio): procedural Web Audio graph, cue router and music director

## Follow-up (2026-11-14, Sonnet 5.5)

### 1. First-play render freeze: fixed by moving synthesis off the main thread
- New `render-worker.ts` (module Worker, pure DSP, PCM transferred back). `BufferStore` takes an optional `CueRenderRemote`; on a cache miss it requests the render and returns null (that one play is skipped, nothing blocks the frame), and `prewarmStep` queues every missing buffer once in `PREWARM_ORDER`. `browserEnv.createRenderer` builds the Worker (CSP in `vercel.json` already allows `worker-src 'self' blob:`). Worker death falls back to main-thread sliced prewarm (`onFallback`). Without a Worker (Node tests, old browsers) behaviour is the previous one.
- Music pulse/melody layers (14-71 ms each, rendered synchronously inside `begin()` before) are now rendered by the worker; `MusicDirector` does not start a set until its layers arrive. Without a worker one layer renders per tick. `renderSlice` no longer allocates an array per tick.
- Measured (Node, warm): stinger_fulfilled 118 ms, ui.clock_in 106, suit_bed 67, night melody 62 - all now off-thread in the browser path. Pad slices (1024 samples, ~5 ms cold) stay on the main thread; that slice remains the only synthesis on the frame thread. Moving pads to the worker is a small next step if 5 ms is judged too much.
- Residual: a cue not yet prewarmed is silent on its first play instead of hitching (prewarm covers the first-minute set first, then the rest).
- Evidence: tsc whole client PASS, eslint src/audio PASS, prettier PASS, vitest src/audio 6 files / 53 tests PASS (new `buffer-store.test.ts`: miss returns null and dedupes, prewarm queues without rendering, worker-failure fallback, worker output equals main render, layer requests, MusicDirector gating with and without worker).
- NOT RUN: a real Worker in a browser (Vite worker bundling of `new URL("./render-worker.ts", import.meta.url)` not built or exercised; run `pnpm --filter @moon-cleanup/client build` and check a worker chunk is emitted).

### 2. Browser CPU vs 0.3 ms budget: NOT RUN in a browser
`AudioModule` is not constructed by the composition root yet (no import outside `src/audio`), so no page in tools/perf or screenshots exercises it; I did not fake a browser number. Node proxy only: `update()` 0.95 us/frame with the fake context over 200k frames (router tick, music tick, ducker included, at the 30 Hz throttle). Real cost in a browser is dominated by Web Audio node creation per play and parameter writes; measure after wiring (needs the lead to register `new AudioModule({ env: browserEnv(window) })`).

### 3. Hot-path allocation review (player, voice-manager, ducking, event-router tick, music, buffer-store)
- `Ducker.apply`, `VoiceManager.acquire/release/pickVictim`, `EventRouter.tick`: no allocation (reused result object, fixed tables, indexed loops).
- Fixed: `MusicDirector.renderSlice` built an array every tick.
- Remaining minor, left as is: `BufferStore.get` builds a `${id}#${v}` key string per play (short-lived string, per play not per frame); `MusicDirector.renderSlice` iterates `pads.keys()` (one iterator per 30 Hz tick) while any pad exists; `play` creates one BufferSource per voice (unavoidable in Web Audio; gain/panner nodes are pooled). Voice-steal logic reads correct (steal releases slot first, stolen voice's slot not double-released via `releaseSlot=false`).
- No per-frame allocation found in the 30 Hz tick path.

### 4. Recommendation on "Opus/WebM + AAC N/A"
Recommend ruling it N/A for M1 with an explicit scope note, and keeping the codec requirement alive only for M2 recorded assets. Reason: every cue and bed is synthesised at runtime, so there is nothing to encode and the download is zero bytes. Target browsers (current Chrome/Edge, Firefox, Safari 17+) all decode Opus in WebM or Ogg, and Safari plays Opus in CAF/MP4 only recently; AAC in MP4 works everywhere, so if recordings are added a single AAC/MP4 file would cover all targets, with Opus/WebM as the small-size primary for Chromium/Firefox. Cost of the procedural approach is startup CPU (now off-thread) and memory; both reported in diagnostics. Lead decides.

### NOT RUN
Browser CPU measurement; real Worker build/runtime; listening, loudness (-18 LUFS), true peak at master (unchanged from the original report).
- Note: one vitest run of src/audio showed 1 failing test (cause not captured, likely load/timeout as eslint/tsc ran just before); 4 reruns passed 53/53. Not root-caused.
