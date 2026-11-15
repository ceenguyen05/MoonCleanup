# M1-W1-T06 Dust contest integration and decision (terrain-dust-engineer)

Task / status: **in-review** / 2026-11-14 / terrain-dust-engineer / Fable 5.2
Node 26.13.1 (fnm PATH prefix), i7-8650U + Intel UHD Graphics 620, Windows 11, Chrome 157.0.8103.79. No git used. `packages/**` and `apps/**` untouched. No server or browser left running.
Inputs: T04 (P2) and T05 (P3, comparison table) reports. A number is a T06 measurement only where it says so. The machine was shared with other work all session (load 20 to 100 %); every timing carries its load.

## Decision

**P2 (strokes + tile atlas + coarse ledger) wins. P3 is not adopted. P1 is kept as the mid-field look and as the fallback if the detail ring fails.**

| | P1 scalar | P2 strokes + ledger | P3 min-merge |
| --- | --- | --- | --- |
| Scoring authority | server, uniform dust: re-scrub exploit | **server, exact at 0.8 m** | client-reported: 2.70 x forger, 0 rejects (T05) |
| Trails others see | none (dissolve) | persistent, identical on every client | 0.4 m, 16 levels |
| S4 down per client, 16 bots, 10 Hz (bar 1,200 B/s) | 72 | 762 (T06 recheck: 761.99) | 1,031 + 118 up |
| S4 at the cap, 6 bots, 10 Hz | not run | **334** (T06) | 458 + 117 up |
| S5 share of 0.1 CPU (bar 10 %) | 0.18 % | 2.9 % | 0.47 % |
| S7 blocking join (bar 150 KB) | 101 B | 26,739 B | 5,139 B |
| GPU replay on the UHD 620 | NOT RUN | **0.010 to 0.028 ms per pass, bytes identical to the CPU reference** (T06) | NOT RUN |

- Decision rule (WDS 10): P2 wins unless it misses a server bar by more than 2 x where P1 meets it, or loses the blind visual test to P3 by more than 60/40. P2 misses no server bar. The blind test is NOT RUN for all three, so it cannot overturn the default.
- P2 against P1: P1 is 5 to 250 x cheaper on every server number, and P2 is still inside every bar with room (334 of 1,200 B/s at the cap, 2.9 of 10 % CPU). What P1 cannot give is the product: trails that persist and match between players, and scoring that cannot be farmed by re-scrubbing. The condition T05 left open ("P1 if P2's GPU half fails") is now half answered: the replay half runs and is cheap; the ring and the shading are still unbuilt.
- P3: breaks the authority non-negotiable with a measured exploit, and has the highest bandwidth.

## Solo-first check (CLAUDE.md product priority)

| Rule | P2 status | Evidence |
| --- | --- | --- |
| No solo input delay | By design, not captured: own strokes are drawn from the local prediction in the frame they happen; in a Solo Shift the ledger runs in the sim Worker (ADR-0031), no socket on the path | input-to-visual capture NOT RUN |
| No solo allocation | At the floor of the method, not proven 0: 4.3 to 4.7 B per tick with 1 client, floor row 2.3 to 8.4 | `bench/tick-alloc-t06.ts` |
| No solo frame cost, steady state | CPU tile bookkeeping p95 0.01 ms (S1). GPU replay 0.024 ms p50 / 0.041 ms p99 per pass, main-thread encode 0.08 ms p50 / 0.14 ms p99, in 1 frame of 6 (S1, rAF paced, UHD 620) | GPU table |
| No solo frame cost, tile rebuilds | **Not met by WDS 7.2 as written**: one rebuild with full logs is 0.9 to 5.5 ms of main-thread CPU and the budget counts tiles (3 / 6 per frame). The same log replay costs 0.02 to 0.14 ms on the GPU | finding 3, contract W3-T02.7 |
| Netcode never costs solo | In solo nothing is encoded for a wire (chains, `dust.check`, interest sets, ledger messages exist only in a server room) | design |

## P2 fixes done in T06

