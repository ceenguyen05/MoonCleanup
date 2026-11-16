# M1 server dust follow-ups (netcode-engineer)

Source: `M1-server-dust-review-code-reviewer.md` (N1-N5). Client B1 is not in this scope. No git.

## Changes

| Item | Fix | File |
|---|---|---|
| N5 | `seat.snapCount = 0` in `requestDustSnapshot`, and also in the hidden/held/inactive drop in `sendDust` | `apps/server/src/net/shift/shift-core.ts` |
| N1 | `dust-budget.test.ts` no longer asserts wall-clock ms. ms/s, p50/p99 are still measured and logged. Strict ms bounds only run with `DUST_BUDGET_STRICT=1`. Default run asserts deterministic work: max 1 snapshot per tick, snapshots per seat within the 2 s interval bound, `moonWideBuilds * 4 <= snapshots` (measured 23 vs 186), sweep dust B/s/client under `DUST_STREAM_BYTES_PER_S` (measured 22), RAM, pool growths | `apps/server/src/world/dust-budget.test.ts` (outside `net/shift`, edited because the brief named it) |
| N2 | `checkDetailBody(chunkId, sent?)` lists only `sent[plot] === 1` plots (the set the chunk summary hashes); the core passes the asking seat's `dustSent`. Without `sent` it behaves as before | `shift-dust.ts`, `shift-core.ts` |
| N3 | moonWide cache is also keyed on `ledger.l0Version` (moves on `reset()`, which marks nothing dirty) | `shift-dust.ts` |
| N4 | `seat.held` added to the early return in `refreshDustInterest` (held seat no longer fills its queue / forces full scans; `requestDustSnapshot` on resume rewrites the state anyway) | `shift-core.ts` |

## Tests added

- `shift-dust-pacing.test.ts`: "a resync that supersedes a paced snapshot also drops its recorded versions". Verified to fail without the N5 line (`expected 1 to be +0` catch-ups) and pass with it.
- `shift-dust.test.ts`, `ShiftDust hardening`: N2 (detail lists 0 / 0 / 1 plots for sent = 0 / 2 / 1) and N3 (`reset()` with an empty dirty list forces a rebuild; states all zero).

## Checks (Node v26.13.1)

- `vitest run src/net/seat-cap-idle src/net/shift src/world/dust-budget` (apps/server): 10 files, 71 tests passed.
- Earlier full `src/net src/world`: 191 passed, 1 failed: `seat-cap-idle.test.ts` "closes a seat that never sends an app message..." (timing test, not touched; passes alone and in the focused run above, so a load flake like N1; not in my scope, flagging for lead).
- `tsc --noEmit` apps/server: clean. `eslint` on `net/shift` and `dust-budget.test.ts`: clean. `prettier --check`: clean.
- Budget numbers (6 seats, 20 Hz, this laptop, under load): sweep 3.73 ms/s; storm 43.17 ms/s (above the old 40 ms/s abuse bound under load, which is why the wall-clock bound was dropped from the default run).

## Left / notes

- None of N1-N5 left open. The detail-answer change (N2) relies on the client ignoring held-but-unlisted plots, which `remote-dust.ts` `check` does (compares listed plots only).
- B1 (client wanted-plot stuck after Polished) still belongs to the client owner.
