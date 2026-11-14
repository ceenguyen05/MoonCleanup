# M1-W1-T03 Dust prototype P1, scalar + procedural (terrain-dust-engineer)

Task / status: in-review / 2026-11-14 / terrain-dust-engineer / Fable 5.2
Node 26.13.1 (fnm PATH prefix), i7-8650U + UHD 620, Windows 11. No git used. No servers or browsers left running.

## Done
- P1 core in `prototypes/dust-sim/p1/src` (no Node/DOM/three/Colyseus): L0 scalar server (validation with contract reject reasons, state-independent removal, Opened/Polished thresholds, per-actor micrograms, robot plot jobs in 1 s chunks), `dust.plots` / `dust.ack` / `robot.plot` byte encoders, cached join snapshot (sparse or run-length), checkpoint + restore, client L0 mirror with the same incremental hash.
- Client visuals as **CPU references only**: toroidal detail ring (`ring.ts`) and plot-seeded dissolve with an area-calibrated threshold (`visual.ts`).
- Harness adapter (`p1/harness-adapter.ts`, re-exported by `p1-scalar-procedural/harness-adapter.ts`) and `p1/grid.ts` (`createGrid()` = packages/world GP(128,0)). S1 to S8 run through the harness CLI on the real grid.
- README with hypothesis, run commands, numbers and limits: `prototypes/dust-sim/p1/README.md`.
- CPU reference pictures of the 9 bookmarks (`p1/results/cpu-reference/*.png`, ray-cast smooth sphere, **not GPU captures**) and the model's edge widths.

## Measured (standard lengths, flat out unless noted; full i7 core, not the 0.1-CPU cgroup)
Values are the run on the final file state (`p1/results/standard`). Timings moved by up to 2 x between two runs (other agents on the machine); counts, bytes and hashes were identical.

| Scenario | Result |
| --- | --- |
| S1 (180 s, 10,800 frames, 3,599 strokes) | client CPU p95 0.02 ms/frame. Dust GPU ms and edge px NOT RUN |
| S2 (120 s) | worst frame 0.16 x of 16.7 ms (bar 2 x): PASS, CPU part only; ring replay p95 0.22 ms |
| S3 (60 s) | 0.09 plot-table rows/frame; tester identification NOT RUN |
| S4 (600 s, 16 bots, 192,000 strokes) | hash match 100 % (1,920 checks); 72.3 B/s per client (bar 1,200); tick p99 0.08 ms; server 60.7 ms total; 1 reject (`segment_too_long`, bot lane wrap) |
| S4 lag (60 s `--realtime`) | p99 11.5 ms (bar 20), mostly the Windows timer step (tick p99 0.43 ms) |
| S5 (1,800 s, 400 robots + 4 bots) | 0.18 % of a 0.1-CPU budget (bar 10 %); RSS 140 MB whole process (bar 300); 17.1 intent B/s |
| S6 (80 s) | restored hash consistent, 100 % client match after rejoin, restore 7.0 ms, checkpoint 710 B. In-process byte store, not PostgreSQL |
| S7 | blocking 101 B (bar 150 KB), playable 2.4 ms in process, streamed 0 |
| S8 | bookmarks listed; captures NOT RUN |

Hot path (best of 5, `bench/p1-bench.ts`): `submitStroke` 84 ns, 0.33 B/call (method floor); a 6-stroke tick with flush to 6 clients 756 ns, 0.00 B; 400 robot jobs per tick 5.1 us, 0.00 B. Server state 983 KB per room.

## CPU reference look (not a contest score)
- Viewer's own strip is crisp inside the ring. Everything else is dissolve: random blobs over the whole plot, cut by straight lines at plot borders; the 16 bots' lanes are not recognisable; a late joiner loses the strip. This is the expected P1 visual risk, now visible.
- Model edge at 2 m (1080p): presence mask 2.1 px, full dust opacity 20.6 px (thinning ramps across the 3.5 cm ring texel); 10 m: 1.0 / 1.2 px. The harness does not say which definition the 2 px bar uses; the same ramp applies to any approach with this ring.

## Evidence
- vitest Node: 1 file, 12 tests pass (golden, 5 order shuffles, thresholds, reachability, re-scrub weakness, rejects, deltas + both snapshot formats, checkpoint round trip and corruption, robots, ring, dissolve).
- vitest browser lane (headless Chromium): golden scenario equals the Node recording (12 numbers). Firefox / WebKit NOT RUN (not installed).
- tsc clean (`p1/tsconfig.json`); prettier clean on all P1 `.ts`; eslint with `--no-ignore`: only the 3 deep-import errors that prototypes/README rule 1 requires (the folder is eslint-ignored by repo config).
- File state: tests, tsc, prettier, the standard run and the CPU reference pictures are from the final files. The `realtime-60s` and `flush-2hz` runs predate two edits that do not touch their code path (an unused `view` parameter removed, `sweptBilinearAt` added to the ring).
- Results: `prototypes/dust-sim/p1/results/{standard,flush-2hz,realtime-60s,smoke}/p1-scalar-procedural/`.

## Not run
- Any GPU work: S1 dust GPU ms, edge width px, S8 WebGPU/WebGL2 captures, VT-M1-03/04/05. No TSL twin of the ring or dissolve exists.
- S3 testers, S4/S5 in the 0.1-CPU cgroup, S5/S7 30-minute aging, PostgreSQL restore, root `pnpm verify`.

## Next
1. Decide the render side (lead + qa-test-engineer): the harness has no shared render scene, so P1/P2/P3 captures would differ by renderer. A shared terrain patch + regolith material with a per-approach dust-mask hook is needed before blind A/B pairs mean anything.
2. Then for P1: TSL twin of `Dissolve.coverage` and the ring (R8 texture), `view()` GPU timestamps, `measureEdgeWidthPx`, `capture()`.
3. T06: run P1 with `--tier A|B` on reference hardware and in the cgroup.

## Blockers / requests
- Path: the brief says `prototypes/dust-sim/p1/**`, the stage card and the harness id say `p1-scalar-procedural/`. I built in `p1/` and kept a one-line entry + pointer README in `p1-scalar-procedural/`. Lead: confirm or ask for a move.
- Harness question (qa-test-engineer): define the edge-width measure for `s1.edgeWidthPx` (mask step or 10-90 % of opacity).
- Findings: (a) scoring exploit confirmed and quantified by test (re-scrub = fresh lanes); (b) strokes credit the anchor plot only; (c) robot jobs in flight are not checkpointed; (d) `ContestGrid` exposes no neighbours or plot classes/areas, so all plots are mean-area Highland in harness runs.

Files: `prototypes/dust-sim/p1/**`, `prototypes/dust-sim/p1-scalar-procedural/{harness-adapter.ts,README.md}`, this report.
Commit suggestion: feat(dust-sim): add P1 scalar + procedural prototype with harness adapter and dev results
