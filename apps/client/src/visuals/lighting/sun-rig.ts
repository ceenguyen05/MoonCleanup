// Sun / earthshine key light with filtered cascades, plus the regolith-bounce fill (rendering-pipeline.md sections 5.1-5.2).
//
//   key   one DirectionalLight + MoonShadowNode (CSM). By day it is the sun; at near-side night the SAME light is re-pointed
//         at the Earth and recoloured (cost-free earth shadows, section 5.2).
//   fill  one HemisphereLight used as a normal-dependent ambient: up-facing 15 %, vertical 25 %, down-facing 35 % of the
//         key's flat-ground illuminance, warm grey, never blue (art-direction D-05).
//   floor one AmbientLight, far-side night only.
//
// r187 findings applied here (M0-W2-T07): CSM clones `light.shadow` per cascade, so bias / radius are written to
// `csm.lights[i].shadow`; `csm.fade` is fixed at build time, so a preset change rebuilds the node.
//
// Bias (M0-visual-checks, `shadow-bias.ts`): a flat normal offset and a half-texel depth bias toward more shadow; the
// cascades hold back faces, so there is no self-shadow acne to push away.
// `?debug=cascades` tints the sunlight by the cascade a pixel reads (VT-M0-03 debug view).

import { float, mix, positionView, smoothstep, step, uniform, vec3, vec4 } from "three/tsl";
import {
  AmbientLight,
  Color,
  DirectionalLight,
  HemisphereLight,
  Vector3,
  type Camera,
  type Node,
  type NodeBuilder,
  type PerspectiveCamera,
  type Scene,
} from "three/webgpu";
import { CSMShadowNode } from "three/addons/csm/CSMShadowNode.js";
import type { QualitySettings } from "@moon-cleanup/shared";
import { DEFAULT_LOOK_KNOBS, sunShadowsEnabled, type LookKnobs, type ShadowFilterId } from "../look-knobs";
import { KEY_NORMAL_OFFSET_PROPERTY, KeyCascadeShadowNode } from "./cascade-shadow-node";
import { cascadeEndsM } from "./cascade-splits";
import { keyDirectionUniform } from "./key-direction";
import { FILL_FRACTION, type KeyState } from "./key-light";
import { depthBias, normalBiasM, texelWorldM } from "./shadow-bias";
import { shadowFilterFor } from "./shadow-filter";

const DEG = Math.PI / 180;

/** Sun colour (art-direction 2.1) and earthshine colour, linear. */
/** Rec.709 luma 1.00 (was 0.95, which cost every chart chip 4-8 codes): a warm white that does not change the exposure. */
const SUN_COLOUR = new Color(1.03, 0.998, 0.94);
const EARTH_COLOUR = new Color(0.62, 0.74, 1.0);
const FLOOR_COLOUR = new Color(0.4, 0.46, 0.65);
/** Bounce tint, normalised to luminance 1: neutral with a soft cool lean (reference mood: shadows read slightly cooler than the sunlit ground; art-direction #8C8478 was warm, tunable). */
const FILL_TINT = new Color(1.0, 1.0, 1.045);

/** Material `userData` key under which a receiver publishes its far-occluder (horizon map) visibility node. */
export const HORIZON_VISIBILITY_KEY = "mcHorizonVisibility";

/**
 * Layer of the shadow camera of cascade 0; cascade i also renders layer `KEY_CASCADE_LAYER_BASE + i`. An object on
 * that layer alone is drawn into that one cascade and by no other camera (the per-cascade terrain casters, M1-W2-T01).
 */
export const KEY_CASCADE_LAYER_BASE = 10;

/** Sun elevations (degrees) over which terrain receivers hand far cascades over to the horizon map (`MoonShadowNode.lowSun`). */
export const HANDOVER_LOW_DEG = 6;
export const HANDOVER_HIGH_DEG = 10;

/** 1 at or below `HANDOVER_LOW_DEG`, 0 at or above `HANDOVER_HIGH_DEG`, smoothstep between. */
export function lowSunHandover(elevationDeg: number, lowDeg = HANDOVER_LOW_DEG, highDeg = HANDOVER_HIGH_DEG): number {
  const t = Math.min(1, Math.max(0, (elevationDeg - lowDeg) / (highDeg - lowDeg)));
  return 1 - t * t * (3 - 2 * t);
}

