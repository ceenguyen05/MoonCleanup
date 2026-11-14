// Built-in backend-parity test mesh (`?scene=smoke`; VT-M0-09 smoke, M0-W1-T01): one faceted solid with an unlit
// TSL node material, so it needs no lights, no textures and no assets and must look the same on `webgpu`,
// `webgpu-compat` and `webgl2`. Not game art: the hello-world scene until visuals and terrain exist.
//
// The colour is scene-linear and exceeds 1.0 on the faces turned towards the key direction, so the frame also
// exercises the half-float target and the AgX tone map (a clamped 8-bit target would flatten those faces).

import { mix, normalWorld, vec3 } from "three/tsl";
import { IcosahedronGeometry, Mesh, MeshBasicNodeMaterial, type Object3D } from "three/webgpu";
import type { FrameInfo } from "@moon-cleanup/shared";

/** Radians per second around the vertical axis; slow enough to read, driven by frame time (deterministic). */
const SPIN_RAD_PER_S = 0.5;
const TILT_RAD = 0.35;

export class SmokeScene {
  readonly object: Mesh;

  private readonly geometry: IcosahedronGeometry;
  private readonly material: MeshBasicNodeMaterial;
  private parent: Object3D | null = null;

  constructor() {
    // Detail 0: 20 flat faces (the geometry is non-indexed, so normals are per face).
    this.geometry = new IcosahedronGeometry(0.5, 0);

    const keyDirection = vec3(0.45, 0.8, 0.4).normalize();
    const facing = normalWorld.dot(keyDirection).mul(0.5).add(0.5);
    const shadowSide = vec3(0.02, 0.03, 0.06);
    const litSide = vec3(2.4, 1.5, 0.7);
    this.material = new MeshBasicNodeMaterial();
    this.material.name = "mc:smoke";
    this.material.colorNode = mix(shadowSide, litSide, facing.mul(facing));

    this.object = new Mesh(this.geometry, this.material);
    this.object.name = "mc:smoke-mesh";
    // 3 m in front of the default camera (eye height 1.7 m, looking down -Z).
    this.object.position.set(0, 1.7, -3);
    this.object.rotation.x = TILT_RAD;
  }

  addTo(parent: Object3D): void {
    this.parent = parent;
    parent.add(this.object);
  }

  update(frame: FrameInfo): void {
    this.object.rotation.y = frame.time * SPIN_RAD_PER_S;
  }

  dispose(): void {
    this.parent?.remove(this.object);
    this.parent = null;
    this.geometry.dispose();
    this.material.dispose();
  }
}
