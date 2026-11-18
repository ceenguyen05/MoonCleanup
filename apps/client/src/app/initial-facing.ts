// Initial camera facing (client-side only): the sim spawns the avatar facing frame north, which in real flat Solo looks away
// from the outpost. Once the first pose and the station list are known, the live look yaw (not sim state, no hash impact)
// is turned once toward the Assay Counter (the Desk when there is none). It runs only while the player has not looked
// around yet (yaw still exactly 0) and never again after it fired.

interface Dir {
  x: number;
  y: number;
  z: number;
}

export interface InitialFacingOptions {
  readonly stations: () => readonly {
    readonly kind: string;
    readonly x: number;
    readonly y: number;
    readonly z: number;
  }[];
  /** Avatar position (any scale) into `out`; false before the first pose. */
  readonly samplePos: (out: Dir) => boolean;
  /** `sphereBearingDeg`. */
  readonly bearing: (p: Readonly<Dir>, d: Readonly<Dir>) => number | null;
  /** Reads / writes the live look yaw in radians (frame north 0, + toward east). */
  readonly getYaw: () => number;
  readonly setYaw: (yawRad: number) => void;
}

/**
 * Bearing (degrees, + toward east) of `d` from `p` in the SIM's heading frame (`headingBasis`): near the poles
 * (|y| > 0.8, where the spawn is) yaw 0 points along +X, not along +Y, so the HUD's `sphereBearingDeg` does not apply.
 * Both are unit vectors. Null when `d` is straight overhead.
 */
export function simHeadingBearingDeg(p: Readonly<Dir>, d: Readonly<Dir>): number | null {
  const polar = Math.abs(p.y) > 0.8;
  let rx: number;
  let ry: number;
  let rz: number;
  if (!polar) {
    rx = -p.y * p.x;
    ry = 1 - p.y * p.y;
    rz = -p.y * p.z;
  } else {
    rx = 1 - p.x * p.x;
    ry = -p.x * p.y;
    rz = -p.x * p.z;
  }
  const rl = Math.hypot(rx, ry, rz);
  if (rl < 1e-9) return null;
  rx /= rl;
  ry /= rl;
  rz /= rl;
  const ex = ry * p.z - rz * p.y;
  const ey = rz * p.x - rx * p.z;
  const ez = rx * p.y - ry * p.x;
  const dot = d.x * p.x + d.y * p.y + d.z * p.z;
  const tx = d.x - dot * p.x;
  const ty = d.y - dot * p.y;
  const tz = d.z - dot * p.z;
  if (Math.hypot(tx, ty, tz) < 1e-9) return null;
  return (Math.atan2(tx * ex + ty * ey + tz * ez, tx * rx + ty * ry + tz * rz) * 180) / Math.PI;
}

export class InitialFacing {
  private done = false;
  private readonly pos: Dir = { x: 0, y: 1, z: 0 };

  constructor(private readonly o: InitialFacingOptions) {}

  get applied(): boolean {
    return this.done;
  }

  pump(): void {
    if (this.done) return;
    const stations = this.o.stations();
    if (stations.length === 0) return;
    const p = this.pos;
    if (!this.o.samplePos(p)) return;
    const len = Math.hypot(p.x, p.y, p.z);
    if (!(len > 0)) return;
    p.x /= len;
    p.y /= len;
    p.z /= len;
    this.done = true;
    if (this.o.getYaw() !== 0) return; // the player already looked around
    const target = stations.find((s) => s.kind === "assay_counter") ?? stations.find((s) => s.kind === "desk");
    if (target === undefined) return;
    const deg = this.o.bearing(p, target);
    if (deg === null) return;
    this.o.setYaw((deg * Math.PI) / 180);
  }
}