/** Light margin above the highest point of a cascade (rim shadows at grazing sun), metres. */
const LIGHT_MARGIN_M = 300;
/** Smallest sun elevation used for the CSM direction: avoids a degenerate light-space box at exactly 0. */
const MIN_CSM_ELEVATION_RAD = 0.2 * DEG;

type TslNode = Node<"vec4">;

/** Sunlight tint per cascade of the `?debug=cascades` view: cascade 0 red, 1 green, 2 blue, 3 yellow; past the last: white. */
export const CASCADE_DEBUG_TINTS: readonly (readonly [number, number, number])[] = [
  [1.0, 0.42, 0.42],
  [0.42, 1.0, 0.42],
  [0.45, 0.55, 1.0],
  [1.0, 0.95, 0.4],
];

/** Tint (vec4, alpha 1) by view depth against the cascade far ends in metres (the split the CSM itself uses). */
function cascadeTintNode(endsM: readonly number[]): TslNode {
  const depth = positionView.z.negate();
  let tint: Node<"vec3"> = vec3(1, 1, 1);
  for (let i = endsM.length - 1; i >= 0; i--) {
    const [r, g, b] = CASCADE_DEBUG_TINTS[i % CASCADE_DEBUG_TINTS.length] ?? [1, 1, 1];
    tint = mix(vec3(r, g, b), tint, step(float(endsM[i] ?? 0), depth));
  }
  return vec4(tint, 1);
}

/**
 * CSM with three extra hooks: cascade shadows are created lazily on the first build (`onCascades` receives them so the PCF
 * kernel can be attached), a receiving material may publish a far-occluder visibility node in
 * `userData[HORIZON_VISIBILITY_KEY]` which multiplies the cascade result (min of CSM and horizon map, section 5.2), and
 * `debugEndsM` (cascade far ends) switches the cascade tint of the debug view on.
 */
export class MoonShadowNode extends CSMShadowNode {
  onCascades: ((lights: CSMShadowNode["lights"]) => void) | null = null;
  debugEndsM: readonly number[] | null = null;
  /**
   * Low-sun handover on TERRAIN receivers (M1-W2-T02, "toothed far shadows"): 0 = cascades as usual, 1 = past
   * `handoverEndM` the terrain is shadowed by the horizon map alone. At a grazing sun the terrain casters' cascade shadow
   * on the terrain itself is a comb of long teeth (one map texel spans about 11 texels of ground along the light at 5
   * degrees, and the caster mesh is not the receiver mesh), while the horizon map draws the same ridge and crater shadows
   * per pixel with no texels along the light. Cascade 0 (near the player) keeps the cascades, so the player's and nearby
   * props' shadows stay; props past it lose their shadow ON THE TERRAIN at a low sun only. Props as receivers keep the
   * cascades. Driven by `SunRig.update` from the key's elevation (`lowSunHandover`).
   */
  readonly lowSun = uniform(0);
  readonly handoverStartM = uniform(8);
  readonly handoverEndM = uniform(10);

  override setup(builder: NodeBuilder): Node | null | undefined {
    const first = this.camera === null;
    let node = super.setup(builder);
    if (first) {
      // The cascade graph is built lazily after this returns: swap three's per-cascade shadow nodes for ours (normal offset
      // per receiver, `cascade-shadow-node.ts`) before any of them has been built.
      const nodes = (this as unknown as { _shadowNodes: unknown[] })._shadowNodes;
      for (let i = 0; i < this.lights.length; i++) {
        const light = this.lights[i];
        if (light !== undefined) nodes[i] = new KeyCascadeShadowNode(light as never, light.shadow as never);
      }
      this.onCascades?.(this.lights);
    }
    if (node === null || node === undefined) return node;
    const material = builder.material as { userData?: Record<string, unknown> } | null | undefined;
    const horizon = material?.userData?.[HORIZON_VISIBILITY_KEY] as TslNode | undefined;
    if (horizon !== undefined) {
      // Terrain receiver: past cascade 0, a low sun hands the cascades over to the horizon map (`lowSunHandover`).
      const depth = positionView.z.negate();
      const away = smoothstep(this.handoverStartM, this.handoverEndM, depth);
      const csmWeight = float(1).sub(this.lowSun.mul(away));
      // mix(1, csm, w) written for any vector width of the cascade result.
      node = (node as TslNode).sub(1).mul(csmWeight).add(1).mul(horizon);
    }
    if (this.debugEndsM !== null) node = (node as TslNode).mul(cascadeTintNode(this.debugEndsM));
    return node;
  }
}

