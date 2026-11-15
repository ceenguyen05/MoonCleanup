# M1-W3-T01b follow-up: lattice residue fix (terrain-dust-engineer)

Task / status: **in-review; pitch snap done and goldens re-recorded once; the `DUST_MODEL_VERSION` constant is NOT bumped (it lives in `packages/shared`, see Blockers)** / 2026-11-14 / terrain-dust-engineer / Fable 5.2
Node 26.13.1 (fnm PATH prefix), i7-8650U, Windows 11, headless Chromium for the browser lanes. No git mutation. Root `pnpm verify` not run (per brief). No server or browser left running.

## Done

- **Pitch snap** (`packages/world/src/dust/ledger.ts`): the lattice pitch is still clamp(width / 8, 25, 100) mm rounded, then snapped **down** to the largest divisor of the 800 mm texel edge. Possible pitches: 25, 32, 40, 50, 80, 100 mm. One table lookup in `applyStroke` (a 101-byte table built at module load), same lookup in `latticePitchMm`. No allocation, no API change.
- Why down and not nearest: it never samples coarser than the width / 8 of WDS 4.5 step 3. Only T4 differs between the two (80 against 100 mm).

| Tool | width | pitch before | pitch now |
| --- | --- | --- | --- |
| T1 Desk Duster | 0.15 m | 25 | 25 |
| T2 Crescent Squeegee | 0.28 m | 35 | 32 |
| T3 Bristle Broom | 0.45 m | 56 | 50 |
| T4 Lane Broom | 0.75 m | 94 | 80 |
| T5, T6, Charge, vehicles, robot lanes | 0.8 m and up | 100 | 100 |
| Detailing disc | 0.5 m | 63 | 50 |

- **Residue, lanes exactly one width apart, Depth = level, Mare plot, no jitter, 5 lane phases (worst):**

| Tool | left after one pass, before | now | passes to Polished, before | now |
| --- | --- | --- | --- | --- |
| T3 | 2.12 % | Polished inside the pass | 1.50 | 0.86 |
| T4 | 3.23 % | Polished inside the pass | 1.61 | 0.88 |

  New regression test: every hand tool with Depth >= level Polishes Highland, Mare and Crater Floor in one pass of exact-width lanes at 5 lane phases.
- **Not fixed by this, and not lattice:** with the same lanes and +-5 cm jitter, Mare T3 / T4 still need a second partial pass (1.60 -> 1.45 and 1.67 -> 1.60 passes; 1.89 % / 3.05 % left after one pass, was 3.39 % / 4.78 %). That is ground the jittered lanes really miss.
- Detailing disc removes 74 to 81 units depending on where it lands (was 71 to 83; design 78). Test bounds tightened to 72 .. 84.

## Goldens (re-recorded once)

| Golden | before | now |
| --- | --- | --- |
| `GOLDEN_REPLAY` (stand-in ledger, `packages/sim/test/golden/cases.ts`) | stateHash 4037918216, strokeHash 2027053455, strokes 3975, gramsCollected 56640 | **unchanged** (the stand-in has no lattice; the test passes on the old values) |
| `GOLDEN_REPLAY_WORLD_LEDGER.stateHash` | 634894361 | **1669990435** |
| `GOLDEN_REPLAY_WORLD_LEDGER.gramsCollected` | 67192 | **67504** (+0.46 %) |
| `GOLDEN_REPLAY_WORLD_LEDGER.dustHash` | 4087304160 | **3965169329** |
| strokeHash / strokes / ledgers / polished | 2027053455 / 3975 / 25 / 0 | unchanged |
| `packages/world/test/vectors/ledger-v1.json` worldHash | 3416099554 | 1057297321 |
| same file, totalRemovedUnits | 505031 | 505143 |
| same file, chunksSha256 | f8cae0e7...87f784b | 3a8cd99e...3dd0947 |
| same file, chunkBytes / polishedPlots / strokesSha256 | 34530 / 1 / eb39dbe7... | unchanged |

The new world-ledger values were produced identically by four independent runs: sim golden test (Node), the 10-reload test (Node), the sim browser lane (Chromium) and the sim-host module Web Worker (Chromium).

## V3 pacing (spacing 0.75 x width, +-5 cm jitter; `dust-ledger.test.ts`)

Measured passes, columns T1 .. T6:

| Class | before | now |
| --- | --- | --- |
| Highland | 0.86 0.85 0.86 0.85 0.85 0.87 | 0.857 0.855 0.861 0.851 0.854 0.870 |
| Mare | 1.76 1.53 0.86 0.87 0.86 0.87 | 1.763 1.555 0.862 0.870 0.855 0.870 |
| Crater Floor | 1.85 1.82 1.79 1.77 0.86 1.49 | 1.849 1.824 1.775 1.774 0.855 1.495 |

- **Moon-mix T2: measured 1.197 against rule 1.45, ratio 0.825 (was 1.185, 0.82; limit 0.80).** Headroom went from about 2 to about 2.5 points; it is still the tightest row.
- Other Moon-mix ratios: T1 0.878, T3 0.866, T4 0.864, T5 0.855, T6 0.848. Outpost mix: 0.863, 0.846, 0.862, 0.854, 0.854, 0.866. All inside +-20 %.

## Cost (`packages/world/bench/dust-bench.ts`, load about 0)

