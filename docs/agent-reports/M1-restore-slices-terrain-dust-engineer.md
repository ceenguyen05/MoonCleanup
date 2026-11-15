# M1 restore slices: `DustRestoreJob` overshoot of the 2 ms budget (terrain-dust-engineer)

Task / status: **in-review; restore job fixed and measured; under 2 ms on a quiet machine, not under machine load; atlas cold rebuild measured but NOT fixed; one golden notice** / 2026-11-15 / terrain-dust-engineer / Fable 5.2
Node 26.13.1 (fnm PATH prefix), i7-8650U + UHD 620 (the floor laptop), Windows 11. No git mutation. No server or browser left running. Other workers ran on the same machine the whole time (load 2 to 84 %), which affects every wall-clock number below.

## Golden notice (read first)

The brief's golden values are **no longer in the tree, and not because of this task**. `packages/sim/test/golden/cases.ts` was re-recorded at 06:31 today by M1-B1 (Detailing cooldown fix): `GOLDEN_REPLAY` is now stateHash 3938942926 (was 4037918216); world ledger is stateHash 3774476554, grams 66779, dustHash 2946260242 (was 1669990435 / 67504 / 3965169329).

That re-record ran while my first `packages/world` edits were already on disk, so I checked it did not absorb anything of mine: the sim golden lane was run against a copy of `packages/world/src` with my `ledger.ts` and `stroke-log.ts` edits reversed (vitest alias; confirmed loaded by making the copy throw). **Both goldens pass on the pre-change and on the changed world code with the same recorded values.** No golden had to change for this task. `packages/world/test/vectors/ledger-v1.json` is untouched and passes. (The A/B was run before the last two small edits, slack and default headroom; the normal sim lane passes after them.)

## What dominated

| Cause (before) | Measured |
| --- | --- |
| The stop rule: `run` stopped after the first unit that crossed the budget, and a unit was a whole plot record | slice p50 2.02 ms; 64 to 70 of 65 to 71 slices over 2 ms in every run |
| Pool growth by doubling in the middle of the restore (ledger pool 1024 -> 2048 -> 4096 slots, stroke-log slab 8 -> 16 MB, full copy) | one unit of 2.5 to 5.7 ms: the longest slice |
| First, unoptimised call of the code | chunk begin 1.0 to 1.5 ms, first plot record 2.0 to 2.8 ms, each one unit |

Inside a settled plot record (about 45 us): **the ownership-mask rebuild is 53 to 54 %** (1,024 nearest-centre tests), texel install 12 %, header check with contributions 18 % (the FNV ledger hash alone is 2.5 us, about 5 %), stroke-log decode 11 %. So: ledger rebuild, not the hash and not the logs.

## Done

- **Finer steps.** A plot record is 8 steps (open, mask in 4 bands of 8 rows, texels, check, log); chunk begin is a scan plus resets of 64 plots. Settled steps cost 1 to 10 us.
- **Stop before, not after.** `run` reads the clock after every step, keeps a decaying maximum per step kind, and starts a step only if twice its estimate plus 0.3 ms slack still fits. Cold estimates keep two first calls out of one slice. A preempted step enters the estimate at no more than a quarter of the budget.
- **Memory sized once.** The first step counts the incoming ledgers from the payload headers (bounded by payload bytes, so a forged header cannot over-reserve) and reserves the ledger pool and the log slab in one allocation, including the slots the host constructed the ledger with (its play headroom). The hosts' own `reserve(ledgerCount + 1024)` after the restore is then a no-op, with no host change. Growth copies only slots in use.
- Same bytes, same slots, same counters as an uninterrupted run (tests). Additions only: `DustRestoreJob(…, headroomSlots?)`, `slowestStepMs`, `WorldDustLedger.openLedger / buildMaskRows / slotCapacity / initialSlots`, `StrokeLogStore.reserve / ringsTouched`. `job.units` now counts steps.

## Before / after (cold = fresh process, as a booting worker; budget 2 ms; 3,000 ledgers unless noted)

| | Before | After |
| --- | --- | --- |
| Slice p50 | 2.02 ms | 1.67 to 1.68 ms |
| Longest slice, cold | 4.84 to 5.54 ms (5 runs, load about 22 %) | 1.69 to 1.86 ms in the 7 runs of 10 without an outlier (load 49 to 52 %) |
| Slices over 2 ms | 64 to 70 of 65 to 71 per run | with 0.15 ms slack: 0 of 1,751 in 52 runs at high process priority (longest 1.94 ms), 0 of 1,039 in 12 runs at normal priority and load 0 to 39 %. Final state (0.3 ms slack), load 44 to 67 %: 11 of 1,755 in 8 of 42 runs, longest 6.15 ms |
| Host lane (`sim-host.test.ts` dust-large, Node, final state) | 3.3 to 4.3 ms | 1.72 / 1.71 / 1.77 ms at load 20 to 37 %; 2.13 and 2.22 ms at about 62 % |
| Total | 137 to 150 ms in 65 to 71 slices | 139 to 189 ms in 82 to 112 slices (host lane) |
| Longest single step | 5.2 to 5.6 ms | 0.5 to 0.8 ms (first calls, quiet machine) |

