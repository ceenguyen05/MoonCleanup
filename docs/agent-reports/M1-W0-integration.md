# M1-W0-T05 — M1-W0 integration (integrator)

Task / status: done for the card scope, gate FAIL on two unrelated items (below) / 2026-11-14 / integrator / Sonnet 5.5. No git used. Node 26.13.1 (checked with `node -v` after the fnm PATH prefix).

## Verdict

Apps compile against contracts v1 (`PROTOCOL_VERSION = 1`, `SAVE_FORMAT_VERSION = 1`). `pnpm verify` is **not green**, for two reasons that are not caused by the contracts bump (details and exact output below): a lint failure in files another agent added (`tools/perf/scripts/*.mjs`) and one server test suite that timed out in a hook while the machine was loaded (passes in isolation).

## Gates

| Gate | Result | Evidence |
| --- | --- | --- |
| `tsc` apps/client, apps/server, packages/protocol, packages/db, tools/bots (before my edits) | 1 error | only `apps/client/src/render/tier.ts(129,9) TS2740` (QualitySettings new groups); the rest clean |
| same, after my edits | PASS | all exit 0 (inside `pnpm verify`: every `typecheck` task successful) |
| `vitest` apps/client `src/app` | PASS | 4 files / 32 tests (new `ui-reducer.test.ts` included) |
| `vitest` apps/client `src/render` | PASS | 12 files / 164 tests |
| `vitest` apps/server `src/api/health.test.ts` | PASS | 7 tests (was failing on `protocolVersion: 0`) |
| `pnpm verify` run 1 (`turbo run lint typecheck test build`) | FAIL (aborted fail-fast) | 26 of 45 tasks, 38.6 s; failed `@moon-cleanup/perf#lint`. Log: `C:\Users\caseyn\AppData\Local\Temp\claude\430d3d07c3d5e4f4\5a7524bb-e0d6-4adc-a1f7-8310425628b1\scratchpad\verify.log` |
| `pnpm verify` run 2, same command + `--continue` (needed to see past the abort; same tree) | FAIL | 50 of 52 tasks successful, 26 cached, 1m18s; failed `@moon-cleanup/perf#lint`, `@moon-cleanup/server#test`. Log: `...\scratchpad\verify2.log` |
| Re-run of the failed server suite alone | PASS | `vitest run src/net/admission-ws-rooms.test.ts`: 2 tests passed, 2.78 s |

Everything else in the 52 tasks passed: all `typecheck`, all other `lint`, all other `test` (server: 14 files passed, 148 tests passed, 2 skipped), and all `build` tasks (client build ends `built in 7.25s`; only the existing framer-motion "use client" notices).

### Failure 1 (unrelated): `@moon-cleanup/perf#lint`

Files `tools/perf/scripts/gpu-timing-ab.mjs` and `gpu-timing-probe.mjs` (not mine; created by the performance work running in parallel). Exact output:

```
tools\perf\scripts\gpu-timing-ab.mjs
  56:38   error  'window' is not defined  no-undef
  57:53   error  'window' is not defined  no-undef
  70:19   error  'window' is not defined  no-undef
  87:53   error  'window' is not defined  no-undef
  87:80   error  'window' is not defined  no-undef
  87:115  error  'window' is not defined  no-undef
tools\perf\scripts\gpu-timing-probe.mjs
  19:36  error  'window' is not defined  no-undef
  27:52  error  'window' is not defined  no-undef
8 problems (8 errors, 0 warnings)
```

Owner: the profiler / `performance-profiler` (browser-evaluated code inside `page.evaluate` needs a `/* global window */` comment or an eslint override in `tools/perf`). I did not touch it (outside my paths, and the file is being written by another agent).

### Failure 2 (flaky under load): `@moon-cleanup/server#test`

```
FAIL  src/net/admission-ws-rooms.test.ts [ src/net/admission-ws-rooms.test.ts ]
Error: Hook timed out in 10000ms.
 ❯ src/net/admission-ws-rooms.test.ts:24:1   (beforeAll: createGameServer({ port: 0, ...
Test Files  1 failed | 14 passed (15)   Tests  148 passed | 2 skipped (150)
```

