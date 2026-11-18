// Camera rig and tool aim (M1-W3-T05), three-free math in moon-centred metres.
//
// - Follows the avatar pose with frame-rate independent exponential smoothing (absorbs the 20 Hz authoritative steps
//   under variable frame time); snaps on teleports. Look (yaw / pitch) is the LIVE input angle, so mouse look reaches
//   the screen on the next rendered frame (E13 first visual) without waiting for a sim tick.
// - Heading frame: the same north/east basis as the sim (`headingBasis`, yaw 0 = frame north, + toward east), so the
//   camera's forward is exactly the direction the sim moves on `moveY`.
// - First person (default, the reference's work feel) or a third-person chase view (placeholder avatar visible).
// - Tool aim: the look ray meets the local tangent plane at the feet; the distance, clamped to the equipped tool's
//   reach, is the input `toolParam` (0..255 = 0..reach) and the aim point drives the placeholder tool-head marker.
// - Render mapping is a port: the app chooses a floating-origin tangent frame (y up) or a scene's own plot frame.

import { AvatarState, headingBasis } from "@moon-cleanup/sim";
import { INPUT_TOOL_PARAM_MAX } from "@moon-cleanup/shared";

/** Live look angles (InputState satisfies it). */
export interface LookAngles {
  readonly yawRad: number;
  readonly pitchRad: number;
}

export const CAMERA_MODES = ["first", "third"] as const;
export type CameraMode = (typeof CAMERA_MODES)[number];

export interface CameraRigSettings {
  /** Eye height above the feet (m). */
  eyeHeightM: number;
  /** Follow rate (1/s); 1 - exp(-rate dt) of the remaining gap is closed per frame. */
  followRate: number;
  /** Vertical follow rate (1/s): softer, so low-g landings ease instead of jolting. */
  verticalRate: number;
  /** A jump larger than this (m) snaps (teleport, respawn, restore). */
  snapDistanceM: number;
  /** Third-person distance behind and height above the eye (m). */
  chaseDistanceM: number;
  chaseHeightM: number;
  /** Reduced motion: no eased vertical lag (the camera sits exactly at the eye). */
  reducedMotion: boolean;
}

export const DEFAULT_CAMERA_RIG: Readonly<CameraRigSettings> = {
  eyeHeightM: 1.55,
  followRate: 30,
  verticalRate: 14,
  snapDistanceM: 6,
  chaseDistanceM: 3.4,
  chaseHeightM: 0.7,
  reducedMotion: false,
};

/** Default reach of a hand tool (m) until the equipped tool's reach is supplied. */
export const DEFAULT_TOOL_REACH_M = 2.2;
/** Pitch at or above this (rad, i.e. looking nearly level or up) aims at full reach. */
const LEVEL_PITCH_RAD = -0.02;

/** Tool aim distance (m) on flat ground for an eye `eyeHeightM` above the feet, clamped to `reachM`. */
export function aimDistanceM(pitchRad: number, eyeHeightM: number, reachM: number): number {
  if (pitchRad >= LEVEL_PITCH_RAD) return reachM;
  const d = eyeHeightM / Math.tan(-pitchRad);
  return d > reachM ? reachM : d < 0 ? 0 : d;
}

/** Aim distance -> input `toolParam` code (0..255 = 0..reach). */
export function toolParamFor(distanceM: number, reachM: number): number {
  if (reachM <= 0) return 0;
  const c = Math.round((distanceM / reachM) * INPUT_TOOL_PARAM_MAX);
  return c < 0 ? 0 : c > INPUT_TOOL_PARAM_MAX ? INPUT_TOOL_PARAM_MAX : c;
}

export class CameraRig {
  readonly settings: CameraRigSettings = { ...DEFAULT_CAMERA_RIG };
  mode: CameraMode = "first";
  toolReachM = DEFAULT_TOOL_REACH_M;
  /** Outputs (moon-centred metres / unit vectors), valid after `update` returned true. */
  readonly eye = new Float64Array(3);
  readonly forward = new Float64Array(3);
  readonly up = new Float64Array(3);
  /** Smoothed feet position and the tool aim point on the tangent plane. */
  readonly feet = new Float64Array(3);
  readonly aim = new Float64Array(3);
  /** Horizontal (tangent) look direction. */
  readonly heading = new Float64Array(3);
  aimDistanceM = 0;
  toolParam = 0;
  private has = false;
  private readonly frame = new AvatarState();
  private readonly basis = new Float64Array(9);

