// Instancing helpers (M0-W2-T02; rendering-pipeline.md section 10.1 "Repeated props/rocks": one `InstancedMesh` per
// type). Reusable by later waves (props, robots, Dust Pucks). Rules kept here:
//   - the matrix array is the InstancedMesh's own, written in place: no per-frame allocation;
//   - every geometry / material / mesh has one owner (`InstancedSet`) and one `dispose()`;
//   - instances are split over at most `maxDraws` meshes, so the draw cost of a population is a decision, not a side effect.

import { Color, InstancedMesh, Matrix4, type BufferGeometry, type Material, type Object3D } from "three/webgpu";

/** How `total` instances are shared by `groups` meshes: the first `total % groups` meshes get one extra. Pure. */
export function splitInstanceCounts(total: number, groups: number): number[] {
  if (!Number.isInteger(total) || total < 0) throw new RangeError(`splitInstanceCounts: bad total ${String(total)}`);
  if (!Number.isInteger(groups) || groups < 1)
    throw new RangeError(`splitInstanceCounts: bad groups ${String(groups)}`);
  const base = Math.floor(total / groups);
  const extra = total % groups;
  const out: number[] = [];
  for (let i = 0; i < groups; i++) out.push(base + (i < extra ? 1 : 0));
  return out;
}

/** Smallest number of draws that holds `total` instances when a mesh may hold `perDrawLimit` (0 instances need 0 draws). */
export function drawsNeeded(total: number, perDrawLimit: number): number {
  if (perDrawLimit < 1) throw new RangeError("drawsNeeded: perDrawLimit must be >= 1");
  return total === 0 ? 0 : Math.ceil(total / perDrawLimit);
}

export interface InstancedSetOptions {
  readonly name: string;
  readonly geometry: BufferGeometry;
  readonly material: Material;
  readonly count: number;
  readonly castShadow?: boolean;
  readonly receiveShadow?: boolean;
  /** Allocates a per-instance colour attribute (`setColorAt`). Default false. */
  readonly instanceColors?: boolean;
}

/**
 * One `InstancedMesh` and its lifetime. The geometry and material are owned by the set only when `ownsResources` is
 * true (the default); a set that shares them with others passes `false` and the shared owner disposes them.
 */
export class InstancedSet {
  readonly mesh: InstancedMesh;

  private readonly geometry: BufferGeometry;
  private readonly material: Material;
  private readonly ownsResources: boolean;
  private parent: Object3D | null = null;
  private dirtyMatrices = false;
  private dirtyColors = false;

  constructor(options: InstancedSetOptions, ownsResources = true) {
    this.geometry = options.geometry;
    this.material = options.material;
    this.ownsResources = ownsResources;
    this.mesh = new InstancedMesh(options.geometry, options.material, options.count);
    this.mesh.name = options.name;
    this.mesh.castShadow = options.castShadow ?? false;
    this.mesh.receiveShadow = options.receiveShadow ?? false;
    // Static populations are culled per mesh by bounds the caller computes once (`computeBounds`).
    this.mesh.instanceMatrix.setUsage(35048); // DynamicDrawUsage: matrices may be rewritten every frame
    if (options.instanceColors === true) this.mesh.setColorAt(0, new Color(1, 1, 1));
  }

  get count(): number {
    return this.mesh.count;
  }

  addTo(parent: Object3D): void {
    this.parent = parent;
    parent.add(this.mesh);
  }

  setMatrixAt(index: number, matrix: Matrix4): void {
    this.mesh.setMatrixAt(index, matrix);
    this.dirtyMatrices = true;
  }

  setColorAt(index: number, color: Color): void {
    this.mesh.setColorAt(index, color);
    this.dirtyColors = true;
  }

  /** Visible instance count (the rest stay allocated but are not drawn). */
  setVisibleCount(count: number): void {
    this.mesh.count = Math.max(0, Math.min(count, this.mesh.instanceMatrix.count));
  }

  /** Uploads what changed since the last call. Call once per frame after writing, never per instance. */
  commit(): void {
    if (this.dirtyMatrices) {
      this.mesh.instanceMatrix.needsUpdate = true;
      this.dirtyMatrices = false;
    }
    if (this.dirtyColors && this.mesh.instanceColor !== null) {
      this.mesh.instanceColor.needsUpdate = true;
      this.dirtyColors = false;
    }
  }

  /** Bounds for mesh-level culling after the matrices are final (static populations). */
  computeBounds(): void {
    this.mesh.computeBoundingBox();
    this.mesh.computeBoundingSphere();
  }

  dispose(): void {
    this.parent?.remove(this.mesh);
    this.parent = null;
    this.mesh.dispose();
    if (this.ownsResources) {
      this.geometry.dispose();
      this.material.dispose();
    }
  }
}