/**
 * PCF kernel of CASCADE 0 a preset runs without a `?shadowfilter=` / `?shadowfilter0=` knob. SMAA presets (Low / Medium)
 * have no temporal resolve to average the per-pixel rotation of three's Vogel-disk filter, which showed as dither in the
 * penumbra (M0-W2-T07 finding 3): they use the exact 3x3 tent from 4 bilinear taps (`pcf3`: one clean continuous edge, no
 * trigonometry per pixel, the same 4 taps as the `tent4` pattern it replaces, whose kernel at radius 1.5 had a half-texel
 * hole and drew doubled, stair-stepped edges). TRAA presets keep the rotated disk, which the resolve turns into a smooth
 * wide penumbra.
 */
export function defaultShadowFilter(settings: QualitySettings): ShadowFilterId {
  return settings.post.aa === "traa" ? "vogel5" : "pcf3";
}

/**
 * PCF kernel of the cascades BEYOND cascade 0 without a knob. SMAA / FXAA presets run the wider exact kernel `pcf5` there
 * (9 comparisons); TRAA presets keep the rotated disk.
 *
 * Why not `pcf3` everywhere (M0 look-polish round 3): a shadow map is a point-sampled, binary image of the caster, so an
 * edge at a shallow angle to the texel grid is a staircase, and a kernel only removes the staircase periods its frequency
 * response cancels. The 4-texel tent of `pcf3` leaves 17 % of a 2.75-texel staircase (an edge 20 degrees off the grid);
 * the 6-texel kernel of `pcf5` leaves under 4 % (`shadow-filter.test.ts`). On far cascades one texel is large on screen across the view and short along it
 * (Low cascade 1: 18.4 cm, about 10 x 2 px at 17 m), so that residue showed as a comb of horizontal teeth on every shadow
 * edge that runs away from the camera (S05 canopy, Low and Medium). Cascade 0 keeps `pcf3`: its texel is 2.3 cm and its
 * edges are seen close, where the narrower kernel is the sharper look. `tent4` on far cascades was worse (round 2).
 * `?shadowfilter=<id>` still sets every cascade, `?shadowfilter0=<id>` cascade 0 alone.
 */
export function defaultFarShadowFilter(settings: QualitySettings): ShadowFilterId {
  return settings.post.aa === "traa" ? "vogel5" : "pcf5";
}

/** Largest radius at which the four 1-texel boxes of `tent4` still tile (a 2 x 2 texel box, no hole in the kernel). */
export const TENT4_HOLE_FREE_RADIUS = 1;

/**
 * PCF radius in texels of a cascade running `filter` (read by three's Vogel disk and by `tent4`; the exact tents ignore it).
 * `tent4` is capped at its hole-free radius; the Vogel disk keeps the preset width (at most 3 with a temporal resolve, 2
 * without one to hide the dither).
 */
export function pcfRadiusFor(filter: ShadowFilterId, settings: QualitySettings): number {
  const width = settings.shadows.pcfWidthTexels;
  if (filter === "tent4") return Math.min(width, TENT4_HOLE_FREE_RADIUS);
  return Math.min(width, settings.post.aa === "traa" ? 3 : 2);
}

export interface CascadeInfo {
  readonly index: number;
  /** World size of one shadow texel (m). */
  texelM: number;
  /** Far end of the cascade (m). */
  endM: number;
}

export class SunRig {
  readonly key: DirectionalLight;
  readonly fill: HemisphereLight;
  readonly floor: AmbientLight;
  /** Cascades of the current CSM: texel size and far end, for the debug sidecar. */
  readonly cascadeInfo: CascadeInfo[] = [];
  /**
   * Shadow cameras of the cascades that cast this frame, in cascade order (empty while the key casts no shadow or the
   * cascades are not built). Their matrices are those of the last shadow render.
   */
  readonly cascadeCameras: Camera[] = [];

