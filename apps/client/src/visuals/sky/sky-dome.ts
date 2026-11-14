// Backdrop of the sky (REFERENCE mode, M0-W3-T03b): a night-blue space gradient with a soft horizon glow, a faint warm lift
// toward the sun and a nebula-tinted star band, drawn first behind stars, Earth and sun. It is a stylised "readable space"
// backdrop (reference mood: blue nebula-tinted sky), not atmosphere: nothing here scatters light onto the ground and nothing
// is fogged. The values are display-relative scene-linear (the buffer is pre-exposed), so they do not follow the EV100.
//
// Cost (M0-W3-T08): the dome covers every pixel of the frame before the ground is drawn over it. The static part of the look
// (vertical gradient + nebula = 7 octaves of 3D fractal noise) is therefore BAKED once per renderer into a small half-float
// equirect texture of the upper hemisphere (`bake`), and the per-pixel work is one texture fetch plus the analytic sun glow
// (the only term that moves). The bake renders the very same node graph, so the look is the procedural one resampled at
// 0.35 degrees per texel. `mode: "procedural"` (`?skydome=procedural`) keeps the per-pixel path for A/B; it is also what is
// shown until a renderer has been bound, and the fallback when the bake fails.

import {
  Fn,
  cameraPosition,
  cos,
  exp,
  float,
  max,
  mix,
  mx_fractal_noise_float,
  positionWorld,
  pow,
  sin,
  smoothstep,
  texture,
  uniform,
  uv,
  vec2,
  vec3,
  vec4,
} from "three/tsl";
import {
  BackSide,
  ClampToEdgeWrapping,
  HalfFloatType,
  LinearFilter,
  Mesh,
  MeshBasicNodeMaterial,
  QuadMesh,
  RenderTarget,
  RepeatWrapping,
  SphereGeometry,
  Vector3,
  type Node,
  type WebGPURenderer,
} from "three/webgpu";
import type { SkyDomeMode } from "../look-knobs";

/** Scene-linear colour stops (display-relative). Tunable: see the T03b report for the measured codes. */
export const SKY_ZENITH = [0.0016, 0.0032, 0.0105] as const;
export const SKY_MID = [0.006, 0.0095, 0.026] as const;
export const SKY_HORIZON = [0.036, 0.046, 0.088] as const;
export const SKY_SUN_GLOW = [0.15, 0.078, 0.04] as const;
export const SKY_NEBULA = [0.018, 0.012, 0.04] as const;

/** Baked backdrop: 360 degrees of azimuth by 0..90 degrees of elevation (below the horizon the horizon row repeats). */
export const SKY_BAKE_WIDTH = 1024;
export const SKY_BAKE_HEIGHT = 256;
/** GPU bytes of the baked backdrop (RGBA16F, no mips). */
export const SKY_BAKE_BYTES = SKY_BAKE_WIDTH * SKY_BAKE_HEIGHT * 8;

// The graph mixes float / vec3 freely and is built once per material: typed loosely on purpose.
/* eslint-disable @typescript-eslint/no-explicit-any */
type TslNode = any;

/** Static part of the backdrop for a unit direction `d` (world space, +Y up): vertical gradient plus nebula band. */
function staticBackdrop(d: TslNode): TslNode {
  const up: TslNode = max(d.y, 0);
  // Vertical gradient: a thin bright horizon band (about 12 degrees) over a wider deep-blue shoulder.
  const bandT = pow(float(1).sub(up), 9);
  const shoulderT = pow(float(1).sub(up), 2.6);
  const base = mix(vec3(...SKY_ZENITH), vec3(...SKY_MID), shoulderT);
  const withHorizon = mix(base, vec3(...SKY_HORIZON), bandT);

  // Nebula band: a tilted great circle, broken up by noise; blue-violet, faint, never brighter than the horizon band.
  const axis = vec3(0.34, 0.86, 0.38).normalize();
  const across: TslNode = d.dot(axis);
  const bandMask = exp(across.mul(across).mul(-9));
  const cloud = mx_fractal_noise_float(d.mul(3.1).add(vec3(2.3, 7.1, 4.4)), 4, 2.1, 0.55, 1.0)
    .mul(0.5)
    .add(0.5);
  const fine = mx_fractal_noise_float(d.mul(11).add(vec3(5.0, 1.0, 9.0)), 3, 2.0, 0.5, 1.0)
    .mul(0.5)
    .add(0.5);
  const nebula = vec3(...SKY_NEBULA)
    .mul(bandMask)
    .mul(smoothstep(0.25, 0.8, cloud).mul(0.8).add(fine.mul(0.25)))
    .mul(smoothstep(-0.05, 0.35, d.y));
  return withHorizon.add(nebula);
}

