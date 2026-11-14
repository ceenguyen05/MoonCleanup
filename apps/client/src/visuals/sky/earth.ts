// Earth placeholder: a screen-space disk with a procedural blue-marble surface (original, no external texture, so no ledger
// row) lit by the sun direction: the phase falls out of the reconstructed sphere normal. Thin blue limb, soft terminator,
// faint earthshine on the dark side. Own exposure compensation (art-direction D-10) so it holds a readable luminance at every
// key. Replaced by the NASA Blue Marble KTX2 derivative in the asset-pipeline task.
//
// Why a disk and not a sphere mesh (M0 look-polish r2): a rectilinear projection stretches a sphere radially by
// 1 / cos(angle off the optical axis), so a mesh Earth near a frame corner was an egg (1.18 : 1 measured). The planet and its
// halo are quads expanded in CLIP space around the projected centre: a circle of the same pixel radius anywhere in the frame
// (the radius the angular diameter has on the optical axis). The sphere normal is rebuilt per pixel in a frame that is fixed
// in the WORLD (viewer direction + the camera's right / up projected onto the plane across it), so the continents do not
// slide over the disk when the camera turns.

import {
  Fn,
  cameraProjectionMatrix,
  cameraViewMatrix,
  cameraWorldMatrix,
  dot,
  float,
  fwidth,
  mix,
  mx_fractal_noise_float,
  normalize,
  positionGeometry,
  pow,
  saturate,
  smoothstep,
  uniform,
  uv,
  vec2,
  vec3,
  vec4,
} from "three/tsl";
import { AdditiveBlending, Mesh, MeshBasicNodeMaterial, PlaneGeometry, Vector3, type Node } from "three/webgpu";
import { EARTH_ALBEDO, SUN_LUX_NORMAL } from "../lighting/key-light";

/** Halo quad edge as a multiple of the Earth's diameter. */
const HALO_SPAN = 3.2;
/** Planet quad edge as a multiple of the Earth's diameter (room for the anti-aliased limb). */
const PLANET_SPAN = 1.06;

/**
 * NDC half-extent of a sky disk of angular radius atan(`tanRadius`) for a projection matrix (`elements` of a
 * `Matrix4`, column-major): the size the disk has on the optical axis, used everywhere in the frame. The CPU mirror of
 * the quad expansion in the vertex stage. Writes `out`.
 */
export function skyDiskRadiusNdc(tanRadius: number, elements: ArrayLike<number>, out: { x: number; y: number }): void {
  out.x = tanRadius * (elements[0] ?? 0);
  out.y = tanRadius * (elements[5] ?? 0);
}

export class Earth {
  /** The planet disk (alpha-blended over the stars and the halo). */
  readonly mesh: Mesh;
  /** Blue atmosphere glow around the limb, brighter on the sunlit side (additive quad drawn before the planet). */
  readonly halo: Mesh;

  private readonly geometry = new PlaneGeometry(1, 1);
  private readonly material: MeshBasicNodeMaterial;
  private readonly haloMaterial: MeshBasicNodeMaterial;
  /** Unit direction from the viewer to the Earth, the sky distance, and the tangent of the Earth's angular radius. */
  private readonly direction = uniform(new Vector3(0, 1, 0));
  private readonly distance = uniform(1000);
  private readonly tanRadius = uniform(0.02);
  private readonly sunDir = uniform(new Vector3(0, 1, 0));
  private readonly gain = uniform(1);
  private readonly haloStrength = uniform(0.5);

