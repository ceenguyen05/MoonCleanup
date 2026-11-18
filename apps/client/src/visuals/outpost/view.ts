import { Group, LOD, Matrix4, Vector3, type Camera } from "three/webgpu";
import type { OutpostKit, OutpostPiece } from "./assets";

export interface OutpostPoint {
  readonly kind: "assay_counter" | "receiving_gate";
  readonly x: number;
  readonly y: number;
  readonly z: number;
}
export interface OutpostMapper {
  point(src: Float64Array, so: number, out: Float64Array, o: number): void;
  direction(src: Float64Array, so: number, out: Float64Array, o: number): void;
}
export interface OutpostPlacement {
  readonly piece: OutpostPiece;
  readonly position: Float64Array;
  readonly front: Float64Array;
}

/** Authored layout anchored to the same service points as selling; no independent guessed station coordinates. */
export function outpostLayout(points: readonly OutpostPoint[], radius: number): OutpostPlacement[] {
  const counter = points.find((point) => point.kind === "assay_counter");
  if (!counter) return [];
  const result: OutpostPlacement[] = [];
  const centre = new Vector3(counter.x, counter.y, counter.z).normalize();
  const add = (piece: OutpostPiece, normal: Vector3, front: Vector3): void => {
    result.push({
      piece,
      position: new Float64Array(normal.clone().multiplyScalar(radius).toArray()),
      front: new Float64Array(front.toArray()),
    });
  };
  const east = new Vector3(1, 0, 0).addScaledVector(centre, -centre.x).normalize();
  add("assay_counter", centre, east);
  const gates = points.filter((point) => point.kind === "receiving_gate");
  for (let i = 0; i < gates.length; i++) {
    const point = gates[i]!;
    const normal = new Vector3(point.x, point.y, point.z).normalize();
    const inward = centre.clone().addScaledVector(normal, -centre.dot(normal)).normalize();
    add("dump_plate", normal, inward);
    add("receiving_gate", normal.clone().multiplyScalar(radius).addScaledVector(inward, -2.6).normalize(), inward);
    const next = gates[(i + 1) % gates.length]!;
    const diagonal = normal
      .clone()
      .add(new Vector3(next.x, next.y, next.z))
      .normalize();
    const mastFront = centre.clone().addScaledVector(diagonal, -centre.dot(diagonal)).normalize();
    add("flood_mast", diagonal, mastFront);
  }
  return result;
}

/** Owns clones, not the shared kit. Update after gameplay applies the current render frame. */
export class OutpostView {
  readonly root = new Group();
  private readonly instances: { placement: OutpostPlacement; lod: LOD }[] = [];
  private readonly scratch = new Float64Array(9);
  private readonly up = new Vector3();
  private readonly front = new Vector3();
  private readonly side = new Vector3();
  private readonly basis = new Matrix4();
  constructor(
    kit: OutpostKit,
    points: readonly OutpostPoint[],
    radius: number,
    private readonly mapper: OutpostMapper,
    private readonly flat = true,
  ) {
    this.root.name = "Outpost Boreal";
    for (const placement of outpostLayout(points, radius)) {
      const lod = new LOD();
      const levels = kit.get(placement.piece);
      if (!levels) throw new Error(`Outpost kit missing ${placement.piece}`);
      levels.forEach((level, index) => lod.addLevel(level.clone(true), [0, 35, 90][index]!, 0.1));
      lod.autoUpdate = false;
      this.root.add(lod);
      this.instances.push({ placement, lod });
    }
  }
  update(camera: Camera): void {
    for (const { placement, lod } of this.instances) {
      this.mapper.point(placement.position, 0, this.scratch, 0);
      lod.position.fromArray(this.scratch);
      if (this.flat) this.up.set(0, 1, 0);
      else {
        this.mapper.direction(placement.position, 0, this.scratch, 3);
        this.up.fromArray(this.scratch, 3).normalize();
      }
      this.mapper.direction(placement.front, 0, this.scratch, 6);
      this.front.fromArray(this.scratch, 6).addScaledVector(this.up, -this.front.dot(this.up)).normalize();
      this.side.crossVectors(this.front, this.up).normalize();
      this.basis.makeBasis(this.front, this.up, this.side);
      lod.quaternion.setFromRotationMatrix(this.basis);
      lod.updateMatrixWorld(true);
      lod.update(camera);
    }
  }
  dispose(): void {
    this.root.removeFromParent();
    this.root.clear();
  }
}
