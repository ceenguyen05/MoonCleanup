// Look-dev tuning handle: sets the detail-normal strength on every look-dev ground material under `world` (the strength is a
// uniform stored in the material's userData by `createGroundMaterial`).

import type { Object3D } from "three/webgpu";

export function createGroundBumpHandle(world: Object3D): (strength: number) => void {
  return (strength) => {
    world.traverse((o) => {
      const mesh = o as { material?: { userData?: Record<string, unknown> } };
      const bump = mesh.material?.userData?.["mcBump"] as { value: number } | undefined;
      if (bump !== undefined) bump.value = strength;
    });
  };
}
