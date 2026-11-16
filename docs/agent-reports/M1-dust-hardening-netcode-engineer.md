# M1 dust hardening (netcode-engineer)

Fixes security review findings F1, F2, F4 from `M1-dust-save-security-review-netcode-security-reviewer.md`. F3 not done. No git. Solo path untouched (online-only files).

## Changes

- **F1** `apps/server/src/net/shift/shift-core.ts`: per-seat DUST_SNAPSHOT egress credit (`SNAPSHOT_EGRESS_BURST_BYTES` 96 KB, refill `SNAPSHOT_EGRESS_BYTES_PER_S` 4 KB/s). Each built snapshot charges its wire bytes; a seat with credit <= 0 keeps `dustSnapshot` pending and waits (nothing dropped, no close). Join, reconnect and unhide snapshots (15-25 KB) stay well inside the burst, so legit resume is unchanged and the 2 s minimum interval still applies. A new occupant starts with a full budget. Sustained forced-snapshot egress is now <= 4 KB/s/seat instead of one full snapshot per 2 s.
- **F2** same file: a pending chunk DUST_REQUEST is skipped when the seat's `dustSent` is null (no snapshot yet), so "all plots" is never listed.
- **F4** `apps/client/src/net/remote-dust.ts`: parallel `wantedTries`; a wanted plot expires after `WANTED_PLOT_MAX_REQUESTS` (3) requests, purged in place in `nextRequest` (no new allocation beyond the existing event-time slice). A later check re-wants it with a fresh bound, so the want is not lost forever and chunk repair is no longer starved.
- **F3** not done: needs a per-plot distance test against the seat avatar; not trivial. Remains optional (cosmetic shared data, credit-limited).

## Tests

- `shift-dust.test.ts`: F1 (debt of 10 s holds the resync past the 2 s interval, repeated requests do not multiply it, one snapshot after refill, normal resync still works), F2 (hidden seat with no snapshot gets no detail; seated seat with snapshot does).
- `remote-dust.test.ts`: F4 (unanswered plot requested exactly 3 times, then the chunk request goes out; a fresh check starts a new bounded round).
- `shift-dust-pacing.test.ts`: the worst-case 261 KB fabricated snapshot now puts the seat into budget debt, so the superseding resync waits about 40 s; test updated to assert exactly that (expected behaviour of the cap).

## Evidence (Node 26.13.1)

- apps/server `vitest run src/net/shift src/world/dust-budget.test.ts`: 9 files, 65 tests passed.
- apps/client `vitest run src/net`: 7 files, 62 passed, 1 skipped. (A first run under load failed `inflate-raw` timing 62 ms vs 50 ms and other files; clean on rerun, timing-sensitive, unrelated.)
- tsc --noEmit server and client: clean. eslint and prettier on touched files: clean.
