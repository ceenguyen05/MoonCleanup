# CODEX audio bridge — 2026-11-18

Status: implemented and focused checks pass; browser/listening acceptance pending lead's shared real-GPU check. W7-T05 remains in review for the remaining items below.

Scope/authority: temporary owner-authorized Codex worker; boot audio registration plus narrow sim-host readout bridge. Read CLAUDE.md, STATUS.md latest checkpoint/owner decisions/next-session queue, MODEL_POLICY.md, REFERENCE_TARGET.md, M1-W7-T05-audio.md and M1-solo-restore-audio-integrator.md. No STATUS, model-policy, git, goldens, production or secrets changes. Source writes paused during lead GPU capture and resumed after release. Coordinated boot ownership directly with outpost worker.

## Changes

- `app/boot.ts`: the enabled audio module now owns an AudioBridge before prepare/frame-loop startup; its frame slot pumps bridge then audio. Audio-disabled/capture lanes construct no bridge.
- `app/audio-bridge.ts`: forwards only AUDIO_EVENT_CUES notifications from the current RoomHost to the typed bus. Host swaps/disposal detach listeners and end own vehicle audio. Cached own Solo vehicle motion is emitted at <=10 Hz with speed, hopper load and attachment intensity, plus a final all-zero event on stop. Already-seated subscription and pause/resume are seeded from authoritative cache. Completed-tick guards prevent stale readouts undoing an enter or resurrecting an exited seat.
- `sim-host/messages.ts` / `readouts.ts`: optional vehicle motion in the existing worker readout message; true sim readout speed/load/intake and completed tick/entity id. Work is off while boosted, airborne, reversing, full, stationary or intake raised, matching intake conditions. Scratch data/messages are reused; unchanged readout messages remain suppressed. No new FRAME decoder, network import, input delay, sim change or render-frame object allocation. Seat transitions may allocate one small payload.

## Tests and evidence

All tool commands use fnm Node 26.13.1. `fnm exec --using=26 pnpm ...` cannot spawn pnpm in this environment; direct Node CLI paths work (no install needed).

From `apps/client`:

- `fnm exec --using=26 node ../../node_modules/vitest/vitest.mjs run src/app/audio-bridge.test.ts src/app/boot-wiring.test.ts src/sim-host/readouts.test.ts src/audio` — final PASS, 9 files / 85 tests, 51.89 s on loaded machine.
- `fnm exec --using=26 node ../../node_modules/eslint/bin/eslint.js src/app/audio-bridge.ts src/app/audio-bridge.test.ts src/sim-host/readouts.ts src/sim-host/readouts.test.ts src/sim-host/messages.ts` — PASS, exit 0.
- `fnm exec --using=26 node ../../node_modules/prettier/bin/prettier.cjs --write src/app/audio-bridge.ts src/app/audio-bridge.test.ts src/sim-host/readouts.ts src/sim-host/readouts.test.ts src/sim-host/messages.ts` — applied successfully (final extra changes formatted separately with same CLI).

From root:

- `fnm exec --using=26 node node_modules/typescript/bin/tsc -p apps/client/tsconfig.json --noEmit` — PASS, exit 0 on the final source state (including stale-cache guard).

Regression coverage: boot must install bridge before prepare (old boot fails); real host event forwarding exactly once across swaps/disposal; 10 Hz level updates/final zero; missed initial seat; stale-cache enter/exit ordering. Real MoonRoomSim Trundle purchase/call/enter then structured-clone/cache verifies speed/load/work, suppression during boost/reverse/full hopper, stop and exit changes. The old readout cache has no vehicleMotion so this assertion fails on old behavior. Initial local test harness mistakes (publisher method name, vehicle id field) were fixed before green checks.

## Remaining / limits

- Remote host sim notifications are forwarded, but remote vehicle motion/placement is still unclaimed: its readout source has no vehicle data. Own Solo motion is complete; no guessed remote load/intake data was added.
- `avatar.stepped`, remote placement, UI `audio.cue` / `audio.settings`, browser listening/loudness and true-peak acceptance remain open per original audio report.
- Real-GPU look-check: lead owns shared browser check on current integrated tree; requested audio-enabled boot/no-errors check. This change has no visible assets/shader changes, so standalone visual comparison is N/A. No browser/GPU/perf claim made by this worker.
- Full pnpm verify is lead-owned and not run here. Goldens unchanged. No servers/browsers started; final tool processes are short-lived checks only.