1. **Both T05 allocation fixes applied** (`src/core/{server,client,dust-view}.ts`): the per-client outbox is a counted list (no `length = 0`); ledger, plot and chunk hashes are signed int32 inside the core (unsigned only at `hashWhere`, the public boundary). Wire bytes, golden digests and the S4 byte count (761.99 B/s) are unchanged. Three windows per variant after the fixes (`bench/tick-alloc-t06.ts`):

   | Variant | B/tick, 3 windows |
   | --- | --- |
   | floor: empty loop, no dust code | 2.29 / 8.43 / 3.85 |
   | 1 client (solo shape), 10 Hz, checks every 5 s | 60.74 / 4.31 / 4.70 |
   | 6 clients (cap), 10 Hz / 20 Hz, checks | 4.48 / 2.20 / 4.29 and 6.91 / 2.07 / 2.05 |
   | 16 clients, 10 Hz / 20 Hz, checks | 2.23 / 2.17 / 1.85 and 1.62 / 1.58 / 1.55 |

   Honest limits: there is **no valid before / after pair**. T04's single-window probe (`bench/tick-probe.ts`) read 32.5 / 3.2 / 19.5 / 11.3 / 15.6 B/tick before and 13.6 / 26.2 / 16.9 / 19.4 / 14.1 after (`results/t06/tick-probe-after.txt`): the same variant moved from 3.2 to 26.2 with code that only removed allocations, so that probe is not repeatable and T04's "19 to 30 B" may have been its warm-up. The first window of the 1-client row (60.7) is also warm-up, not traced.
2. **S2 "FAIL in 1 of 4" is a machine flake, not tile work** (`t06/s2-diagnose.mjs`, 5 runs, per-frame trace, `results/t06/s2-diagnosis/summary.json`). The deterministic rebuild work per frame is identical in all 5 runs. Worst frame in 4 runs: frame 0 (3 rebuilds, 12,480 work units, 10.3 to 11.6 ms = 0.62 to 0.70 x, cold JIT at 807 to 914 ns per unit against a warm 172 to 208). In run 3 the worst frame was **frame 84: 0 rebuilds, 0 work units, 29.0 ms** (1.74 x), and frame 0 of that run took 22.5 ms. No GC pause was recorded in any run. Load 29 to 53 %. S2 for P2 in T06: PASS in every run (5 traced runs 0.62 to 1.74 x, final recheck 0.08 x).
3. **Real finding beside it: rebuild cost is not bounded by the WDS 7.2 tile budget.** S2 never fills a stroke log; a partly cleaned plot fills its 256-stroke log long before it is Polished (arithmetic, not a run: a 307 m^2 plot over 0.18 m^2 per 60 cm x 0.3 m stroke is about 1,700 strokes for one pass). One rebuild, warm, logs of the plot and its 6 neighbours full (`bench/rebuild-worst-t06.ts`, `results/t06/rebuild-worst.txt`):

   | Logs | Tile | CPU ms p50 / p95 / max (quieter run) | same, loaded run | GPU log replay, fragment, ms p50 / max |
   | --- | --- | --- | --- | --- |
   | 7 x 256 hand tool 60 cm | Medium 64^2 | 0.91 / 1.49 / 1.83 | 1.58 / 3.24 / 6.46 | 0.019 / 0.025 (305 quads) |
   | 7 x 256 Bulldust 300 cm | Medium 64^2 | 1.88 / 3.00 / 6.08 | 3.57 / 7.44 / 10.63 | 0.061 / 0.075 (469 quads) |
   | 7 x 256 hand tool | High 128^2 | 1.61 / 2.37 / 5.13 | 2.53 / 7.27 / 19.91 | 0.024 / 0.029 (290 quads) |
   | 7 x 256 Bulldust | High 128^2 | 5.45 / 7.44 / 8.90 | 9.47 / 18.98 / 34.84 | 0.133 / 0.183 (453 quads) |

   At the WDS 7.2 budgets (Medium 3, High 6 tiles per frame) one frame carries 2.7 to 5.6 ms (Medium) or 9.7 to 32.7 ms (High) of main-thread rebuild at p50 in the quieter run (57 ms on High in the loaded run): at or over 2 x target on High, and a visible hitch in solo whenever tiles come back (join, eviction return, Skiff re-entering ground, resync). The GPU column times only the log replay; the per-cell residual step has no GPU twin yet.
