# M0-W2-T05 Terrain bake spike

Status: **implemented, verified locally** (real LDEM_16, not a stand-in) · 2026-11-12 · terrain-dust-engineer (Sonnet 5.5; resumed after a usage-limit stop, disk state verified first) · Node 26.13.1, 8 cores, 16 GiB, Intel UHD 620 laptop.

Done: steps 1-7, 8b, 9 of world-and-dust §3.2 on LDEM_16 (PDS, 33,177,600 B, SHA-256 `a511e40d...254cb`, label `9aef2946...6579`; pinned in `src/lola/sources.ts`, bake refuses a mismatch). Decode is label-driven (LSB int16, 0.5 m/DN, 1,737.4 km sphere, pixel-registered). Step 8 (dust class, grid golden hash) deferred to M1 (`grid.status` in the manifest).

## Measured (clean rerun, same machine)

| Item | Result |
| --- | --- |
| Wall time | **114 s** total: low-pass 2.6, cube 1024 27, cube 256 1, encode 9, horizon 72 (443.7 M ray samples). One run under CPU contention took 282 s. |
| Peak RAM | 359-393 MiB RSS |
| Determinism | two full runs: `manifest.json` byte-identical (output hashes + `bakeHash` `8b10f7e2...f470`) |
| Outputs (committed, `assets/terrain/`) | `height-cube-1024.0d70550a0d75.bin` **7.92 MB**; `height-cube-256.3b5aa9176cde.bin` 0.60 MB; `horizon-map.0600f54d4815.bin` **6.98 MB**; manifest 7 KB; fixtures 0.08 MB. Total 15.6 MB, each file under the 10 MiB CI limit. Estimate was 4-6 MB for the cube: the data has ~5 bits/texel of real entropy (Brotli and a gradient predictor gained under 6 %). Every rebake adds about 15 MB to git history: bake once per milestone, not per tweak. |
| Quantisation | uint16 over -48.05..59.16 m (107 m relief, not the 140 m estimate), step 1.64 mm, max error 0.82 mm |
| Slope (1024 cube, all texels, rims not masked) | **3.28 % > 30 deg, 0.049 % > 45 deg**, none > 50 deg, max 50.0, mean 9.5, p99 36 deg: PASS. Pad interior max 1.58 deg (limit 3): PASS. Pad blend ring max 43.5 deg (spec ring is only 20 m wide; steep at pads with large height offset, e.g. Dawnside pad sits 26 m below its surroundings) |
| E_high step-down (§3.3) | **E_high 3 FAILS** (10.7 % > 30 deg, 1.15 % > 45 deg), 2.5 fails (6.9 %), **2.0 passes**: shipped E_low 6 / **E_high 2** (the minimum allowed). Sweep: `pnpm --filter @moon-cleanup/terrain-bake bake:sweep`. The real moon is rougher at 2 km baseline than the doc assumed; this reduces crater-wall relief to about 2x (design call for Cee/art if it reads too flat; procedural near-field detail adds the rest) |
| Slope relaxation (>50 deg) | 189 texels in first pass, 11 iterations, 0 left (pad texels excluded) |
| Accuracy vs source (20,000 seeded dirs, away from pads) | rms **0.095 m**, p99 0.35 m, max 0.95 m |
| Cube seams (20,000 dirs within 1 texel of an edge, primary face vs neighbour gutter) | rms **0.116 m**, p99 0.51 m, max 1.77 m (steep rim). Ratio to interior error is 1.2, so seams are not worse than anywhere else; 1-texel gutter works |
| Horizon map | 6 x 512^2 x 8 azimuths, range -16..+60 deg (0.30 deg/step), 0 clamped, min -13.6 (summit dip), max 44.9, mean 2.7; 53 distance steps per ray (20 m ratio 1.1 to 3 km, early exit past about 750 m). Needs M0-W3 spike validation against CSM |

Visual: per-face hillshade (sun az 315 / el 35, z-factor 10, 512^2) in `docs/agent-reports/M0-W2-T05-terrain-dust-engineer-previews/hillshade-{px,nx,py,ny,pz,nz}.png`; viewed py and px: real craters/maria, flat pad disc at the +Y centre, no visible seams.

## LDEM_64 go/no-go (NOT downloaded: 531 MB is over the 500 MB stop line; estimates only)

Download about 50 s at the measured 11 MB/s. Naive Float32 decode needs about 4-5 GB RAM; with Int16 kept and the low band computed from an LDEM_16-res grid, about 1.5 GB. Taps stay 16 per texel, but a 3 m texel spans about 5.6 LDEM_64 pixels so 4x4 taps alias: needs 8x8 or a pyramid, so about 2-4 min bake. **Recommend NO-GO for M1**: the 1024^2 cube texel (3.07 m) is already coarser than LDEM_16 (2.18 m in game), so LDEM_64 adds no visible resolution unless the cube moves to 2048^2 (48 MiB, ruled out by §3.4). Revisit only with a second-tier detail cube (ADR-0008 trigger). Owner call if you want it fetched anyway.

## Deliverables and checks

- `tools/terrain-bake/**` (src/lola, cubemap, manifest, pipeline, sweep, bake CLI, README), `assets/terrain/**`, ledger row `terrain-lola-ldem16-derivatives` appended to `docs/ASSET_LICENSES.md` (SPDX `LicenseRef-NASA-PD`, credit line, raw not committed). Raw files sit in git-ignored `assets/terrain/raw/` (verified with `git check-ignore`); `cache/` holds timings.
- Golden samples: `assets/terrain/fixtures/golden-height-samples-1024.json` (6 face centres, 12 edge midpoints, 8 corners, 4 outposts, 12 seeded = 42 dirs, tolerance 0.02 m, reference sampler `src/cubemap/sample.ts`). Fixture cube `height-cube-fixture-64.bin` (raw uint16 LE, 6 x 66^2, no header) + `.json` meta + its own golden file, for `packages/world` tests.
- `tsc -p tools/terrain-bake` clean; eslint clean; prettier clean; vitest 6 files / 23 tests pass (label, mapping round-trip of every texel centre, low-pass, codec round-trip/determinism, pad flatness, relaxation, seams, golden, committed-asset hashes).
- Not done: `packages/world` untouched (no grid/sampler code yet, M1-W1-T01); `pnpm verify` not run (focused checks only); no browser decode test of `DecompressionStream("deflate-raw")`.

## Contract proposals (for contracts-architect / lead)

1. **Cube layout v1** (faces +X,-X,+Y,-Y,+Z,-Z; `dir = normalize(n + tan(pi/4 a) u + tan(pi/4 b) v)`, major-axis face, 1-texel gutter, row j = b) lives in `src/cubemap/mapping.ts` and the manifest; move to `shared` or `packages/world` when M1-W1-T01 starts so the CDLOD and TSL twin reuse it.
2. **Container formats** CTMH/CTMW (32-byte header, deflate-raw payload, doc in `src/cubemap/codec.ts`); client decodes with `DecompressionStream("deflate-raw")` (Brotli has none) then undoes row-delta + byte planes. Needs a client loader task.
3. `bakeHash` (manifest) for the save header; manifest also has per-output `rawSha256` for cross-machine checks (zlib output can differ across Node versions).
4. Open for later: horizon map vs CSM handoff, `outputs` to be copied into `apps/client/public/assets/` (hashed names already satisfy asset-validation; raw .bin is an allowed extension).

Blockers: none for T05. LDEM_64 fetch needs owner OK. Commit suggestion: `feat(terrain-bake): LDEM_16 height cube, horizon map and manifest spike (M0-W2-T05)`
