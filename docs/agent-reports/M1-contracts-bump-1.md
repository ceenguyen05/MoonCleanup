# M1-contracts-bump-1 (contracts-architect)

Task / status: in-review / 2026-11-14 / contracts-architect / Sonnet 5.5
Additive minor bump of `packages/shared`; no `PROTOCOL_VERSION` / `SAVE_FORMAT_VERSION` change, no wire or save change, no other package edited.

## Done
Versions: `world/plot-grid` v1.1, `api/rest` v0.3.0, `config/world.schema` v1.1, `audio/cues` v1.1, `events/gameplay` v1.1, `events/catalog` v1.2.

1. **Golden hashes** (`world/plot-grid.ts`): `PLOT_GRID_GOLDEN_HASHES` = grid `eecb088b...c6c5`, pointToPlot `ace8f2e5...8298a`, ledger `null`. Test updated to the exact values.
2. **REST** (`api/rest.ts`): error code `VERSION_CONFLICT` (409, in `API_ERROR_STATUS`); `GetContractResponseSchema` = `ContractSummarySchema` + `inviteCode: InviteCode | null | optional` for `GET /v1/contracts/:id`. `ContractSummarySchema` unchanged and still parses the new body (key stripped), so current server tests pass.
3. **Audio requests** (presentation events, `events/gameplay.ts`):
   - `audio.cue` (`AudioCueEvent`, discriminated union over `AudioCueId` with each cue's `AudioCuePlay` params) and `audio.settings` (`{ monoAudio, captions }`, emitted on change and once after settings load).
   - `avatar.stepped { tick, actorSlot, surface: AudioSurface, speed01, placement? }`.
   - `vehicle.motion { tick, vehicleId, kindId, actorSlot|null, speed01, load01, workIntensity01, placement? }` (<= 10 Hz per vehicle, final all-zero event on stop, emitter may reuse the payload).
   - Positions for others: `AudioPlacement { distanceM, pan }` (listener-relative, computed by the emitter that owns the camera), optional `placement` on `AudioCueParams`, `tool.stroke_contact`, `avatar.jumped`, `avatar.landed`, `avatar.stepped`, `vehicle.motion`. Absent = own or non-spatial.
   - DOT: optional `syllables` (1..32, `DOT_SYLLABLES_MIN/MAX`) on `dot.message`.
   - `AUDIO_EVENT_CUES_V1_1` wires `avatar.stepped -> avatar.footstep` and `vehicle.motion -> vehicle.drive_loop, vehicle.work_loop` (see follow-ups for why it is a separate const).
4. **World** (`config/world.schema.ts`): `SunPathSchema` (`maxElevationDeg` 1..90, `minElevationDeg` -90..-1, max > min, strict), `WORLD_SUN_PATH_DEFAULT` (40 / -20), `WorldSchema.sunPath` optional on input with that default (a fresh object per parse), always present on `WorldTable`.

## Declined (with reasons)
- **`daynight` far-side flag**: far side depends on the player's position, not on a phase change, and `daynight.changed` fires only on terminator crossings, so a flag there would go stale as the player walks. The MVP Pilot Fence keeps play near the outpost; whole-moon streaming is M2-W1-T05. Revisit with a continuous source (a client-side listener state or sim query) in M2. `ambience.suit_bed.farSide01` stays 0 for now.
- **Positions on sim events and a listener/emitter position service**: sim events are deterministic Solo/server payloads, and adding positions there changes sim output and bandwidth. A new `ServiceTypes` key forces a composition-root registration. The emitter-computed `placement` on presentation events covers footsteps, vehicles, tools and jumps. Others' Stamps, robot sounds and sales stay unspatialised until a sim-side need is shown.
- **`mono` and `captions` in `UiSettingsState`**: not added, because required fields would break the UI store's initial state and persistence. They travel as the `audio.settings` event instead. The UI owner may mirror them into the store later (additive then).
- **Rows for the new events in `AUDIO_EVENT_CUES`**: deferred. The client's `EventRouter` types its handler table on that object's keys, so adding rows would break `apps/client` compilation. Split as add (`AUDIO_EVENT_CUES_V1_1`), migrate (audio-engineer adds handlers), remove (next contracts wave merges the two rows and deletes the const).

## Consumer follow-ups
- **apps/client/src/audio** (audio-engineer): subscribe to `audio.cue` (play `id` with `params`), `audio.settings` (mono, captions), `avatar.stepped` and `vehicle.motion` using `AUDIO_EVENT_CUES_V1_1`; apply `placement` (rolloff and equal-power pan) instead of the fixed 0.5 gain for others; use `dot.message.syllables` when present; drive `vehicle.drive_loop` / `work_loop` from `vehicle.motion` instead of the fixed 0.4.
- **apps/client/src/gameplay** (gameplay-systems): emit `avatar.stepped` (per foot contact, own and others), `vehicle.motion`, fill `placement` for others on the events above; set `syllables` on `dot.message` if it knows the resolved text.
- **apps/client/src/ui**: emit `audio.cue` for ui.click/hover/toggle/panel/clock_in; emit `audio.settings` on change and after load.
- **apps/server/src/api** (backend-data-engineer): answer a stale `PATCH /v1/me` with `409 VERSION_CONFLICT` (now `409 BAD_REQUEST`); return `inviteCode` for the Holder of a Private Shift on `GET /v1/contracts/:id` (validate with `GetContractResponseSchema`); add tests. **apps/client/src/net**: on `VERSION_CONFLICT` refetch `/v1/me`, reapply, resend.
- **packages/game-data** (game-designer): `sun-path.ts` should read `world.sunPath` (drop the local constant or alias `WORLD_SUN_PATH_DEFAULT`); optionally write `sunPath` into `data/world.json`. The T05 per-row `archetype` token for `pacing-targets` was not in this brief and is not done.
- **packages/world** (terrain-dust): golden lane may now assert against `PLOT_GRID_GOLDEN_HASHES` (the comment in `test/golden/lane.ts` can be dropped). Ledger digest is still pending.
- **Lead**: `docs/architecture/module-boundaries.md` section 2 is stale (not edited, the brief did not ask): `world` golden hashes no longer `null`; `events` catalog v1.2 / gameplay v1.1; `audio` cues v1.1; `config` world.schema v1.1; `api` rest v0.3.0.

## Evidence (Node 26.13.1 via fnm PATH prefix; this file state)
- `@moon-cleanup/shared`: tsc 0 errors, eslint clean, prettier clean, vitest 32 files / 454 tests pass (new: `events/audio-events.test.ts`, additions in `rest-v2.test.ts`, `bundle.schema.test.ts`, `plot-grid.test.ts`).
- Consumers `tsc --noEmit`: client, server, protocol, world, game-data, db all 0 errors, no consumer edits needed.
- Spot test runs: game-data 55, protocol 51, db 78 (2 skipped, need DATABASE_URL), server `src/api` 43, client `src/audio` 46: all pass.
- NOT RUN: whole-repo `pnpm verify`; Firefox/WebKit golden lane.

Files: `packages/shared/src/{world/plot-grid.ts,world/plot-grid.test.ts,api/rest.ts,api/rest-v2.test.ts,config/world.schema.ts,config/bundle.schema.test.ts,audio/cues.ts,events/gameplay.ts,events/catalog.ts,events/audio-events.test.ts}`.

Blockers / contract requests: none.
Commit suggestion: feat(shared): contracts bump 1 (golden hashes, VERSION_CONFLICT, audio presentation events, world.sunPath)
