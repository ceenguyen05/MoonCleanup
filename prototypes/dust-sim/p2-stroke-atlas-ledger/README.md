# dust-sim / p2-stroke-atlas-ledger (P2: strokes + tile atlas + coarse ledger)

Task M1-W1-T04. Prototype only: nothing here is imported by `apps/` or `packages/`.
The harness loads `harness-adapter.ts` in this folder (approach id `p2-stroke-atlas-ledger`).
Not a workspace package (pnpm-workspace.yaml does not list prototypes/*). No dependencies. Production code is read by relative import of source barrels, read-only.

## Hypothesis

The canonical design (ADR-0009, WDS sections 4 to 7): the server keeps a **32 x 32 x 8-bit ledger per touched plot** (0.8 m texels) plus a capped stroke log.
A stroke removes a state-independent, coverage-weighted amount from every ledger texel it crosses (ADR-0026), so the same strokes in any order give the same bytes.
Clients get the strokes themselves (17 B chain header, 4 B continuation), apply the same integer code to their own ledger copies and replay the strokes into a per-plot tile atlas.
What must be shown: byte-identical ledgers on every client, bandwidth and server cost inside the bars, mid-game join, restore, robots as intents, and trails that are shared and persistent.

## What is built

| Piece | File | Notes |
| --- | --- | --- |
| Plot tables | `src/core/tables.ts` | flat arrays from the packages/world grid; **synthetic class map** (hash of chunk id, 55 / 35 / 10 %), the class bake does not exist yet |
| Ledger, L0, hashes | `src/core/dust-view.ts` | WDS 4.5 rasteriser (integer lattice, flat ends, minimum removal), ownership mask, Opened / Polished thresholds, FNV ledger hash, pooled ledgers |
| Stroke log | `src/core/stroke-log.ts` | ring of 256 strokes per plot, 16 B each, 16 MB cap with eviction |
| Interest set | `src/core/interest.ts` | dust radius = residency + 20 m, leave at + 40 m; server mirror and client run the same code on the same position |
| Robots | `src/core/robots.ts` | intent (20 B) expanded into 1 s lane chunks by server and clients, keyed by server tick; stop record (2 B) |
| Server | `src/core/server.ts` | queue, 10 Hz coalescing, fixed apply order, chains, per-client FRAME sections, `dust.plots` at 2 Hz, `dust.ack`, ledgers and logs on interest entry (cached per plot), `dust.check` every 5 s + resync, join snapshot |
| Client | `src/core/client.ts` | authoritative copy, prediction list by `inputSeq`, decode of the real bytes, drift check |
| Persistence | `src/core/persistence.ts` | header in two slots + two versions per dirty chunk, load rule of data-model 3.7b, against an **in-memory store** |
| Tile atlas (CPU reference) | `src/core/tiles.ts` | residency, slots, eviction, rebuild budget, replay and rebuild math in JavaScript. **No GPU code exists** |
| Harness adapter (Node) | `harness-adapter.ts` | zlib level 6, clock, probes; `grid.ts` exports `createGrid()` (packages/world GP(128,0)) |

**Not built:** the GPU replay (compute and fragment), the detail ring (L3), the dust shading, Inspector's Stamp fade, footprints, orbit proxy. `dust.request` and `dust_interest` are not modelled (the server resyncs by itself; the radius comes from the preset).

`src/core` has no Node, DOM, three.js or Colyseus import (`tsconfig.core.json` compiles it with no DOM lib and no Node types).

## How to run (repo root, Node 26 first on PATH)

- Tests, Node: `node_modules/.bin/vitest run --root prototypes/dust-sim/p2-stroke-atlas-ledger`
- Tests, browser lane (headless Chromium): `node_modules/.bin/vitest run --root prototypes/dust-sim/p2-stroke-atlas-ledger -c vitest.browser.config.ts`
- Types: `node_modules/.bin/tsc -p prototypes/dust-sim/p2-stroke-atlas-ledger/tsconfig.json` and `.../tsconfig.core.json`
- Contest scenarios (dev run, results kept in this folder):
  `cd tools/bots && node --import tsx ../../prototypes/dust-sim/harness/src/cli.ts run --adapter ../../prototypes/dust-sim/p2-stroke-atlas-ledger/harness-adapter.ts --grid ../../prototypes/dust-sim/p2-stroke-atlas-ledger/grid.ts --results ../../prototypes/dust-sim/p2-stroke-atlas-ledger/results/standard --tier floor`
- Event-loop lag: add `--realtime` (the probe is attached only then; a flat-out run reports NOT_RUN). `P2_STROKE_CADENCE=tick` sends every submitted stroke (20 Hz) instead of the 10 Hz spec cadence. `P2_TILES=0` switches the CPU reference atlas off. `P2_DUST_CELL_G=<grams>` sets a Dust Cell capacity.
- Benchmarks (from `tools/bots`, `node --import tsx ../../prototypes/dust-sim/p2-stroke-atlas-ledger/bench/<file>`): `p2-bench.ts` (time and bytes per call), `alloc-probe.ts`, `tick-probe.ts`, `tile-ledger-agreement.ts`, `edge-model.ts`, `print-golden.ts`.

## Numbers (dev runs, 2026-11-14, i7-8650U, Windows 11, Node 26.13.1; one full core, not the 0.1-CPU cgroup)

Standard lengths, results in `results/standard/p2-stroke-atlas-ledger/` (the run on the final file state).
**Timings are upper bounds:** other agents were using the machine (CPU load 31 to 100 % during the runs); the same run earlier in the day was about 2 x faster. Counts, bytes and hashes are identical between runs.

| Scenario | Measured | Bar | Status |
| --- | --- | --- | --- |
| S1 walk, 180 s, 10,800 frames, 3,599 strokes | client tile CPU p95 0.01 ms per frame; 12 tiles; 0 drift, 0 mispredicts | dust GPU ms, edge px | GPU ms and edge px **NOT RUN** (no GPU renderer) |
| S2 Skiff, 120 s, 2,399 strokes | worst frame 0.09 x the 16.7 ms target; replay p95 0.02 ms; tile rebuild max 1.5 (mean 0.25) ms; 23.5 tile uploads/s; 157 rebuilds; 21 tiles, no eviction. Three repeats: 1.0 x, 0.72 x and **2.9 x** (rebuild max 16.6, 11.8 and 47.5 ms at 55 to 100 % machine load) | <= 2 x target | PASS in 3 of 4 runs, **FAIL in 1**: the worst-frame bar is not stable on a loaded machine (CPU reference only; the GPU cost is NOT RUN) |
| S3 orbit, 60 s | 0 tile uploads per frame | >= 80 % identification | **NOT RUN** (needs testers and captures) |
| S4 16 bots, 600 s, 192,000 strokes submitted, 96,000 applied after 10 Hz coalescing | hash match 100 % (1,920 checks); **762 B/s** per client; tick p50 / p99 0.35 / 1.69 ms (server + 16 in-process clients); server part p50 / p99 0.05 / 0.22 ms, 726 ms in total (1.2 ms per simulated second; 2.3 and 4.6 in two earlier runs at higher load; WDS 9 allows 8); 1 stroke rejected (`segment_too_long`, a bot's lane wrap); 0 drift, 0 resyncs | 100 %; <= 1,200 B/s | PASS |
| S4 at 20 Hz (`P2_STROKE_CADENCE=tick`, every submitted stroke sent) | **1,492 B/s** per client; hash match 100 % | <= 1,200 B/s | **FAIL**. The PASS above depends on the 10 Hz cadence of WDS 4.4 |
| S4 event-loop lag (60 s `--realtime`) | p99 29.1, 40.2 and 34.1 (three runs, machine load 46 to 94 %). Control: P1 read 108 ms in the same minute (11.5 ms in its own report), so this measures the machine, not the prototype ms. Whole process (16 in-process clients and the bots included); tick p99 14 to 16 ms in real time, server part p99 2.4 to 2.7 ms | <= 20 ms | **FAIL as measured, not a valid measurement**; cgroup run NOT RUN |
| S5 400 robots + 4 bots, 1,800 s (synthetic) | server 5,238 ms in total = 2.9 % of a 0.1-CPU budget; RSS 160 MB (whole process); 1,466 intents, 9.4 B/s; 718,178 robot chunks (399/s, no scheduler cap in the prototype); 343 ledgers, 185 Polished; **0 drift, 0 resyncs** | <= 10 %; <= 300 MB | PASS |
| S6 restart, 80 s | restored hash consistent; clients match 100 % after rejoin; restore 9.0 ms; 24 saves, last save 4,019 B (1 chunk), store 7,951 B; lost 0 s (the harness crashes on a persist tick) | <= 30 s; consistent | PASS. In-memory store, **not PostgreSQL** |
| S7 late join after 60 s of S4 | blocking 26,739 B (25 ledgers + logs + state map); streamed 465 B; playable 44.7 ms in process (no network), of which 33.5 ms for 25 tile rebuilds (CPU reference) | <= 150 KB; <= 3 s | PASS. Aged 60 s, not 30 minutes |
| S8 parity | 9 bookmarks listed | no visible difference | captures **NOT RUN** (no GPU renderer) |

S4 bytes per client per second: strokes 702, `dust.ack` 39, `dust.plots` 16, ledgers + logs + checks + snapshot 4. Strokes scale with the number of cleaners in range: at the 6-player cap about 263 B/s of strokes (derived, not run; the harness has no 6-bot S4).

Determinism:

- Golden vectors (`test/golden-cases.ts`): 1,000 seeded strokes over 18 plots with every tool, and a whole-model scenario (6 cleaners, chains, robots, checkpoint, late join, tile atlas). Node 26.13.1 and headless Chromium give the same numbers. Firefox and WebKit NOT RUN (not installed here).
- 200 random permutations of one op set give identical ledgers (V2). Re-scrubbing never collects more than fresh lanes (V4). Every tool reaches Polished (reachability).
- V1 is not the contract form: the vectors are recorded digests in a test file, not `packages/world/test/vectors/ledger-v1.json` with SHA-256.

Benchmark (`bench/p2-bench.ts`, one run at moderate machine load; allocation floor of the method about 0.1 to 0.6 B per call):

| Call | ns/call | B/call |
| --- | ---: | ---: |
| `applyStroke` Desk Duster 15 cm x 0.15 m (54 lattice points) | 2,968 | floor |
| `applyStroke` bot 60 cm x 0.30 m (74 points) | 2,500 | floor |
| `applyStroke` Bulldust 300 cm x 2 m (1,393 points) | 15,353 | floor |
| `applyStroke` robot lane 200 cm x 0.6 m (436 points) | 4,405 | floor |
| `applyStroke` largest record 1,023 cm x 4 m (15,640 points) | 80,017 | 2.3 |
| `ledgerHash` (1,024 bytes) | 1,127 | floor |
| `InterestSet.scan` (140 m, 210 plots) | 6,622 | floor |
| client `onFrame`, 16 strokes decoded and applied | 38,107 | floor |
| tile frame, 2 strokes replayed, Medium / High (CPU reference) | 24,226 / 28,849 | floor |

The WDS 9 bar "p99 stroke <= 0.2 ms" holds for every tool up to the largest legal record (0.08 ms).
Whole tick (`bench/tick-probe.ts`, 16 clients, fake clock): 19 to 30 B per tick at the 10 Hz cadence (about 0.5 KB per simulated second, not traced to one call site), 2.5 B per tick at 20 Hz. Ledger and log messages allocate by design (per plot entering a client's radius, never per stroke).

## Edge width: a CPU model, not a capture (`bench/edge-model.ts`, `results/edge-model/edge-model.json`)

The reference strip's west edge seen from the harness edge bookmarks (1920 x 1080, vertical field of view 60 degrees, eye 1.7 m), 10 to 90 % rise with the harness function, in pixels: dust opacity / presence mask.

| Source | Pass strength s | 2 m | 10 m | 50 m |
| --- | ---: | --- | --- | --- |
| Tile atlas Medium (40 cm texels), strip as the harness sweeps it | 0.25 | 117.9 / no edge | 6.5 / no edge | not measurable |
| Tile atlas Medium, strip swept clean | 1.00 | 75.8 / 4.5 | 5.1 / 0.9 | not measurable |
| Tile atlas High (20 cm texels), strip as the harness sweeps it | 0.25 | 74.1 / no edge | 4.7 / no edge | not measurable |
| Tile atlas High, strip swept clean | 1.00 | 38.1 / 2.6 | 3.0 / 1.5 | not measurable |
| Ring model 3.5 cm (ring not built), strip as the harness sweeps it | 0.25 | 10.0 / no edge | 1.0 / no edge | not measurable |
| Ring model 3.5 cm, strip swept clean | 1.00 | 8.3 / 1.6 | 1.4 / 1.5 | not measurable |

Reading:

- **The tile atlas alone is far from the 2 px bar at 2 m** (38 to 118 px of opacity ramp). The atlas is the mid-field layer; near the Custodian the bar depends entirely on the detail ring, which is not built. A late joiner standing at an old edge sees the atlas softness until the ring is fed.
- With the ring's texel size the opacity ramp is 8 to 10 px at 2 m, the mask 1.6 px. The thinning term spans about two ring texels, as P1 found. On the harness definition (opacity, T02b) this fails 2 px; the mask alone passes.
- The harness strip is one Bristle Broom pass (depth16 32) and the site is a Mare plot here (level 8), so P2 removes a quarter of the layer: the strip is thinned, not clean, and the presence mask shows no edge at all. Any approach with authoritative depth behaves like this; the scene should use a depth that clears the class, or state the class.
- At 50 m the 2.4 m strip is under 2 px tall.
- `measureEdgeWidthPx` returns null (NOT RUN) until a GPU frame is measured. The P1 README numbers used a different edge definition (fixed 10 / 90 % levels), so they are not directly comparable.

## Findings (defects found and fixed in this task, then open limits)

Fixed:

1. **Tile replay ran ahead of the ledger.** WDS 7.3 draws round-capped capsules and subtracts them. Consecutive segments of a chain overlap by a cap at every joint, so a slow chain removed (length + width) / length passes instead of one. Measured against the ledger on 16-bot worlds (`bench/tile-ledger-agreement.ts`): mean tile dust 8.6 points below the ledger, worst cell 62 points, 27 % of cells off by more than 10 points (VT-M1-34 allows 10). The replay now draws the flat-ended segment box-filtered over one texel, as the ledger lattice does: mean 0.5, worst 8, 0 % over 10; after a rebuild from ledger + logs 0.0, worst 3. Round caps remain a look option only where s = 1 or as a non-subtractive effect. **WDS 7.3 needs this correction.**
2. **Tile rebuild double counted** (found by the earlier worker): WDS 7.4 initialises from the ledger and then replays the logs, which subtracts the logged strokes twice. The reference replays the logs from R = 1 and then subtracts per ledger cell only what the logs do not explain.
3. **Robot re-assignment drifted clients.** A client that held a robot's plan was not told when the robot moved to a plot outside its reach and kept executing the stale plan; a second, narrower race applied one old chunk on one side only when the new intent arrived on a chunk tick. S5 showed 139 drifting chunks and 139 resyncs in 30 minutes (the hash check of S5 is not scored, so it still read PASS). Now the swap happens at the frame boundary on both sides, out-of-reach clients get a 2 B stop record, and reach is two plot rings (what the rasteriser can touch): 0 drift over the same run with the drift check switched off. `robot.plot` needs a stop record (or equivalent) in the protocol.
4. **Ledger sends were not shared.** On the first frame all 16 clients entered the same 12 plots and the server deflated 330 ledger and log messages in one tick (41 ms server time, cold). Messages are now cached per plot until the ledger version or log changes: 24 encodes; the burst tick is 3 to 7.5 ms warm, 18 to 34 ms in a cold process (first-tick JIT). A mass entry (teleport, join with hundreds of Opened plots in range) is still unbudgeted.
5. **The lag PASS in the earlier results was not a lag measurement** (a flat-out run reported server tick time as event-loop lag). The probe is now attached only under `--realtime`; those results were deleted.

Open:

6. No GPU path, no ring: S1 GPU ms, edge width, S8 parity, compute versus fragment replay (WDS 12 item 5) and the VT-M1-03/04/05 look are all unmeasured.
7. The bandwidth bar is met only at the 10 Hz cadence (finding in the table). With 16 cleaners in one spot strokes are 92 % of the bytes.
8. Coalescing two 20 Hz strokes into one segment replaces a bend by its chord; the ledger and tiles follow the coalesced record, the predicted local trail would not. Not measured.
9. Bends of a chain leave a thin uncovered wedge on the outside in the tile (flat ends), and a double-covered one inside. Not measured.
10. Rebuild de-duplication collapses two identical strokes by one actor (same packed words) into one.
11. Stroke log beyond the caps (256 per plot, 32 in a save, 16 MB) is represented by the ledger only: old edges come back at 0.8 m after a rebuild. Not exercised (no evictions in any run).
12. A robot intent submitted in the last frame interval before a save is not in it. Robots are not capped at 150 chunks/s.
13. Encoded-message cache entries are kept until their ledger slot is reused (up to about 2.5 KB per plot that was ever sent).
14. Malformed strokes map to `tool_not_equipped`; reach, speed, height and rate checks of WDS 4.4 are not modelled (the harness gives no pose).
15. The harness passes no plot classes, so classes are synthetic per chunk; mgPerUnit is the fixed mean (2,480 mg).

## T06 additions (M1-W1-T06, see `docs/agent-reports/M1-W1-T06-terrain-dust-engineer.md`)

- Allocation fixes from T05 applied: counted outbox list, signed int32 hashes inside the core (`bench/tick-alloc-t06.ts`, three windows and a floor row; the single-window `bench/tick-probe.ts` is not repeatable).
- `src/core/tiles.ts`: optional `TileRecorder` tap on the draw stream and a deterministic rebuild work counter (`fRebuildWork`). The CPU reference behaves the same without a recorder.
- Adapter switches: `P2_FRAME_TRACE=<file.json>` (per-frame trace + GC pauses), `P2_GPU_RECORD=<dir>` (draw-stream recording).
- GPU lane (`gpu/`): `recorder.ts` (Node), `record-cluster.ts` (N cleaners + viewer), `replay-page.mjs` + `replay.html` (raw WebGPU fragment and compute replay, byte comparison with `tiles.ts`, timestamp queries), `run-gpu.mjs` (Playwright runner, serves on 127.0.0.1 and closes everything), `summarize.mjs`.
  `node prototypes/dust-sim/p2-stroke-atlas-ledger/gpu/run-gpu.mjs prototypes/dust-sim/results/t06/gpu-rec prototypes/dust-sim/results/t06/gpu`
- Benches: `bench/rebuild-worst-t06.ts [recDir]` (one tile rebuild with full logs), `bench/s4-cap6.ts [bots] [seconds]` (S4 at the room cap).
- Shared T06 scripts: `prototypes/dust-sim/t06/lag-run.ps1` (lag runs with the load sampled during the run, idle control, optional load gate), `t06/s2-diagnose.mjs`. Results: `prototypes/dust-sim/results/t06/`.
- Findings 1 and 2 above (WDS 7.3 flat ends, WDS 7.4 rebuild order) are confirmed by the GPU byte comparison: 0 differing bytes on six recordings. New open limit: the rebuild budget must be in milliseconds, not tiles (one full-log rebuild is 0.9 to 5.5 ms of CPU).
