// Star field: one merged quad mesh (4 vertices per star), billboarded in CLIP space with a pixel-sized Gaussian disk of
// radius >= 1.2 px (rendering-pipeline.md section 6, VT-M0-13). Additive, depth-tested, no twinkle.
//
// The quads are built from the camera matrices in the vertex stage (direction only: stars are at infinity, the mesh's own
// transform is not used), so a star is the same round, pixel-sized disk anywhere in the frame (a world-space quad on the
// unit sphere grows and stretches toward the frame corners) and follows the camera of the very render call that draws it.
//
// Two draw modes (M0 look-polish r2):
//   scene   the mesh sits in the sky group and is drawn inside the HDR scene pass (SMAA presets, zero extra cost).
//   layer   the mesh sits in `layerScene`, which the post chain renders AFTER the temporal resolve at output resolution
//           (`post/look-stages.ts`). A temporal resolve reprojects and variance-clips its history, which costs a 2 px
//           Gaussian a quarter of its peak whenever the camera pans; a layer added after the resolve is not touched by it.
//           The resolve jitters the camera for every pass of the frame, so the layer cancels that jitter in clip space
//           (`unjitter`); terrain occlusion comes from the prepass depth in the composite, the Earth's disk from
//           `earthDirection` here (in scene mode the Earth quad simply draws over the stars).
//
// Peak stability: a Gaussian sampled at pixel centres loses peak when its centre falls between pixels (sigma 0.8 px: up to
// 18 % on one axis). Half of that loss is given back per star from the sub-pixel position of its centre (`PEAK_COMPENSATION`),
// which splits the residual between peak and total flux instead of leaving all of it in the peak.
//
// The magnitude limit fades stars out as the exposure rises (m_lim model).

import {
  Fn,
  attribute,
  cameraProjectionMatrix,
  cameraViewMatrix,
  exp,
  float,
  fract,
  positionGeometry,
  renderGroup,
  screenSize,
  smoothstep,
  step,
  uniform,
  varying,
  vec4,
} from "three/tsl";
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Mesh,
  MeshBasicNodeMaterial,
  Scene,
  Vector2,
  Vector3,
  type Camera,
  type Node,
  type Object3D,
  type PerspectiveCamera,
} from "three/webgpu";
import { generateStars, starPeak, starRadiusPx, type StarCatalog } from "./star-catalog";

/** Gaussian sigma as a fraction of the star's radius in pixels (radius 1.2 .. 2.0 px -> sigma 0.8 .. 1.3 px). */
export const STAR_SIGMA_PER_RADIUS = 0.66;
/** Share of the sub-pixel peak loss that is given back (0 = constant flux, 1 = constant peak). */
export const PEAK_COMPENSATION = 0.5;
/** Quad half-extent beyond two star radii, pixels. */
const QUAD_MARGIN_PX = 0.8;

/** View offset a temporal resolve puts on the camera (three `PerspectiveCamera.view`). */
interface ViewOffset {
  readonly enabled: boolean;
  readonly fullWidth: number;
  readonly fullHeight: number;
  readonly offsetX: number;
  readonly offsetY: number;
}

/**
 * NDC shift that cancels a camera view offset (the TRAA jitter): `setViewOffset` moves the image by
 * (-2 offsetX / fullWidth, +2 offsetY / fullHeight) in NDC, this returns the opposite. Writes `out`; (0, 0) without an offset.
 */
export function viewOffsetCancelNdc(view: ViewOffset | null | undefined, out: { x: number; y: number }): void {
  if (view === null || view === undefined || !view.enabled || view.fullWidth <= 0 || view.fullHeight <= 0) {
    out.x = 0;
    out.y = 0;
    return;
  }
  out.x = (2 * view.offsetX) / view.fullWidth;
  out.y = (-2 * view.offsetY) / view.fullHeight;
}

/** Peak of a unit Gaussian of `sigmaPx` sampled at the pixel centre nearest to a centre `offsetPx` away (one axis). */
export function sampledPeak(sigmaPx: number, offsetPx: number, compensation = PEAK_COMPENSATION): number {
  const loss = (offsetPx * offsetPx) / (2 * sigmaPx * sigmaPx);
  return Math.exp(-loss * (1 - compensation));
}