4. **WDS 7.3 / 7.4**: both corrections are in the P2 code as found (flat-ended box-filtered segments; rebuild from R = 1 plus per-cell residual) and are now confirmed by the GPU byte comparison. The spec text is not mine to edit; the wording is in the contract below for the lead / contracts-architect.

## Event-loop lag (S4, 60 s `--realtime`, load sampled every second DURING each run)

`t06/lag-run.ps1`; rows in `results/t06/lag/<tag>/lag-log.jsonl`. Accepted only when the mean total CPU load during the run is below 25 %. New: an **idle control** (`t06/idle-lag-control.mjs`), the same probe in a Node process with no dust code.

| Run | lag p99 ms | load mean / p90 / max % | Verdict |
| --- | ---: | --- | --- |
| R1 idle control | 15.3 (p50 5.8) | 34.0 / 61.0 / 77.0 | invalid |
| R1 P1 | 14.8 | 33.4 / 55.9 / 85.6 | invalid |
| R1 P2 (before the T06 edits) | 15.2 | 27.5 / 54.7 / 82.7 | invalid |
| R1 P3 | **14.5** | 23.1 / 42.0 / 69.2 | **accepted** (bar 20: PASS) |
| R2 idle / P2 / P1 / P3 | 37.5 / 61.4 / 74.7 / 91.6 | 95.1 / 78.8 / 99.6 / 99.9 mean | invalid |
| R3 idle / P2 / P1 / P3 | 25.6 / 21.1 / 13.5 / 20.7 | 53.6 / 60.7 / 31.2 / 55.0 mean | invalid |
| R4 idle control (gated at 20 % before each run) | 14.9 (p50 5.8) | 40.5 / 60.3 / 73.1 | invalid |
| R4 P2 (final T06 files) | **14.1** | 19.2 / 32.7 / 58.0 | **accepted** (bar 20: PASS) |
| R4 P1 | **13.7** | 18.9 / 33.3 / 52.8 | **accepted** (bar 20: PASS) |

Accepted readings (mean load below 25 %): **P1 13.7, P2 14.1, P3 14.5 ms, all PASS against 20 ms.** But **the probe measures the machine, not the approach**: an idle process reads 14.9 to 15.3 ms in the same rounds (37.5 at 95 % load), and its p50 is already 5.8 ms, the Windows timer step (15.6 ms; 3,697 callbacks in 60 s) minus the 10 ms probe resolution. So the three sit on the idle floor, no difference between them is resolvable here, and the PASS says only that none of them adds measurable lag on a full core. The 0.1-CPU Linux cgroup run, the one the bar is written for, is NOT RUN. T04's 29 to 40 ms for P2 was machine load.

## Tick rate for dust streaming

| S4, P2, 600 s (`bench/s4-cap6.ts`, `results/t06/cap6/`) | B/s per client | strokes / ack / plots / rest | hash match | server ms total |
| --- | ---: | --- | --- | ---: |
| 6 bots (cap), 10 Hz | **334** | 285 / 39 / 7 / 2 | 100 % (720) | 352 |
| 6 bots (cap), 20 Hz | 653 | 565 / 78 / 7 / 2 | 100 % (720) | 855 |
| 16 bots, 10 Hz | 762 | 702 / 39 / 16 / 4 | 100 % (1,920) | 1,071 |
| 16 bots, 20 Hz | 1,492 FAIL | 1,393 / 77 / 16 / 4 | 100 % (1,920) | 1,179 |