The same suite passes alone in 2.78 s. Cause: the 10 s `beforeAll` hook budget was exceeded while turbo ran 9 parallel tasks and a GPU capture ran on the same laptop. Owner: netcode-engineer / devops-engineer (raise `hookTimeout` for the Colyseus-boot suites, or run server tests with lower concurrency). Not caused by v1: the log lines `closed unexpectedly (4002)` and `(4100): {"serverProtocol":1,...}` in the same output are expected negative-path tests.

## Wiring and compile fixes (every edit)

| File | Change | Why |
| --- | --- | --- |
| `apps/client/src/render/tier.ts` (`resolveQuality`) | the resolved literal now starts with `...base` (shared preset) before overriding `preset`, `dprCap`, `dynres`, `shadows`, `post` | `QualitySettings` v1 has 9+ new required groups (lights, terrain, texturePoolMb, dust, particles, sky, budgets, distances, ui). Values come from `QUALITY_PRESETS`, no invented numbers; `visuals/**` untouched; future new groups need no edit here |
| `apps/server/src/api/health.test.ts` | `protocolVersion: PROTOCOL_VERSION` (import added) | hard-coded `0` |
| `apps/client/src/app/ui-reducer.ts` (new) | pure `applyUiAction(state, action, ctx)` for every `UiAction`: 26 `<slice>.set` shallow merges (identity kept if nothing changed), `wallet.delta` (ring 8, `settle`), `notices.push/dismiss` (merge by `mergeKey`, 3 visible newest first, higher priority pre-empts oldest lower, cap 8 dropping ambient first), `dot.say/next` (queue 3, history 50), `menus.open/back/closeAll/modal`, `compass.ping` (replace by id, prune expired), `checklist.complete`, `saveSync.resolveConflict` (only while `state === "conflict"`), `saveSync.restoreBackup` (only while `backupAvailable`) | T03/T06 actions; the old flush handled only `session.set` |
| `apps/client/src/app/ui-store.ts` | flush now folds the queue through the reducer; `createUiStore(maxHz, wallClockMs = Date.now)`; 15 Hz throttle and identity-on-change unchanged | same |
| `apps/client/src/app/ui-reducer.test.ts` (new) | 17 tests of the above | same |
| `docs/architecture/module-boundaries.md` §2 | rows rewritten for v1 (protocol files, sim/*, room-host, world/*, save/* incl. sync-rules, events gameplay/save, ui slices, audio, render, mvp-scope, REST, version note) + new subsection "Contract versions (end of M1-W0)" | delegated |
| `docs/architecture/netcode.md` §4 intro, 4.1 (INPUT levels, 16 buttons, `INPUT_WIRE`, `select_tool`, MVP active set), 4.2 (u16 section length prefixes, Self 21/49 B with u24 grams, `plot.polished` compact event superseded), 4.3 (`hello`, `sim_events`, reserved list), 4.5 (record sizes with prefix), 12 (4002/4003/4010 rows, verified SDK reconnect set), 14 (Self +1 B note), 18 (item 1 closed, items 6/7 added) | delegated |

`roomHost` in `REQUIRED_SERVICES` (`apps/client/src/app/services.ts`): **not added**, no registration exists yet (nothing in apps/ references `roomHost`). The `ServiceTypes.roomHost` key is additive and boot does not break. Add it when the facade is registered (M1-W3-T08/T05).

Reducer decisions to confirm (documented in code, not in the contract): `dot.say` with `keep: true` queues behind a showing line, `keep: false` replaces it; `menus.back` and `menus.open` clear the modal; the focus-return id is the one given when the FIRST surface opened; notices are not filtered by `settings.noticeVerbosity` (the UI layer filters). `ui-store` stays in `apps/client/src/app/`, so the UI writer reads actions only.

## Mismatches returned to owners (not edited by me)

1. `tools/perf/scripts/*.mjs` lint errors (above) to performance-profiler.
2. `apps/server/src/net/admission-ws-rooms.test.ts:24` 10 s hook budget under load (above) to netcode-engineer / devops.
3. Contracts-architect: `RoomSim.snapshot()` is cold path; hot-path frame source (`readSelf(actor, out)` + interest iterator) is undefined (T02 open item 1, netcode §18 item 6). Must be agreed before M1-W4-T01 writes the FRAME encoder.
4. Contracts-architect: `packages/shared/src/index.ts` header is v1 already; nothing outstanding. T01 `PLOT_GRID_GOLDEN_HASHES` ship `null` (filled by M1-W1-T01).
5. Still unverified from netcode §18 item 1: `exposedMethods`, `reserveSeatFor`, `broadcastPatch` with auto patching disabled (netcode-engineer, before M1-W4-T02).

## Consumers that must adopt v1 (by wave, from the M1 task table)

| Module / path | What to adopt | Task and wave |
| --- | --- | --- |
| `packages/world` | `PlotGrid` (`world/plot-grid`), ledger + FNV-1a hashes + golden vectors (`world/vectors`), fill `PLOT_GRID_GOLDEN_HASHES`, dust chunk codec (`save/dust-chunk`), `[R]` zero-length stroke = disc | M1-W1-T01 (grid, height, golden hashes); M1-W3-T01 (ledger, rasteriser, thresholds `LEDGER_UNITS_PER_LEVEL = 16`); M1-W3-T04 (server dust state, chunk codec, checkpoint serialisation) |
| `prototypes/dust-sim/*` | stroke/ledger shapes from `world/stroke`, `world/dust`, `QualitySettings.dust.*` | M1-W1-T02..T05 |
| `tools/screenshots`, `tests/e2e` (harness) | `QualitySettings` v1 groups if it builds a literal | M1-W1-T02 |
| `packages/game-data` | test that every id in `MVP_SCOPE` exists in the bundle; config limits (dust level <= `LEDGER_MAX_DUST_LEVEL`, thresholds 0.1 %/1 %) | M1-W2-T05 |
| `tools/balance-sim` | policy `mvp` reads `MVP_SCOPE` | M1-W2-T05 |
| `apps/client/src/render` | `QualitySettings` v1 groups (`resolveQuality` already spreads), render infra reads budgets/distances | M1-W2-T03 |
| `apps/client/src/terrain`, `visuals` | `dust.atlas`, `dust.ring`, `dust.residencyRadiusM`, terrain LOD, sky/light rows | M1-W2-T01, T02, T04; M1-W3-T02 |
| `packages/sim` | `RoomSim` v1 (`tick`, `applyInput`, `applyIntent` returning `IntentResult`, `addActor`, `removeActor`, `snapshot`, `onEvent`), input edges derived from LEVELS, `SimEventMap` events with `tick`, save envelope v1 + v0 to v1 upgrade, `StrokeRecord` emission, `MVP_SCOPE`, hot-path frame source | M1-W3-T03 (core); M1-W4-T03 (server driver, validation) |
| `apps/client/src/sim-host` | `LocalRoomHost` (`checkpoint`, `pause`, `suspend`, `resume`, `close`), pooled `RoomHostFrame`, emit `save.checkpointed/restored/backup_stored/storage_warning`, local MCCK package | M1-W3-T08 |
| `apps/client/src/app` | register the `roomHost` facade (`RoomHostService`), add `"roomHost"` to `REQUIRED_SERVICES`, reducer already implements all actions | M1-W3-T05 (integration) after T08 |
| `apps/client/src/gameplay`, `animation` | `AvatarActionState`, `MoveState`, `INPUT_BUTTON_MASK`/`INPUT_BUTTON_MEANING`, `ControlIntent` (`purchase`, `select_tool`), `roomHost.current` + `onChange`; ui slices writers (holster, suit, vehicle, interaction, plotCard, assay, dot, checklist) | M1-W4-T03 (input, camera, tool aiming); M1-W5-T04 (animation); M1-W6-T01, T02 (tools, economy) |
| `packages/protocol` | codecs for INPUT (`INPUT_WIRE`), FRAME (header 9 B, Self 21/49 B, u16 section prefixes, slot changes, entities), dust messages, `sim_events`, `SHIFT_STATE_SCHEMA_FIELDS` Schema, rate limits `limits.ts`, golden vectors in `protocol/vectors` | M1-W4-T01 |
| `apps/server/src/net` | `ShiftRoom`, sequencer per `INPUT_SEQUENCING`, zod-validate every control message with `PAYLOAD_SCHEMAS`, `sim_events` batching, close codes incl. 4002/4003/4010 notes, `PROTOCOL_VERSION = 1` handshake | M1-W4-T02; M1-W8-T01 (co-op, kick, reconnect) |
| `apps/client/src/net` | `RemoteRoomHost` (Schema to `ShiftStateView` array form, `sim_events` to `onEvent`), prediction/reconciliation on Self `cellGrams` (= `dust.ack`), dust ingest, wake-up | M1-W4-T04 |
| `packages/db`, `apps/server/src/api` + persistence | routes from `API_ROUTES`, DTOs of `api/rest` v0.2.0, `API_ERROR_STATUS`, DB schema v1 + guest auth | M1-W4-T05 |
| `apps/server` persistence | checkpoints, lease, restore, SIGTERM drain, generation columns | M1-W5-T01; checkpoint upload/verify/head/download REST + `CHECKPOINT_REJECT_REASONS`, `generation_not_increasing` (rules 1 and 4 of `save/sync-rules`) | M1-W5-T07 |
| `apps/client/src/net` (sync) | upload queue, head check, conflict detection, `saveSync` slice writes, `save.queued/synced/upload_failed/conflict/resolved/restored`, consume `saveSync.request` | M1-W5-T08; open-to-friends handoff and Return to solo: M1-W8-T07 |
| `tools/bots` | v1 INPUT layout (16 levels), v1 fixtures, `MVP_SCOPE` | M1-W5-T02 (real-protocol bots); M1-W8-T04 |
| `apps/client/src/ui` | read the 26 slices; text catalog ids (`textId`, `labelId`); HUD, toasts, Desk, Ops Console, settings; "Which copy?" modal, sync indicator, backup restore (`saveSync.*`); compass, onboarding, invite UI | M1-W6-T04; M1-W6-T07; M1-W7-T03 |
| `apps/client/src/audio` | `AUDIO_CUE_DEFS`, `AUDIO_EVENT_CUES`, buses/voices; audio-pack manifest with one entry per `AUDIO_CUE_IDS` | M1-W7-T05 |
| `apps/client/src/debug` | event log: `EVENT_NAMES` grew by 9 save events (+ 29 sim, 9 presentation) | with first debug-touching task in M1-W3-T05 (integration) |
| `packages/sim`, client, server integration | Solo to Private handoff (`LocalRoomHost.suspend` then authoritative room) | M1-W8-T07 |

## Open issues

- Golden determinism lane is a STUB (T04): constant hash `2086404176`; real cases arrive with M1-W1-T01 and M1-W3-T03. Firefox/WebKit lanes and the CI `determinism` job have not run locally/CI.
- Bit layouts are verified only against a test-local packer (no FRAME codec yet).
- `pnpm verify` environment noise: a GPU capture by another agent was running on this machine during both runs; turbo timings are not comparable with T04's 3m01s.

## Recommendation

Proceed to M1-W1 (T01 and T02 may start). Before relying on a green verify: have the profiler fix the `tools/perf` lint errors and have netcode/devops raise the `admission-ws-rooms` hook timeout; then one clean `pnpm verify` closes the acceptance item `/verify PASS` (currently FAIL on those two, not on v1 compile). All v1 compile fixes needed in apps/ are done.
