# M1-W1-T04 Dust prototype P2, strokes + atlas + ledger (terrain-dust-engineer)

Task / status: in-review, **GPU half NOT RUN** / 2026-11-14 / terrain-dust-engineer / Fable 5.2
Node 26.13.1 (fnm PATH prefix), i7-8650U + UHD 620, Windows 11. No git used. No servers or browsers left running.
Resumed from disk (earlier worker left `src`, `test`, `bench`, a stub README, no report). Nothing restarted.

## Done
- Verified what existed: environment-agnostic core in `prototypes/dust-sim/p2-stroke-atlas-ledger/src/core` (WDS 4.5 ledger rasteriser, stroke log, interest sets, robots as intents, server with chains / FRAME sections / `dust.plots` / `dust.ack` / `dust.check` + resync / join snapshot, client with prediction list, checkpoint with two header slots and two chunk versions, CPU reference tile atlas) and the harness adapter. tsc and the 24 existing tests passed as found.
- Fixed four defects and one false result (README "Findings" 1, 3, 4, 5):
  1. **Tile replay ran ahead of the ledger** (round caps of WDS 7.3 are subtracted again at every chain joint). Now flat-ended, box-filtered segments. Tile versus ledger on 16-bot worlds: mean 8.6 points off, worst 62, 27 % of cells over 10 points -> mean 0.5, worst 8, 0 % over 10.
  2. **Robot re-assignment drifted clients** (stale plan kept by clients out of reach of the new plot, plus a same-tick race). S5 had 139 drifting chunks and 139 resyncs hidden behind a PASS. Now 0 drift over the same 30 minutes with the drift check off (frame-boundary swap, 2 B stop record, two-ring reach).
  3. **Ledger sends not shared**: 330 deflates in the first tick of S4 (41 ms server time). Cached per plot: 24 encodes.
  4. **Adapter lag probe** attached only under `--realtime`, as P1. The old `results/node-frame` (lag PASS that was a tick time) is deleted; those files were tracked in git.
- Added: whole-model golden scenario, browser lane, vitest configs, regression tests (28 Node + 2 browser), `bench/tile-ledger-agreement.ts`, `bench/edge-model.ts`, `bench/print-golden.ts`, README.

## Measured (standard lengths, real GP(128,0) grid, same lengths as P1; one full core, not the 0.1-CPU cgroup)
Final file state, `results/standard`. **Timings are upper bounds**: machine load was 31 to 100 % from other agents; counts, bytes and hashes are identical between runs.

| Scenario | Result |
| --- | --- |
| S1 (180 s, 10,800 frames, 3,599 strokes) | client tile CPU p95 0.01 ms/frame. Dust GPU ms and edge px NOT RUN |
| S2 (120 s) | worst frame 0.09 x of 16.7 ms; three repeats 1.0 x, 0.72 x, **2.9 x**: PASS in 3 of 4, FAIL in 1 (rebuild stalled 47 ms at 77 % load). CPU reference only |
| S3 (60 s) | tester identification NOT RUN |
| S4 (600 s, 16 bots, 192,000 strokes) | hash match 100 % (1,920 checks); **762 B/s** per client (bar 1,200); server tick p99 0.22 ms; server 726 ms total; 1 reject (`segment_too_long`); 0 drift |
| S4 at 20 Hz (`P2_STROKE_CADENCE=tick`) | **1,492 B/s: FAIL**. The PASS above depends on the 10 Hz cadence of WDS 4.4 |
| S4 lag (60 s `--realtime`, 3 runs) | p99 29.1 / 40.2 / 34.1 ms against a 20 ms bar: **FAIL as measured, not valid**. Control: P1 read 108 ms in the same minute (11.5 ms in its report) |
| S5 (1,800 s, 400 robots + 4 bots) | 2.9 % of a 0.1-CPU budget (bar 10 %); RSS 160 MB (bar 300); 0 drift, 0 resyncs; 9.4 intent B/s |
| S6 (80 s) | restored hash consistent, 100 % client match after rejoin, restore 9.0 ms, last save 4,019 B. In-memory store, not PostgreSQL |
| S7 | blocking 26,739 B (bar 150 KB), playable 44.7 ms in process, streamed 465 B. Aged 60 s, not 30 minutes |
| S8 | bookmarks listed; captures NOT RUN |

Hot path (`bench/p2-bench.ts`): `applyStroke` 2.5 to 15 us for hand tools to Bulldust, 80 us for the largest legal record (bar 200), allocation at the method floor. Whole tick with 16 clients: 19 to 30 B per tick at 10 Hz, not traced to one call site.

## Edge width: CPU model, not a capture (harness 10-90 % definition, opacity / mask px)
- Tile atlas alone, 2 m: 38 to 118 px / 2.6 to 4.5 px. 10 m: 3.0 to 6.5 px. The 2 px bar at 2 m depends entirely on the detail ring.
- Ring texel model (3.5 cm; the ring is not built in P2), 2 m: 8.3 to 10.0 px opacity, 1.6 px mask. 10 m: 1.0 to 1.4 px.
- The harness strip (one Bristle Broom pass, depth16 32) only thins a Mare plot to 75 %, so the presence mask has no edge there.

## Evidence
- vitest Node: 2 files, 28 tests pass. Browser lane (headless Chromium): 2 tests, golden ledger vectors and the whole-model scenario equal the Node recording. Firefox / WebKit NOT RUN (not installed).
- tsc clean (`tsconfig.json`, `tsconfig.core.json` with no DOM lib and no Node types); prettier clean; eslint `--no-ignore`: only the 2 deep-import errors in `grid.ts` that prototypes/README rule 1 requires.
- File state: tests, tsc, prettier, eslint and every harness run are from the final files. `p2-bench`, `alloc-probe` and `tick-probe` predate the message cache (interest entry only, not on their paths).
- Results: `prototypes/dust-sim/p2-stroke-atlas-ledger/results/{standard,cadence-tick,realtime-60s,realtime-60s-b,realtime-60s-c,s2-repeat-1..3,edge-model}/`.

## Not run
- **Any GPU work**: no TSL or WebGPU code exists in P2. Compute versus fragment replay (acceptance criterion, WDS 12 item 5), S1 GPU ms, edge width, S8 captures, VT-M1-03/04/05.
- Detail ring, dust shading, Inspector's Stamp fade (not built). S3 testers. S4/S5 in the 0.1-CPU cgroup. A valid lag run (needs a quiet machine). S7 30-minute aging. PostgreSQL restore. Root `pnpm verify`.

## Next
1. GPU twin of the tile replay (compute and fragment) with timestamp queries and a byte comparison against `tiles.ts`, then the ring; only then `view()` GPU ms, `measureEdgeWidthPx`, `capture()`.
2. Rerun `--realtime` S4 and S2 on a quiet machine (and in the cgroup at T06).
3. P3 (T05).

## Blockers / requests
- Spec (lead / contracts-architect): WDS 7.3 round-cap subtraction and WDS 7.4 rebuild both double count; `robot.plot` needs a stop record; the bandwidth bar holds only at 10 Hz.
- Harness (qa-test-engineer): S5 should score client drift (it hid a divergence); the reference strip is not clean under authoritative depth; a 6-bot S4 for the real cap.
- Open limits 6 to 15 in the README (mass interest entry unbudgeted, coalescing versus predicted trail, log caps not exercised).

Files: `prototypes/dust-sim/p2-stroke-atlas-ledger/**` (deleted `results/node-frame/**`), this report.
Commit suggestion: feat(dust-sim): finish P2 stroke atlas ledger prototype with fixes, harness results and findings