export class StarField {
  readonly mesh: Mesh;
  readonly catalog: StarCatalog;
  /** Holds the mesh while the stars are drawn as a layer after the temporal resolve (`setLayerMode(true)`). */
  readonly layerScene = new Scene();

  private readonly geometry: BufferGeometry;
  private readonly material: MeshBasicNodeMaterial;
  private readonly distance = uniform(1000);
  private readonly limit = uniform(6.5);
  private readonly gain = uniform(1);
  /** Unit direction of the Earth and the tangent of its angular radius (negative: no Earth to hide behind). */
  private readonly earthDir = uniform(new Vector3(0, 1, 0));
  private readonly earthTan = uniform(-1);
  /** 1 while the stars are a post-resolve layer: the camera jitter of the frame is cancelled. */
  private layer = false;
  private readonly unjitter = uniform(new Vector2(0, 0))
    .setGroup(renderGroup)
    .onRenderUpdate((frame, self) => {
      const camera = (frame as { camera?: Camera | null }).camera as (Camera & { view?: ViewOffset | null }) | null;
      viewOffsetCancelNdc(this.layer ? camera?.view : null, (self as { value: Vector2 }).value);
    });

  constructor(catalog: StarCatalog = generateStars()) {
    this.catalog = catalog;
    this.layerScene.name = "mc:star-layer";
    const n = catalog.count;
    const position = new Float32Array(n * 4 * 3);
    const corner = new Float32Array(n * 4 * 2);
    const data = new Float32Array(n * 4 * 4);
    const colour = new Float32Array(n * 4 * 3);
    const index = new Uint32Array(n * 6);
    const corners = [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ] as const;
    for (let i = 0; i < n; i++) {
      const dx = catalog.dirs[i * 3] ?? 0;
      const dy = catalog.dirs[i * 3 + 1] ?? 0;
      const dz = catalog.dirs[i * 3 + 2] ?? 0;
      const mag = catalog.mag[i] ?? 6.5;
      for (let c = 0; c < 4; c++) {
        const v = i * 4 + c;
        position[v * 3] = dx;
        position[v * 3 + 1] = dy;
        position[v * 3 + 2] = dz;
        corner[v * 2] = corners[c]?.[0] ?? 0;
        corner[v * 2 + 1] = corners[c]?.[1] ?? 0;
        data[v * 4] = starPeak(mag);
        data[v * 4 + 1] = mag;
        data[v * 4 + 2] = starRadiusPx(mag);
        colour[v * 3] = catalog.colour[i * 3] ?? 1;
        colour[v * 3 + 1] = catalog.colour[i * 3 + 1] ?? 1;
        colour[v * 3 + 2] = catalog.colour[i * 3 + 2] ?? 1;
      }
      const b = i * 4;
      index.set([b, b + 1, b + 2, b, b + 2, b + 3], i * 6);
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new BufferAttribute(position, 3));
    geometry.setAttribute("aCorner", new BufferAttribute(corner, 2));
    geometry.setAttribute("aStar", new BufferAttribute(data, 4));
    geometry.setAttribute("aTint", new BufferAttribute(colour, 3));
    geometry.setIndex(new BufferAttribute(index, 1));
    this.geometry = geometry;

    const aCorner = attribute("aCorner", "vec2");
    const aStar = attribute("aStar", "vec4");
    const aTint = attribute("aTint", "vec3");

    // Clip-space centre of a unit direction at the sky distance (rotation only: w = 0 through the view matrix).
    const clipOf = (direction: Node<"vec3">) =>
      cameraProjectionMatrix.mul(vec4(cameraViewMatrix.mul(vec4(direction, 0)).xyz.mul(this.distance), 1));
    const centre = clipOf(positionGeometry);
    // Quad half-extent: 2 radii plus a margin (the Gaussian is below 0.2 % of its peak at the quad's edge).
    const extentPx = aStar.z.mul(2).add(QUAD_MARGIN_PX);
    const sigma = aStar.z.mul(STAR_SIGMA_PER_RADIUS);

    // Per-star factor from the vertex stage: sub-pixel peak compensation and the Earth's disk.
    const perStar = varying(
      Fn(() => {
        const ndc = centre.xy.div(centre.w).add(this.unjitter);
        const px = ndc.mul(0.5).add(0.5).mul(screenSize);
        const off = fract(px).sub(0.5);
        const compensation = exp(off.dot(off).div(sigma.mul(sigma).mul(2)).mul(PEAK_COMPENSATION));
        // Earth: a disk of constant pixel radius around its projected centre (see `earth.ts`).
        const earth = clipOf(this.earthDir);
        const earthNdc = earth.xy.div(earth.w).add(this.unjitter);
        const distPx = ndc.sub(earthNdc).mul(0.5).mul(screenSize).length();
        // Projection scale of the y axis (1 / tan(fov / 2)): @types/three has no `element` on a mat4 uniform.
        const projection = cameraProjectionMatrix as unknown as { element(column: number): Node<"vec4"> };
        const radiusPx = this.earthTan.mul(projection.element(1).y).mul(screenSize.y).mul(0.5);
        const outside = smoothstep(radiusPx.sub(1), radiusPx.add(1), distPx);
        const clear = float(1).sub(step(0.001, earth.w).mul(float(1).sub(outside)));
        return compensation.mul(clear);
      })(),
    );

    const material = new MeshBasicNodeMaterial();
    material.name = "mc:stars";
    material.transparent = true;
    material.depthWrite = false;
    material.depthTest = true;
    material.fog = false;
    material.blending = AdditiveBlending;
    material.vertexNode = Fn(() => {
      const offsetNdc = aCorner.mul(extentPx).mul(2).div(screenSize);
      return vec4(centre.xy.add(offsetNdc.add(this.unjitter).mul(centre.w)), centre.z, centre.w);
    })();
    material.colorNode = Fn(() => {
      const d2 = aCorner.dot(aCorner).mul(extentPx).mul(extentPx);
      const g = exp(d2.negate().div(sigma.mul(sigma).mul(2)));
      const visible = float(1).sub(smoothstep(this.limit.sub(0.5), this.limit, aStar.y));
      return vec4(aTint.mul(aStar.x).mul(g).mul(visible).mul(this.gain).mul(perStar), 1);
    })();
    this.material = material;

    const mesh = new Mesh(geometry, material);
    mesh.name = "mc:star-field";
    mesh.frustumCulled = false;
    mesh.renderOrder = -20;
    this.mesh = mesh;
  }

