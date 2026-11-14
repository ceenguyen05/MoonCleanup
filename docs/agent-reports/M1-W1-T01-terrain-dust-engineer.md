# M1-W1-T01 — packages/world plot grid + height function (terrain-dust-engineer)

Task / status: implemented and focused-verified (H_detail allocation fixed in the follow-up) / 2026-11-14 / terrain-dust-engineer / Opus 5.5
Node 26.13.1 (fnm PATH prefix). No git used. Only `packages/world/**` and this report were edited.

## Done
- **GP(m,0) grid** (`src/grid/build.ts`, `icosahedron.ts`): 17-digit icosahedron literals; each diamond's (m+1)^2 lattice is filled by recursive great-circle bisection (normalise(a+b)). The build checks that every shared diamond edge is bit-identical to the owning diamond and throws if not. Requires m to be a power of two (64, 128).
- **Indexing**: PlotId = d·m² + i·m + j, poles 10m² / 10m²+1, WDS 2.3 edge remaps (`canonicalPlotId`, lattice table). Chunks, local index and `Plot {chunk}-{local}` display ids (`display-id.ts`).
- **Neighbours**: built from the triangle list, then verified (163,830×6 + 12×5 = 983,040 entries, symmetric). Ordered counter-clockwise from the neighbour closest to local east, using no trigonometry. Pentagons have −1 in slot 5.
- **Point→plot** (`IcoPlotGrid.plotAt`): pick the face by centroid dot product, confirm with edge planes, descend log2 m levels with lattice-table midpoints, take the nearest of the 3 corners, then run a greedy local-max check. The hinted path is a greedy walk of at most 3 steps, then falls back to the full path. Hinted and full answers are identical by construction and tested. Ties go to the lower id.
- **Frames / plot-local**: WDS 2.7 formulas verbatim, with millimetres rounded and never −0. `frame` / `center` / `centerDirection` return frozen `FrozenVec3` class instances from a bounded direct-mapped cache. Extras: `neighborTable`, `centers`, `latticeOf`, `plotAtLattice`, `buildTriangleIndices` (orbit mesh, counter-clockwise).
- Implements the shared `PlotGrid` v1 interface exactly (`class IcoPlotGrid implements PlotGrid`). No DOM, Node, three.js or Colyseus imports in `src`.
- **Height** (`src/height`): `HeightCube` takes the decoded padded uint16 cube as an `ArrayBuffer` plus layout (`faceSize`, `offsetM`, `scaleM`). It does no I/O and copies on an unaligned offset or a big-endian host. It matches the bake's reference sampler exactly (max error 0 on the 38 fixture golden samples). Cube mapping layout v1 is ported from tools/terrain-bake. `GroundHeight` adds WDS 3.5 H_detail: 3 crater bands in equal-angle face space with seam-free cross-face ownership, 2 octaves of 3D value noise, a PCG hash and pad masks. The procedural numbers are [R] data (`DEFAULT_HEIGHT_DETAIL`).
- **SHA-256** in pure JS (`src/hash/sha256.ts`), synchronous and the same in every engine.
- **Golden lane**: the FNV stub was replaced by real cases. `test/golden/lane.ts` + `cases.ts` are shared by `lane.golden.test.ts` (Node) and `lane.browser.test.ts` (browser). Cases cover the Standard and Moonlet digests, H_base against the bake goldens, and H_base + H_detail against the Node recording (±1e-6 m). The fixture `.bin` is loaded via `?inline` (`assetsInclude` in both vitest configs; zod pre-bundled for the browser lane).
- Tests (`test/unit`, 49 tests): every plot round-trips, with and without a hint, on both grids. Also covered: brute-force agreement, perturbation and edge-midpoint probes at the pentagons and diamond seams, symmetry, counter-clockwise order, Euler count, chunk and display-id round trips for every plot, remaps, frames, plot-local within 1 mm, largest corner radius ≤ 12.3 m, cube mapping, fixture height, detail seam continuity (< 2 mm), pads, and bad inputs. `tsconfig` now includes `test`.
- The fixture already existed (`assets/terrain/fixtures/height-cube-fixture-64.bin` + json, from M0-W2-T05); nothing was added.

