# M1-W3-T01 World dust ledger, rasterisation, thresholds, stamp rule (terrain-dust-engineer)

Task / status: **in-review, not wired into a host** / 2026-11-14 / terrain-dust-engineer / Fable 5.2
Node 26.13.1 (fnm PATH prefix), i7-8650U, Windows 11. No git used. Only `packages/world/**` and this report were written. `packages/sim`, `apps/**`, `packages/shared` untouched. No server or browser left running.

## Done

The real dust ledger is in `packages/world` and satisfies the sim's `DustLedgerPort` structurally (`world` cannot import `sim`: the dependency runs the other way).

- **`WorldDustLedger`** (`src/dust/ledger.ts`): per-plot state and L0 byte, pooled 32 x 32 x 8-bit ledgers with an ownership mask, exact WDS 4.5 rasteriser (frame-aligned lattice, flat ends, disc for a zero-length stroke, coverage-weighted absolute removal with the per-pass minimum), integer thresholds (Opened at `ceil(initial/1000)` removed, Polished at `floor(initial/100)` left), `mgPerUnit = floor(plot mass / initialUnits)`, FNV-1a ledger hash, chunk hash, world hash.
- **Inspector's Stamp** (WDS 4.7): Polished in the same call, ledger and log freed, the residual is never paid, credit to the player slot with at least 50 % of the removed units, else the shift. Queues for the host: Polished (plot, creditedTo), Opened, dirty plots, dirty chunks, optional ledger-zero events.
- **Stroke log** (`stroke-log.ts`): 256-stroke ring per plot, 16 B per stroke, 16 MB cap with eviction, `trim`.
- **Checkpoint** (`chunk-codec.ts`): dust chunk payload v1 exactly as `shared/save/dust-chunk` (both contract golden vectors match, CRC32 included), stroke logs saved as chains, dirty chunks only. Restore treats the bytes as untrusted: structure is checked before a chunk changes anything; ownership, totals, `mgPerUnit`, hash and state are recomputed, texels clamped; nothing throws.
- **Plot areas** (`plot-attributes.ts`): deterministic area per plot (no `atan`), plus a uniform-class stand-in because the per-plot class bake does not exist yet.

## Not done / honest limits

- **The game still loses dust on reload.** `MoonRoomSim` still defaults to `ApproxDustLedger` and `apps/client/src/sim-host` neither passes the new ledger nor saves dust chunks. Both paths belong to gameplay-systems-engineer. The round trip is proven in `packages/world` tests and in an uncommitted scratch script that drives the real `MoonRoomSim` (below).
- **Golden hash 4037918216: unchanged**, because `packages/sim` was not touched (sim golden test 1/1 on this file state). It **will change when a host or the sim default switches to the real ledger**: the removal math differs, so Dust Cell grams differ. The spec forces that; the re-record is the sim owner's deliberate step.
- Not built here: interest membership for client copies, robot lanes and the stop record, the two-slot header with CRC (data-model 3.7b, persistence), deflate, Stamp Lumens payout (sim reads the queue).

## Numbers

| Check | Result |
| --- | --- |
| Stroke cost, per-tool stress set (segments up to 3.8 m, 14 tools, 4,000 strokes each) | worst p99 **134 us** (load 10 %) and 156 us (load 57 %), bar 200 us. T1 mean 29 to 34 us; worst single stroke 1.66 ms |
| Stroke cost, hand tools, segments up to 0.6 m (one 10 Hz interval) | mean 2.7 us, p50 2.4, p99 5.7, 276 lattice points per stroke |
| Allocation per stroke through the port, 3 windows of 1,000,000 strokes, world reset every 20,000 | 0.345 / 0.259 / 0.256 B; floor row 0.050 / 0.259 / 0.257 B; pool growths 0. At the floor of the probe (one buffer step is about 0.23 B) |
| Checkpoint encode, 3,000 ledgers with full logs | 51 to 56 ms, 16.9 us per plot, 1,649 B per plot raw |
| Restore, same set | 93 to 128 ms, 31 us per plot |
| Sliced restore (`DustRestoreJob.run(budgetMs, now)`) | budget 2 ms: slice p50 2.02 / max 2.06 ms; budget 1 ms: p50 1.02 / max 1.22 ms. One run at 57 % load: max 3.97 ms at the 2 ms budget |
| Log read for one tile rebuild (7 full rings, 1,792 strokes) | p50 0.09 to 0.10 ms, max 0.64 ms |

**Rebuild budget in milliseconds.** Ledger restore is bounded by the job: default 2 ms per slice, overshoot at most one plot record (about 31 us). For the client tile rebuild the ring cap stays 256, so T06's 0.9 to 5.5 ms is not made worse, and `count` / `read(k)` / `stamp` let W3-T02 slice a rebuild by time. The 1.0 ms per frame bound on the raster replay itself is W3-T02's and is not delivered here.