  /** `true` while the stars are drawn as a post-resolve layer. */
  get layerMode(): boolean {
    return this.layer;
  }

  /**
   * Moves the mesh between the sky group (`sceneParent`, drawn inside the scene pass) and `layerScene` (drawn by the post
   * chain after the temporal resolve). `sceneParent = null` (the stars are hidden by a knob) leaves it detached in scene mode.
   */
  setLayerMode(layer: boolean, sceneParent: Object3D | null): void {
    this.layer = layer;
    if (layer) this.layerScene.add(this.mesh);
    else if (sceneParent !== null) sceneParent.add(this.mesh);
    else this.mesh.removeFromParent();
  }

  /**
   * Per-frame: sky distance, limiting magnitude, an overall gain (1 by default) and the Earth's disk (`earthDirection` unit
   * vector, `earthDiameterDeg`; `null` = no Earth in the sky). The camera matrices are read by the shader at draw time.
   */
  update(
    camera: PerspectiveCamera,
    limitingMagnitude: number,
    gain = 1,
    earthDirection: Vector3 | null = null,
    earthDiameterDeg = 0,
  ): void {
    this.distance.value = camera.far * 0.7;
    this.limit.value = limitingMagnitude;
    this.gain.value = gain;
    if (earthDirection !== null && earthDiameterDeg > 0) {
      this.earthDir.value.copy(earthDirection);
      this.earthTan.value = Math.tan((earthDiameterDeg * Math.PI) / 360);
    } else {
      this.earthTan.value = -1;
    }
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.geometry.dispose();
    this.material.dispose();
  }
}