  constructor() {
    // Clip-space quad of half-extent `span` planet radii around the projected centre: round and of constant pixel size.
    const billboard = (span: number): Node<"vec4"> =>
      Fn(() => {
        const view = cameraViewMatrix.mul(vec4(this.direction, 0)).xyz.mul(this.distance);
        const centre = cameraProjectionMatrix.mul(vec4(view, 1));
        // Projection scale (1 / tan of the half field of view per axis): @types/three has no `element` on a mat4 uniform.
        const projection = cameraProjectionMatrix as unknown as { element(column: number): Node<"vec4"> };
        const scale = vec2(projection.element(0).x, projection.element(1).y);
        const offsetNdc = positionGeometry.xy
          .mul(2 * span)
          .mul(this.tanRadius)
          .mul(scale);
        return vec4(centre.xy.add(offsetNdc.mul(centre.w)), centre.z, centre.w);
      })() as Node<"vec4">;

    const material = new MeshBasicNodeMaterial();
    material.name = "mc:earth";
    material.transparent = true;
    material.depthWrite = false;
    material.fog = false;
    material.vertexNode = billboard(PLANET_SPAN);
    material.colorNode = Fn(() => {
      // Disk coordinate in planet radii (x right, y up on the screen) and the sphere normal it stands for.
      const q = uv()
        .sub(0.5)
        .mul(2 * PLANET_SPAN);
      const r = q.length();
      const z = float(1).sub(r.mul(r)).max(0).sqrt();
      const toViewer = this.direction.negate();
      const across = cameraWorldMatrix.mul(vec4(q, 0, 0)).xyz;
      const tangent = across.sub(toViewer.mul(dot(across, toViewer)));
      const n = normalize(tangent.div(tangent.length().max(1e-6)).mul(r.min(1)).add(toViewer.mul(z)));

      // Continents: low-frequency fractal noise; clouds: a second, offset field.
      const landNoise = mx_fractal_noise_float(n.mul(2.2).add(vec3(3.1, 1.7, 0.4)), 5, 2.0, 0.5, 1.0);
      const land = smoothstep(0.02, 0.1, landNoise);
      const shallow = smoothstep(-0.06, 0.02, landNoise);
      const cloudNoise = mx_fractal_noise_float(n.mul(3.3).add(vec3(9.2, 4.4, 7.7)), 5, 2.1, 0.55, 1.0);
      const cloud = smoothstep(0.1, 0.38, cloudNoise);
      const polar = smoothstep(0.78, 0.93, n.y.abs());

      const ocean = mix(vec3(0.012, 0.05, 0.19), vec3(0.03, 0.13, 0.32), shallow);
      const greenery = vec3(0.07, 0.15, 0.05);
      const desert = vec3(0.3, 0.22, 0.1);
      const arid = smoothstep(-0.2, 0.2, mx_fractal_noise_float(n.mul(4.0).add(vec3(1.3, 8.1, 2.2)), 3, 2.0, 0.5, 1.0));
      let surface = mix(ocean, mix(greenery, desert, arid), land);
      surface = mix(surface, vec3(0.9, 0.93, 0.95), polar);
      surface = mix(surface, vec3(0.95, 0.96, 0.98), cloud.mul(0.88));

      const ndl = dot(n, this.sunDir);
      const lit = smoothstep(-0.07, 0.28, ndl);
      const earthshine = float(0.012);
      const radiance = surface.mul(
        lit
          .mul(SUN_LUX_NORMAL / Math.PI)
          .mul(EARTH_ALBEDO / 0.3)
          .add(earthshine.mul(SUN_LUX_NORMAL / Math.PI)),
      );

      // Thin blue limb, brighter on the lit side (atmosphere rim, <= 3 % of the radius).
      const rim = pow(float(1).sub(saturate(z)), 5).mul(smoothstep(-0.25, 0.4, ndl));
      const limb = vec3(0.35, 0.6, 1.0)
        .mul(rim)
        .mul(float(SUN_LUX_NORMAL / Math.PI).mul(0.9));
      // Analytic limb: one pixel of coverage ramp, no geometric edge to alias.
      const coverage = saturate(float(1).sub(r).div(fwidth(r).max(1e-5)).add(0.5));
      return vec4(radiance.add(limb).mul(this.gain), coverage);
    })();
    this.material = material;
    this.mesh = new Mesh(this.geometry, material);
    this.mesh.name = "mc:earth";
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -10;

    // Halo: radial falloff outside the limb (planet radius = 1 / HALO_SPAN of the quad's half-extent), tinted blue, weighted
    // toward the sun-lit side. The planet disk is drawn over it, so it only shows beyond the limb.
    const halo = new MeshBasicNodeMaterial();
    halo.name = "mc:earth-halo";
    halo.transparent = true;
    halo.depthWrite = false;
    halo.fog = false;
    halo.blending = AdditiveBlending;
    halo.vertexNode = billboard(HALO_SPAN);
    halo.colorNode = Fn(() => {
      const p = uv().sub(0.5).mul(2);
      // Distance from the centre in planet radii (the quad's half-extent is HALO_SPAN planet radii).
      const planetRadii = p.length().mul(HALO_SPAN);
      const outside = saturate(planetRadii.sub(1));
      const falloff = float(1)
        .div(float(1).add(outside.mul(outside).mul(60)))
        .mul(float(1).sub(smoothstep(0.55, 1.0, planetRadii.sub(1).div(HALO_SPAN - 1))));
      // The lighting direction as the screen sees it (view-space x / y), for the sun-side weighting.
      const sunScreen = cameraViewMatrix.mul(vec4(this.sunDir, 0)).xy;
      const side = dot(p.div(p.length().max(1e-4)), sunScreen.div(sunScreen.length().max(1e-4)))
        .mul(0.5)
        .add(0.5);
      const lit = mix(float(0.18), float(1), smoothstep(0.1, 0.9, side));
      const colour = vec3(0.28, 0.5, 1.0).mul(float(SUN_LUX_NORMAL / Math.PI).mul(0.06));
      return vec4(colour.mul(falloff).mul(lit).mul(this.haloStrength).mul(this.gain), 1);
    })();
    this.haloMaterial = halo;
    this.halo = new Mesh(this.geometry, halo);
    this.halo.name = "mc:earth-halo";
    this.halo.frustumCulled = false;
    this.halo.renderOrder = -11;
  }

  /** Where the disk stands: unit `direction` from the viewer, sky `distanceM` (depth only) and the angular diameter. */
  place(direction: Vector3, distanceM: number, diameterDeg: number): void {
    this.direction.value.copy(direction);
    this.distance.value = distanceM;
    this.tanRadius.value = Math.tan((diameterDeg * Math.PI) / 360);
  }

  /**
   * `lightDirection`: unit vector toward the light that sets the phase; `gain`: pre-exposure with the Earth's own
   * compensation; `lit`: lit fraction of the disk (0..1), scales the halo.
   */
  update(lightDirection: Vector3, gain: number, lit = 1): void {
    this.sunDir.value.copy(lightDirection);
    this.gain.value = gain;
    this.haloStrength.value = 0.15 + 0.85 * Math.min(1, Math.max(0, lit));
  }

  dispose(): void {
    this.halo.removeFromParent();
    this.haloMaterial.dispose();
    this.mesh.removeFromParent();
    this.geometry.dispose();
    this.material.dispose();
  }
}