  private readonly scene: Scene;
  private csm: MoonShadowNode | null = null;
  private settings: QualitySettings | null = null;
  private shadowsOn = true;
  private filterId: ShadowFilterId = "vogel5";
  /** Kernel of cascade 0 (`?shadowfilter0=`); the other cascades run `filterId`. */
  private filterNearId: ShadowFilterId = "vogel5";
  /** `?shadowkernel=square`: the rule before round 4 (square kernel, normal offset on every receiver), for A/B captures. */
  private squareKernel = false;
  /** PCF radius (texels) of cascade 0 and of the other cascades. */
  private radiusNear = 1;
  private radiusFar = 1;
  private lastAspect = -1;
  private lastFov = -1;
  private lastFar = -1;
  private readonly _dir = new Vector3();
  /** Low-sun handover of terrain receivers (`?handover=1`; off by default, see `MoonShadowNode.lowSun`). */
  terrainHandover = false;

  constructor(scene: Scene) {
    this.scene = scene;
    this.key = new DirectionalLight(SUN_COLOUR, 1);
    this.key.name = "mc:key-light";
    this.key.castShadow = true;
    this.key.target.position.set(0, 0, 0);
    this.fill = new HemisphereLight(0xffffff, 0xffffff, 1);
    this.fill.name = "mc:regolith-fill";
    this.floor = new AmbientLight(FLOOR_COLOUR, 0);
    this.floor.name = "mc:far-side-floor";
    scene.add(this.key, this.key.target, this.fill, this.floor);
  }

  /**
   * Rebuilds what depends on the preset: cascade count, map size, far distance, PCF width. `knobs` (URL, `../look-knobs.ts`)
   * can switch the sun shadows off, pick the PCF kernel and override the radius; cascade count and map size knobs are already
   * folded into `settings` by `applyLookKnobs`.
   */
  applyQuality(settings: QualitySettings, knobs: LookKnobs = DEFAULT_LOOK_KNOBS): void {
    this.settings = settings;
    const shadows = settings.shadows;
    this.csm?.dispose();
    this.csm = null;
    this.cascadeInfo.length = 0;
    this.shadowsOn = sunShadowsEnabled(knobs);
    this.squareKernel = knobs.shadowKernelSquare;
    // `?shadowfilter=` sets every cascade, `?shadowfilter0=` cascade 0 alone; without knobs the preset's pair.
    this.filterId = knobs.shadowFilter ?? defaultFarShadowFilter(settings);
    this.filterNearId = knobs.shadowFilterNear ?? knobs.shadowFilter ?? defaultShadowFilter(settings);
    this.radiusNear = knobs.pcfRadius ?? pcfRadiusFor(this.filterNearId, settings);
    this.radiusFar = knobs.pcfRadius ?? pcfRadiusFor(this.filterId, settings);
    if (!this.shadowsOn) {
      this.key.shadow.shadowNode = undefined;
      this.key.castShadow = false;
      return;
    }

    const far = LIGHT_MARGIN_M + shadows.maxFarM * 1.5 + 50;
    const shadow = this.key.shadow;
    shadow.mapSize.set(shadows.cascadeSizePx, shadows.cascadeSizePx);
    shadow.camera.near = 0.5;
    shadow.camera.far = far;
    // PCF radius in texels (`pcfRadiusFor`); written per cascade per frame, like the biases.
    shadow.radius = this.radiusNear;
    // Both biases are written per cascade per frame from the texel of the cascade (`shadow-bias.ts`).
    shadow.bias = 0;
    shadow.normalBias = 0;

    const scratch: number[] = [];
    const split0 = Math.min(shadows.cascade0SplitM, shadows.maxFarM * 0.5);
    cascadeEndsM(shadows.cascades, split0, shadows.maxFarM, settings.preset === "ultra" ? 0.8 : 0.75, scratch);
    const splits = scratch.slice();
    for (let i = 0; i < shadows.cascades; i++) {
      this.cascadeInfo.push({ index: i, texelM: 0.02, endM: splits[i] ?? shadows.maxFarM });
    }

    const csm = new MoonShadowNode(this.key, {
      cascades: shadows.cascades,
      maxFar: shadows.maxFarM,
      mode: "custom",
      customSplitsCallback: (amount, _near, farM, target) => {
        cascadeEndsM(amount, Math.min(split0, farM * 0.5), farM, settings.preset === "ultra" ? 0.8 : 0.75, scratch);
        for (const end of scratch) target.push(end / farM);
      },
      lightMargin: LIGHT_MARGIN_M,
    });
    csm.fade = true;
    csm.debugEndsM = knobs.debugCascades ? this.cascadeInfo.map((info) => info.endM) : null;
    csm.onCascades = (lights) => this.attachFilter(lights);
    this.key.shadow.shadowNode = csm;
    this.csm = csm;
    this.lastAspect = -1;
  }

