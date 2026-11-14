# M1-W1-T02 Dust contest harness (qa-test-engineer)

Status: in-review. Date 2026-11-14. Model Sonnet 5.5.

Done: seeded scene (HARNESS_SEED 20261114, 20 Hz), reference strip, 9 bookmarks, camera path drivers S1/S2/S3/S7/S8, bot scenarios S4/S6 and synthetic S5 (`tools/bots/src/scenarios/dust-contest/`), metric schema + bars, blind A/B pair generator + tally, stub adapter dry run.
Next: P1/P2/P3 owners write `<approach>/harness-adapter.ts`; swap `--grid` to the packages/world grid when it lands (the dry run uses a lat/lon stub grid); GPU runs, S3 testers, S4 cgroup run and 30-min S5/S7 aging are NOT RUN.

## Adapter interface (published)

`DustPrototypeAdapter` in `prototypes/dust-sim/harness/src/types.ts`; export `createAdapter()` from `<approach>/harness-adapter.ts`.
It extends `DustContestTarget` (`tools/bots/.../dust-contest/target.ts`, structural copy):

- `start(ctx{approach,seed,grid,simTickHz,tier,quality,backend,outDir})`, `stop()`
- `joinClient(id)`, `leaveClient(id)`; `submitStroke(clientId, StrokeRecord) -> {ok:true}|{ok:false,reason}` (reasons = STROKE_REJECT_REASONS; never throws); `submitRobotIntent(RobotPlotIntent) -> wire bytes`
- `advance(ticks)`: simulated time, delivers all echoes so hashes are comparable immediately
- `serverHash()`, `clientHash(id)` (u32, same mixing); `clientBytesSent(id)` cumulative server-to-client bytes
- optional S6: `persist()->{tick,hash}`, `crash()`, `restore()->{tick,hash,restoreMs}`; optional probes `eventLoopLagP99Ms()`, `serverCpuMs()`, `rssMb()`
- optional render/S7/S8: `view(pose, cleaning)->FrameSample{cpuMs,dustGpuMs?,replayMs?,tileUploads?,tileRebuildMs?}`, `measureEdgeWidthPx(distM)`, `lateJoin(id)->{blockingBytes,streamedBytes,playableMs,tileRebuildMs}`, `capture(bookmarkId,pose,outPath)` (native-res PNG), `exportMetrics()`

Strokes are the shared `StrokeRecord` (anchor plot + plot-local mm). Plot-local `PlotLocalMm` is `{u, v}`.

## Evidence (this file state, Node 26.13.1)

- tsc: tools/bots and harness tsconfig clean. eslint on tools/bots dust-contest clean (prototypes/ is eslint- and prettier-ignored by repo config; harness formatted with prettier anyway). prettier on bots files clean.
- vitest: bots dust-contest 3/3, harness 9/9 (determinism, schema validity, A/B blindness/byte copy).
- Dry run PASS as plumbing: `cd tools/bots && node --import tsx ../../prototypes/dust-sim/harness/src/cli.ts run --adapter stub --max-sim-seconds 20 --fps 30` wrote `prototypes/dust-sim/results/stub/S1..S8.json` + `SUMMARY.md` (runs in under 1 s, no GPU). Stub numbers are INFO, not scores.
- Not run: any real prototype, GPU capture (S1/S2/S8 GPU ms, parity), S3 tester identification, S4 0.1-CPU cgroup, standard-length S4/S5.

Blockers / requests: none blocking. Optional: `@moon-cleanup/shared` resolves only through the harness tsconfig `paths` (type-only imports). Prototypes needing runtime deps need devops install.
Files: prototypes/dust-sim/harness/{README.md,tsconfig.json,src/*}, tools/bots/src/scenarios/dust-contest/*, prototypes/dust-sim/results/stub/*.
Commit suggestion: test(dust-sim): add contest harness, S4-S6 bot scenarios and A/B pair generator