  /** Forget the smoothed pose (next update snaps). */
  reset(): void {
    this.has = false;
  }

  /**
   * One rendered frame: `target` is the avatar's feet (moon-centred m), `look` the live look angles. Objects, not
   * doubles, cross this call (a double argument to a non-inlined call is boxed: measured 32 B per frame).
   */
  update(target: Float64Array, look: LookAngles, t: { readonly dt: number }): void {
    const s = this.settings;
    const yawRad = look.yawRad;
    const pitchRad = look.pitchRad;
    const dtS = t.dt;
    const f = this.feet;
    const tx = target[0]!;
    const ty = target[1]!;
    const tz = target[2]!;
    const dx = tx - f[0]!;
    const dy = ty - f[1]!;
    const dz = tz - f[2]!;
    if (!this.has || dx * dx + dy * dy + dz * dz > s.snapDistanceM * s.snapDistanceM) {
      f[0] = tx;
      f[1] = ty;
      f[2] = tz;
      this.has = true;
    } else {
      // Split the gap into radial (vertical) and tangent parts so height eases slower than travel.
      const len = Math.sqrt(tx * tx + ty * ty + tz * tz);
      const ux = tx / len;
      const uy = ty / len;
      const uz = tz / len;
      const vertical = dx * ux + dy * uy + dz * uz;
      const kh = 1 - Math.exp(-s.followRate * dtS);
      const kv = s.reducedMotion ? kh : 1 - Math.exp(-s.verticalRate * dtS);
      const hx = dx - vertical * ux;
      const hy = dy - vertical * uy;
      const hz = dz - vertical * uz;
      f[0] = f[0]! + hx * kh + vertical * ux * kv;
      f[1] = f[1]! + hy * kh + vertical * uy * kv;
      f[2] = f[2]! + hz * kh + vertical * uz * kv;
    }

    // Heading basis of the sim at the smoothed feet: n, north, east.
    const a = this.frame;
    a.px = f[0]!;
    a.py = f[1]!;
    a.pz = f[2]!;
    const b = this.basis;
    headingBasis(a, b);
    const nx = b[0]!;
    const ny = b[1]!;
    const nz = b[2]!;
    const cy = Math.cos(yawRad);
    const sy = Math.sin(yawRad);
    const hx = b[3]! * cy + b[6]! * sy;
    const hy = b[4]! * cy + b[7]! * sy;
    const hz = b[5]! * cy + b[8]! * sy;
    const h = this.heading;
    h[0] = hx;
    h[1] = hy;
    h[2] = hz;
    const cp = Math.cos(pitchRad);
    const sp = Math.sin(pitchRad);
    const fw = this.forward;
    fw[0] = hx * cp + nx * sp;
    fw[1] = hy * cp + ny * sp;
    fw[2] = hz * cp + nz * sp;
    const up = this.up;
    up[0] = nx;
    up[1] = ny;
    up[2] = nz;

    const e = this.eye;
    const eh = s.eyeHeightM;
    e[0] = f[0]! + nx * eh;
    e[1] = f[1]! + ny * eh;
    e[2] = f[2]! + nz * eh;
    if (this.mode === "third") {
      const back = s.chaseDistanceM;
      const lift = s.chaseHeightM;
      e[0] = e[0]! - fw[0]! * back + nx * lift;
      e[1] = e[1]! - fw[1]! * back + ny * lift;
      e[2] = e[2]! - fw[2]! * back + nz * lift;
    }

    const dist = aimDistanceM(pitchRad, eh, this.toolReachM);
    this.aimDistanceM = dist;
    this.toolParam = toolParamFor(dist, this.toolReachM);
    const m = this.aim;
    m[0] = f[0]! + hx * dist;
    m[1] = f[1]! + hy * dist;
    m[2] = f[2]! + hz * dist;
  }
}

