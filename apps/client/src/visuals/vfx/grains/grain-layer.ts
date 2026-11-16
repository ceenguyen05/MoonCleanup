// Grains v0, GPU half (M1-W3-T07): one instanced draw of camera-facing, velocity-stretched round grain quads, lit as
// tiny spheres by the scene's own lights (key + fill + earthshine + lamps, shadows included) through a
// `MeshLambertNodeMaterial` with a per-fragment sphere normal. Works on WebGPU and WebGL2 alike (no compute): the
// position is the closed-form parabola of `grain-pool.ts`, evaluated per vertex from the launch attributes.
//
// Look (art-direction 3.6): grime-tinted, 1-3 cm, never below 2 output px (the radius grows with distance), coverage
// alpha with a one-pixel soft edge (no aliasing), 15 % glint grains that flash to 2x as they tumble, gone within
// VANISH_S of landing. Never mesh pebbles.
//
// Compositing after AA (rendering-pipeline 8.1 step 4) is the post chain's job: `layerScene` holds the mesh for a
// post-resolve layer pass; until the chain draws it, the mesh sits in the scene pass (`attachTo`).

/* eslint-disable @typescript-eslint/no-explicit-any */
type TslNode = any;

import {
  attribute,
  cameraProjectionMatrix,
  cameraViewMatrix,
  cameraWorldMatrix,
  float,
  fwidth,
  length,
  max,
  min,
  mix,
  modelWorldMatrix,
  modelWorldMatrixInverse,
  normalize,
  positionGeometry,
  pow,
  select,
  sin,
  smoothstep,
  sqrt,
  uniform,
  varying,
  vec2,
  vec3,
  vec4,
} from "three/tsl";
import {
  BufferAttribute,
  Color,
  DynamicDrawUsage,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Mesh,
  MeshLambertNodeMaterial,
  Scene,
  type Object3D,
  type WebGPURenderer,
} from "three/webgpu";
import { GRAIN_G, GRAIN_STRIDE, GrainPool, VANISH_S } from "./grain-pool";

/** Minimum on-screen grain diameter (output px; art-direction 3.6). */
export const MIN_GRAIN_PX = 2;
/** Grime tint of the grains, linear RGB: the regolith grime albedo, lifted (loose turned-up dust reads lighter). */
export const GRAIN_TINT: readonly [number, number, number] = [0.098 * 1.45, 0.083 * 1.45, 0.068 * 1.45];
/** Motion-stretch exposure (s): the quad stretches by |v| * this along its screen velocity. */
const STRETCH_S = 1 / 60;

export interface GrainLayerOptions {
  readonly capacity?: number;
  readonly seed?: number;
}

export class GrainLayer {
  readonly pool: GrainPool;
  readonly mesh: Mesh;
  readonly material: MeshLambertNodeMaterial;
  /** Scene for a post-resolve layer pass (after AA). Empty while the mesh is attached to the world. */
  readonly layerScene = new Scene();
  readonly tint = new Color(GRAIN_TINT[0], GRAIN_TINT[1], GRAIN_TINT[2]);
  readonly stats = { uploads: 0, uploadedGrains: 0 };

  private readonly geometry: InstancedBufferGeometry;
  private readonly aP0: InstancedBufferAttribute;
  private readonly aV0: InstancedBufferAttribute;
  private readonly aLook: InstancedBufferAttribute;
  private readonly timeU = uniform(0);
  private readonly heightPxU = uniform(720);
  private readonly range = { start: 0, count: 0 };