## Evidence

- `packages/world`: `tsc` exit 0, `eslint .` exit 0, prettier clean, `vitest run` **94 / 94** (49 existing + 31 ledger + 13 chunk + 1 golden). Browser lane, headless Chromium: 5 / 5, including the ledger vectors.
- V1 golden: `test/vectors/ledger-v1.json`, 1,000 strokes, 23 plots, 3 classes, 1 Polished plot, per-plot texel SHA-256, per-actor units, SHA-256 of the saved chunks. Identical in Node 26 and Chromium.
- V2: 200 permutations, identical bytes and Polished sets. V4: re-scrub never collects more than fresh lanes (6 tools). V5: only at ledger level (reordered arrival, equal chunk hashes).
- Scratch end-to-end (uncommitted, `scratchpad/integ.ts`): real `MoonRoomSim` + `WorldDustLedger`, 2 actors, 6,000 ticks, 3,985 strokes, 53.5 kg. Save, restore into a fresh sim and ledger, 6,000 more ticks: state hash and dust hash identical every tick. Control without the dust restore diverged at tick +1,716. The port assignment type-checks. `packages/protocol` `readStrokeChain` decodes the saved logs: 96 strokes, 0 mismatches.
- Bench: `packages/world/bench/dust-bench.ts`.

## Findings for owners

1. **Contract defect, contracts-architect:** `DUST_CHUNK_PAYLOAD_MAX_BYTES` (262,144) is below a legal payload. A chunk with all 256 plots touched and none Polished needs 269,383 B with no stroke logs at all, and up to 421,959 B with them. The encoder shrinks saved logs (32, 16, 8, 4, 0 per plot) to fit and flags `oversize` when it cannot; restore accepts up to the layout maximum so a local save is not lost. Such a chunk can never be uploaded today. Proposal: raise the limit to 512 KiB.
2. **V3 pacing bar (+-20 % of progression section 4) is not met for every pair, balance-reviewer / game-designer.** Every hand tool reaches Polished on every class (hard requirement holds, 72 runs). With lanes 0.75 x width apart, three pairs are faster than the design table because overlapping lanes also remove dust: Mare with T2 takes 1.26 to 1.54 passes against 2, Crater Floor with T1 and T2 1.85 against 3. Nothing is more than 20 % slower.
3. **Lattice residue, spec owner:** with lanes exactly one width apart and Depth equal to the level, a pass leaves 2.09 % (T3, 56 mm pitch) and 3.21 % (T4, 94 mm pitch) on a Mare plot, so a second partial pass is needed (1.5 to 1.7 passes against 1). Pitches that divide 800 mm (T1 25 mm, T5 100 mm) polish in one pass. Snapping the pitch to a divisor of 800 would fix it; that is a `DUST_MODEL_VERSION` change and was not applied.
4. Detailing removes 71 to 83 units depending on where the disc lands (design 78 = 4.9 levels).
5. `[R]` decisions made here: non-player actor slots (16 to 63) fold into one shift bucket saved as slot 16; a save keeps the 4 biggest removers, smaller ones restart at 0 after a reload, which can only turn a personal credit into a shift credit when 5 or more actors worked one plot.
6. Hexagon areas measure 284.6 to 370.1 m^2 (WDS 2.8 estimates 266 to 346); pentagons 271.8.
7. A restore cannot verify a stored Polished state (the ledger is gone). A forged Solo save can claim Polished plots; upload verification has to decide what it accepts.

## Not run

Firefox and WebKit lanes; a browser Worker lane; the 0.1-CPU cgroup; `/bot-test` S4 for V5; vehicle and robot reachability; root `pnpm verify` (lead). The per-plot class bake is absent, so tests use a seeded class table.

## Next

1. gameplay-systems-engineer (sim-host): construct the ledger and pass it as `MoonRoomSim` option `ledger`; on load run `restoreDustChunks(ledger, payloads, bakeCheck)` (or `DustRestoreJob`) before `sim.restoreCheckpoint`; on save store `encodeDustChunks(ledger, bakeCheck, true)` and call `ledger.clearChunkDirty(id)` after the write; drain the Polished queue into `plot.polished`. Then re-record the goldens that run with the real ledger.
2. contracts-architect: finding 1; rule on 5.
3. Lead: route findings 2 and 3.

## Files

`packages/world/src/dust/{ledger,stroke-log,chunk-codec,plot-attributes}.ts`, `packages/world/src/index.ts`, `packages/world/test/unit/{dust-ledger,dust-chunk}.test.ts`, `packages/world/test/support/dust.ts`, `packages/world/test/golden/{ledger-lane,cases}.ts`, `packages/world/test/vectors/ledger-v1.json`, `packages/world/bench/{dust-bench,print-ledger-vectors}.ts`, this report.

Commit suggestion: `feat(world): exact dust ledger, stamp rule, stroke logs and dust chunk checkpoint codec`
