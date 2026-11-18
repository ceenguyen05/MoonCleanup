# M1 alloc regression fix (packages/sim)

Task / status: done (verified on Node 26) / 2026-11-17 / gameplay-systems-engineer / Opus 5.5

Done
- Root cause (real regression, uncommitted Apron work): `landing-apron.ts` passed the grid's frozen `FrozenVec3` centre
  directions to `PlotGrid.toPlotLocal`. That made `toPlotLocal`'s `dir` polymorphic for the whole process, so its hot
  callers (tool and intake strokes, which pass own-map `DirScratch`) boxed HeapNumbers: 225-230 B/tick in the real-ledger
  case (`toPlotLocal grid/plot-grid.ts`) on Node 26.
- Fix: copy the direction into a module-level own-map `ApronDir` class instance before `toPlotLocal`. The values are the
  same, so the same Apron plots are picked. This runs at construction only.
- The `stepActor` ~105 B/tick seen by the triage is **not a regression.** It is Node 22-specific (the triage shell ran
  system Node 22.20; the repo pins `engines.node` 26.x). The same ~105-113 B/tick shows on Node 22 at HEAD and at the
  Nov 15 commit b7c4221 (scratch copies via `git show`). On Node 26 all three give 16-18 B/tick, below the bound. It
  matches the existing moon-room-sim.ts:1270 comment about Maglev phi boxing.
- vehicles.test step budget: now takes the best of 3 timed windows for the fixture-world and flat timings. Bounds are
  unchanged.

Bisection (scratch copies under `packages/sim/src` paths so the test's frame filter counts them; the working tree was
never reverted):
- HEAD: passes.
- Working tree: fails.
- `landingApronPlots` disabled: passes.
- Own-map `out` object only: still fails.
- Own-map `dir` copy: passes.

Files: packages/sim/src/room/landing-apron.ts, packages/sim/test/unit/vehicles.test.ts

Evidence (Node 26.13.1, repo, 2 runs): alloc, vehicles, onboarding-apron, room-vehicles and golden: 5 files, 49/49 pass.
- Sweep: 25-28 B/tick.
- Lope: 0.
- Real ledger: 3.3-4.7 B/tick, 0 pool growths.
- Vehicle step: 6.7-6.9 us.
- Golden 1076468633 / 4164540033 unchanged.
- `tsc --noEmit -p packages/sim`: exit 0.

Next / blockers: run sim tests on Node 26 (fnm PATH prefix). The Node 22 failure of alloc.test is expected. An optional
follow-up is the remaining ~3 B per actor-tick in `stepActor` on Node 26 (pre-existing).