  constructor(options: GrainLayerOptions = {}) {
    const capacity = options.capacity ?? 4096;
    this.pool = new GrainPool(capacity, options.seed ?? 1);
    const geometry = new InstancedBufferGeometry();
    geometry.setAttribute(
      "position",
      new BufferAttribute(new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]), 3),
    );
    geometry.setIndex([0, 1, 2, 0, 2, 3]);
    this.aP0 = new InstancedBufferAttribute(this.pool.p0, GRAIN_STRIDE);
    this.aV0 = new InstancedBufferAttribute(this.pool.v0, GRAIN_STRIDE);
    this.aLook = new InstancedBufferAttribute(this.pool.look, GRAIN_STRIDE);
    for (const a of [this.aP0, this.aV0, this.aLook]) a.setUsage(DynamicDrawUsage);
    geometry.setAttribute("aGrainP0", this.aP0);
    geometry.setAttribute("aGrainV0", this.aV0);
    geometry.setAttribute("aGrainLook", this.aLook);
    geometry.instanceCount = 0;
    this.geometry = geometry;

    this.material = this.buildMaterial();
    const mesh = new Mesh(geometry, this.material);
    mesh.name = "mc:grains";
    mesh.frustumCulled = false;
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    mesh.renderOrder = 10;
    this.mesh = mesh;
  }

  private buildMaterial(): MeshLambertNodeMaterial {
    const m = new MeshLambertNodeMaterial();
    m.name = "mc:grains";
    m.transparent = true;
    m.depthWrite = false;
    const p0: TslNode = attribute("aGrainP0", "vec4");
    const v0: TslNode = attribute("aGrainV0", "vec4");
    const look: TslNode = attribute("aGrainLook", "vec4");
    const corner: TslNode = positionGeometry.xy;
    const t: TslNode = this.timeU;
    const camWorld: TslNode = cameraWorldMatrix;
    const camView: TslNode = cameraViewMatrix;
    const camProj: TslNode = cameraProjectionMatrix;
    const model: TslNode = modelWorldMatrix;
    const modelInv: TslNode = modelWorldMatrixInverse;

    const age: TslNode = t.sub(p0.w);
    const land: TslNode = v0.w;
    const alive = age.greaterThanEqual(0).and(age.lessThan(land.add(VANISH_S)));
    const a: TslNode = min(max(age, 0), land);
    const g: TslNode = float(GRAIN_G);
    const center = p0.xyz.add(v0.xyz.mul(a)).add(vec3(0, g.mul(a).mul(a).mul(-0.5), 0));
    const vel = vec3(v0.x, v0.y.sub(g.mul(a)), v0.z).mul(select(age.lessThan(land), float(1), float(0)));
    const shrink = float(1)
      .sub(max(age.sub(land), 0).div(VANISH_S))
      .clamp(0, 1);

    // Camera axes in world space; the screen-space velocity direction picks the stretch axis.
    const right = camWorld.element(0).xyz;
    const up = camWorld.element(1).xyz;
    const velW = model.mul(vec4(vel, 0)).xyz;
    const sv = vec2(velW.dot(right), velW.dot(up));
    const svLen = length(sv);
    const dir = select(svLen.greaterThan(1e-4), sv.div(max(svLen, 1e-4)), vec2(1, 0));
    const perp = vec2(dir.y.negate(), dir.x);

    // Radius: world size, grown so the grain never drops below MIN_GRAIN_PX on screen.
    const centerView = camView.mul(model).mul(vec4(center, 1));
    const depth = max(centerView.z.negate(), 0.05);
    const pxPerM = camProj.element(1).y.mul(this.heightPxU).mul(0.5).div(depth);
    const radius = max(look.x, float(MIN_GRAIN_PX * 0.5).div(pxPerM)).mul(shrink);
    const halfLen = radius.add(svLen.mul(STRETCH_S * 0.5));
    const along = dir.mul(corner.x).mul(halfLen);
    const across = perp.mul(corner.y).mul(radius);
    const offs = along.add(across);
    const offsetW = right.mul(offs.x).add(up.mul(offs.y));
    const offsetL = modelInv.mul(vec4(offsetW, 0)).xyz;
    m.positionNode = select(alive, center.add(offsetL), vec3(0, -1e4, 0));

    // Fragment: round coverage, sphere normal in view space (screen axes = view axes), glint tumble.
    const q: TslNode = varying(corner, "v_mcGrainCorner");
    const sdir: TslNode = varying(dir, "v_mcGrainDir");
    const r: TslNode = length(q);
    const edge = float(1).sub(r);
    const cover = smoothstep(0, max(fwidth(r), 1e-3), edge);
    const nxy = sdir.mul(q.x).add(vec2(sdir.y.negate(), sdir.x).mul(q.y));
    const nz = sqrt(max(float(1).sub(r.mul(r)), 0));
    m.normalNode = normalize(vec3(nxy, nz));
    const tint = uniform(this.tint);
    const glint: TslNode = varying(look.z, "v_mcGrainGlint");
    const phase: TslNode = varying(look.w.add(age.mul(9)), "v_mcGrainPhase");
    const flash = pow(sin(phase).mul(0.5).add(0.5), 8).mul(glint);
    const bright: TslNode = varying(look.y, "v_mcGrainBright");
    m.colorNode = vec4(tint.mul(bright).mul(mix(float(1), float(2), flash)), cover);
    return m;
  }

  /** Puts the mesh in the scene pass under `parent` (until the post chain composites `layerScene` after AA). */
  attachTo(parent: Object3D): void {
    parent.add(this.mesh);
  }

  /** Per frame: advance the clock, upload the grains written since the last frame, size the 2 px floor. */
  update(dt: number, renderer: WebGPURenderer | null): void {
    const pool = this.pool;
    pool.advance(dt);
    this.timeU.value = pool.time;
    if (renderer !== null) this.heightPxU.value = renderer.domElement.height || 720;
    const range = this.range;
    if (pool.takeDirty(range)) {
      const s = range.start * GRAIN_STRIDE;
      const c = range.count * GRAIN_STRIDE;
      for (const attr of [this.aP0, this.aV0, this.aLook]) {
        attr.clearUpdateRanges();
        attr.addUpdateRange(s, c);
        attr.needsUpdate = true;
      }
      this.stats.uploads++;
      this.stats.uploadedGrains += range.count;
    }
    this.geometry.instanceCount = pool.used;
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.geometry.dispose();
    this.material.dispose();
  }
}
