# M1-W1-T05 Dust prototype P3, client-painted min-merge (terrain-dust-engineer)

Task / status: in-review, **GPU half NOT RUN** / 2026-11-14 / terrain-dust-engineer / Fable 5.2
Node 26.13.1 (fnm PATH prefix), i7-8650U + UHD 620, Windows 11. No git used. No servers or browsers left running.
Resumed twice from disk after usage-limit interruptions; nothing restarted. `packages/**` and `apps/**` untouched.

## Done
- P3 core in `prototypes/dust-sim/p3-client-paint-minmerge/src/core` (no DOM/Node/three/Colyseus): client painter (private 8-bit fine plane + shared 4-bit level, flat or soft brush, segment or disc), sparse C->S paint upload, server tile store with per-texel **min merge**, bounds (ownership, reach from the server-side pose incl. the last 8 ticks, removal rate of the server-known tool), plot states, credit, interest sets with enter / leave, join snapshot (blocking 60 m + streamed), drift check + resync, robots painted server-side (1 s chunks, 150 chunks/s cap), whole-world checkpoint with CRC, incremental (Zobrist) tile hash.
- Harness adapter (same shape as P1/P2), `grid.ts` (packages/world GP(128,0)), README with hypothesis, authority / determinism / join / checkpoint / cheating story, run commands and limits.
- S1 to S8 run through the harness CLI on the real grid at the standard lengths (same as P1/P2), plus flush-cadence variants, three S2 repeats, three 60 s `--realtime` runs with a P1 control, and S4 at the real cap of 6.
- Two allocation defects found and fixed while proving the hot paths (both likely apply to P2's untraced 19 to 30 B per tick): `array.length = 0` drops the backing store, so the next `push` allocates 152 B (now a counter-based list); unsigned 32-bit hashes crossing a non-inlined call box a heap number (now signed int32 inside the core).

## Authority, honestly
CLAUDE.md and security 1 require an authoritative sim with clients sending intents. **P3 breaks this by design**: clients send cleaned texels. The server owns the merged tile, plot states, credit and robots; for player paint it only bounds what arrives. Determinism across machines is not needed (state is merged by value, no replay, no stroke log), but the outcome depends on message timing. Late join and restore never use stroke history. Details and the tested bounds: README.

## Measured (standard lengths, real GP(128,0) grid; one full core, not the 0.1-CPU cgroup)
Final file state, `results/standard`. Machine load 17 to 71 % from other agents during the runs; counts, bytes and hashes are identical between runs, timings are upper bounds.

| Scenario | Result |
| --- | --- |
| S1 (180 s, 10,800 frames, 3,599 strokes) | client CPU p95 < 0.01 ms/frame; upload 122 B/s; no tile bytes come back to a solo player (L0 492 B in total). Dust GPU ms and edge px NOT RUN |
| S2 (120 s) | worst frame 0.35 x of 16.7 ms; three repeats **2.87 x**, 1.62 x, 1.74 x: PASS in 3 of 4, FAIL in 1 (load rose to 71 %). Upload 435 B/s; 111 full tiles (18.7 KB) re-sent as the Skiff re-enters dropped ground. CPU only |
| S3 (60 s) | tester identification NOT RUN |
| S4 (600 s, 16 bots, 192,000 strokes) | hash match 100 % (1,920 checks, every client held every touched tile); **1,031 B/s** down per client (bar 1,200) **plus 118 B/s up**; tick p99 0.29 ms; server 230 ms total; 1 reject (`segment_too_long`, client-side); 0 server rejects, 0 drift; 16 of 192,605 merged texels lost a race |
| S4 at 20 Hz (`P3_FLUSH_TICKS=1`) | **1,629 B/s: FAIL**, 201 B/s up. As P2, the PASS depends on the 10 Hz cadence |
| S4 at 5 Hz (`P3_FLUSH_TICKS=4`) | 696 B/s down, 71 B/s up (remote trails 200 ms late) |
| S4 at the cap, 6 bots (`bench/s4-cap6.ts`, not a harness score) | 458 B/s down, 117 B/s up per client; hash match 100 % (720 checks) |
| S4 lag (60 s `--realtime`, 3 runs) | p99 **14.1 ms** at 20 to 29 % machine load (bar 20: PASS); 33.2 ms at 76 to 100 % and 52.2 ms at 59 to 90 %: not valid. Control: P1 read 38.2 ms starting at 100 % load between the runs (11.5 ms in its report). Lag follows machine load, not the approach |
| S5 (1,800 s, 400 robots + 4 bots) | 0.47 % of a 0.1-CPU budget (bar 10 %); RSS 156 MB (bar 300); 6.9 intent B/s; tile deltas 313 B/s per near client (robots cannot be intents in P3); 270,000 chunks = the 150/s cap all run; tile state 1.74 MB for 271 plots |
| S6 (80 s) | restored hash consistent, 100 % client match after rejoin, restore 3.6 ms, checkpoint 1,445 B for 14 tiles (792 B deflated). In-memory store, not PostgreSQL |
| S7 | blocking 5,139 B (bar 150 KB; 2,499 B deflated), playable 5.1 ms in process, streamed 631 B. Aged 60 s, not 30 minutes |
| S8 | bookmarks listed; captures NOT RUN |

Hot path (`bench/p3-bench.ts`, `bench/alloc-probe.ts`, final files, load 9 to 45 %): client paint 2.0 us (Desk Duster) to 11.0 us (Bulldust), 96 us for the largest legal record; server pose + merge of one upload + two ticks incl. a flush to 16 clients 3.2 us; whole tick with 16 clients 70 us. Allocation: **1.3 to 3.9 B per whole tick with 1, 6 or 16 clients** (measurement floor; was 1,214 B with 6 clients before the two fixes). First touch of a plot costs 0.31 to 0.36 ms (ownership mask), once per plot per process. Outside the core, the harness adapter's pose proxy (stroke end point converted to a server pose) boxes 48 B per stroke; in the game the pose comes from the sim's typed arrays.

## Cheating surface (acceptance criterion), measured by test
A client that never moves and never sweeps, claiming 5 cleared texels per second inside its reach, gets **0 rejects and 2.70 x the grams** of an honest 3 m/s Desk Duster sweep over 30 s (7,438 g against 2,757 g). The rate bound caps the gain at the tool's legal maximum; it cannot tell a sweep from a claim, and Depth and coverage are unchecked. Refused as tested: out of reach, over rate, other plots' texels, re-dirtying, malformed bytes. Closing it means the server deriving paint from inputs, which is P2.

## Comparison (same harness, lengths, grid and machine; P1/P2 from their reports)

| | P1 scalar | P2 strokes + ledger | P3 min-merge |
| --- | --- | --- | --- |
| Scoring authority | server, uniform dust (re-scrub exploit) | **server, exact at 0.8 m** | client-reported, bounded (2.70 x forger) |
| S4 down B/s per client, 10 Hz (bar 1,200) | 72 | 762 | 1,031 (+118 up) |
| S4 at 20 Hz | not run | 1,492 FAIL | 1,629 FAIL |
| S4 at the cap of 6 | not run | not run | 458 (+117 up) |
| S4 hash match | 100 % | 100 % | 100 % |
| S4 tick p99 / server total | 0.08 ms / 61 ms | 0.22 ms / 726 ms | 0.29 ms / 230 ms |
| S4 lag p99 (bar 20 ms) | 11.5 ms (quiet); 38.2 ms as today's control | 29 to 40 ms, not valid | 14.1 ms at 20 to 29 % load; 33 and 52 ms loaded, not valid |
| S5 share of 0.1 CPU (bar 10 %) / RSS | 0.18 % / 140 MB | 2.9 % / 160 MB | 0.47 % / 156 MB |
| S5 robots on the wire | intent 17.1 B/s | intent 9.4 B/s | intent 6.9 B/s + tile deltas |
| S2 worst frame (bar 2 x) | 0.16 x | 0.09 x; 2.9 x once | 0.35 x; 2.87 x once |
| S6 restore / checkpoint | 7.0 ms / 710 B | 9.0 ms / 4,019 B | 3.6 ms / 1,445 B |
| S7 blocking / playable / streamed | 101 B / 2.4 ms / 0 | 26,739 B / 44.7 ms / 465 B | 5,139 B / 5.1 ms / 631 B |
| Hot path | 84 ns per stroke | 2.5 to 15 us, 80 us max | 2.0 to 11.0 us client, 96 us max; 3.2 us server |
| Allocation per tick | 0 | 19 to 30 B | 1.3 to 3.9 B (core) |
| Trails shared with others | none (dissolve) | strokes: tile + ring | 0.4 m, 16 levels; ring only for own strokes |
| Cross-engine determinism needed | no | yes (golden vectors) | no |
| GPU ms, edge px, captures, S3 testers | NOT RUN | NOT RUN | NOT RUN |

## Recommendation
**P2 wins; do not adopt P3.** By the decision rule P3 can only win by taking the blind visual test by more than 60/40 while inside the bandwidth and storage bars; that test is NOT RUN for all three, and P3 starts behind: it shares only a 0.4 m 16-level tile, its bandwidth is the highest of the three and is paid in both directions, and it breaks the authority non-negotiable with a measured, unclosable scoring exploit. P3's real advantages (3 x less server CPU than P2, 5 x smaller join, no determinism burden) do not decide anything at a 6-player cap, where P2 already meets the same server bars at 16 bots. P1 stays the fallback if P2's GPU half fails.
Worth carrying into P2: RLE tile snapshot, the incremental per-texel hash, the single-author skip, and the two allocation fixes.

## Evidence
- vitest Node: 1 file, 17 tests pass (ownership mask equals point-to-plot incl. pentagon, pole and seam; codec round trips and garbage; merge commutative / associative / idempotent over 6 orders; 6-client convergence; not additive; brush freedom; reach, rate, ownership bounds; cheating surface; thresholds and Polished free; checkpoint round trip and corruption; late join, streaming, drift repair, interest drop; robots and chunk cap; golden numbers).
- tsc clean (`tsconfig.json`, `tsconfig.core.json` with no DOM lib and no Node types); prettier clean (run with `--ignore-path .gitignore`, the folder is prettier-ignored); eslint `--no-ignore` on `src`, adapter and grid: only the 6 deep-import errors that prototypes/README rule 1 requires.
- File state: the harness runs are from the final logic. Afterwards: a whitespace-only prettier pass and two unused adapter parameters removed; tsc, eslint, the 17 tests, both benches and a full-length S4 + S6 + S7 recheck (`results/final-recheck`: 1,030.92 B/s, 100 %, 5,139 B, identical) were rerun on the final files. Realtime runs b and c already ran on the formatted files.
- Results: `prototypes/dust-sim/p3-client-paint-minmerge/results/{standard,cadence-tick,flush-5hz,s2-repeat-1..3,realtime-60s-a..c,realtime-60s-p1-control}/`, `results/{bench,alloc-probe,realtime-log,s4-cap6}.txt`.

## Not run
- **Any GPU work** (not attempted on the UHD 620: no TSL or WebGPU code exists in P3 and the shared render scene is still missing): S1 GPU ms, edge width, S8 captures, VT-M1-03/04/05, blind pairs. Arithmetic only, not a measurement: a 0.4 m texel under bilinear filtering gives a 10-90 % edge of about 0.32 m, about 150 px at 2 m, so the 2 px bar depends entirely on a local detail ring, as for P1/P2.
- Browser lane (the merge is by value, so no cross-engine golden is required; not run). S3 testers. S4/S5 in the 0.1-CPU cgroup. S7 30-minute aging. PostgreSQL restore. Root `pnpm verify`.

## Next
1. Lead: record the D2 decision (P2) once T06 runs the GPU half; P3 folder can be archived.
2. P2 owner: apply the two allocation fixes and consider the RLE snapshot; rerun `--realtime` S4 on a quiet machine.

## Blockers / requests
- Harness (qa-test-engineer): scene setup submits 80 m of sweeping in one tick, which any rate or reach bound must refuse (P3 bypasses its bounds for that batch); S5 should score robot bytes on the wire, not only intents; a 6-bot S4 for the real cap.
- README limits 1 to 7 (drift check needs an acknowledged view, Dust Cell capacity and stamp credit not modelled, one-blob checkpoint).

Files: `prototypes/dust-sim/p3-client-paint-minmerge/**`, this report.
Commit suggestion: feat(dust-sim): add P3 client-painted min-merge prototype with harness results and comparison
