# M1-W0-T01 — World, dust, stroke and save contracts v1 (contracts-architect)

Task / status: in-review / 2026-11-13 / contracts-architect / Sonnet 5.5
Done: all acceptance items. world/{plot-grid,dust,stroke,vectors} v1; save/{format v1, vectors, dust-chunk, dust-chunk-vectors, checkpoint-package (MCCK), checkpoint-vectors} v1. `SAVE_FORMAT_VERSION = 1`, fixed header 92 B (generation, parentGeneration, originKind, originId), migration note v0 to v1 in format.ts, v0 fixture kept.
Next: lead updates module-boundaries section 2 rows; T02 binds dust payloads to protocol ids; terrain-dust-engineer confirms [R] items below.
Files: packages/shared/src/world/*, packages/shared/src/save/* (+ tests); one-line edit packages/shared/src/index.test.ts (`SAVE_FORMAT_VERSION` 0 to 1).
Evidence (Node 26.13.1, packages/shared): tsc clean, eslint clean, prettier check clean, vitest 23 files / 361 tests pass. Not run: root `pnpm verify`; no consumer typecheck.

## Decisions flagged [R] (not in the WDS text)
- Zero-length stroke = disc of diameter widthCm (Detailing); rasteriser must special-case it.
- Ledger hash FNV-1a 32; chunk mix = FNV-1a over (plotId u32le, hash u32le); golden vectors in world/vectors.
- `laneMask` 64 lanes ([lo, hi] u32); robot.plot about 20 B, not 17 B.
- dust.ack = u24 grams; DustClass codes Highland 0, Mare 1, CraterFloor 2, Empty 3.
- MCCK: download continuation pages have headerLen 0; upload parts are raw slices of one package.
- Golden-hash slots (`PLOT_GRID_GOLDEN_HASHES`) ship null until packages/world exists.
- Dust levels (5/8/13) are not restated; only `LEDGER_UNITS_PER_LEVEL = 16` and max level 15.

## Consumers
- T02 (protocol/sim/api): bind dust payloads (world/dust.ts `Dust*PayloadSchema`, `RobotPlotIntentSchema`, chain widths in stroke.ts) to type ids/FRAME sections; add `CHECKPOINT_REJECT_REASONS` etc. in api/rest (deliberately NOT defined in save/); add canonical `PlotIdSchema` in ids only if renamed from my `PlotIdWireSchema`/`ChunkIdWireSchema`.
- packages/world: implement PlotGrid, ledger, golden hashes, dust chunk codec (save/dust-chunk).
- packages/sim: envelope codec v1, v0 to v1 upgrade step, StrokeRecord emission.
- apps/server persistence/api, packages/db: generation columns, MCCK verify.
- apps/client sim-host/net/terrain: local checkpoints, MCCK, two-view ledger.
- T03/config: validate dust level <= `LEDGER_MAX_DUST_LEVEL`; thresholds in config/world.schema must match 0.1 %/1 % divisors.
- Root barrel: no change needed (sub-barrels already `export *`); header bump of src/index.ts v0 to v1 is T03's. Root index.test.ts needs `SAVE_FORMAT_VERSION` 1 (done).
