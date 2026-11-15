// Pilot Fence marker ring (M1-W2-T01): posts every 10 m along the 900 m ring around Outpost Boreal, every sixth a tall
// pylon, each with a lit safety-orange head. One instanced draw. Posts stand on the JS ground function.
/* eslint-disable @typescript-eslint/no-explicit-any */
import * as TSL from "three/tsl";
import { BoxGeometry, InstancedMesh, Matrix4, MeshStandardNodeMaterial, Vector3 } from "three/webgpu";
import { fenceRingDirections, type PilotFenceSpec } from "./pilot-fence";

const t = TSL as unknown as Record<string, (...args: any[]) => any>;
const { float, mix, positionLocal, step, vec3 } = t as any;

export interface PilotFenceMarkerOptions {
  readonly spec: PilotFenceSpec;
  /** Ground height above R at a unit direction. */
  readonly heightAt: (x: number, y: number, z: number) => number;
  /** World position of the moon centre (default origin). */
  readonly center?: Vector3;
  /** Distance between posts along the ring, metres (default 10). */
  readonly spacingM?: number;
}

const POST = { heightM: 1.8, widthM: 0.14 } as const;
const PYLON = { heightM: 5, widthM: 0.3, every: 6 } as const;
/** Fraction of a post taken by the orange head. */
const HEAD_FRACTION = 0.22;

export class PilotFenceMarkers {
  readonly mesh: InstancedMesh;
  readonly count: number;
  private readonly geometry: BoxGeometry;
  private readonly material: MeshStandardNodeMaterial;

  constructor(options: PilotFenceMarkerOptions) {
    const { spec } = options;
    const center = options.center ?? new Vector3();
    const spacing = options.spacingM ?? 10;
    // A multiple of the pylon interval, so pylons are evenly spaced all the way round.
    const count = Math.max(PYLON.every, Math.round((2 * Math.PI * spec.radiusM) / spacing / PYLON.every) * PYLON.every);
    this.count = count;

    // Unit box standing on its base: y in 0..1.
    this.geometry = new BoxGeometry(1, 1, 1);
    this.geometry.translate(0, 0.5, 0);

    const material = new MeshStandardNodeMaterial();
    material.name = "mc:pilot-fence";
    material.metalness = 0;
    const head = step(1 - HEAD_FRACTION, positionLocal.y);
    material.colorNode = mix(vec3(0.62, 0.64, 0.66), vec3(1, 0.42, 0.05), head);
    material.roughnessNode = float(0.6);
    material.emissiveNode = vec3(1, 0.36, 0.04).mul(head).mul(1.6);
    this.material = material;

    const mesh = new InstancedMesh(this.geometry, material, count);
    mesh.name = "mc:pilot-fence";
    mesh.castShadow = true;
    mesh.receiveShadow = true;

    const dirs = fenceRingDirections(spec, count, new Float64Array(count * 3));
    const up = new Vector3();
    const tangent = new Vector3();
    const side = new Vector3();
    const toCenter = new Vector3(spec.center.x, spec.center.y, spec.center.z);
    const matrix = new Matrix4();
    for (let k = 0; k < count; k++) {
      up.set(dirs[k * 3]!, dirs[k * 3 + 1]!, dirs[k * 3 + 2]!);
      const shape = k % PYLON.every === 0 ? PYLON : POST;
      // Faces square to the ring: one horizontal axis points at the outpost.
      tangent.crossVectors(up, toCenter).normalize();
      side.crossVectors(tangent, up).normalize();
      const radius = spec.moonRadiusM + options.heightAt(up.x, up.y, up.z) - 0.05;
      matrix.makeBasis(tangent, up, side);
      matrix.scale(side.set(shape.widthM, shape.heightM, shape.widthM));
      matrix.setPosition(center.x + up.x * radius, center.y + up.y * radius, center.z + up.z * radius);
      mesh.setMatrixAt(k, matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    this.mesh = mesh;
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.geometry.dispose();
    this.material.dispose();
  }
}
