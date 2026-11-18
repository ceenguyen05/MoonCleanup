# M1 sim test triage (packages/sim)

Date 2026-11-17. Node 22.20 in the tool shell. No source edits were made (experiments were reverted; file verified byte-identical to its pre-experiment copy).

## 3) tsc `PlotIdView` not iterable in moon-room-sim.ts
Status: already resolved on disk. `tsc --noEmit -p packages/sim` is clean now. `computeApron` (Apron work) iterates `grid.neighbors()` with index loops and spreads only `Set<number>`s. Cause had been the Apron work (spreading PlotIdView); someone fixed it before this triage.

## 1) alloc.test.ts fails (117 B/tick vs bound 64)
Real, reproducible regression (fails alone, 3+ runs, 108-118 B/tick; Nov 15 baseline 0-8). Site is `stepActor` self allocation (~103-112 B/tick, about one 16 B HeapNumber per actor-tick), not `toPlotLocal` in `computeApron`.
Evidence it is NOT the Apron work: with `computeApron` disabled -> 108-117 B/tick; with the first-stroke and polish onboarding checks also disabled (`if (false && ...)`) -> 113-114 B/tick; with the new `stepDriver` driverRelief lines commented out -> 118 B/tick. `computeApron` runs only in the constructor, and toPlotLocal is alloc-free (out fields only). Apron is cleared.
Not the Trundle `stepDriver` lines either (not executed in the sweep scenario). Remaining suspects: (a) the committed M1 change 3e37c25 (2026-11-16) after the Nov 15 alloc test, (b) uncommitted vehicle edits (room-vehicles/intake/vehicle.ts, driverRelief plumbing) changing TurboFan inlining of stepActor (stepToolHead/stepAvatar boxing doubles). Could not bisect without checkout (denied; read-only constraint). Proposed next step for the vehicle owner: after they finish, rerun alloc.test; if still failing, bisect with `git stash`-free copy of HEAD sim in a scratch dir, or check which doubles are written into object fields in the stepActor inlined path (heap profile with --no-turbo-inlining to compare).
No fix applied (not caused by Apron).

## 2) vehicles.test.ts step-budget
Load-sensitive timing flake, not a logic regression. Failure: `expected 30.538 to be less than 30` (line 627, the fixture-world us/step bound). It passed on the next two runs, and the file's other 28 tests pass. Cause: wall-clock microbench on a loaded machine (several agents running) with a 30 us bound versus a documented 7-10 us normal. Proposed fix (vehicle owner): keep the bound but take the min of 3 timed windows (or median) instead of one, or loosen to 45 us per the "generous CI bound 60 us" in the test title.

## Golden
`test/golden` (replay.golden.test.ts) passes: GOLDEN_REPLAY stateHash 1076468633 / strokeHash 4164540033 unchanged. onboarding-apron.test.ts passes.