/** Warm lift toward the sun azimuth, strongest along the horizon (reads as a lunar-dawn glow, not scattering). */
function sunGlow(d: TslNode, sunDir: TslNode, sunUp: TslNode): TslNode {
  const low: TslNode = float(1).sub(max(d.y, 0));
  const glow = exp(
    float(-1)
      .mul(float(1).sub(d.dot(sunDir)))
      .mul(15),
  )
    .mul(low.mul(low).mul(low))
    .mul(sunUp);
  return vec3(...SKY_SUN_GLOW).mul(glow);
}

/**
 * Unit direction of a baked texel: `u` is the azimuth fraction and `t` the elevation fraction (0 = horizon, 1 = zenith), in
 * the parametrisation of three's `SphereGeometry` so the dome's own `uv` attribute addresses the texture with no per-pixel
 * trigonometry. Exported for the unit test (same formula on the CPU: `skyBakeDirection`).
 */
function bakeDirection(u: TslNode, t: TslNode): TslNode {
  const phi: TslNode = u.mul(Math.PI * 2);
  const theta: TslNode = float(1)
    .sub(t)
    .mul(Math.PI / 2);
  const ring: TslNode = sin(theta);
  const x: TslNode = cos(phi).negate().mul(ring);
  const y: TslNode = cos(theta);
  const z: TslNode = sin(phi).mul(ring);
  return (vec3 as (...parts: TslNode[]) => TslNode)(x, y, z);
}

/** CPU twin of the bake parametrisation: direction of (u, t), written into `out`. */
export function skyBakeDirection(u: number, t: number, out: { x: number; y: number; z: number }): void {
  const phi = u * Math.PI * 2;
  const theta = (1 - t) * (Math.PI / 2);
  const ring = Math.sin(theta);
  out.x = -Math.cos(phi) * ring;
  out.y = Math.cos(theta);
  out.z = Math.sin(phi) * ring;
}

/** CPU twin of the dome lookup: (u, t) of a `SphereGeometry` vertex uv (`uv.y` = 1 at the zenith, 0.5 at the horizon). */
export function skyBakeCoordOfSphereUv(uvX: number, uvY: number, out: { u: number; t: number }): void {
  out.u = uvX;
  out.t = Math.min(1, Math.max(0, (uvY - 0.5) * 2));
}

export class SkyDome {
  readonly mesh: Mesh;

  private readonly requested: SkyDomeMode;
  private readonly geometry = new SphereGeometry(1, 64, 32);
  private readonly procedural: MeshBasicNodeMaterial;
  private baked: MeshBasicNodeMaterial | null = null;
  private bakedLookup: { value: unknown } | null = null;
  private target: RenderTarget | null = null;
  private readonly sunDir = uniform(new Vector3(0, 0, 1));
  private readonly level = uniform(1);
  private readonly sunUp = uniform(1);

  constructor(mode: SkyDomeMode = "baked") {
    this.requested = mode;
    this.procedural = this.createMaterial("mc:sky-dome", (d) => staticBackdrop(d));
    this.mesh = new Mesh(this.geometry, this.procedural);
    this.mesh.name = "mc:sky-dome";
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -100;
  }

  /** Path the dome is drawn with right now: `baked` only after a successful `bake`. */
  get mode(): SkyDomeMode {
    return this.mesh.material === this.baked ? "baked" : "procedural";
  }

