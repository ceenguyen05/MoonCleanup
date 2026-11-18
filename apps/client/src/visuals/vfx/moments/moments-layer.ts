// Render layer of the juicy moments (M1-W6-T03): ONE instanced draw of ground-flat quads (<= MomentFx.CAPACITY) that shows
// the Inspector's Stamp (hex outline drawn as a sweep, then the emblem landing with one overshoot, glow fade), the Assay
// ka-ching flash (lumen gold) and the Railshot launch glow. Unlit, additive, depth-tested, no depth write. The CPU writes
// the curve values of `moments.ts` into two reused instance attributes each frame, only while a moment is live; the mesh is
// hidden otherwise (zero cost while idle). Grains are the GrainLayer's draw, not this one.
//
// NOT visually verified: authored without a GPU. Colours are scene-linear after pre-exposure (like the sun disk), tuned by
// `radiance`; the capture agent adjusts geometry / brightness against VT-M1-22, VM-03, VM-04.

/* eslint-disable @typescript-eslint/no-explicit-any */
type TslNode = any;

import {
  abs,
  atan,
  attribute,
  exp,
  float,
  max,
  mix,
  positionGeometry,
  select,
  smoothstep,
  uniform,
  vec3,
  vec4,
} from "three/tsl";
import {
  AdditiveBlending,
  BufferAttribute,
  DoubleSide,
  DynamicDrawUsage,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Mesh,
  MeshBasicNodeMaterial,
  type Object3D,
} from "three/webgpu";
import {
  MOMENT_POUR,
  MOMENT_RAILSHOT,
  MOMENT_STAMP,
  MomentFx,
  pourFlash,
  railshotGlow,
  stampEmblemScale,
  stampGlow,
  stampOutlineProgress,
} from "./moments";

/** Quad half-extent relative to the effect radius (room for the outline glow). */
export const MOMENT_QUAD_SCALE = 1.25;
/** Lift above the ground (m) so the flat quad never z-fights the regolith. */
export const MOMENT_LIFT_M = 0.03;
/** Pour flash / Railshot glow world radius (m) for size = 1. */
export const FLASH_RADIUS_M = 1.2;
export const RAILSHOT_RADIUS_M = 3.5;
/** Scene-linear brightness of the effects. */
export const MOMENT_RADIANCE = 2.5;

const N = MomentFx.CAPACITY;

export class MomentsLayer {
  readonly mesh: Mesh;
  readonly material: MeshBasicNodeMaterial;
  /** Instance count last frame (live moments; slots are packed). */
  drawn = 0;

  private readonly geometry: InstancedBufferGeometry;
  private readonly a = new Float32Array(N * 4); // cx, cy, cz, radius
  private readonly b = new Float32Array(N * 4); // kind, outline progress / flash, emblem scale, glow
  private readonly aA: InstancedBufferAttribute;
  private readonly aB: InstancedBufferAttribute;
  private readonly radiance = uniform(MOMENT_RADIANCE);