- Stress set (segments up to 3.8 m): worst p99 over the 14 tools 95.4 us (bar 200 us). T2 mean 15.2, T3 9.8, T4 7.1 us.
- Hand tools, segments up to 0.6 m: mean 2.8 us, p99 6.0 us, 306 lattice points per stroke (was 2.7 us, 5.7 us, 276).
- Allocation: 0.152 to 0.273 B per stroke against a floor of 0.153 to 0.224; pool growths 0.

## Evidence (all on the final file state)

| Command | Result |
| --- | --- |
| `pnpm --filter @moon-cleanup/world exec tsc -p tsconfig.json`, `eslint .` | exit 0, exit 0 |
| `pnpm --filter @moon-cleanup/world exec vitest run` | 5 files, **100 / 100** (99 before + 1 new) |
| `pnpm --filter @moon-cleanup/world exec vitest run -c vitest.browser.config.ts` | Chromium **5 / 5** (ledger vectors included) |
| `pnpm --filter @moon-cleanup/sim exec tsc -p tsconfig.json`, `eslint .` | exit 0, exit 0 |
| `pnpm --filter @moon-cleanup/sim exec vitest run` | 7 files, **106 / 106** |
| `pnpm --filter @moon-cleanup/sim exec vitest run -c vitest.browser.config.ts` | Chromium **2 / 2** |
| `pnpm exec prettier --check` on the four changed files | clean |
| `pnpm --filter @moon-cleanup/balance-sim balance:assert` | exit 0, 9 MVP rows PASS, values unchanged (5.50 min, 6.13 min, 1.16 h, 1.54 h, 8.87 min, 2.17, 3.40, 0.53 h, 0.65 h); v1.0 rows SKIPPED as before. Root `pnpm balance:assert` does not exist |
| `pnpm --filter @moon-cleanup/balance-sim exec vitest run` | 17 / 17 |
| `pnpm --filter @moon-cleanup/client exec vitest run src/visuals src/sim-host` | 15 files, **136 / 136** (dust atlas / replay included) |
| `pnpm --filter @moon-cleanup/server exec vitest run src/net` | **151 / 151** on the second run; `src/net/shift` 22 / 22 (shift-ledger included). First run: 150 / 151, `seat-cap-idle.test.ts` idle-close timing failed once; it passes alone (8 / 8) and in the rerun. Not dust code |
| `pnpm --filter @moon-cleanup/client exec vitest run --config src/sim-host/browser/vitest.browser.config.ts` | **4 / 5: FAILS on the stale golden copy** (below). The Worker returned exactly the new values |

NOT RUN: Firefox / WebKit lanes, client GPU verify page (`run-verify.mjs`), root `pnpm verify`.

## Blockers / requests

1. **contracts-architect: bump `DUST_MODEL_VERSION` 1 -> 2.** The constant is in `packages/shared/src/world/dust.ts:45`, a contract file outside my paths and the brief, so I did not edit it. The code now behaves as model 2 while saves are still stamped 1. Nothing compares the stamp today, and old ledgers load unchanged (the rule only affects new strokes). The bump needs, together:
   - `packages/shared/src/world/dust.ts`: constant 2, header note, and the comment on `LEDGER_LATTICE_PITCH_DIVISOR` (add "then snapped down to a divisor of LEDGER_TEXEL_SIZE_MM").
   - `packages/shared/src/world/dust.test.ts:112`: expect 2.
   - `packages/world/test/unit/dust-chunk.test.ts:128`: expect 2, and `packages/world/test/vectors/ledger-v1.json` line 2 `"dustModelVersion": 2` (I can do these two; they fail until the constant changes, so I left them at 1). No hash changes with the bump.
2. **sim-host owner: `apps/client/src/sim-host/browser/sim-host.worker-lane.ts:22` holds a copy of `GOLDEN_REPLAY_WORLD_LEDGER`.** Not my path, not edited. Set stateHash 1669990435, gramsCollected 67504, dustHash 3965169329. This lane is not part of `pnpm verify`.
3. **Doc numbers that now conflict (docs not edited):**
   - WDS 4.5 step 3: "pitch p = clamp(width/8, 25 mm, 100 mm), rounded to whole mm" lacks the snap.
   - WDS 4.5b V3 row and progression-and-economy.md:43 name "lattice residue" as a cause of the +-15 % per-pair spread; what remains is frame overshoot and lane jitter.
   - WDS 4.5 step 6: "hand about 100 lattice points per stroke"; measured 306 (276 before this change).
   - Test comments quoting 71 .. 83 units for Detailing are updated in code; no doc states that range.

## Housekeeping

- My worker-lane run wrote two screenshots into the untracked `apps/client/.vitest/attachments/`; I deleted those two only. Two older files from 21:46 are someone else's and remain.
- `balance:assert` rewrote the git-ignored `tools/balance-sim/out/report.md`.
- The old `ledger-v1.json` is kept in my session scratchpad only.

## Next

1. Lead: route blocker 1 (contracts-architect) and blocker 2 (sim-host owner); docs-keeper for item 3.
2. After the constant is 2: the two one-number edits in `packages/world` named above.

## Files

`packages/world/src/dust/ledger.ts`, `packages/world/test/unit/dust-ledger.test.ts`, `packages/world/test/vectors/ledger-v1.json`, `packages/sim/test/golden/cases.ts`, this report.

Commit suggestion: `fix(world): snap the dust lattice pitch to a divisor of the texel edge and re-record the ledger goldens`