**Recommendation: sim at 20 Hz, dust strokes at `SNAPSHOT_HZ` = 10 Hz, as WDS 4.4 already says. No delta or budget change to P2.**
- The 20 Hz failure exists only at 16 bots, which is outside the room cap of 6. At the cap both rates pass (334 and 653 of 1,200 B/s); 10 Hz halves egress and server stroke work for a gain only remote players could see, and remote lag is allowed.
- Solo feel does not depend on this rate: own strokes are predicted and drawn per rendered frame.
- One stroke interval (`SIM_TICK_HZ / SNAPSHOT_HZ` ticks) must be a shared constant used by the Solo Worker and the server room, so a Contract opened to friends keeps the same ledger arithmetic.
- The S4 bar should be restated at 6 bots (harness request, as in T04 / T05).
- 1 reject in every run: a bot's lane wrap leaves the int16 range (`SUBMIT_MALFORMED`, which the adapter labels `tool_not_equipped`; T04 called it `segment_too_long`).

## GPU half (P2): stroke replay on the UHD 620

Chrome 157 through Playwright (headed, `channel: chrome`); adapter reported by the page: **intel, gen-9, "Intel(R) UHD Graphics 620", not a fallback adapter**; timestamp-query on, quantisation off by launch flag; page cross-origin isolated (5 us clock). `results/t06/gpu/adapter.json`.
**Raw WebGPU + WGSL, not three / TSL**: a prototype measurement of the pass itself. The TSL port inside WebGPURenderer is W3-T02 and is NOT RUN.
Method: the CPU reference (`tiles.ts`) records its draw stream per 60 fps frame (`gpu/recorder.ts`); the page (`gpu/replay-page.mjs`) replays it into the RGBA8 atlas (2048^2 Medium, 4096 x 2048 High), then reads the atlas back and compares every byte of every resident tile. Rebuilt tiles are uploaded whole (16 KB / 64 KB). Fragment = one render pass, one instanced draw, blend RGB reverse-subtract + alpha max. Compute = WDS 7.3 column (per-texel loop, scratch storage texture, one copy per touched tile; the copies are outside the timed pass). Full table: `results/t06/gpu-summary.md`.

| Recording (60 fps frames) | Bytes differing from `tiles.ts`, fragment and compute (whole recording, flat-out) | Fragment GPU ms per pass p50 / p99 / max (rAF paced) | Compute GPU ms p50 / p99 / max | Main-thread encode ms p50 / p99 / max, fragment | Load % |
| --- | --- | --- | --- | --- | ---: |
| S1 walk, harness, Medium | **0 of 49,152** | 0.024 / 0.041 / 0.053 | 0.019 / 0.047 / 0.147 | 0.080 / 0.135 / 0.190 | 29 |
| S2 Skiff, harness, Medium (157 tile uploads) | **0 of 86,016** | 0.025 / 0.029 / 0.051 | 0.021 / 0.051 / 0.160 | 0.090 / 0.170 / 0.210 | 35 |
| 1 cleaner, Medium | **0 of 12,288** | 0.025 / 0.030 / 0.584 | 0.021 / 0.034 / 0.147 | 0.120 / 0.930 / 1.685 | 82 |
| 6 cleaners (cap), Medium | **0 of 20,480** | 0.025 / 0.027 / 0.027 | 0.029 / 0.044 / 0.144 | 0.110 / 0.260 / 0.395 | 91 |
| 6 cleaners, High | **0 of 81,920** | 0.026 / 0.029 / 0.030 | 0.065 / 0.127 / 1.140 | 0.105 / 0.355 / 3.995 | 86 |
| 16 cleaners, Medium (79 quads in the largest pass) | **0 of 20,480** | 0.028 / 0.032 / 0.035 | 0.047 / 0.068 / 0.215 | 0.115 / 0.480 / 1.985 | 89 |

