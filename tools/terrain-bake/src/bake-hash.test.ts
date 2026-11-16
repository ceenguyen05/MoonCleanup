// Guards the pure constant exported by @moon-cleanup/world against drift from the baked manifest.
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { TERRAIN_BAKE_HASH } from "@moon-cleanup/world";
import { describe, expect, it } from "vitest";

const manifestPath = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "assets",
  "terrain",
  "manifest.json",
);

describe("TERRAIN_BAKE_HASH", () => {
  it("equals bakeHash in assets/terrain/manifest.json (update packages/world/src/height/bake-hash.ts after re-baking)", () => {
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as { bakeHash: string };
    expect(manifest.bakeHash).toMatch(/^[0-9a-f]{64}$/);
    expect(TERRAIN_BAKE_HASH).toBe(manifest.bakeHash);
  });
});