  /** Attaches the PCF kernel to the cloned cascade shadows (three reads `filterNode` when it builds each cascade). */
  private attachFilter(lights: CSMShadowNode["lights"]): void {
    // `null` keeps three's own filter for `renderer.shadowMap.type` (PCF: 5-tap Vogel disk with per-pixel dither).
    for (let i = 0; i < lights.length; i++) {
      // Receiver-aware kernel height: these are shadows of the key light (`shadow-filter.ts` `RECEIVER_KERNEL_K`).
      const filter = shadowFilterFor(i === 0 ? this.filterNearId : this.filterId, !this.squareKernel);
      const shadow = lights[i]?.shadow;
      if (filter !== null && shadow !== undefined) (shadow as unknown as { filterNode: unknown }).filterNode = filter;
    }
  }

  /**
   * Points the key at `directionToKey` (unit vector toward the sun or the Earth), colours and scales every light for the
   * key state, and updates the cascade bias rule (it follows the cascade texel, not the sun elevation). Call once per frame
   * after the camera moved.
   */
  update(camera: PerspectiveCamera | Camera, key: KeyState, directionToKey: Vector3, siteUp?: Vector3): void {
    const settings = this.settings;
    if (settings === null) return;
    const csm = this.csm;

    // Camera-dependent cascade fit.
    const persp = camera as PerspectiveCamera;
    if (
      csm !== null &&
      (persp.aspect !== this.lastAspect || persp.fov !== this.lastFov || persp.far !== this.lastFar)
    ) {
      this.lastAspect = persp.aspect;
      this.lastFov = persp.fov;
      this.lastFar = persp.far;
      if (csm.camera !== null) csm.updateFrustums();
    }

    // Direction (never exactly horizontal) and colour.
    // `siteUp`: local vertical of the scene's site (default +Y). The bounce fill's "up" follows it.
    this._dir.copy(directionToKey);
    const minSin = Math.sin(MIN_CSM_ELEVATION_RAD);
    if (siteUp === undefined) {
      if (this._dir.y < minSin) {
        this._dir.y = minSin;
        this._dir.normalize();
      }
      if (this.fill.position.y !== 1) this.fill.position.set(0, 1, 0);
    } else {
      const sinEl = this._dir.dot(siteUp);
      if (sinEl < minSin) this._dir.addScaledVector(siteUp, minSin - sinEl).normalize();
      this.fill.position.copy(siteUp);
    }
    this.fill.updateMatrixWorld();
    keyDirectionUniform.value.copy(this._dir);
    if (csm !== null) {
      const sinEl = siteUp === undefined ? directionToKey.y : directionToKey.dot(siteUp);
      const elevationDeg = Math.asin(Math.min(1, Math.max(-1, sinEl))) / DEG;
      csm.lowSun.value = this.terrainHandover && key.mode === "sun" ? lowSunHandover(elevationDeg) : 0;
      const end0 = this.cascadeInfo[0]?.endM ?? 10;
      csm.handoverStartM.value = end0 * 0.8;
      csm.handoverEndM.value = end0;
    }
    this.key.position.copy(this._dir).multiplyScalar(500);
    this.key.target.position.set(0, 0, 0);
    this.key.updateMatrixWorld();
    this.key.target.updateMatrixWorld();

    const mode = key.mode;
    this.key.color.copy(mode === "earth" ? EARTH_COLOUR : SUN_COLOUR);
    // A DirectionalLight's intensity is the illuminance on a surface FACING the light; the surface's N.L supplies sin(elevation)
    // for the ground. (`key.sunLux` is the flat-ground value and only drives the fill; using it here applied N.L twice.)
    // The sun fades over the terminator band (`sunTerminatorFraction`), so it is at 0 when the key hands over to the Earth.
    const normalLux = mode === "sun" ? key.sunNormalLux : mode === "earth" ? key.earthLux : 0;
    this.key.intensity = normalLux * key.scale;
    this.key.castShadow = this.shadowsOn && mode !== "floor";

    // Regolith bounce: a hemisphere with sky = 15 % and ground = 35 % of the key (vertical = 25 %).
    this.fill.color.copy(FILL_TINT).multiplyScalar(FILL_FRACTION.up);
    this.fill.groundColor.copy(FILL_TINT).multiplyScalar(FILL_FRACTION.down);
    this.fill.intensity = key.keyLux * key.scale;
    // Far-side floor, or the earthshine carried through the terminator band (cool Earth white, no shadows).
    this.floor.color.copy(key.floorIsEarth ? EARTH_COLOUR : FLOOR_COLOUR);
    this.floor.intensity = key.floorLux * key.scale;

    // Cascade texel sizes and the normal offset (it follows the texel, which changes with the camera), written to the CLONED
    // cascade shadows.
    this.cascadeCameras.length = 0;
    if (csm !== null) {
      const casting = this.key.castShadow && csm.camera !== null;
      for (let i = 0; i < csm.lights.length; i++) {
        const shadow = csm.lights[i]?.shadow;
        if (shadow === undefined) continue;
        // Own layer per cascade (a mask beyond layer 0 stops three copying the layers of the main camera onto it).
        shadow.camera.layers.enable(0);
        shadow.camera.layers.enable(KEY_CASCADE_LAYER_BASE + i);
        if (casting) this.cascadeCameras.push(shadow.camera);
        const width = shadow.camera.right - shadow.camera.left;
        const texel = texelWorldM(width, shadow.mapSize.width);
        const info = this.cascadeInfo[i];
        if (info !== undefined) info.texelM = texel;
        // The normal offset (metres along the surface normal, `shadow-bias.ts`) is applied per receiver by
        // `KeyCascadeShadowNode`: three's own `normalBias`, which would lift every receiver, stays 0.
        shadow.normalBias = this.squareKernel ? normalBiasM(texel) : 0;
        (shadow as unknown as Record<string, number>)[KEY_NORMAL_OFFSET_PROPERTY] = this.squareKernel
          ? 0
          : normalBiasM(texel);
        // bias is in the normalised depth of the cascade.
        shadow.bias = depthBias(texel, shadow.camera.far - shadow.camera.near);
        shadow.radius = i === 0 ? this.radiusNear : this.radiusFar;
      }
    }
  }

