// Sun disk: a camera-facing quad with a 0.53 degree HDR disk (limb darkened) and a small glare skirt. Radiance is far above
// the bloom threshold (4.0), so only the disk and its skirt bloom; the bloom pass makes the halo (rendering-pipeline 6, 8.1).
// Depth-tested against the terrain, so the sun sets behind real ground with no glow or twilight.

import { Fn, float, max, mix, pow, saturate, smoothstep, uv, vec3, vec4, uniform } from "three/tsl";
import { AdditiveBlending, Mesh, MeshBasicNodeMaterial, PlaneGeometry, type Camera, type Vector3 } from "three/webgpu";
import { SUN_DIAMETER_DEG, quadEdgeForAngle } from "./sky-math";

/** Half-extent of the quad in degrees (disk radius 0.265, skirt out to this). */
export const SUN_GLARE_RADIUS_DEG = 2.2;
/** Scene-linear radiance of the disk after pre-exposure (FP16 safe, far above the bloom threshold). */
export const SUN_DISK_RADIANCE = 260;

export class SunDisk {
  readonly mesh: Mesh;

  private readonly geometry = new PlaneGeometry(1, 1);
  private readonly material: MeshBasicNodeMaterial;
  private readonly radiance = uniform(SUN_DISK_RADIANCE);

  constructor() {
    const material = new MeshBasicNodeMaterial();
    material.name = "mc:sun-disk";
    material.transparent = true;
    material.depthWrite = false;
    material.blending = AdditiveBlending;
    const diskRadius = SUN_DIAMETER_DEG / 2 / SUN_GLARE_RADIUS_DEG;
    material.colorNode = Fn(() => {
      const r = uv().sub(0.5).length().mul(2);
      const x = r.div(diskRadius);
      // Limb darkening (linear, u = 0.6) inside the disk; a soft analytic edge one half-pixel wide at 1080p.
      const mu = pow(max(float(1).sub(x.mul(x)), 0), 0.5);
      const limb = mix(float(0.4), float(1), mu);
      const edge = float(1).sub(smoothstep(0.96, 1.0, x));
      const disk = limb.mul(edge);
      const skirt = pow(saturate(float(1).sub(r)), 5)
        .mul(0.012)
        .add(pow(saturate(float(1).sub(r.mul(r).mul(4))), 2).mul(0.02));
      const colour = vec3(1.0, 0.97, 0.92);
      return vec4(colour.mul(disk.mul(this.radiance).add(skirt.mul(this.radiance))), 1);
    })();
    this.material = material;
    this.mesh = new Mesh(this.geometry, material);
    this.mesh.name = "mc:sun-disk";
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -9;
  }

  /** Places the quad at `direction * distanceM` (relative to the sky root) facing the camera. */
  place(direction: Vector3, distanceM: number, camera: Camera): void {
    this.mesh.position.copy(direction).multiplyScalar(distanceM);
    this.mesh.quaternion.copy(camera.quaternion);
    this.mesh.scale.setScalar(quadEdgeForAngle(SUN_GLARE_RADIUS_DEG * 2, distanceM));
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.geometry.dispose();
    this.material.dispose();
  }
}