**Not met under load.** In every slice over 2 ms that I looked at, a step that normally takes microseconds took milliseconds: time the thread did not get. Slicing by wall clock cannot bound that. "Every slice under 2 ms" is shown only up to about 40 % machine load. A quiet-machine rerun of `restore-bench.ts cold` is the missing evidence.

Budget 1 ms (the main-thread view), 0.15 ms slack state: 0 of 1,760 slices over at load 16 to 18 % (longest 0.99 ms). Final state at 41 to 84 % load: 1 to 3 % of slices over. First calls cost 0.5 to 0.9 ms each, so a 1 ms slice holds one of them.

## Not done

1. **Atlas rebuild, cold (measured, not fixed).** After a restore the tile atlas rebuilds from ledger and logs. Settled it is inside its budget: `frame()` p50 0.33 to 0.37, p99 0.47 to 0.51, max 0.49 to 0.94 ms. In a fresh process the first frames are **3.0 to 4.3 ms and 2.6 to 3.3 ms** (Node, CPU side only): first `takeSnapshot` 2.3 ms, first `emitResidual` 3.5 to 5.4 ms, first `residency` 1.1 to 1.4 ms. Proposed fix: residual in row bands and snapshot per source log, both with a clock check, restarting when a stroke arrives between bands so the exactly-once contract and the byte-exact reference hold. Not started: `tile-atlas.ts` sits next to the integrator's live edits and the change needs the GPU verify page afterwards. Nothing in `apps/client` was edited.
2. **View only, sim-host owner:** `dust-view.ts:314` reserves `ledgerCount + queueN + 1024`. When strokes were queued during the restore that is more than the job left free and copies every restored ledger on the main thread in one call (not measured; the pool part is about 3.7 MB for 3,000 ledgers). Dropping `queueN` there, or passing a larger headroom as the job's 4th argument, avoids it.
3. The coordinator's "view slice 2.9 ms against 1 ms" was not re-measured in the view itself; same job, so the 1 ms numbers above apply.
4. Chromium (worker lane and main thread): NOT RUN. The 0.1 ms browser clock is covered by the slack by reasoning only.
5. Firefox, WebKit, world and sim browser lanes, client GPU verify page, root `pnpm verify`: NOT RUN.

## Evidence (final file state, sha256 prefixes: chunk-codec e3a86baf, ledger e6ef9df7, stroke-log 5f9b2c4a, dust-chunk.test 9df53f44)

| Command | Result |
| --- | --- |
| `packages/world`: `tsc`, `eslint .`, prettier on `src test bench` | 0, 0, clean |
| `packages/world`: `vitest run` | 5 files, **104 / 104** (100 before, 4 new) |
| `packages/sim`: `tsc`, `eslint .`, `vitest run` | 0, 0, 7 files **107 / 107** (both goldens at the M1-B1 values) |
| sim golden lane against the pre-change world copy | 2 / 2 |
| `apps/client`: `tsc --noEmit`, `eslint src/visuals/dust`, `vitest run src/visuals src/sim-host` | 0, 0, 18 files **158 / 158** |

Bench: `packages/world/bench/restore-bench.ts` (modes `save`, `cold`, `steps`, `warm`; the header explains). Raw output: `docs/agent-reports/M1-restore-slices-evidence/`. The bench batches were taken before the default-headroom edit (they pass the headroom explicitly, so the job did the same work).

## Next

1. Lead: STATUS golden line (the M1-B1 values are current); one quiet-machine `cold` batch to close the 2 ms claim.
2. Fable queue: atlas cold rebuild slicing (item 1), then Chromium numbers.
3. sim-host owner: item 2.

## Files

`packages/world/src/dust/{chunk-codec,ledger,stroke-log}.ts`, `packages/world/test/unit/dust-chunk.test.ts`, `packages/world/bench/restore-bench.ts` (new), `docs/agent-reports/M1-restore-slices-evidence/`, this report.

Commit suggestion: `fix(world): cut the dust restore into fine steps that stop before the slice budget and size the pools once`