  /** `true` once the first frame has built the cascades. */
  get built(): boolean {
    return this.csm !== null && this.csm.camera !== null;
  }

  /** PCF kernel of the current cascades (`near+far` when cascade 0 runs its own). */
  get shadowFilter(): string {
    return this.filterNearId === this.filterId ? this.filterId : `${this.filterNearId}+${this.filterId}`;
  }

  /**
   * Edge in pixels of one cascade's shadow map: the depth target three allocated once the cascades are built (cascade 0;
   * every cascade is cloned from the same shadow), the size written from the preset before that. 0 with sun shadows off.
   * Reads only; for `__mcLook.info()` (VT-M0-03).
   */
  get shadowMapSizePx(): number {
    if (!this.shadowsOn || this.csm === null) return 0;
    const shadow = this.csm.lights[0]?.shadow ?? this.key.shadow;
    return shadow.map?.width ?? shadow.mapSize.width;
  }

  /** The CSM node (for debug views and tests). */
  get shadowNode(): MoonShadowNode | null {
    return this.csm;
  }

  dispose(): void {
    this.csm?.dispose();
    this.csm = null;
    this.key.shadow.shadowNode = undefined;
    this.key.removeFromParent();
    this.key.target.removeFromParent();
    this.key.dispose();
    this.fill.removeFromParent();
    this.fill.dispose();
    this.floor.removeFromParent();
    this.floor.dispose();
  }
}
