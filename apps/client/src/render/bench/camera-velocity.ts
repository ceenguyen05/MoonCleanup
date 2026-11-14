// Camera-only velocity for static geometry (rendering-pipeline.md section 8.1 step 3; M0-W2-T02 "terrain camera-only
// velocity check"). Terrain, instanced rocks and static props do not move, so their motion vector is the reprojection of
// their world position through the previous and current camera matrices: no per-object matrix history, no per-object
// update on the CPU (three's built-in `velocity` node updates once per OBJECT every frame, 64 chunks + props).
//
// The matrices are captured once per frame by `update(camera)` from the UNJITTERED projection (TRAA applies its jitter
// to the camera only while it renders, after our update), so jitter never leaks into the vectors.
// Convention equals three's `VelocityNode`: NDC xy of the current position minus NDC xy of the previous one.
//
// Moving objects (avatars, vehicles, robots) must keep three's `velocity` (true previous-frame matrices): this node
// is for static draws only. The bench writes it for everything it draws and animates its avatars slowly; the swap
// to per-material velocity is a visuals / M0-W3-T07 decision.

import { positionWorld, renderGroup, uniform, vec4 } from "three/tsl";
import { Matrix4, Vector3, Vector4, type Camera } from "three/webgpu";

/** NDC motion (current minus previous) of the world point (x, y, z). Pure; used by the unit test and the check. */
export function cameraOnlyVelocityNdc(
  previousViewProjection: Matrix4,
  currentViewProjection: Matrix4,
  point: Vector3,
  out: { x: number; y: number },
): void {
  _clip.set(point.x, point.y, point.z, 1).applyMatrix4(currentViewProjection);
  const cx = _clip.x / _clip.w;
  const cy = _clip.y / _clip.w;
  _clip.set(point.x, point.y, point.z, 1).applyMatrix4(previousViewProjection);
  out.x = cx - _clip.x / _clip.w;
  out.y = cy - _clip.y / _clip.w;
}
const _clip = new Vector4();

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
