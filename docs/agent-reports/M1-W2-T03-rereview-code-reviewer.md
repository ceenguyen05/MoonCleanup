# M1-W2-T03 re-review: render infra after review fixes 1 and 2

Re-review / **APPROVED** / 2026-11-16 / code-reviewer. Read-only. Scope: `apps/client/src/render/{dynres.ts,warmup.ts,module.ts}`. Node 26.13.1 (PATH prefix confirmed). `vitest run src/render`: 14 files, 226/226.
Repro: fresh copies of the live `dynres.ts` and `warmup.ts` run with `C:\Users\caseyn\AppData\Local\Temp\claude\430d3d07c3d5e4f4\19e746ed-0596-4022-b8f3-0fb4ccf0d212\scratchpad\repro2\run.ts` (the old repro folder held stale copies).

## (a) Original blockers: fixed

- **Leaked hold:** a hold left out for the full 60 s ends the warm-up with `holds=0`, `gen=1`, `timedOut`. The next warm-up with a stable count took 33 ms (before: 60 s). A stale release of the dropped hold does nothing and does not cancel a new owner's hold (`holds` stayed 1 until the new owner released). `warmup.ts:157-163,191-195`, `module.ts:648-658`.
- **Interval signal below 60 Hz:** a frames-on-time interval signal at 50 Hz and at 30 Hz now holds scale=1 with no floor hint (before: 0.6 plus hint). The refresh floor is applied at `dynres.ts:270`. The 60 -> 30 Hz drop on the gpu signal now recovers to scale 1 (see finding 1 for its timing).

## (b) Hold generation, restart, fatal path: no race found

- Double release: the handle's `released` flag (`module.ts:654-658`) plus `s.holds <= 0` (`warmup.ts:159`) make it idempotent. A release after dispose is harmless.
- Restart during a hold: the holds stay, and the clock, cap and frame count restart. The first frame of the new renderer does not complete the warm-up (9 s recovery). A hold with a late restart ends at restart + 60 s with `timedOut`, `holds=0`. `restart` when idle or ready only clears `lastCount`, so no phantom runtime creations. The call order `restart` then `bindRenderer` then `beginWarmup` (`module.ts:932-933`, `:773`) is right. If a warm-up is already running, `begin` is a no-op and the sources stay on.
- Fatal: `onFatal` sets `fatal` and resolves the waiters (`module.ts:488-493`), and later `whenPipelinesReady()` calls resolve at once (`:663`). `fatal` is terminal, so there is no reset race.

## (c) Known limit confirmed

Interval signal, 60 Hz for 10 s, then 33.3 ms intervals (Energy Saver or unplug), GPU light: scale 0.6 and `floorHint=true` after 60 s. It stays that way until `reset()` (preset or stage change, warm-up). This matches the documented limit (`dynres.ts:27-28,348-349`). It is non-blocking: the floor is a safe state, and the interval signal is only the WebGL2 / no-timestamp-query fallback. The only real exposure is a WebGL2 session where the laptop drops to the 30 fps cap. Optional mitigation: call `reset` from the module when the page visibility or power state changes. Not required.

## Non-blocking findings

1. **`dynres.ts:75-77,347-358`: the comment "horizon is longer than the time to the floor plus the floor hint" does not hold.** The candidate keeps the fastest window since the horizon start, so a 60 -> 30 Hz drop mid-horizon (gpu signal) is learnt only at the next horizon end. Measured for drops at 0, 1, 10, 25 and 29 s into the horizon: `floorHint` first fires 18.1 s after the drop and clears 46 to 61 s after it. The scale does recover to 1. Effect: a "Lower preset?" hint shown falsely for up to about 40 s after the drop. Fix if wanted: rise on the first horizon end where the current window is above the estimate by more than jitter, or fix the wording. Also a possible 29 s window where `refreshHorizonS` could be shorter than 30 s.
2. **`warmup.ts:188`: the held time cap counts from the warm-up start, not from the last `hold()`.** A hold taken at about 59.9 s into a warm-up (for example after another owner's forgotten hold) is dropped at 60 s. Edge case only; the cost is one counted runtime pipeline creation.

Report honesty: the claims in "Review fixes" and "Review fixes 2" match the code, the repro output and the 226/226 test result. The terrain `holds: 1` explanation (6 frames at about 3 s each under SwiftShader) is consistent with the hold code.
