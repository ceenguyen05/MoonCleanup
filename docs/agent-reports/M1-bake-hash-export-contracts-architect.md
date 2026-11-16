# M1 bake-hash export (contracts-architect)

Status: done.

- Export: `TERRAIN_BAKE_HASH` (string literal, 64-hex) from `@moon-cleanup/world` public barrel (`packages/world/src/index.ts`), defined in `packages/world/src/height/bake-hash.ts`. Value `8b10f7e2...bff470` equals `assets/terrain/manifest.json` `bakeHash`. Additive; no version bump.
- Drift test: `tools/terrain-bake/src/bake-hash.test.ts` (reads manifest.json, asserts equality; not skipped).
- Bake tool: `tools/terrain-bake/src/bake.ts` now warns with the new hash and file path when it differs from the constant; README note added.
- Checks (Node 26.13.1): focused vitest pass; `tsc` clean for terrain-bake and world; `eslint` clean for both. No pnpm verify.
- Consumers (next wave, optional): apps/server and packages/db may replace their own bakeHash source with this constant (not touched). apps/server must depend on `@moon-cleanup/world` if it does not already.
