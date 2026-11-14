// Camera-only velocity for static geometry (rendering-pipeline.md section 8.1 step 3). Terrain, instanced rocks, static
// props and the sky do not move, so their motion vector is the reprojection of their world position through the previous
// and current camera matrices. The matrices are captured once per frame from the UNJITTERED projection (TRAA applies its
// jitter to the camera while it renders, after our update). Convention equals three's `VelocityNode`: current NDC minus
// previous NDC. Moving objects (avatars, vehicles, robots) must keep three's per-material `velocity`.

import { positionWorld, renderGroup, uniform, vec4 } from "three/tsl";
import { Matrix4, type Camera } from "three/webgpu";

export class CameraOnlyVelocity {
  /** The velocity node (vec2) for an MRT output named `velocity`. */
  readonly node;

  readonly current = uniform(new Matrix4()).setGroup(renderGroup);
  readonly previous = uniform(new Matrix4()).setGroup(renderGroup);
  private primed = false;

  constructor() {
    const world = vec4(positionWorld, 1);
    const currentClip = this.current.mul(world);
    const previousClip = this.previous.mul(world);
    this.node = currentClip.xy.div(currentClip.w).sub(previousClip.xy.div(previousClip.w));
  }

  /** Once per frame, before the render, with the camera at its final pose and its unjittered projection. */
  update(camera: Camera): void {
    camera.updateMatrixWorld();
    if (!this.primed) {
      this.current.value.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      this.previous.value.copy(this.current.value);
      this.primed = true;
      return;
    }
    this.previous.value.copy(this.current.value);
    this.current.value.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
  }
}