/** Moon-centred metres -> render space (y up). Implementations must not allocate. */
export interface RenderMapper {
  /** Point `src[so..so+2]`: writes render x, y, z into `out[o..o+2]`. */
  point(src: Float64Array, so: number, out: Float64Array, o: number): void;
  /** Direction (no translation). */
  direction(src: Float64Array, so: number, out: Float64Array, o: number): void;
  /** The mapping is a reflection (left-handed); the input layer then flips turning and strafing. */
  readonly mirrored?: boolean;
}

/**
 * Floating-origin tangent frame at `origin` (moon-centred m): render x = east, y = up, z = -north (right-handed, as
 * three expects), in metres relative to the origin. `recenter` moves the origin (call it when the avatar is far from
 * it, so float32 render precision stays at millimetres).
 */
export class TangentPlaneMapper implements RenderMapper {
  readonly origin = new Float64Array(3);
  /** east (0..2), up (3..5), north (6..8). */
  readonly axes = new Float64Array(9);
  private readonly tmp = new AvatarState();
  private readonly b = new Float64Array(9);

  constructor(origin?: ArrayLike<number>) {
    this.recenter(origin?.[0] ?? 0, origin?.[1] ?? 0, origin?.[2] ?? 1);
  }

  recenter(x: number, y: number, z: number): void {
    this.origin[0] = x;
    this.origin[1] = y;
    this.origin[2] = z;
    const t = this.tmp;
    t.px = x;
    t.py = y;
    t.pz = z;
    t.yawFrame = 0;
    headingBasis(t, this.b);
    const b = this.b;
    const a = this.axes;
    a[0] = b[6]!;
    a[1] = b[7]!;
    a[2] = b[8]!;
    a[3] = b[0]!;
    a[4] = b[1]!;
    a[5] = b[2]!;
    a[6] = b[3]!;
    a[7] = b[4]!;
    a[8] = b[5]!;
  }

  point(src: Float64Array, so: number, out: Float64Array, o: number): void {
    const g = this.origin;
    this.write(src[so]! - g[0]!, src[so + 1]! - g[1]!, src[so + 2]! - g[2]!, out, o);
  }

  direction(src: Float64Array, so: number, out: Float64Array, o: number): void {
    this.write(src[so]!, src[so + 1]!, src[so + 2]!, out, o);
  }

  private write(x: number, y: number, z: number, out: Float64Array, o: number): void {
    const a = this.axes;
    out[o] = x * a[0]! + y * a[1]! + z * a[2]!;
    out[o + 1] = x * a[3]! + y * a[4]! + z * a[5]!;
    out[o + 2] = -(x * a[6]! + y * a[7]! + z * a[8]!);
  }
}

/** What `PlotFrameMapper.fromGrid` needs of a plot grid (packages/world `IcoPlotGrid`, structural). */
export interface PlotFrameGrid {
  fromPlotLocal(
    id: never,
    uMm: number,
    vMm: number,
    out: { x: number; y: number; z: number },
  ): { x: number; y: number; z: number };
}

/**
 * The flat look-scene frame of `?scene=dust` and the game worksite (visuals/dust/flat-lookup.ts): render x = the site
 * plot's gnomonic plot-local u (east), z = -v (south), in metres (packages/world `toPlotLocal`, mm / 1000), y = height
 * above the moon radius. Built from the plot's centre n, east e and north t (unit vectors). The frame (e, n, -t) is the
 * scene's, so strokes land under the avatar's feet; for the standard grid it is right-handed (`mirrored` false).
 *
 * The site can move (the game worksite follows the player): `requestSite(plot)` stages a new site and the next
 * `point()` call (the gameplay present, first in the frame) applies it, so every consumer of that frame (camera,
 * avatar, dust ground) sees one site; `siteVersion` counts the applied moves.
 */
export class PlotFrameMapper implements RenderMapper {
  /** n (0..2), e (3..5), t (6..8). */
  readonly axes = new Float64Array(9);
  /** det(e, n, -t) < 0: the scene frame is a mirror image (input then flips turning and strafing). */
  readonly mirrored: boolean;
  /** Site plot of the frame (-1 when built from bare axes). */
  site = -1;
  /** Applied site moves. */
  siteVersion = 0;
  private grid: PlotFrameGrid | null = null;
  private pendingSite = -1;

