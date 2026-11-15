# M0 close-out: bot reconnect cap under a live kill

Role: qa-test-engineer (bots). Date 2026-11-14. Node v26.13.1.

## Result: PASS (live)

The cap already existed in code (`tools/bots/src/clients/retry.ts` `SESSION_RECONNECT`, applied in `bot.ts` `attach`):
7 retries, 100 ms base, 2 s ceiling, about 9 s of waiting, versus the SDK default of 15 retries (about 60 s). No code
change was needed; this task supplied the missing live proof.

## Live scenario

Local spike server (`run-spike.ts server --port 2571`, `ENV_NAME=local`), 6 bots (`spike-16`, netsim none, `--origin
http://localhost:5177`, which is the origin the spike harness allows; the bot default 5173 is refused with 1006).
Server process tree killed at t=15 to 20 s, restarted at once, then stopped by me afterwards.

| Run | Server listening after kill | Bots see drop after kill | Rejoin |
| --- | --- | --- | --- |
| 1 (3 s gap before restart) | 10.8 s | about 10 s | all 6 reconnected by join backoff, connected on attempt 3 to 4 after 0.7 to 1.3 s |
| 2 (immediate restart) | 8.0 s (pnpm+tsx startup) | 10.5 s | all 6 rejoined on first join attempt, within ~11 s of the kill |

- Each bot logged exactly `attempt 1..7 of 7` (6 bots x 7 = 42 reconnection lines); the cap is honoured.
- Rejoin-after-restart: about 11 to 12 s from kill, inside the 17 s budget. Uncapped SDK schedule would be about 60 s.
- Report counters both runs: joins 12, disconnects 12, unexpected drops 6, reconnects 6; snapshot rate 8.5 Hz.
- Run 2 timings come from 100 ms polling of the log files (precision about 0.1 s); no per-line bot timestamps exist.
- No orphans: port 2571 has no listener and no run-spike or cli node process remains.

Artifacts: `tools/bots/results/M0-closeout/` (kill-restart*.json/.md, bot and server logs; results are git-ignored).

## Notes

- Initial attempts failed with 1006 and then 429 (RATE_LIMITED after 22 retries) because of the wrong origin; the
  error text already hints at `--origin`. Consider making spike16 default to 5177 when `--url` is the spike harness.
- `pnpm bots -- spike-16 ...` through turbo failed in a background Start-Process (exit 1, no log); I ran
  `pnpm exec tsx src/cli.ts` in `tools/bots` instead. Not investigated further.
- Post-deploy smoke script did not exist; only an outline was added to `tools/bots/README.md` (needs the M1 real room).
- STATUS item B(7) and the NOT RUN note can be closed by the lead.
