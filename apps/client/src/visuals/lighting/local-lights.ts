// Range-culled local lights (M0 look-polish round 3): `LocalSpotLight` / `LocalPointLight` are three's SpotLight / PointLight
// whose light nodes skip the whole BRDF (and the shadow lookup) for fragments the light does not reach.
//
// Why: three r187 evaluates every forward light for every lit fragment: the full diffuse + GGX term runs even where the
// distance cutoff or the spot cone has already made the light's colour exactly zero. Measured on the UHD 620 (S06, Low,
// 0.75 scale): the Crown Lamp, the outpost flood and the door glow together cost 8.6 ms of a 36.1 ms frame, although each
// reaches a fraction of the screen. Clustered lighting (rendering-pipeline 5.4) is the M1 answer for many lights; until it is
// in, every local light should be one of these classes.
//
// How: the node computes the unshadowed radiance at the fragment first (three's own attenuation: exactly 0 past
// `light.distance` and outside the cone), and runs shadow + BRDF inside `If(radiance > 0)`. The lit result is identical to
// three's for every fragment the light reaches. A light with `distance = 0` (no cutoff) is never culled by range, only by
// its cone: give local lights a cutoff.
//
// Registration is three r187's `Light.registerNode()`, which stores the node class on the light class's prototype, so
// nothing has to be registered on a renderer. The light nodes' internals used here (`baseColorNode`, `setupShadow`,
// `setupDirect`, `lightsNode.setupDirectLight`) mirror `AnalyticLightNode.setup` of r187: re-check on every three upgrade.

import { If } from "three/tsl";
import {
  PointLight,
  PointLightNode,
  SpotLight,
  SpotLightNode,
  type Node,
  type NodeBuilder,
  type Object3D,
} from "three/webgpu";
import type { ShadowFilterId } from "../look-knobs";
import { shadowFilterFor } from "./shadow-filter";

// three's light-node internals are not in @types/three; the graph is built once per material, never per frame.
/* eslint-disable @typescript-eslint/no-explicit-any */
type Loose = any;

/**
 * `AnalyticLightNode.setup` with the BRDF (and the shadow lookup) inside `If(unshadowed radiance > 0)`.
 * Returns `false` when the builder context supplies its own shadow colour (`context.getShadow`): the caller then uses
 * three's plain path.
 */
function setupRangeCulled(node: Loose, builder: Loose): boolean {
  if (builder.context.getShadow) return false;
  node.colorNode = node.baseColorNode || node.colorNode;
  const shadowed: boolean = node.light.castShadow === true && builder.object.receiveShadow === true;
  if (node.light.castShadow !== true && node.shadowNode !== null) node.disposeShadow();

  // Unshadowed radiance: colour x distance attenuation (x cone attenuation), zero where the light does not reach.
  const direct = node.setupDirect(builder);
  if (!direct) return true;
  const radiance: Loose = direct.lightColor.toVar();
  If(radiance.r.add(radiance.g).add(radiance.b).greaterThan(0), () => {
    let lightColor: Loose = radiance;
    if (shadowed) {
      // Creates (once) and exposes the light's shadow node; the lookup is emitted inside this branch.
      node.setupShadow(builder);
      lightColor = radiance.mul(node.shadowNode);
    }
    builder.lightsNode.setupDirectLight(builder, node, { lightDirection: direct.lightDirection, lightColor });
  });
  return true;
}

export class RangeCulledSpotLightNode extends SpotLightNode {
  static get type(): string {
    return "RangeCulledSpotLightNode";
  }

  override setup(builder: NodeBuilder): Node | null | undefined {
    return setupRangeCulled(this, builder) ? undefined : super.setup(builder);
  }
}

export class RangeCulledPointLightNode extends PointLightNode {
  static get type(): string {
    return "RangeCulledPointLightNode";
  }

  override setup(builder: NodeBuilder): Node | null | undefined {
    return setupRangeCulled(this, builder) ? undefined : super.setup(builder);
  }
}

/** A SpotLight whose shading is skipped outside its cone and beyond its `distance`. Same constructor as SpotLight. */
export class LocalSpotLight extends SpotLight {}

/** A PointLight whose shading is skipped beyond its `distance`. Same constructor as PointLight. */
export class LocalPointLight extends PointLight {}

(LocalSpotLight as Loose).registerNode(RangeCulledSpotLightNode);
(LocalPointLight as Loose).registerNode(RangeCulledPointLightNode);

/** `true` when `light` is shaded through a range-culled node (for tests and the debug sidecar). */
export function isRangeCulled(light: object): boolean {
  const nodeClass = (light as Loose)._lightNode;
  return nodeClass === RangeCulledSpotLightNode || nodeClass === RangeCulledPointLightNode;
}

// ---- Lamp shadow maps --------------------------------------------------------------------------------------------------

/**
 * Layer of everything that may cast into a local lamp's shadow map (props, avatars, rocks). The terrain is NOT on it: three
 * draws shadow maps from caster back faces, so up-facing ground never lands in a lamp's map, yet its whole mesh would be
 * submitted to the lamp's shadow pass every frame (the look scenes' cap: 128 k triangles).
 */
export const LAMP_CASTER_LAYER = 1;

/** Puts `root` and its descendants on the lamp-caster layer, except the objects `skip` returns true for. */
export function markLampCasters(root: Object3D, skip?: (object: Object3D) => boolean): void {
  root.traverse((object) => {
    if (skip?.(object) === true) return;
    object.layers.enable(LAMP_CASTER_LAYER);
  });
}

/**
 * Shadow setup of a local lamp: map size of the preset, casters of `LAMP_CASTER_LAYER` only, and the PCF kernel `filter`
 * (`vogel5` = three's own rotated disk, right only with a temporal resolve; SMAA / FXAA presets pass `pcf3`: no per-pixel
 * trigonometry and no dither in the penumbra).
 */
export function configureLampShadow(lamp: SpotLight, sizePx: number, filter: ShadowFilterId): void {
  lamp.shadow.mapSize.set(sizePx, sizePx);
  lamp.shadow.camera.layers.set(LAMP_CASTER_LAYER);
  const fn = shadowFilterFor(filter);
  if (fn !== null) (lamp.shadow as Loose).filterNode = fn;
}
