// Shadow node of one key-light cascade (M0 look-polish round 4): three's `ShadowNode` with the normal offset applied to
// the receivers that need it instead of to every receiver.
//
// The normal offset (`shadow-bias.ts`, 1.1 texels of the cascade) lifts the shadow lookup off the receiver so the PCF
// footprint does not reach the receiver's own back faces: it keeps the lit faces of props clean (a post the sun grazes: 3 %
// of its lit pixels falsely darkened with the offset, 8 to 11 % without, measured). On the GROUND it only does harm: a lookup
// lifted by h reads the shadow of the point h / tan(elevation) further down-light, so every shadow on the ground ends
// that much early. Low cascade 1 has 18.4 cm texels: h = 20 cm, 11.6 m at a 1 degree sun; a 0.38 m rock's 21.8 m shadow
// ended at 10.3 m (VT-M0-04b). The ground does not need the offset: three draws shadow maps from caster back faces, flat or
// gently rolling terrain has none toward the light, and the measured open-ground acne without it is 0 px.
//
// So three's own `LightShadow.normalBias` stays 0 on the cascades, the rig writes the offset in metres to
// `shadow[KEY_NORMAL_OFFSET_PROPERTY]`, and this node adds it to the lookup of every material EXCEPT those flagged
// `userData[SHADOW_FLAT_RECEIVER_KEY] === true` (the regolith / terrain materials). Flagged materials pay nothing.
//
// r187 internals used: `ShadowNode.setupShadowCoord(builder, shadowPosition)` (the position is still in the light's clip
// space there, before the y flip and the depth bias, so adding `shadowMatrix * (N * offset, 0)` is exact on both backends),
// `lightShadowMatrix(light)` (the same cached uniform three's node multiplies with). Re-check on every three upgrade.

import * as TSL from "three/tsl";
import { normalWorld, reference, renderGroup, vec4 } from "three/tsl";
import { ShadowNode, type Node, type NodeBuilder } from "three/webgpu";

/** Material `userData` key: `true` on receivers that take no normal offset on the key light's cascades (terrain). */
export const SHADOW_FLAT_RECEIVER_KEY = "mcShadowFlatReceiver";
/** Property of a cascade's `LightShadow` holding the normal offset in metres (written per frame by `SunRig`). */
export const KEY_NORMAL_OFFSET_PROPERTY = "mcNormalOffsetM";

// three's light / shadow node internals are not in @types/three; the graph is built once per material.
/* eslint-disable @typescript-eslint/no-explicit-any */
type Loose = any;

export class KeyCascadeShadowNode extends ShadowNode {
  static get type(): string {
    return "KeyCascadeShadowNode";
  }

  setupShadowCoord(builder: NodeBuilder, shadowPosition: Node): Node {
    const base = (ShadowNode.prototype as Loose).setupShadowCoord as (b: NodeBuilder, p: Node) => Node;
    const material = builder.material as { userData?: Record<string, unknown> } | null | undefined;
    if (material?.userData?.[SHADOW_FLAT_RECEIVER_KEY] === true) return base.call(this, builder, shadowPosition);
    const self = this as Loose;
    const offsetM: Loose = (reference(KEY_NORMAL_OFFSET_PROPERTY, "float", self.shadow) as Loose).setGroup(renderGroup);
    const shadowMatrix: Loose = (TSL as Loose).lightShadowMatrix(self.light);
    const lifted: Loose = (shadowPosition as Loose).add(shadowMatrix.mul(vec4(normalWorld.mul(offsetM), 0)));
    return base.call(this, builder, lifted);
  }
}

/** `true` when `material` is flagged as a flat receiver (for tests and the debug sidecar). */
export function isFlatShadowReceiver(material: { userData?: Record<string, unknown> }): boolean {
  return material.userData?.[SHADOW_FLAT_RECEIVER_KEY] === true;
}
