# M1 solo restore + audio boot timing (integrator)

Status: A and B done; checks green except one failure outside my paths (net) · 2026-11-14 · Sonnet 5.5
Scope: `apps/client/src/sim-host/**`, `apps/client/src/app/**`. No edits to packages/**, apps/server, audio/** (not needed).

## A) Restore host on the new sim checkpoint format (DONE)
- `sim-host/sim-checkpoint.ts`: save now wraps `sim.captureCheckpoint()` (META v1, PLAYERS v1) in the save envelope. Decode picks sections by id; both version 0 gives the legacy interim data, anything else goes to the sim, which validates it.
- `sim-host/worker-core.ts` `boot`: new saves are restored with `sim.addActor(SELF)` then `sim.restoreCheckpoint(...)`; v0 saves still use the old constructor-option path (tick, wallet, pose). Any read failure (store error, gunzip, bad CRC or magic, missing sections) or a sim rejection (`ok:false`) starts a fresh game, keeps the generation lineage if the header was readable, and posts the new worker message `restore_failed` (`messages.ts`).
- `sim-host/local-room-host.ts`: new option `onRestoreProblem(reason)`. `app/solo-host.ts` forwards it to `onProblem`, so it reaches `boundary.report("solo save restore", Error(reason))` (non-fatal banner).
- Tests (all pass): v1 save -> reload gives equal hash and byte-equal META/PLAYERS sections (tick, wallet, pose, tools, holster, Dust Cells; cells non-empty asserted); v0 save (real old layout written by `test-support.encodeLegacyV0Save`) loads tick 200, wallet, pose within 0.5 m, generation continues, re-save is v1; six corrupt cases (random bytes, truncated gzip, flipped byte, truncated PLAYERS rejected by sim, unsupported version 9, missing sections) each start fresh at tick 0, report once, keep ticking and re-checkpoint. App test: restore problem reaches `onProblem`.
- Host cost (Node MessageChannel harness, 2000 ticks, 2000 inputs): main-thread host cost p95 0.012 ms, max 0.349 ms; worker tick p95 0.090 ms. No per-tick code changed (capture/restore run at checkpoint/boot only).
- Not fixed, by instruction: Dust on plots does not persist (the ledger is not in the checkpoint). Open: a rejected or corrupt save is replaced by the next checkpoint (one record per Contract), so a save that a future build rejects is lost at the first timer checkpoint; consider keeping the old record as a backup.

## B) Audio boot timing (DONE)
- `app/boot.ts`: `AudioModule` is held in a const; `audio?.prepare()` runs right after the module init loop and before `frameLoop.start()`, so the suspended AudioContext and the cue Worker are built in the loading phase. The module's idle hook and gesture path stay as fallbacks (`prepare` is idempotent). No change to `audio/**`.
- Test: `boot-wiring.test.ts` checks the order (init, then prepare, then frameLoop.start).

### Measurement (MEASURED: Playwright, installed Chrome channel, headed, this Windows laptop, `vite build` + `vite preview`, real game page `?preset=low`, 1280x720; 3 runs per variant; script and raw JSON in the session scratchpad `audio-boot.mjs`, `audio-boot2.json`)
Window = 5 s after `__mcReady` and the first rendered frame; click at +1 s, key `w` held +2.0 to +2.5 s. Long tasks from PerformanceObserver (>= 50 ms), frame gaps from a rAF probe.

| Variant | AudioContext construction (ms, run 1/2/3) | Construction time vs ready | Longest long task, first 5 s | Max frame gap, first 5 s |
| --- | --- | --- | --- | --- |
| before (idle prepare, 800 ms timer + idle callback) | 322 / 166 / 157 | +10 to +13 ms after ready (inside play) | 330 / 171 / 161 ms (1 task each) | 333 / 167 / 150 ms |
| after (prepare in boot, before frame loop) | 176 / 173 / 178 | -1.6 to -1.9 s (before ready) | none >= 50 ms in all 3 runs | 17.0 / 33.3 / 16.8 ms |

- Gesture-time cost (click window, 1 s): no long task and max frame gap 16.8 to 17.5 ms (one 33.3 ms outlier in a "before" run), in both variants. Caveat: headed Chrome created the context in state `running` (autoplay allowed), so `resume()` was never called and the suspended-then-resume path was NOT exercised in a real browser (covered by fake-context tests only). The construction cost itself no longer touches the gesture in either variant.
- Cost moved, not removed: boot now has a 173 to 178 ms construction inside the loading phase (before the first frame), versus 157 to 322 ms in play. The "before" run to run spread (157 to 322 ms) is machine noise.
- The earlier "idle after 800 ms" design did not help in practice: the 800 ms timer starts at module init, which is well before the first rendered frame, so the idle callback fired about 10 ms after play started.
- NOT RUN: UHD 620, Firefox, Safari, autoplay-blocked browser (suspended start), multi-minute heap.

## Gates
| Check | Result |
| --- | --- |
| `tsc -p apps/client/tsconfig.json --noEmit` | PASS (exit 0) |
| `eslint src/sim-host src/app --max-warnings=0` | PASS (exit 0) |
| `prettier --check src/sim-host src/app` | PASS |
| `vitest run` (apps/client) | 424 pass, 1 FAIL (425 total), see below |
| `vite build` | PASS (used for the measurement) |
| `pnpm verify` | NOT RUN (instructed) |

## Mismatch returned to owner (not patched, outside my paths)
- `apps/client/src/net/session.test.ts` "reports a 4100 join rejection as lost with that close code": expected `{state:"lost", closeCode:4100}`, got `state:"connecting"`. Fails deterministically when run alone; `src/net` has no working-tree change by me, so it is likely a side effect of the uncommitted apps/server join/admission edits or of the net module. Owner: net / server integrator.

## Open issues
- Dust on plots does not persist (ledger not in the checkpoint), as instructed.
- A rejected or corrupt save is replaced by the next checkpoint (one IndexedDB record per Contract); consider keeping the previous record as a backup.
- The sim restore path for reboots after a worker crash (memory store) uses the same code and is covered by the v1 round-trip test.

## Recommendation
Accept A and B. Fix the net session test failure before the final `pnpm verify`. Re-measure the audio start on the UHD 620 and in a browser that blocks autoplay.
