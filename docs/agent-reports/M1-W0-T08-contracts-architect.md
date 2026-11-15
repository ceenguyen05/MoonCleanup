# M1-W0-T08 Dust chunk payload limit (contracts-architect)

Task / status: **in-review** / 2026-11-14 / contracts-architect / Opus 5.5
Node 26.13.1 (fnm PATH prefix). No git used. Wrote `packages/shared/src/save/**`, the docs below and, in the lead-narrowed follow-up, two world files and the server checkpoint comments.

## Done

Fixes M1-W3-T01 finding 1: `DUST_CHUNK_PAYLOAD_MAX_BYTES` (262,144) was below a legal payload.

- `save/dust-chunk` v1.1. New constants: `DUST_CHUNK_STROKE_CHAIN_PREFIX_BYTES` 18, `DUST_CHUNK_STROKE_LOG_MAX_BYTES` 576, `DUST_CHUNK_PLOT_RECORD_MAX_BYTES` 1,648 and `DUST_CHUNK_PAYLOAD_LAYOUT_MAX_BYTES` 421,959 (7 + 64 + 256 x 1,648). The record schema now requires `strokeLog.length <= strokeCount x 18`. The old check was u16 only.
- `save/format` v1.1: `DUST_CHUNK_PAYLOAD_MAX_BYTES = DUST_CHUNK_PAYLOAD_LAYOUT_MAX_BYTES`. The limit is now derived from the layout.
- `save/checkpoint-package` v1.1: notes only. `rawSize` follows the constant. The 1 MiB part limit, 4 MiB session limit, 1 MiB header limit and the server's 32 MiB inflate budget are all unchanged.
- `save/dust-chunk-vectors` v1.1: new third golden vector at exactly 421,959 B, CRC32 1,486,968,057.
- None of `DUST_CHUNK_PAYLOAD_VERSION`, `SAVE_FORMAT_VERSION`, `CHECKPOINT_PACKAGE_VERSION` or `PROTOCOL_VERSION` is bumped. The bytes did not change; the limit only got wider. A server still running the old build answers `size_limit` to a large chunk. No migration is needed.
- Docs: `data-model.md` lines 220 and 359, and the WDS section 6 size table.

## Evidence

- `packages/shared`:
  - `vitest run`: 471/471 passed, 32 files.
  - `tsc --noEmit`: exit 0.
  - eslint and prettier on `src/save`: clean.
- `packages/world` `test/unit/dust-chunk.test.ts`, run read-only: 13/14 passed.
  - The independent world codec reproduces the new vector's length and CRC.
  - Expected failure: "a chunk over 256 KiB keeps fewer strokes..." (lines 475-493), which asserts the old limit.
- `apps/server` `src/api/checkpoints`: 33/33 passed.

## Follow-up patch (lead-narrowed ownership, same task)

- `packages/world/src/dust/chunk-codec.ts`:
  - `DUST_CHUNK_LAYOUT_MAX_BYTES` is now an alias of the shared constant (the world barrel export is unchanged).
  - The encoder always writes 32 strokes per plot; the shrink ladder is removed. `lastOversize`, `oversize` and `strokesPerPlot` stay as defensive or reporting fields, because the sim test reads them.
  - `scanDustChunk` rejects `strokeLogBytes > strokeCount x 18` with `bad_count`.
- `packages/world/test/unit/dust-chunk.test.ts`:
  - The old-limit test is rewritten: a 256-plot chunk with full logs is not oversize and round-trips.
  - New test for the stroke-log bound.
- `apps/server/src/api/checkpoints`: comments and the test name now cite 421,959 B and about 258 MiB. No code change.
- Follow-up evidence:
  - world `vitest run`: 96/96. tsc, eslint and prettier: clean.
  - Server checkpoints: 33/33. prettier and eslint: clean.
  - sim `dust-reload.test.ts`: 2/2.

## Next

Lead: rule on M1-W3-T01 finding 5. It is not addressed here.

## Files

- `packages/shared/src/save/{format,dust-chunk,dust-chunk-vectors,checkpoint-package}.ts`
- `packages/shared/src/save/{dust-chunk,checkpoint-package}.test.ts`
- `packages/world/src/dust/chunk-codec.ts`
- `packages/world/test/unit/dust-chunk.test.ts`
- `apps/server/src/api/checkpoints/{service,inflate-budget}.ts`
- `apps/server/src/api/checkpoints/checkpoints.test.ts`
- `docs/architecture/{data-model,world-and-dust-simulation}.md`

## Blockers

None.

Commit suggestion: `fix(shared): derive dust chunk payload limit from the v1 layout maximum (421,959 B)`
