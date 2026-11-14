// Helpers shared by the verification rows (M0-W2-T07): ownership / disposal, camera placement, screen rectangles of
// world boxes, check bookkeeping.

import {
  BoxGeometry,
  Mesh,
  MeshBasicNodeMaterial,
  MeshStandardNodeMaterial,
  PlaneGeometry,
  Vector3,
  type Camera,
  type Object3D,
  type PerspectiveCamera,
} from "three/webgpu";
import { rectFromNdc, type Rect, type RegionStats } from "./analysis";
import type { RowVerdict, VariantMeasure } from "./types";

interface Disposable {
  dispose(): void;
}

/** Collects what a row creates; `dispose` removes the objects from their parents and frees the GPU resources. */
export class Owner {
  private readonly items: Disposable[] = [];
  private readonly objects: Object3D[] = [];

  own<T extends Disposable>(item: T): T {
    this.items.push(item);
    return item;
  }

  add<T extends Object3D>(parent: Object3D, object: T): T {
    parent.add(object);
    this.objects.push(object);
    return object;
  }

  dispose(): void {
    for (const object of this.objects.splice(0)) object.removeFromParent();
    for (const item of this.items.splice(0)) {
      try {
        item.dispose();
      } catch {
        // A resource whose device is gone has nothing left to free.
      }
    }
  }
}

const _corner = new Vector3();

/** Places the camera and updates its matrices (the module owns the projection). */
export function placeCamera(
  camera: Camera,
  position: readonly [number, number, number],
  target: readonly [number, number, number],
): void {
  camera.position.set(position[0], position[1], position[2]);
  camera.lookAt(target[0], target[1], target[2]);
  camera.updateMatrixWorld();
}

/** Screen rectangle (image fractions) of the axis-aligned world box `centre +- half`. */
export function screenRectOfBox(
  camera: PerspectiveCamera,
  centre: readonly [number, number, number],
  half: readonly [number, number, number],
): Rect {
  camera.updateMatrixWorld();
  const points: { x: number; y: number }[] = [];
  for (let i = 0; i < 8; i++) {
    _corner
      .set(
        centre[0] + ((i & 1) === 0 ? -half[0] : half[0]),
        centre[1] + ((i & 2) === 0 ? -half[1] : half[1]),
        centre[2] + ((i & 4) === 0 ? -half[2] : half[2]),
      )
      .project(camera);
    points.push({ x: _corner.x, y: _corner.y });
  }
  return rectFromNdc(points);
}

/** A large ground plane in the world root (grey regolith stand-in, rough, non-metal). */
export function addGround(owner: Owner, parent: Object3D, size: number, colour = 0x8c8c8c): Mesh {
  const geometry = owner.own(new PlaneGeometry(size, size).rotateX(-Math.PI / 2));
  const material = owner.own(new MeshStandardNodeMaterial({ color: colour, roughness: 1, metalness: 0 }));
  const mesh = owner.add(parent, new Mesh(geometry, material));
  mesh.receiveShadow = true;
  mesh.name = "mc:verify-ground";
  return mesh;
}

/** A shadow-casting box standing on y = 0. */
export function addBox(
  owner: Owner,
  parent: Object3D,
  x: number,
  z: number,
  width: number,
  height: number,
  depth: number,
  colour = 0xd0d0d0,
): Mesh {
  const geometry = owner.own(new BoxGeometry(width, height, depth));
  const material = owner.own(new MeshStandardNodeMaterial({ color: colour, roughness: 1, metalness: 0 }));
  const mesh = owner.add(parent, new Mesh(geometry, material));
  mesh.position.set(x, height / 2, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

/** A flat unlit colour quad facing -z in the world, toward a camera looking down +z (for the 2D-style rows). */
export function addFlatQuad(
  owner: Owner,
  parent: Object3D,
  material: MeshBasicNodeMaterial,
  x: number,
  y: number,
  z: number,
  width: number,
  height: number,
): Mesh {
  const geometry = owner.own(new PlaneGeometry(width, height));
  const mesh = owner.add(parent, new Mesh(geometry, material));
  mesh.position.set(x, y, z);
  // Faces -z: toward a camera at lower z looking down +z.
  mesh.rotation.y = Math.PI;
  mesh.frustumCulled = false;
  return mesh;
}

// ---- Evaluation helpers ---------------------------------------------------------------------------------------------

export class Checks {
  readonly notes: string[] = [];
  private failed = false;

  /** Records one check. `detail` carries the measured numbers. */
  expect(ok: boolean, what: string, detail: string): void {
    if (!ok) this.failed = true;
    this.notes.push(`${ok ? "ok  " : "FAIL"} ${what}: ${detail}`);
  }

  verdict(): RowVerdict {
    return { verdict: this.failed ? "FAIL" : "PASS", notes: this.notes };
  }
}

export function find(measures: readonly VariantMeasure[], variant: string): VariantMeasure | undefined {
  return measures.find((m) => m.variant === variant);
}

export function stat(measure: VariantMeasure | undefined, region: string): RegionStats | undefined {
  return measure?.stats[region];
}

export function fmt(value: number | undefined): string {
  return value === undefined ? "n/a" : value.toFixed(2);
}

/** A row whose measurements are missing cannot pass. */
export function missing(what: string): RowVerdict {
  return { verdict: "FAIL", notes: [`FAIL missing measurement: ${what}`] };
}