- A pass exists in 1 frame of 6 (strokes arrive at 10 Hz); averaged over all frames the fragment replay is 0.004 ms GPU and 0.014 to 0.025 ms of main thread.
- Against the bars: replay target 0.6 ms Tier B (WDS 7.3) and dust GPU 1.0 ms Tier B (WDS 9, S1). The replay part is **about 15 to 20 x under its target on a GPU below Tier B**. The S1 bar itself stays NOT RUN: it also covers the ring and the rebuilds, and the harness metric needs the adapter's `view()` to return GPU ms.
- The encode maxima (1.7 to 4.0 ms) were taken at 82 to 91 % machine load; at 29 to 35 % the maximum is 0.21 ms. Not re-run on a quiet machine.
- **Compute versus fragment (WDS 12 item 5): keep one path, fragment.** Same bytes; fragment is flat at 0.025 ms while compute grows with tile size and stroke count (0.065 ms on High, 0.26 to 1.45 ms for a full-log tile against 0.02 to 0.14 ms); compute needs a scratch texture and copies; fragment is the only path on WebGL2. Needs the ADR named in WDS 12.

## Contract for production

### W3-T01 world dust ledger (`packages/world`, replaces `ApproxDustLedger` behind `DustLedgerPort`)

1. Implements `DustLedgerPort` (`packages/sim/src/dust/ledger-port.ts`) unchanged: `isEmptyPlot`, `applyStroke(stroke, out)` writing milligrams, removed units, `grime01` and up to 8 plots into the caller's `StrokeApplyResult`. No allocation per call.
2. State per touched plot: 32 x 32 x 8-bit ledger (0.8 m texels, 1/16-level units), ownership mask, initial and remaining units, version, 32-bit hash; pooled slots, typed arrays only. Untouched plots cost nothing; Polished plots drop ledger and log.
3. Rasteriser: WDS 4.5 integer lattice, flat ends, coverage-weighted absolute removal with the per-pass minimum (ADR-0026), from the integer stroke record of WDS 4.4. Ledger bytes must not depend on stroke order or engine: no transcendental `Math.*`, no float in any value that reaches a ledger byte.
4. Golden vectors in the contract form: `packages/world/test/vectors/ledger-v1.json` with SHA-256, on Node and in a browser Worker. Start from P2's 1,000-stroke set and whole-model scenario (`p2-stroke-atlas-ledger/test/golden-cases.ts`; today recorded digests, Node + Chromium only).
5. Plot states only from the authoritative host (server room or Solo Worker): Opened at >= 0.1 % removed, Polished at <= 1 % left.
6. Stroke log per plot capped at 256 x 16 B, used only for tile rebuilds. Join, restore and resync use ledger + log snapshots, never raw history.
7. Robots: intents expanded into 1 s lane chunks by the same code on every host, keyed by server tick; a plot change needs a 2 B **stop record** and a frame-boundary swap (T04: 139 drifting chunks without it).
8. Checkpoint: per dirty chunk two alternating versions plus a two-slot header with CRC (data-model 3.7b), written only when dirty; `SAVE_FORMAT_VERSION` round-trip test.
9. Stroke interval is one shared constant for both hosts (10 Hz at defaults).
10. Allocation: steady state at the floor of a multi-window probe with a floor row. Traps: `array.length = 0` then `push`; unsigned 32-bit hashes crossing a call (keep them signed int32 inside); a clock read per stroke.

### W3-T02 GPU stroke replay (`apps/client/src/terrain`)

