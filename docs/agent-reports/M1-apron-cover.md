# M1 Landing Apron 20% cover (2026-11-18, terrain-dust-engineer, Opus 5.5)

Status: **implemented, focused tests green.** No git, Node 26.13.1, no browsers/GPU, no STATUS edits, no pnpm verify.
Real-GPU look check of the visible cover: NOT RUN.

## Design
- **Recipe** (`packages/world/src/dust/initial-cover.ts`, `DUST_INIT_REVISION = 1`). For each cover plot, the owned
  texels are ranked by `key = coarse << 20 | fine << 10 | ix`. `coarse` and `fine` are the top 10 bits of an FNV-1a mix
  of (plot, texel block): 4x4 texel (3.2 m) patches with 2x2 (1.6 m) detail. The top
  `K = max(1, floor((owned * permille + 500) / 1000))` texels start dusty, at the cover level. All other texels start at 0.
  The masks are built once, at ledger construction. All integer math, so they are deterministic.
- **Mass.** `mgPerUnit` is always the full-plot value `floor(mass(level, area) / (16 x level x owned))`. A dusty texel
  has full areal density, and the plot holds about 20% of the level-2 plot mass, matching `game-data.test` apronKg. The
  full mass is never concentrated into 20% of the texels. Thresholds use `initialUnits = 16 x level x K`.
- **No free removal.** Blank texels hold 0, so strokes over them remove nothing and credit nobody. An untouched plot is
  allocated only when an owned *dusty* texel would lose dust. K >= 1, so no plot can be Polished without cleaning.
- **Consumers.**
  - Allocation (`allocLedger`), the clamp in `installLedger` (snapshots and restores), and mass all read the cover.
  - `reset` and `resetPlot` need no change: L0 is relative to the initial cover.
  - New accessors: `hasPartialCover`, `isCoverTexel`, `coverTexelCount`.
- **One factory.** `createRoomDustLedger` now passes `landingApronCover(grid, data, outposts?)`. That is the sim's
  `landingApronPlots` around home outpost 0 (default `BOREAL_STAND_IN_OUTPOSTS`), with `world.landingApron`
  (6 plots, 0.2 -> 200 per mille, level 2). The Solo worker, ShiftRoom, online mirror, Solo dust view and goldens all
  get it automatically.
- **Saves and versioning, without a contract change.** Old (revision 0) saves still load, and no new header field is
  needed:
  - The restore and snapshot clamp is the migration: stored texels outside the cover become 0, dusty texels are
    clamped to 16 x level, and the repaired chunks are re-saved.
  - Contributions are clamped to removed units, and restore truncates the Stamp/Opened queues, so no reward is minted.
  - Untouched Apron plots in old saves reconstruct as the new cover.
  - `SAVE_FORMAT_VERSION`, `DUST_MODEL_VERSION`, `PROTOCOL_VERSION` and the dust chunk payload are unchanged.
- **Terrain bake: deliberately unchanged.** The bakeHash and manifest stay as they are. Putting the recipe into the
  bakeHash would archive every existing save under the owner's bake-mismatch policy, which contradicts "old saves still
  load". The recipe is identified by `DUST_INIT_REVISION` instead.
- **Client presentation** (`tile-atlas.ts`, minimal):
  - An untouched, non-Empty partial-cover plot now gets a tile.
  - The residual pass reads `isCoverTexel` for a plot with no ledger. Ledgered plots already show blank texels as clean.
  - The new view members are optional, so existing fake views and the scenario are unaffected.

## Files
- New: `packages/world/src/dust/initial-cover.ts`, `packages/world/test/unit/dust-cover.test.ts`, `packages/sim/test/unit/apron-cover.test.ts`.
- Changed:
  - `packages/world/src/dust/ledger.ts`
  - `packages/world/src/index.ts`
  - `packages/sim/src/dust/room-ledger.ts` (`landingApronCover` and the `outposts` option; exported through the existing barrel)
  - `packages/sim/test/golden/cases.ts`
  - `apps/client/src/visuals/dust/tile-atlas.ts`

## Golden (world ledger only, re-baselined once, owner decision)
| field | old | new |
|---|---|---|
| stateHash | 1838396500 | 1159199513 |
| gramsCollected | 66455 | 65689 |
| dustHash | 2469925789 | 3306081474 |
| strokeHash / strokes / ledgers / polished | 4164540033 / 4023 / 24 / 0 | unchanged |

Why: the script anchors 40 accepted strokes in Apron plots, which now hold the thin cover, so less dust is collected.
Strokes do not depend on the ledger, so strokeHash really holds. The stand-in GOLDEN_REPLAY (1076468633 / 4164540033)
is untouched and passes.

## Commands (Node 26.13.1, PATH `$APPDATA/fnm/aliases/default`)
- Fail-first, world, from `packages/world`: `node ../../node_modules/vitest/vitest.mjs run test/unit/dust-cover.test.ts` -> 8 of 11 failed before the implementation.
- After the change, world: `run test/unit/dust-cover.test.ts test/unit/dust-ledger.test.ts test/unit/dust-chunk.test.ts test/golden` -> all pass (11 cover tests; ledger, chunk and world golden vectors unchanged).
- Sim, from `packages/sim`: `run test/unit/apron-cover.test.ts test/unit/onboarding-apron.test.ts test/golden`.
  - Before the re-baseline: only the world-ledger golden failed, and it reported the new values above.
  - After the re-baseline: pass.
  - Note: `apron-cover.test.ts` was written after the factory change, so it was not fail-first.
- Server, from `apps/server`: `run src/net/shift/shift-ledger.test.ts src/net/shift/shift-dust.test.ts` -> 23/23 pass.
- Client: `run src/net/remote-dust.test.ts` passes.
  - `src/visuals/dust/dust-replay.test.ts` fails 3 tests: two 5 s timeouts and the frame-time p99 budget.
  - The **same 3 also fail in a control run with my atlas change reverted**, on a machine with 12 node processes running. This looks like load, not this change; rerun it when the machine is quiet.
- `tsc --noEmit`:
  - world, sim and server: clean.
  - client: one error, `src/app/solo-avatar.ts(274): Cannot find name 'RenderMapper'`. That file is another agent's in-progress work, not mine.
- eslint on all touched files: clean.

## Not run / Next
- Real-GPU look check of a fresh and a cleaned Apron (RF/VT): NOT RUN.
- Not done:
  - `flat-lookup` far-field and the orbit L0 view still show an untouched Apron as full dust beyond the tile residency radius.
  - Protocol skew: a stale client build would mirror a full-dust Apron. Recommend the contracts-architect consider a `PROTOCOL_VERSION` bump if version-skewed clients matter.
- The terrain-bake manifest `grid.status` still defers per-plot dust; the cover recipe intentionally lives outside the bake identity (see above).