  constructor(
    n: ArrayLike<number>,
    e: ArrayLike<number>,
    t: ArrayLike<number>,
    readonly radiusM: number,
  ) {
    this.setAxes(n, e, t);
    const cx = e[1]! * n[2]! - e[2]! * n[1]!;
    const cy = e[2]! * n[0]! - e[0]! * n[2]!;
    const cz = e[0]! * n[1]! - e[1]! * n[0]!;
    this.mirrored = -(cx * t[0]! + cy * t[1]! + cz * t[2]!) < 0;
  }

  /** From a plot grid's `fromPlotLocal` (axes by 1 m finite differences, exact to about 1e-7). */
  static fromGrid(grid: PlotFrameGrid, plot: number, radiusM: number): PlotFrameMapper {
    const ax = plotAxes(grid, plot);
    const m = new PlotFrameMapper(ax.slice(0, 3), ax.slice(3, 6), ax.slice(6, 9), radiusM);
    m.grid = grid;
    m.site = plot;
    return m;
  }

  /** Stages a move of the frame to `plot` (applied by the next `point()` or `applyPendingSite()`). Grid-built only. */
  requestSite(plot: number): void {
    if (this.grid === null || plot === this.site) return;
    this.pendingSite = plot;
  }

  /** A staged site move is waiting. */
  get sitePending(): boolean {
    return this.pendingSite >= 0;
  }

  /** Applies a staged site move now (cold path: a few `fromPlotLocal` calls); false when none is staged. */
  applyPendingSite(): boolean {
    const plot = this.pendingSite;
    const grid = this.grid;
    if (plot < 0 || grid === null) return false;
    this.pendingSite = -1;
    const ax = plotAxes(grid, plot);
    this.setAxes(ax.slice(0, 3), ax.slice(3, 6), ax.slice(6, 9));
    this.site = plot;
    this.siteVersion++;
    return true;
  }

  private setAxes(n: ArrayLike<number>, e: ArrayLike<number>, t: ArrayLike<number>): void {
    for (let i = 0; i < 3; i++) {
      this.axes[i] = n[i]!;
      this.axes[3 + i] = e[i]!;
      this.axes[6 + i] = t[i]!;
    }
  }

  point(src: Float64Array, so: number, out: Float64Array, o: number): void {
    if (this.pendingSite >= 0) this.applyPendingSite();
    const a = this.axes;
    const x = src[so]!;
    const y = src[so + 1]!;
    const z = src[so + 2]!;
    const len = Math.sqrt(x * x + y * y + z * z);
    const dn = (x * a[0]! + y * a[1]! + z * a[2]!) / len;
    const qx = x / len / dn - a[0]!;
    const qy = y / len / dn - a[1]!;
    const qz = z / len / dn - a[2]!;
    const r = this.radiusM;
    out[o] = r * (qx * a[3]! + qy * a[4]! + qz * a[5]!);
    out[o + 1] = len - r;
    out[o + 2] = -r * (qx * a[6]! + qy * a[7]! + qz * a[8]!);
  }

  direction(src: Float64Array, so: number, out: Float64Array, o: number): void {
    const a = this.axes;
    const x = src[so]!;
    const y = src[so + 1]!;
    const z = src[so + 2]!;
    out[o] = x * a[3]! + y * a[4]! + z * a[5]!;
    out[o + 1] = x * a[0]! + y * a[1]! + z * a[2]!;
    out[o + 2] = -(x * a[6]! + y * a[7]! + z * a[8]!);
  }
}

/** n, e, t of `plot` (9 numbers) from the grid's `fromPlotLocal` by 1 m finite differences. Cold path. */
function plotAxes(grid: PlotFrameGrid, plot: number): number[] {
  const c = { x: 0, y: 0, z: 0 };
  const pu = { x: 0, y: 0, z: 0 };
  const pv = { x: 0, y: 0, z: 0 };
  grid.fromPlotLocal(plot as never, 0, 0, c);
  grid.fromPlotLocal(plot as never, 1000, 0, pu);
  grid.fromPlotLocal(plot as never, 0, 1000, pv);
  const unit = (x: number, y: number, z: number): number[] => {
    const l = Math.hypot(x, y, z);
    return [x / l, y / l, z / l];
  };
  return [c.x, c.y, c.z, ...unit(pu.x - c.x, pu.y - c.y, pu.z - c.z), ...unit(pv.x - c.x, pv.y - c.y, pv.z - c.z)];
}