1. Tile atlas per WDS 7.2 (RGBA8: R remaining dust, G unpolish, B untrampled, A berm); slot table on the CPU.
2. **One replay path: fragment.** One pass per frame that has strokes, one instanced draw; an instance is the texel rectangle of one stroke in one tile slot, drawn into every resident tile whose frame it overlaps. Blend RGB reverse-subtract, alpha max. Order-independent, so prediction, echo and remote strokes may arrive in any order.
3. **WDS 7.3 correction:** flat-ended segments, box-filtered over one texel across the width and along the length; round only for the zero-length Detailing disc. Round caps are subtracted again at every chain joint (T04: tile 8.6 points ahead of the ledger on average, worst 62; flat ends 0.5 / worst 8). `s * c` rounded to 1/255 in the shader (`floor(x + 0.5)`) before the subtraction.
4. **WDS 7.4 correction:** never initialise from the ledger and then replay the logs (double count). Rebuild = R = 1, replay the logs of the plot and its 6 neighbours (each stroke once), then per 0.8 m ledger cell subtract only the removal the logs do not explain; ledger-zero cells cleared.
5. Acceptance: the atlas read back from the GPU equals the CPU reference byte for byte on the T06 recordings (`results/t06/gpu-rec/`), on WebGPU and on the WebGL2 backend.
6. Own strokes are drawn in the frame they are predicted; an echo within 30 mm changes nothing.
7. **Rebuild budget in milliseconds, not tiles**: at most 1.0 ms of main-thread rebuild work per frame (proposal), by replaying the logs on the GPU (item 2's pipeline; measured 0.02 to 0.14 ms per full-log tile) and doing the residual step either as a second small pass or in the Solo Worker, which already holds ledgers and logs. Show the worst frame with full logs on Medium and High.
8. Tiles are client-only and cosmetic: never synced, hashed or saved. Budgets: replay pass <= 0.1 ms GPU and <= 0.3 ms main thread on the UHD 620.

## Risks and what stays open

- **Not built, so NOT RUN**: detail ring (the 2 px edge bar at 2 m depends on it entirely: the atlas alone gives 38 to 118 px, T04 model), dust shading, atlas sampling cost in the terrain shader, Inspector's Stamp fade, TSL port, WebGL2 backend, S8 parity captures, S3 testers, blind A/B pairs, VT-M1-03/04/05.
- Other hardware (Tier A, Tier B reference GPUs), Firefox / WebKit: NOT RUN. The UHD 620 result is headed Chrome (graphics backend not recorded) on a shared machine.
- 0.1-CPU cgroup (S4 / S5 and any valid lag number), PostgreSQL restore, 30-minute S7 aging, root `pnpm verify`: NOT RUN.
- P2 limits still open (T04 README 8 to 15): coalescing replaces a bend by its chord (predicted trail versus ledger), bend wedges with flat ends, rebuild de-duplication of identical strokes, log caps never reached in a harness run, mass interest entry unbudgeted, reach / speed / height validation not modelled.
- Deadline risk: W3-T02 now carries the ring, the shading hooks, the TSL port and a GPU rebuild. That is the largest remaining dust item.

## Evidence

- vitest Node 28 / 28, browser lane (headless Chromium) 2 / 2: golden digests unchanged after the hash change. tsc clean (`tsconfig.json`, `tsconfig.core.json`). prettier clean (`--ignore-path .gitignore`). eslint `--no-ignore`: only the 2 deep-import errors prototypes/README rule 1 requires.
- Harness recheck on the final files (`results/t06/p2-final-recheck`): S2 PASS 0.08 x, S4 761.99 B/s and 100 %, S6 PASS, S7 26,739 B / 38.5 ms; S1 GPU metrics NOT_RUN in the harness.
- File state: the GPU runs predate a formatting pass and a lint comment in `gpu/replay-page.mjs`; the allocation probe, S2 diagnosis and cap-6 runs predate a formatting pass of the adapter. No logic changed afterwards.

## Next

1. Lead: record D2 = P2 and the single fragment path as ADRs; route the WDS 7.2 / 7.3 / 7.4 text changes (rebuild budget in ms, flat ends, rebuild order) to contracts-architect.
2. W3-T01: port the ledger from `p2-stroke-atlas-ledger/src/core/dust-view.ts` behind `DustLedgerPort` with the contract vectors.
3. W3-T02: fragment replay in TSL with the byte acceptance test, then the ring.
4. qa-test-engineer: 6-bot S4 in the harness; a lag probe that subtracts an idle control, run in the cgroup.

## Blockers / requests

None blocking. Spec edits above (lead / contracts-architect). Harness requests as in T04 / T05 plus the idle control.

Files: `prototypes/dust-sim/t06/**`, `prototypes/dust-sim/results/t06/**`, `prototypes/dust-sim/p2-stroke-atlas-ledger/{src/core/{server,client,dust-view,tiles}.ts,harness-adapter.ts,tsconfig.json,bench/{tick-alloc-t06,rebuild-worst-t06,s4-cap6}.ts,gpu/**}`, this report.
Commit suggestion: feat(dust-sim): decide P2, apply allocation fixes, add GPU replay lane, lag control and T06 results
