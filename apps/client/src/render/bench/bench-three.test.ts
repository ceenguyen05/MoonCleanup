// Bench pieces that touch three objects but need no GPU (M0-W2-T02): chunk geometry, the terrain stub's fetch count,
// the camera-only velocity maths, instancing helpers.

import { describe, expect, it } from "vitest";
import { BoxGeometry, Matrix4, MeshBasicNodeMaterial, Vector3, type BufferGeometry } from "three/webgpu";
import { BatchedPool, InstancedSet, batchCapacity, drawsNeeded, splitInstanceCounts } from "../instancing";
import { BenchTextures } from "./bench-textures";
import { cameraOnlyVelocityNdc } from "./camera-velocity";
import { buildChunkGeometry } from "./terrain-chunks";
import { chunkRects } from "./terrain-data";
import { createTerrainStub } from "./terrain-material";

describe("terrain chunks", () => {
  it("builds a 35 x 35 skirted grid with upward normals", () => {
    const rect = chunkRects()[36];
    expect(rect).toBeDefined();
    if (rect === undefined) return;
    const g = buildChunkGeometry(rect);
    expect(g.getAttribute("position").count).toBe(35 * 35);
    expect(g.index?.count).toBe(34 * 34 * 6);
    const n = g.getAttribute("normal");
    for (let i = 0; i < n.count; i += 37) expect(n.getY(i)).toBeGreaterThan(0.9);
    // The skirt vertex lies below its edge neighbour.
    const p = g.getAttribute("position");
    expect(p.getY(1)).toBeLessThan(p.getY(35 + 1) - 0.2);
    g.dispose();
  });
});

describe("terrain shader stub", () => {
  it("builds with the documented fetch count (27) and disposes", () => {
    const textures = new BenchTextures(4);
    const stub = createTerrainStub(textures);
    // 6 detail + 4 dust (ring, atlas, 2 direction) + 4 berm + 2 horizon + 11 plot (id, 2 neighbours, 7 centres, table)
    expect(stub.fetchCount).toBe(27);
    // The 16 sampled textures per fragment stage are shared with 4 CSM cascades, a probe and a lamp shadow map.
    expect(stub.textureBindings).toBeLessThanOrEqual(12);
    expect(stub.material.colorNode).not.toBeNull();
    stub.dispose();
    textures.dispose();
  }, 60_000);
});

describe("camera-only velocity", () => {
  const out = { x: 0, y: 0 };
  const viewProjection = (x: number): Matrix4 => {
    const p = new Matrix4().makePerspective(-0.1, 0.1, 0.1, -0.1, 0.1, 100);
    const v = new Matrix4().makeTranslation(-x, 0, 0);
    return p.multiply(v);
  };
  it("is zero when the camera does not move", () => {
    cameraOnlyVelocityNdc(viewProjection(2), viewProjection(2), new Vector3(1, 1, -5), out);
    expect(out.x).toBeCloseTo(0, 12);
    expect(out.y).toBeCloseTo(0, 12);
  });
  it("points against the camera motion and shrinks with distance", () => {
    const near = { x: 0, y: 0 };
    const far = { x: 0, y: 0 };
    cameraOnlyVelocityNdc(viewProjection(0), viewProjection(0.1), new Vector3(0, 0, -5), near);
    cameraOnlyVelocityNdc(viewProjection(0), viewProjection(0.1), new Vector3(0, 0, -50), far);
    expect(near.x).toBeLessThan(0);
    expect(Math.abs(near.x)).toBeGreaterThan(Math.abs(far.x) * 5);
    expect(near.y).toBeCloseTo(0, 12);
  });
});

describe("instancing helpers", () => {
  it("splits and counts", () => {
    expect(splitInstanceCounts(2100, 4)).toEqual([525, 525, 525, 525]);
    expect(splitInstanceCounts(10, 3)).toEqual([4, 3, 3]);
    expect(splitInstanceCounts(0, 2)).toEqual([0, 0]);
    expect(() => splitInstanceCounts(5, 0)).toThrow(RangeError);
    expect(drawsNeeded(2100, 525)).toBe(4);
    expect(drawsNeeded(0, 10)).toBe(0);
    expect(
      batchCapacity([
        { vertexCount: 3, indexCount: 6 },
        { vertexCount: 4, indexCount: 0 },
      ]),
    ).toEqual({ vertexCount: 7, indexCount: 6 });
  });
  it("InstancedSet writes matrices in place and disposes what it owns", () => {
    const set = new InstancedSet({
      name: "t",
      geometry: new BoxGeometry(),
      material: new MeshBasicNodeMaterial(),
      count: 5,
    });
    const m = new Matrix4().makeTranslation(1, 2, 3);
    set.setMatrixAt(4, m);
    set.commit();
    expect(set.count).toBe(5);
    set.setVisibleCount(2);
    expect(set.count).toBe(2);
    set.dispose();
  });
  it("BatchedPool batches different geometries under one mesh", () => {
    const geometries: BufferGeometry[] = [new BoxGeometry(), new BoxGeometry(2, 2, 2)];
    const pool = new BatchedPool({ name: "b", material: new MeshBasicNodeMaterial(), maxInstances: 4, geometries });
    const m = new Matrix4();
    const a = pool.addInstance(0, m);
    const b = pool.addInstance(1, m);
    expect(pool.instanceCount).toBe(2);
    expect(a).not.toBe(b);
    expect(() => pool.addInstance(5, m)).toThrow(RangeError);
    pool.dispose();
  });
});