## Golden constants (Node 26.13.1, matching in Chromium)
For `PLOT_GRID_GOLDEN_HASHES` (contracts minor bump, contracts-architect). Byte layouts are in `src/grid/golden.ts`:
- grid (Standard): `eecb088b1eff1f24ed2aa8c29b1d1c5dc5d4f3b43716525be777b46be665c6c5`
- pointToPlot (Standard, 1,000 points, mulberry32 seed 0x4d4f4f4e): `ace8f2e5a2974429a00c41457dbc6cba4e779832d6183df484b2e6c35868298a`
- ledger: stays null (no ledger yet)
- world-local values (not contract slots): Standard neighbours `fa6a5f17db89f796e1f5dcc6bb15f214a3ba88e9730b5d809af4cd16f28fc14f`; Moonlet grid `173e8cdc5c15af76a727daa2d63390bb460bb4065cd200408591a0ef185d215e`, pointToPlot `237d41560be7de074fbffbe0be27dd27ccc4e0712b4b9ecbb51b791a41e8b608`, neighbours `d17b4e306aa148915da724d0477a8fb27b10e329b5d45e6a98ab924717954813`

## Benchmarks (`packages/world/bench/world-bench.ts`; Node 26, i7-8650U, other agents running, so timings are noisy)
Command: `node node_modules/.pnpm/tsx@4.23.15/node_modules/tsx/dist/cli.mjs packages/world/bench/world-bench.ts`. Allocation is measured as the v8 `total_allocated_bytes` delta after warm-up. The harness alone allocates about 1 B per call.

| call | ns/call | B/call |
| --- | ---: | ---: |
| grid build GP(128,0) | 116–143 ms total | — |
| plotAt full path | 590–880 (target ≤ 2,000) | 0.2–0.4 |
| plotAt hinted (moving) | 66 | 0.2 |
| toPlotLocal / fromPlotLocal | 890 (includes plotAt) / 126 | ≤ 1 |
| neighbors / frame (cached) | 44 / 16 | ≤ 1 |
| H_base 1024² random / moving | 200 / 95 | ≤ 1.2 |
| H_base + H_detail random (4 pads) / moving | 944 / 655 (target about 1,000) | 1.1 / 0.05 |
| caller-loop form: heightAt / plotAt / sample | 925 / 591 / 194 | 0.9 / 0.2 / 16 (see open) |

H_detail follow-up: bisecting by sub-step (padWeight 0.6, craters 0.9, noise 129 B/call) showed that `noise()` was the only source of the allocation. It made 14+ out-of-line `pcgHash` calls, which exceeds V8's inlining budget, and a uint32 returned from a call that is not inlined is boxed. The PCG step is now written inline in a corner loop with a Float64Array scratch. The arithmetic is identical, and the golden heights still match. Earlier fixes:
- `HeightCube.bilinearIO`: the ternary clamp was swapped for `Math.min/max`, which removed 32 B per call.
- Values now pass through Float64Array scratch buffers instead of double arguments.
- Cached vectors are class instances, not frozen literals.

## Not done / open
- Small residual: in the caller-loop form, `HeightCube.sample(dir)` showed 16 B per call (one boxed double return when V8 does not inline `sample` into that loop). The direct-closure form measures about 0. Hot callers can use `sampleIO()` / `io` for a guaranteed zero; this is low priority.
- Firefox / WebKit golden lane: **NOT RUN**. The Playwright browsers are not installed locally (CI installs them).
- Root `pnpm verify`: NOT RUN (focused checks only). TSL twin and GPU readback: not mine (rendering).
- No server grid binary (`grid-128.<hash>.bin`) build step yet. `IcoPlotGrid` accepts a precomputed neighbour table so it can be added.

## Findings for lead
1. **Cross-cutting V8 hazard:** importing `@moon-cleanup/shared` makes every `{x, y, z}` object literal in that process allocate 16 B per double store. The cause is the zod shapes `z.object({ x: ..., y: ..., z: ... })`, which generalise the literal map's fields to tagged. I measured 48 B per write of a scratch direction. Hot-path scratch objects should be class instances (e.g. three `Vector3`) or Float64Arrays. For the same reason, packages/world returns `FrozenVec3` class instances, never frozen literals.
2. tools/terrain-bake `src/cubemap/mapping.ts` duplicates `src/height/cube-mapping.ts`. The bake could import from packages/world (tools → packages is allowed).
3. Vitest's Node runner runs this numeric code about 10–20× slower than plain Node. Benchmark with the bench script, not with vitest.

## Evidence
Node 26.13.1, after the follow-up:
- packages/world: tsc, eslint and prettier clean; vitest 3 files / 49 tests pass.
- `pnpm test:golden` passes on Node (4 tests) and Chromium (4 tests).
- packages/shared (earlier in the session, unchanged since): tsc and eslint clean; vitest 31 files / 445 tests pass.
