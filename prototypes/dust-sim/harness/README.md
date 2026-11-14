# dust-sim / harness

Shared benchmark harness: same seed, scene, bookmarks, camera paths and bot scenarios for P1/P2/P3
(world-and-dust-simulation section 10). Not a workspace package; no installs. Runs under Node 26 with the `tsx` and
`vitest` the repo already has. Production code and the bot scenarios are imported by relative path.

Run commands (from the repo root; Node 26 on PATH):

- Dry run (stub adapter, CPU only): `cd tools/bots && node --import tsx ../../prototypes/dust-sim/harness/src/cli.ts run --adapter stub --max-sim-seconds 20 --fps 30`
- Real prototype: `... cli.ts run --adapter prototypes/dust-sim/<approach>/harness-adapter.ts --grid <module exporting createGrid()> --tier A|B|floor --backend webgpu|webgl2 [--scenarios S1,S4] [--realtime]` (omit `--max-sim-seconds` for standard lengths)
- Bookmarks as JSON: `... cli.ts bookmarks`
- Blind A/B pairs: `... cli.ts pairs --a-name P1 --a-dir <dir of <bookmarkId>.png> --b-name P2 --b-dir <dir> --out <dir>` (tester sheet `sheet.json`; secret `key.json`)
- Tests: `node_modules/.bin/vitest run --root prototypes/dust-sim/harness`; types: `tsc -p prototypes/dust-sim/harness/tsconfig.json`

Output: `prototypes/dust-sim/results/<approach>/S1..S8.json` plus `SUMMARY.md` (schema in `src/types.ts`; bars in `src/metrics.ts`).
A metric that could not be measured is `NOT_RUN`, never PASS. Stub and dry runs are `INFO` only.

Adapter: a prototype exports `createAdapter(): DustPrototypeAdapter` from `<approach>/harness-adapter.ts` (interface in `src/types.ts`).

## Shared capture scene and edge metric (T02b)

`src/capture-scene.ts` is the renderer-neutral scene every `capture()` / `view()` must render (no prototype may change any value):
1920x1080 at DPR 1, vFOV 60, near 0.05, far 20000; ground = reference sphere (R 2000 m, height 0, radial normals, no relief);
Lambert light (sun illuminance 3.0, ambient 0.02, exposure 1.0, clamp tone map, sRGB output, no shadows); clean albedo 0.55,
dust albedo 0.12 (linear); 20 Hz sim, 60 fps capture, 30 settle frames per bookmark, 40 settle ticks after scene setup;
poses/sun from the 9 bookmarks in `src/scene.ts` (`sunDirection(pose)` gives the unit sun vector); sweep paths =
`sceneSetupStrokes` (two 1.2 m Bristle Broom lanes, 40 m) and the S1/S2/S8 drivers; seed `HARNESS_SEED`.
Dump it as JSON: `cd tools/bots && node --import tsx -e "import('../../prototypes/dust-sim/harness/src/capture-scene.ts').then(m=>console.log(JSON.stringify(m.captureSceneSpec())))"`.

`src/image-compare.ts` (pure TS, float luma/opacity rasters): `edgeWidthPx`, `riseWidth10to90`, `edgeWidthCm`, `judgeEdge`,
`coverageAtLeast`, `meanAbsDiff`, `pearson`, `rasterizeSweeps`, `sweepDissolveCorrelation`.

Edge width definition: 10-90 % rise distance in screen pixels of the mean profile across a clean/dirty boundary (rows
averaged), from OPACITY or luma normalised by the two plateaus, never from a thresholded mask; sub-pixel interpolated.
Measured on the edge bookmarks B01 (2 m), B02 (10 m), B03 (50 m) at 1080p. `adapter.measureEdgeWidthPx(d)` must return this
number for the same crop. One pixel is 2.14 mm at 2 m, so the WDS bar (<= 2 px at 2 m = 4.3 mm) is stricter than the
visual-target bar (<= 2 cm = 9.3 px at 2 m). Both are reported; the gate is the WDS bar (LEAD DECISION, see T02b report).
Tests: `vitest run --root prototypes/dust-sim/harness` (19 tests, synthetic images).
