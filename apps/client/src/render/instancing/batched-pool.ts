// `BatchedMesh` helper (M0-W2-T02; rendering-pipeline.md section 10.1: avatars, player builds). Different geometries,
// one material, one draw. Instances are allocated up front, written in place and shown or hidden by index; nothing
// here allocates after construction. API per docs/vendor/three-r187/docs-pages/BatchedMesh.html.md.

import { BatchedMesh, Color, type BufferGeometry, type Material, type Matrix4, type Object3D } from "three/webgpu";

export interface BatchedPoolOptions {
  readonly name: string;
  readonly material: Material;
  /** Total instances over all geometries. */
  readonly maxInstances: number;
  /** Geometries to register; their vertex and index totals size the buffers. Disposed with the pool. */
  readonly geometries: readonly BufferGeometry[];
  readonly castShadow?: boolean;
  readonly receiveShadow?: boolean;
}

/** Vertex and index capacity needed for `geometries` (pure helper, unit-tested with plain attribute counts). */
export function batchCapacity(geometries: readonly { readonly vertexCount: number; readonly indexCount: number }[]): {
  vertexCount: number;
  indexCount: number;
} {
  let vertexCount = 0;
  let indexCount = 0;
  for (const g of geometries) {
    vertexCount += g.vertexCount;
    indexCount += g.indexCount;
  }
  return { vertexCount, indexCount };
}

export class BatchedPool {
  readonly mesh: BatchedMesh;
  /** Geometry ids in registration order. */
  readonly geometryIds: readonly number[];

  private readonly geometries: readonly BufferGeometry[];
  private readonly material: Material;
  private parent: Object3D | null = null;
  private used = 0;

  constructor(options: BatchedPoolOptions) {
    const capacity = batchCapacity(
      options.geometries.map((g) => ({
        vertexCount: g.getAttribute("position").count,
        indexCount: g.index?.count ?? 0,
      })),
    );
    this.geometries = options.geometries;
    this.material = options.material;
    this.mesh = new BatchedMesh(options.maxInstances, capacity.vertexCount, capacity.indexCount, options.material);
    this.mesh.name = options.name;
    this.mesh.castShadow = options.castShadow ?? false;
    this.mesh.receiveShadow = options.receiveShadow ?? false;
    // One bound for the whole batch: per-object culling costs CPU per instance, and a group of avatars is on screen together.
    this.mesh.perObjectFrustumCulled = false;
    this.mesh.sortObjects = false;
    const ids: number[] = [];
    for (const g of options.geometries) ids.push(this.mesh.addGeometry(g));
    this.geometryIds = ids;
  }

  get instanceCount(): number {
    return this.used;
  }

  /** Adds an instance of the geometry registered at `geometryIndex`. Returns the instance id. */
  addInstance(geometryIndex: number, matrix: Matrix4, color?: Color): number {
    const geometryId = this.geometryIds[geometryIndex];
    if (geometryId === undefined) throw new RangeError(`BatchedPool: no geometry at index ${String(geometryIndex)}`);
    const id = this.mesh.addInstance(geometryId);
    this.mesh.setMatrixAt(id, matrix);
    if (color !== undefined) this.mesh.setColorAt(id, color);
    this.used += 1;
    return id;
  }

  setMatrixAt(instanceId: number, matrix: Matrix4): void {
    this.mesh.setMatrixAt(instanceId, matrix);
  }

  setVisibleAt(instanceId: number, visible: boolean): void {
    this.mesh.setVisibleAt(instanceId, visible);
  }

  /** Whole-batch bounds for culling, after the instances exist. A moving batch calls this rarely (not per frame). */
  computeBounds(): void {
    this.mesh.computeBoundingBox();
    this.mesh.computeBoundingSphere();
  }

  addTo(parent: Object3D): void {
    this.parent = parent;
    parent.add(this.mesh);
  }

  dispose(): void {
    this.parent?.remove(this.mesh);
    this.parent = null;
    this.mesh.dispose();
    for (const g of this.geometries) g.dispose();
    this.material.dispose();
  }
}
