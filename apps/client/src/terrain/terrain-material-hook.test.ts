// Hook H1 (W2-T04): the optional `terrainMaterial` option on `TerrainScene`.
import { describe, expect, it } from "vitest";
import type { NodeMaterial } from "three/webgpu";
import {
  createPlainTerrainMaterial,
  createSpecularTerrainMaterial,
  type TerrainMaterialFactory,
} from "./cdlod/cdlod-terrain";
import { selectTerrainMaterial } from "./terrain-scene";

describe("terrain material hook (H1)", () => {
  const supplied: TerrainMaterialFactory = (): NodeMaterial => {
    throw new Error("not called by the selector");
  };

  it("defaults to the plain material when no factory is supplied", () => {
    expect(selectTerrainMaterial(undefined, new URLSearchParams())).toBe(createPlainTerrainMaterial);
  });

  it("keeps the &spec=1 A/B when no factory is supplied", () => {
    expect(selectTerrainMaterial(undefined, new URLSearchParams("spec=1"))).toBe(createSpecularTerrainMaterial);
  });

  it("uses the supplied factory, ahead of &spec=1", () => {
    expect(selectTerrainMaterial(supplied, new URLSearchParams())).toBe(supplied);
    expect(selectTerrainMaterial(supplied, new URLSearchParams("spec=1"))).toBe(supplied);
  });
});
