# dust-sim / p1-scalar-procedural (P1: scalar + procedural)

Task M1-W1-T03. Prototype only: nothing here is imported by `apps/` or `packages/`.
The harness loads `harness-adapter.ts` in this folder (approach id `p1-scalar-procedural`).
Not a workspace package (pnpm-workspace.yaml does not list prototypes/*). No dependencies. Production code is read by relative import of source barrels, read-only.

## Hypothesis

The cheapest possible dust: the server keeps **one scalar per plot** (L0) and nothing else. No ledger, no stroke log, no stroke traffic.
A stroke removes `depth x swept area` from its anchor plot, as if the dust were spread evenly over the plot.
Clients get only `dust.plots` deltas (4 B per changed plot) and draw the dust themselves:
a procedural dissolve from the plot's remaining fraction, plus a local detail ring that holds the trails near the Custodian.
What must be shown: the cost is lowest, and whether trails that are not persistent and not shared are acceptable.

## What is built

| Piece | File | Notes |
| --- | --- | --- |
| L0 record, hash, wire constants | `src/l0.ts` | u16 per plot (fraction 0..255 + 2-bit state); hash = XOR of FNV-1a(plotId, value), kept incrementally |
| Server | `src/server.ts` | validation with contract reject reasons, removal, Opened / Polished thresholds, per-actor micrograms, robot plot jobs in 1 s chunks, `dust.plots` / `dust.ack` / `robot.plot` encoders, join snapshot (sparse or run-length, cached), checkpoint + restore |
| Client | `src/client.ts` | L0 mirror from deltas and snapshot, same hash, dirty plot-table rows for a GPU upload |
| Detail ring (CPU reference) | `src/ring.ts` | toroidal u8 mask, 1-texel anti-aliased capsules, scroll clears, translation-only re-anchor |
| Dissolve (CPU reference) | `src/visual.ts` | plot-seeded 2 m + 0.5 m value noise; a quantile table makes the dusty area share equal the fraction |
| Harness adapter (Node) | `harness-adapter.ts` | real encode / decode per client, probes; `grid.ts` exports `createGrid()` (packages/world GP(128,0)) |

Rules of the model:

- Units: capacity of a plot = area x u0 (16 x dust level), integer; stroke removal = length mm x width cm x min(depth16, u0) / 16, at least 1 unit. All integers below 2^53, so results are identical in every engine.
- Removal does not depend on what is left, so L0 bytes do not depend on stroke order (tested with shuffles). Credit per actor does depend on order; the server decides it.
- Opened at 0.1 % removed, Polished at 1 % left (the rest is not paid, WDS 4.7). One Highland plot at Depth 5 needs its own area swept once (test: 98 to 100 %).
- The `src` core has no Node, DOM, three.js or Colyseus import (`visual.ts` reads the noise of packages/world). Hot calls allocate nothing (numbers below).

## How to run (repo root, Node 26 first on PATH)

- Tests, Node: `node_modules/.bin/vitest run --root prototypes/dust-sim/p1-scalar-procedural`
- Tests, browser lane (headless Chromium): `node_modules/.bin/vitest run --root prototypes/dust-sim/p1-scalar-procedural -c vitest.browser.config.ts`
- Types: `node_modules/.bin/tsc -p prototypes/dust-sim/p1-scalar-procedural/tsconfig.json`
- Benchmark: `cd tools/bots && node --import tsx ../../prototypes/dust-sim/p1-scalar-procedural/bench/p1-bench.ts`
- Contest scenarios (dev run, results kept in this folder):
  `cd tools/bots && node --import tsx ../../prototypes/dust-sim/harness/src/cli.ts run --adapter ../../prototypes/dust-sim/p1-scalar-procedural/harness-adapter.ts --grid ../../prototypes/dust-sim/p1-scalar-procedural/grid.ts --results ../../prototypes/dust-sim/p1-scalar-procedural/results/standard --tier floor`
- CPU reference pictures and model edge widths: `cd tools/bots && node --import tsx ../../prototypes/dust-sim/p1-scalar-procedural/bench/cpu-reference-capture.ts` (about 1 minute; writes `results/cpu-reference/`)
- Event-loop lag needs `--realtime` (the probe is only attached then). `P1_PLOTS_FLUSH_TICKS=10` sends `dust.plots` at 2 Hz.

## Numbers (dev runs, 2026-11-14, i7-8650U, Windows 11, Node 26.13.1; one full core, not the 0.1-CPU cgroup)

Standard scenario lengths, results in `results/standard/p1-scalar-procedural/` (the run on the final file state). Timings moved by up to 2 x between two runs because other agents were using the machine; counts, bytes and hashes were identical.

| Scenario | Measured | Bar | Status |
| --- | --- | --- | --- |
| S1 walk, 180 s, 10,800 frames, 3,599 strokes | client CPU p95 0.02 ms per frame (ring + plot-table bookkeeping) | dust GPU ms, edge px | GPU ms and edge px **NOT RUN** (no GPU renderer) |
| S2 Skiff, 120 s, 2,399 strokes | worst frame 0.16 x the 16.7 ms target; ring replay p95 0.22 ms; 22.6 plot-table rows/s; no tiles, no rebuilds | <= 2 x target | PASS (CPU part only) |
| S3 orbit, 60 s | 0.09 plot-table rows per frame | >= 80 % identification | **NOT RUN** (needs testers and captures) |
| S4 16 bots, 600 s, 192,000 strokes | hash match 100 % (1,920 checks); 72.3 B/s per client max; tick p50 / p99 0.02 / 0.08 ms; server 60.7 ms in total (0.10 ms per simulated second); 1 stroke rejected (`segment_too_long`: a bot's lane wrap) | 100 %; <= 1,200 B/s | PASS |
| S4 event-loop lag (60 s `--realtime`) | p99 11.5 ms. Tick p99 was 0.43 ms, so this is mostly the Windows timer step, not P1 | <= 20 ms | PASS on this machine; cgroup run NOT RUN |
| S5 400 robots + 4 bots, 1,800 s (synthetic) | server 316 ms in total = 0.18 % of a 0.1-CPU budget; RSS 140 MB (whole process: harness, tsx, grid); 1,466 intents, 17.1 B/s; 718,178 robot chunks; tick p99 0.05 ms | <= 10 %; <= 300 MB | PASS |
| S6 restart, 80 s | restored hash consistent; clients match 100 % after rejoin; restore 7.0 ms; checkpoint 710 B, 2.6 ms to encode; lost 0 s (the harness crashes on a persist tick; the real bound is the persist interval) | <= 30 s; consistent | PASS. Durable store is an in-process byte array, **not PostgreSQL** |
| S7 late join after 60 s of S4 | blocking 101 B; streamed 0; playable 2.4 ms in process (no network); no tile rebuild | <= 150 KB; <= 3 s | PASS |
| S8 parity | 9 bookmarks listed | no visible difference | captures **NOT RUN** (no GPU renderer) |

Other numbers:

- `dust.plots` at 2 Hz instead of every tick (`results/flush-2hz`): 65.1 B/s per client in S4. About 40 B/s of either figure is `dust.ack` at 10 Hz.
- Server state per room: 983 KB (removed units u32 + L0 u16 for 163,842 plots). No per-plot allocation ever.
- Browser lane: the golden scenario (6,000 strokes, 40 robot plots, snapshot join, checkpoint, ring) gives the same 12 numbers in Chromium as in Node. Firefox and WebKit NOT RUN (not installed here).

Benchmark (`bench/p1-bench.ts`, best of 5 rounds; the allocation floor of the method is about 0.1 to 0.4 B per microsecond of run time):

| Call | ns/call | B/call |
| --- | ---: | ---: |
| `server.submitStroke` (accepted, with removal) | 84 | 0.33 |
| Tick: 6 strokes + step + `dust.plots` flush to 6 clients | 756 | 0.00 |
| `server.step` with 400 robot jobs (20 chunks) + flush | 5,078 | 0.00 |
| `encodeSnapshot` cold (163,842 plots; cached afterwards) | 914,000 | floor |
| `encodeCheckpoint` (returns a new buffer) | 414,000 | result only |
| `restore` | 1,502,000 | floor |
| `ring.drawStroke` Desk Duster (7.5 cm x 60 cm) | 4,774 | floor |
| `ring.drawStroke` Bulldust (1 m x 3 m) | 112,469 | floor |
| `ring.centerOn` walking | 53 | 0.00 |

## CPU reference pictures (not GPU captures, not contest scores)

`bench/cpu-reference-capture.ts` ray-casts the 9 harness bookmarks on a smooth sphere with the WDS 7.7 albedo pair and the P1 dust mask, 1280 x 720, into `results/cpu-reference/`.
Scene: 16 bots clean around the site for 120 s (visible only through L0), then the viewer sweeps the reference strip inside its ring. `*.late-join.png` is the same view with an empty ring.

What the pictures show:

- The strip the viewer swept is straight and crisp while it is in the ring.
- Everything else is dissolve: holes appear as random blobs spread over the whole plot, not where anyone swept. The 16 bots' lanes are not recognisable.
- Dissolve blobs are cut by straight lines at plot borders (the noise is seeded per plot, as WDS 7.8 says). One moon-wide seed would remove the cuts but the fraction would still step at borders.
- For a late joiner the strip is gone; only blobs remain.

Edge width of the model at the strip edge, pixels of a 1920 x 1080 frame, 60 degree vertical field of view, median of 9 columns (`results/cpu-reference/cpu-reference.json`):

| Distance | Presence mask (10 to 90 %) | Full dust opacity (10 to 90 %) |
| --- | ---: | ---: |
| 2 m | 2.1 px | 20.6 px |
| 10 m | 1 px | 1.2 px |
| 50 m | 1 px (the 2.4 m strip is under 2 px tall) | 1 px |

At 2 m the mask steps within about 2 px, but the thinning term of WDS 7.7 then ramps across the 3.5 cm ring texel, about 20 px. Which of the two the "edge <= 2 px at 2 m" bar means is not defined by the harness; any approach using the same ring has the same ramp. These numbers are not reported through `measureEdgeWidthPx` (it stays NOT RUN until a GPU frame is measured).

## Limits and findings

1. **No GPU renderer.** The ring and the dissolve exist as CPU references only. S1 GPU time, edge width, S8 captures and the VT-M1-03/04/05 look are not measured. The harness has no shared render scene, so each prototype would have to bring its own terrain and material; blind A/B pairs would then differ by renderer, not by dust approach.
2. **Scoring is exploitable, as expected.** Re-scrubbing one line scores exactly like sweeping fresh lanes (test "known weakness"). A plot can be Polished without sweeping most of it.
3. **Trails are local.** No stroke is ever sent. A late joiner, and anyone outside the ring, sees only the dissolve. Other players' trails would have to be drawn from their replicated tool-head motion (not built).
4. A stroke is credited whole to its anchor plot; wide tools near a plot border are attributed up to half a width off.
5. Robot jobs in flight are not in the checkpoint (the robot scheduler would re-issue them).
6. The harness passes no plot classes or areas, so every plot is a mean-area Highland here; the server accepts baked tables.
7. Malformed strokes map to the nearest contract reason (`out_of_reach` for bad positions, `tool_not_equipped` for bad tool fields).
8. The snapshot is sent raw: at these sizes deflate makes it larger (101 B raw, 104 B deflated).
