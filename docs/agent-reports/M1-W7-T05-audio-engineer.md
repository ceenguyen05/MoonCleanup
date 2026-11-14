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
