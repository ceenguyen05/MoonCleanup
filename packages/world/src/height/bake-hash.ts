// Terrain bake identity (pure literal; no file reads so this package stays DOM/Node/three/Colyseus free).
// MUST equal `bakeHash` in assets/terrain/manifest.json (save header `bakeHash`, world-and-dust 3.2/6). After re-baking
// (`pnpm --filter @moon-cleanup/terrain-bake bake`) update this constant; tools/terrain-bake/src/bake-hash.test.ts fails on drift.
// Consumers: apps/server (checkpoint/save header validation), packages/db, apps/client sync.

export const TERRAIN_BAKE_HASH = "8b10f7e29b3ab47cd312c556a18b8b954056d44d74ee3c657673394095bff470";