  constructor() {
    const geometry = new InstancedBufferGeometry();
    geometry.setAttribute(
      "position",
      new BufferAttribute(new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]), 3),
    );
    geometry.setIndex([0, 1, 2, 0, 2, 3]);
    this.aA = new InstancedBufferAttribute(this.a, 4);
    this.aB = new InstancedBufferAttribute(this.b, 4);
    this.aA.setUsage(DynamicDrawUsage);
    this.aB.setUsage(DynamicDrawUsage);
    geometry.setAttribute("aMomA", this.aA);
    geometry.setAttribute("aMomB", this.aB);
    geometry.instanceCount = 0;
    this.geometry = geometry;
    this.material = this.buildMaterial();
    const mesh = new Mesh(geometry, this.material);
    mesh.name = "mc:moments";
    mesh.frustumCulled = false;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.renderOrder = 11;
    mesh.visible = false;
    this.mesh = mesh;
  }

  attachTo(parent: Object3D): void {
    parent.add(this.mesh);
  }

  /** Packs the live slots of `fx` into the instance attributes; hides the mesh when none is live. No allocation. */
  update(fx: MomentFx): void {
    let n = 0;
    for (let i = 0; i < N; i++) {
      const kind = fx.kind[i]!;
      if (kind < 0) continue;
      const age = fx.age[i]!;
      const o = n * 4;
      const size = fx.size[i]!;
      this.a[o] = fx.x[i]!;
      this.a[o + 1] = fx.y[i]! + MOMENT_LIFT_M;
      this.a[o + 2] = fx.z[i]!;
      this.b[o] = kind;
      if (kind === MOMENT_STAMP) {
        this.a[o + 3] = size;
        this.b[o + 1] = stampOutlineProgress(age);
        this.b[o + 2] = stampEmblemScale(age);
        this.b[o + 3] = stampGlow(age);
      } else if (kind === MOMENT_POUR) {
        this.a[o + 3] = FLASH_RADIUS_M * size;
        this.b[o + 1] = pourFlash(age);
        this.b[o + 2] = 0;
        this.b[o + 3] = 0;
      } else if (kind === MOMENT_RAILSHOT) {
        this.a[o + 3] = RAILSHOT_RADIUS_M * size;
        this.b[o + 1] = railshotGlow(age);
        this.b[o + 2] = 0;
        this.b[o + 3] = 0;
      } else continue;
      n++;
    }
    this.drawn = n;
    this.geometry.instanceCount = n;
    this.mesh.visible = n > 0;
    if (n > 0) {
      this.aA.clearUpdateRanges();
      this.aA.addUpdateRange(0, n * 4);
      this.aA.needsUpdate = true;
      this.aB.clearUpdateRanges();
      this.aB.addUpdateRange(0, n * 4);
      this.aB.needsUpdate = true;
    }
  }

  private buildMaterial(): MeshBasicNodeMaterial {
    const m = new MeshBasicNodeMaterial();
    m.name = "mc:moments";
    m.transparent = true;
    m.depthWrite = false;
    // The ground-flat quad winds clockwise seen from above (corner.y maps to world z): FrontSide culled it (found on GPU).
    m.side = DoubleSide;
    m.blending = AdditiveBlending;
    const A: TslNode = attribute("aMomA", "vec4");
    const B: TslNode = attribute("aMomB", "vec4");
    const corner: TslNode = positionGeometry.xy;
    const radius: TslNode = A.w;
    const world = vec3(
      A.x.add(corner.x.mul(radius).mul(MOMENT_QUAD_SCALE)),
      A.y,
      A.z.add(corner.y.mul(radius).mul(MOMENT_QUAD_SCALE)),
    );
    m.positionNode = select(radius.greaterThan(0), world, vec3(0, -1e4, 0));

    // Fragment in effect units: u in [-1.25, 1.25], 1 = effect radius.
    const u: TslNode = corner.mul(MOMENT_QUAD_SCALE);
    const kind: TslNode = B.x;
    const p1: TslNode = B.y;
    const p2: TslNode = B.z;
    const p3: TslNode = B.w;
    const r = u.length();

    // Stamp: hexagon (circumradius 1) outline swept by angle, emblem hex that lands, soft glow outside.
    const ap: TslNode = abs(u);
    const hex = max(ap.x.mul(0.8660254).add(ap.y.mul(0.5)), ap.y).div(0.8660254);
    const band = float(1).sub(smoothstep(0.0, 0.06, abs(hex.sub(1))));
    const ang = atan(u.y, u.x).div(6.2831853).add(0.5);
    const swept = float(1).sub(smoothstep(p1.sub(0.01), p1.add(0.01), ang));
    const outline = band.mul(swept);
    const emblemR = p2.mul(0.45);
    const emblem = select(
      p2.greaterThan(0),
      float(1).sub(smoothstep(emblemR.mul(0.94), max(emblemR, 0.001), hex)),
      float(0),
    );
    const glowSkirt = exp(abs(hex.sub(1)).mul(-9))
      .mul(0.25)
      .mul(p3)
      .mul(swept);
    const stamp = outline.mul(p3).add(emblem.mul(0.9)).add(glowSkirt);
    const gold = vec3(1.0, 0.72, 0.22);
    const stampCol = mix(gold, vec3(1.0, 0.93, 0.7), emblem);

    // Pour flash: lumen-gold radial pop. Railshot: wide warm glow with a bright core.
    const radial = exp(r.mul(r).mul(-5));
    const flashCol = gold.mul(radial).mul(p1);
    const railCol = vec3(1.0, 0.85, 0.55)
      .mul(exp(r.mul(r).mul(-3)).mul(0.5).add(radial.mul(0.5)))
      .mul(p1);

    const isStamp = kind.lessThan(0.5);
    const isPour = kind.lessThan(1.5);
    const col = select(isStamp, stampCol.mul(stamp), select(isPour, flashCol, railCol));
    const edge = float(1).sub(smoothstep(1.0, MOMENT_QUAD_SCALE, r));
    m.colorNode = vec4(col.mul(this.radiance).mul(edge), 1);
    return m;
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.geometry.dispose();
    this.material.dispose();
  }
}
