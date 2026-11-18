import { describe, expect, test } from "vitest";
import { TRUNDLE_MESH_COUNT, buildTrundle, disposeTrundle } from "./trundle-model";

describe("Trundle model budget", () => {
  test("a handful of meshes and materials, named per the published spec, vertex colours baked", () => {
    const t = buildTrundle();
    expect(t.meshes).toHaveLength(TRUNDLE_MESH_COUNT);
    expect(TRUNDLE_MESH_COUNT).toBeLessThanOrEqual(6);
    expect(t.materials.length).toBeLessThanOrEqual(2);
    let meshes = 0;
    t.root.traverse((o) => {
      if ((o as { isMesh?: boolean }).isMesh) meshes++;
    });
    expect(meshes).toBe(TRUNDLE_MESH_COUNT);
    for (const name of ["chassis", "lamps", "drum_pivot", "drum", "wheel_pivot", "wheels"])
      expect(t.root.getObjectByName(name)).toBeDefined();
    for (const m of t.meshes) {
      expect(m.geometry.getAttribute("color").count).toBe(m.geometry.getAttribute("position").count);
      expect(m.geometry.getIndex()!.count % 3).toBe(0);
    }
    expect(t.lamps.visible).toBe(false);
    disposeTrundle(t);
  });
});
