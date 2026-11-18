// Trundle presenter (M1-W7-T02): puts the own Trundle in the world (driven: the predicted chassis; parked after a Motor
// Pool call: the 10 Hz read-out pose), spins drum and wheels from the ground speed, and throws the brush-drum spray on
// its own small grain layer while the sim's intake is working. Presentation only: it reads poses, never decides
// anything. Allocation-free per frame (scratch vectors and arrays are reused).

import { Matrix4, Vector3, type Object3D, type WebGPURenderer } from "three/webgpu";
import { GrainLayer } from "../grains";
import { DrumSpray } from "./drum-spray";
import {
  TRUNDLE_DRUM_FRONT_M,
  TRUNDLE_DRUM_RADIUS_M,
  TRUNDLE_WHEEL_RADIUS_M,
  buildTrundle,
  disposeTrundle,
  type TrundleParts,
} from "./trundle-model";

/** What the presenter reads each frame: chassis ground point (sim, moon-centred m), heading, speed and intake work. */
export class TrundlePoseOut {
  px = 0;
  py = 0;
  pz = 0;
  fx = 1;
  fy = 0;
  fz = 0;
  /** Signed ground speed, m/s. */
  speed = 0;
  /** Intake intensity 0..1 (sim `vehicleMotion.workIntensity01`; 0 while idle). */
  work01 = 0;
  /** Headlamps lit. */
  lights = false;
}

export interface TrundlePoseSource {
  /** Fills `out`; false = no Trundle to show. */
  read(out: TrundlePoseOut): boolean;
}

/** The render mapper's structural subset (gameplay `RenderMapper`). */
export interface TrundleMapper {
  point(src: Float64Array, so: number, out: Float64Array, o: number): void;
  direction(src: Float64Array, so: number, out: Float64Array, o: number): void;
}

/** Right-handed basis (right, up, forward) from a heading and an up hint, in `out` (3 + 3 + 3). Pure, for tests. */
export function trundleBasis(
  fx: number,
  fy: number,
  fz: number,
  ux: number,
  uy: number,
  uz: number,
  out: Float64Array,
): void {
  let ul = Math.hypot(ux, uy, uz);
  if (ul < 1e-9) {
    ux = 0;
    uy = 1;
    uz = 0;
    ul = 1;
  }
  ux /= ul;
  uy /= ul;
  uz /= ul;
  // right = up x forward
  let rx = uy * fz - uz * fy;
  let ry = uz * fx - ux * fz;
  let rz = ux * fy - uy * fx;
  const rl = Math.hypot(rx, ry, rz);
  if (rl < 1e-9) {
    // heading parallel to up: any perpendicular
    rx = 1;
    ry = 0;
    rz = 0;
  } else {
    rx /= rl;
    ry /= rl;
    rz /= rl;
  }
  // forward = right x up
  const gx = ry * uz - rz * uy;
  const gy = rz * ux - rx * uz;
  const gz = rx * uy - ry * ux;
  out[0] = rx;
  out[1] = ry;
  out[2] = rz;
  out[3] = ux;
  out[4] = uy;
  out[5] = uz;
  out[6] = gx;
  out[7] = gy;
  out[8] = gz;
}

const defaultLoad = async (): Promise<TrundleParts> => (await import("./trundle-glb")).loadTrundleGlb();

export class TrundlePresenter {
  parts: TrundleParts;
  readonly grains = new GrainLayer({ capacity: 512, seed: 11 });
  readonly spray = new DrumSpray();
  private readonly pose = new TrundlePoseOut();
  private readonly src = new Float64Array(3);
  private readonly pos = new Float64Array(3);
  private readonly dir = new Float64Array(3);
  private readonly up = new Float64Array(3);
  private readonly basis = new Float64Array(9);
  private readonly right = new Vector3();
  private readonly upV = new Vector3();
  private readonly fwdV = new Vector3();
  private readonly posV = new Vector3();
  private readonly m = new Matrix4();
  private spinRad = 0;
  private world: Object3D | null = null;
  private disposed = false;
  /** Load the authored GLB after attach (default). */
  loadAuthored = true;

  constructor(
    private readonly source: TrundlePoseSource,
    private readonly mapper: TrundleMapper,
  ) {
    this.parts = buildTrundle();
    this.parts.root.matrixAutoUpdate = false;
    this.parts.root.visible = false;
    this.grains.mesh.visible = false;
  }