  /** GPU bytes held by the baked backdrop (0 on the procedural path). */
  get bakedBytes(): number {
    return this.target === null ? 0 : SKY_BAKE_BYTES;
  }

  /**
   * Renders the static backdrop into the bake texture of `renderer` and switches the dome to the one-fetch material. Call it
   * when a renderer is (re)bound: the texture of a lost device is gone, so every new renderer gets its own bake. No-op in
   * procedural mode. On failure the procedural material stays (same look, per-pixel cost) and the error is logged once.
   */
  bake(renderer: WebGPURenderer): void {
    if (this.requested !== "baked") return;
    this.releaseTarget();
    const target = new RenderTarget(SKY_BAKE_WIDTH, SKY_BAKE_HEIGHT, { type: HalfFloatType, depthBuffer: false });
    target.texture.name = "mc:sky-backdrop";
    target.texture.wrapS = RepeatWrapping;
    target.texture.wrapT = ClampToEdgeWrapping;
    target.texture.minFilter = LinearFilter;
    target.texture.magFilter = LinearFilter;
    target.texture.generateMipmaps = false;

    const bakeMaterial = new MeshBasicNodeMaterial();
    bakeMaterial.name = "mc:sky-bake";
    bakeMaterial.depthTest = false;
    bakeMaterial.depthWrite = false;
    bakeMaterial.fog = false;
    // Quad uv.y runs top-down; the row a lookup at (u, t) reads is the row rendered at quad uv (u, t).
    bakeMaterial.colorNode = Fn(() => vec4(staticBackdrop(bakeDirection(uv().x, uv().y)), 1))();
    const quad = new QuadMesh(bakeMaterial);
    const previous = renderer.getRenderTarget();
    try {
      renderer.setRenderTarget(target);
      quad.render(renderer);
    } catch (error) {
      console.warn(`[sky] backdrop bake failed, keeping the procedural dome: ${String(error)}`);
      target.dispose();
      bakeMaterial.dispose();
      renderer.setRenderTarget(previous);
      this.mesh.material = this.procedural;
      return;
    }
    renderer.setRenderTarget(previous);
    bakeMaterial.dispose();
    this.target = target;

    if (this.baked === null) {
      const lookup = texture(target.texture);
      this.bakedLookup = lookup as unknown as { value: unknown };
      // The sphere's own uv is the bake parametrisation: uv.x = azimuth fraction, uv.y = 1 zenith .. 0.5 horizon.
      const coord = vec2(uv().x, uv().y.sub(0.5).mul(2).clamp(0, 1));
      this.baked = this.createMaterial("mc:sky-dome-baked", () => (lookup as TslNode).sample(coord).rgb);
    } else if (this.bakedLookup !== null) {
      this.bakedLookup.value = target.texture;
    }
    this.mesh.material = this.baked;
  }

  /** `level`: overall brightness (1 by day, lower at night); `sunDirection`: unit vector toward the sun (warm lift). */
  update(sunDirection: Vector3, level: number, sunAbove: boolean): void {
    this.sunDir.value.copy(sunDirection);
    this.level.value = level;
    this.sunUp.value = sunAbove ? 1 : 0;
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.geometry.dispose();
    this.procedural.dispose();
    this.baked?.dispose();
    this.baked = null;
    this.bakedLookup = null;
    this.releaseTarget();
  }

  private releaseTarget(): void {
    const target = this.target;
    this.target = null;
    if (target === null) return;
    try {
      target.dispose();
    } catch {
      // The device that held it may already be gone.
    }
  }

  private createMaterial(name: string, backdrop: (d: TslNode) => TslNode): MeshBasicNodeMaterial {
    const material = new MeshBasicNodeMaterial();
    material.name = name;
    material.side = BackSide;
    material.depthWrite = false;
    material.depthTest = false;
    material.fog = false;
    material.colorNode = Fn(() => {
      const d: TslNode = positionWorld.sub(cameraPosition).normalize();
      const colour: TslNode = backdrop(d).add(sunGlow(d, this.sunDir, this.sunUp));
      return vec4(colour.mul(this.level), 1);
    })() as Node<"vec4">;
    return material;
  }
}
