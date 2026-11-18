import { BoxGeometry, BufferAttribute, Group, Mesh, MeshBasicMaterial } from "three/webgpu";
import { describe, expect, test } from "vitest";
import { TRUNDLE_MESH_COUNT } from "./trundle-model";
import { trundlePartsFromScene } from "./trundle-glb";

function piece(name: string, x: number, y: number, z: number): Mesh {
  const g = new BoxGeometry(0.2, 0.2, 0.2);
  g.setAttribute("color", new BufferAttribute(new Float32Array(g.getAttribute("position").count * 4).fill(1), 4));
  const m = new Mesh(g, new MeshBasicMaterial());
  m.name = name;
  m.position.set(x, y, z);
  return m;
}

describe("Trundle GLB parts", () => {
  test("builds the published node layout with the draw budget and pivot-local spinning meshes", () => {
    const scene = new Group();
    for (const n of ["chassis", "lamps", "drum", "wheels"]) scene.add(piece(`${n}_LOD0`, 0, 0.2, 0.58));
    const drum = new Group();
    drum.name = "drum_pivot";
    drum.position.set(0, 0.2, 0.58);
    const wheel = new Group();
    wheel.name = "wheel_pivot";
    wheel.position.set(0, 0.22, -0.45);
    scene.add(drum, wheel);
    const t = trundlePartsFromScene(scene);
    expect(t.meshes).toHaveLength(TRUNDLE_MESH_COUNT);
    for (const name of ["chassis", "lamps", "drum_pivot", "drum", "wheel_pivot", "wheels"])
      expect(t.root.getObjectByName(name)).toBeDefined();
    expect(t.lamps.visible).toBe(false);
    // The drum mesh sits at its pivot, so its geometry is centred on the origin of the spin axis.
    t.meshes[2]!.geometry.computeBoundingBox();
    expect(t.meshes[2]!.geometry.boundingBox!.min.y).toBeCloseTo(-0.1, 4);
    expect(t.drumPivot.position.z).toBeCloseTo(0.58, 4);
    expect(() => trundlePartsFromScene(new Group())).toThrow(/missing/);
  });
});