  attach(world: Object3D, vfx: Object3D): void {
    this.world = world;
    world.add(this.parts.root);
    this.grains.attachTo(vfx);
    if (this.loadAuthored) void this.upgrade();
  }

  /**
   * Cold path: swaps the procedural blockout for the authored GLB (a dynamic import, so no boot cost). Any failure
   * keeps the procedural model. Set `loadAuthored = false` before `attach` to skip it (unit tests).
   */
  async upgrade(load: () => Promise<TrundleParts> = defaultLoad): Promise<boolean> {
    let next: TrundleParts;
    try {
      next = await load();
    } catch (error) {
      console.warn(`[trundle] authored model unavailable, keeping the procedural one: ${String(error)}`);
      return false;
    }
    if (this.disposed || this.world === null) {
      disposeTrundle(next);
      return false;
    }
    const old = this.parts;
    next.root.matrixAutoUpdate = false;
    next.root.matrix.copy(old.root.matrix);
    next.root.matrixWorldNeedsUpdate = true;
    next.root.visible = old.root.visible;
    this.world.add(next.root);
    old.root.removeFromParent();
    disposeTrundle(old);
    this.parts = next;
    return true;
  }

  update(dt: number, renderer: WebGPURenderer | null): void {
    const p = this.pose;
    const root = this.parts.root;
    if (!this.source.read(p)) {
      root.visible = false;
      this.spray.step(this.grains.pool, dt, 0, 0, 0, 0, 0, 0, 0, 0);
    } else {
      this.src[0] = p.px;
      this.src[1] = p.py;
      this.src[2] = p.pz;
      this.mapper.point(this.src, 0, this.pos, 0);
      this.src[0] = p.fx;
      this.src[1] = p.fy;
      this.src[2] = p.fz;
      this.mapper.direction(this.src, 0, this.dir, 0);
      const rl = Math.hypot(p.px, p.py, p.pz) || 1;
      this.src[0] = p.px / rl;
      this.src[1] = p.py / rl;
      this.src[2] = p.pz / rl;
      this.mapper.direction(this.src, 0, this.up, 0);
      const b = this.basis;
      trundleBasis(this.dir[0]!, this.dir[1]!, this.dir[2]!, this.up[0]!, this.up[1]!, this.up[2]!, b);
      this.right.set(b[0]!, b[1]!, b[2]!);
      this.upV.set(b[3]!, b[4]!, b[5]!);
      this.fwdV.set(b[6]!, b[7]!, b[8]!);
      this.posV.set(this.pos[0]!, this.pos[1]!, this.pos[2]!);
      this.m.makeBasis(this.right, this.upV, this.fwdV).setPosition(this.posV);
      root.matrix.copy(this.m);
      root.matrixWorldNeedsUpdate = true;
      root.visible = true;
      // Rolling: drum and wheels turn with the ground speed (a forward roll turns +X rotation).
      this.spinRad = (this.spinRad + (p.speed * dt) / TRUNDLE_DRUM_RADIUS_M) % (Math.PI * 2);
      this.parts.drumPivot.rotation.x = this.spinRad;
      const wheel = ((this.spinRad * TRUNDLE_DRUM_RADIUS_M) / TRUNDLE_WHEEL_RADIUS_M) % (Math.PI * 2);
      this.parts.wheelPivot.rotation.x = wheel;
      this.parts.lamps.visible = p.lights;
      // Spray from the drum's front edge, thrown along the render-space heading.
      const fl = Math.hypot(this.fwdV.x, this.fwdV.z) || 1;
      this.spray.step(
        this.grains.pool,
        dt,
        p.speed,
        p.work01,
        this.pos[0]! + this.fwdV.x * TRUNDLE_DRUM_FRONT_M,
        this.pos[1]! + this.fwdV.y * TRUNDLE_DRUM_FRONT_M + 0.05,
        this.pos[2]! + this.fwdV.z * TRUNDLE_DRUM_FRONT_M,
        this.fwdV.x / fl,
        this.fwdV.z / fl,
        this.pos[1]!,
      );
    }
    const live = this.grains.pool.live() > 0;
    if (live) {
      this.grains.mesh.visible = true;
      this.grains.update(dt, renderer);
    } else if (this.grains.mesh.visible) this.grains.mesh.visible = false;
  }

  dispose(): void {
    this.disposed = true;
    this.parts.root.removeFromParent();
    disposeTrundle(this.parts);
    this.grains.dispose();
  }
}
