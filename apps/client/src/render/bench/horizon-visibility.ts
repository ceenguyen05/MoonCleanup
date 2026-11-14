// Far-occluder (horizon map) shading of bench v1 (M0-W3-T07), rendering-pipeline.md section 5.2: the baked horizon elevation
// of eight azimuths is stored per terrain vertex (two vec4 attributes, zero sampled textures) and compared with the key
// light's elevation in the fragment; the result multiplies the cascade shadow so craters beyond the CSM range still cast
// shadows. The regolith material publishes the node through `userData.mcHorizonVisibility` (its `horizonVisibility`
// option); `HorizonCsmNode` is the CSM node that multiplies it in. Same technique as visuals/lighting/sun-rig.ts, written
// here because that class is not a public export of the visuals barrel.
//
// Local frame (tools/terrain-bake/src/cubemap/horizon.ts): east = normalize(cross(Y, p)), north = cross(p, east); channel k
// is the horizon at azimuth k * 45 degrees from north toward east. Built once at start-up; nothing per frame except the
// key-direction uniform (written by the scene when the sun moves).

import {
  Fn,
  atan,
  attribute,
  cross,
  dot,
  float,
  mix,
  normalize,
  positionWorld,
  smoothstep,
  uniform,
  vec3,
  vec4,
} from "three/tsl";
import {
  BufferAttribute,
  Vector3,
  type BufferGeometry,
  type Node,
  type NodeBuilder,
  type UniformNode,
} from "three/webgpu";
import { CSMShadowNode } from "three/addons/csm/CSMShadowNode.js";
import { sampleHorizon, type HorizonCube } from "./terrain-cube";
import { MOON_RADIUS_M } from "./terrain-data";

/** `Material.userData` key shared with the regolith material (visuals/materials/regolith-material.ts). */
export const HORIZON_VISIBILITY_KEY = "mcHorizonVisibility";

const _dir = new Vector3();
const _angles = new Float32Array(8);

/** Adds `aHorizonA` (azimuth channels 0..3) and `aHorizonB` (4..7), degrees, to a chunk whose positions are world space. */
export function addHorizonAttributes(geometry: BufferGeometry, cube: HorizonCube): void {
  const position = geometry.getAttribute("position");
  const a = new Float32Array(position.count * 4);
  const b = new Float32Array(position.count * 4);
  for (let i = 0; i < position.count; i++) {
    // Direction from the moon centre (0, -R, 0); the sub-10 m height is ignored.
    _dir.set(position.getX(i), position.getY(i) + MOON_RADIUS_M, position.getZ(i)).normalize();
    sampleHorizon(cube, _dir.x, _dir.y, _dir.z, _angles);
    for (let k = 0; k < 4; k++) {
      a[i * 4 + k] = _angles[k] ?? 0;
      b[i * 4 + k] = _angles[4 + k] ?? 0;
    }
  }
  geometry.setAttribute("aHorizonA", new BufferAttribute(a, 4));
  geometry.setAttribute("aHorizonB", new BufferAttribute(b, 4));
}

export interface HorizonVisibility {
  /** Multiplied into the cascade shadow: 1 = lit, 0 = in a far shadow. */
  readonly node: Node<"float">;
  /** Unit direction toward the key light. */
  readonly keyDirection: UniformNode<"vec3", Vector3>;
  /** 1 enables the term, 0 disables it (A/B captures, `?horizon=off`). */
  readonly enabled: UniformNode<"float", number>;
}

/** `deltaDeg` = half the sun disk plus about one texel of angular error. */
export function createHorizonVisibility(deltaDeg = 0.55): HorizonVisibility {
  const keyDirection = uniform(new Vector3(0, 1, 0));
  const enabled = uniform(1);
  const centre = vec3(0, -MOON_RADIUS_M, 0);
  const aH = attribute("aHorizonA", "vec4");
  const bH = attribute("aHorizonB", "vec4");
  const node = Fn(() => {
    const p = normalize(positionWorld.sub(centre));
    const east = normalize(cross(vec3(0, 1, 0), p));
    const north = cross(p, east);
    const l = keyDirection;
    const elevation = dot(l, p)
      .asin()
      .mul(180 / Math.PI);
    const az = atan(dot(l, east), dot(l, north));
    const t = az
      .mul(8 / (2 * Math.PI))
      .add(8)
      .mod(8);
    const h = vec4(aH.x, aH.y, aH.z, aH.w);
    const g = vec4(bH.x, bH.y, bH.z, bH.w);
    const channel = (i: number): Node<"float"> =>
      (i < 4 ? [h.x, h.y, h.z, h.w][i] : [g.x, g.y, g.z, g.w][i - 4]) as Node<"float">;
    let horizon: Node<"float"> = float(0) as Node<"float">;
    for (let i = 0; i < 8; i++) {
      const w = float(1).sub(
        t
          .sub(i)
          .abs()
          .min(float(8).sub(t.sub(i).abs()))
          .min(1),
      );
      horizon = horizon.add(channel(i).mul(w)) as Node<"float">;
    }
    const visible = smoothstep(horizon.sub(deltaDeg), horizon.add(deltaDeg), elevation);
    return mix(float(1), visible, enabled);
  })();
  return { node: node as Node<"float">, keyDirection, enabled };
}

/** CSM that multiplies a receiver's published horizon visibility into the cascade result. */
export class HorizonCsmNode extends CSMShadowNode {
  override setup(builder: NodeBuilder): Node | null | undefined {
    const node = super.setup(builder);
    const material = builder.material as { userData?: Record<string, unknown> } | null | undefined;
    const horizon = material?.userData?.[HORIZON_VISIBILITY_KEY] as Node<"vec4"> | undefined;
    if (horizon !== undefined && node !== null && node !== undefined) return (node as Node<"vec4">).mul(horizon);
    return node;
  }
}
