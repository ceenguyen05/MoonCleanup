// Synthetic per-tick world work for the netcode spike (netcode.md section 15 line items): kinematic bodies on the
// sphere with a height-sampling suspension stub, robots, and the staggered interest recompute. It stands in for
// RoomSim + InterestService so the spike costs roughly what the MVP will; it is not gameplay.
//
// All state lives in typed arrays allocated in the constructor; `step` and `recomputeInterest` allocate nothing.

/** Canonical moon radius in metres (WDS section 0). */
export const MOON_RADIUS_M = 2000;
/** Entity interest radius for the stub (clustered busy case: everything nearby is in interest). */
export const INTEREST_RADIUS_M = 400;
/** Suspension probe offset in metres (4 probes around the centre sample). */
const PROBE_M = 0.8;
const AVATAR_SPEED_MPS = 6;
const VEHICLE_SPEED_MPS = 9;
const FILLER_SPEED_MPS = 4;
const ROBOT_SPEED_MPS = 1.2;
/** Spawn cluster centre direction (unnormalised) and radius. */
const SPAWN_DIR = [1, 0.2, 0.1] as const;
const SPAWN_RADIUS_M = 30;

// Height-field stub (stands in for the baked height cube): 6 sin(37x+11y)cos(29z) + 2 sin(113x-71z) + 0.7 sin(301y+257z)
// over the unit direction, written inline in stepBody/stepRobot so no double crosses a call boundary.

export interface SyntheticWorldOptions {
  /** Total kinematic bodies (seats first, then vehicles, then filler). */
  readonly bodies: number;
  readonly robots: number;
  /** Player seats (bodies 0..seats-1 are input-driven avatars). */
  readonly seats: number;
  readonly vehicles: number;
}

export class SyntheticWorld {
  readonly bodyCount: number;
  readonly robotCount: number;
  readonly seats: number;
  readonly vehicles: number;
  /** Body position (moon-centred metres), velocity (m/s), yaw (radians about local up). */
  readonly px: Float64Array;
  readonly py: Float64Array;
  readonly pz: Float64Array;
  readonly vx: Float64Array;
  readonly vy: Float64Array;
  readonly vz: Float64Array;
  readonly yaw: Float64Array;
  /** Robot position and heading (radians). */
  readonly rx: Float64Array;
  readonly ry: Float64Array;
  readonly rz: Float64Array;
  readonly rh: Float64Array;
  /** Per-seat interest flags over [bodies..., robots...]: 1 = in interest. */
  readonly interest: Uint8Array[];
  /** Avatar control per seat (from the last consumed input). */
  readonly moveX: Float64Array;
  readonly moveY: Float64Array;
  readonly inputYaw: Float64Array;
  /** Last input yaw as the wire u16 (for the neutral substitute). */
  readonly inputYawU16: Int32Array;
  private readonly centre = new Float64Array(3);
  private interestCursor = 0;
  /** Elapsed simulated seconds. */
  time = 0;
  private dt = 0.05;

  constructor(options: SyntheticWorldOptions) {
    this.bodyCount = options.bodies;
    this.robotCount = options.robots;
    this.seats = options.seats;
    this.vehicles = options.vehicles;
    const n = options.bodies;
    this.px = new Float64Array(n);
    this.py = new Float64Array(n);
    this.pz = new Float64Array(n);
    this.vx = new Float64Array(n);
    this.vy = new Float64Array(n);
    this.vz = new Float64Array(n);
    this.yaw = new Float64Array(n);
    this.rx = new Float64Array(options.robots);
    this.ry = new Float64Array(options.robots);
    this.rz = new Float64Array(options.robots);
    this.rh = new Float64Array(options.robots);
    this.moveX = new Float64Array(options.seats);
    this.moveY = new Float64Array(options.seats);
    this.inputYaw = new Float64Array(options.seats);
    this.inputYawU16 = new Int32Array(options.seats);
    this.interest = Array.from({ length: options.seats }, () => new Uint8Array(n + options.robots));

    const len = Math.sqrt(SPAWN_DIR[0] ** 2 + SPAWN_DIR[1] ** 2 + SPAWN_DIR[2] ** 2);
    this.centre[0] = (SPAWN_DIR[0] / len) * MOON_RADIUS_M;
    this.centre[1] = (SPAWN_DIR[1] / len) * MOON_RADIUS_M;
    this.centre[2] = (SPAWN_DIR[2] / len) * MOON_RADIUS_M;
    for (let i = 0; i < n; i++) this.placeNearCentre(i, i / n);
    for (let r = 0; r < options.robots; r++) this.rh[r] = (r / Math.max(1, options.robots)) * Math.PI * 2;
  }

  /** Puts body `i` back on the spawn ring (seat join). `phase` in [0, 1) spreads bodies around the ring. */
  placeNearCentre(i: number, phase: number): void {
    const angle = phase * Math.PI * 2;
    // Tangent offsets: the centre lies mostly along +x, so y/z are close to tangential.
    const x = this.centre[0] ?? 0;
    const y = (this.centre[1] ?? 0) + Math.cos(angle) * SPAWN_RADIUS_M;
    const z = (this.centre[2] ?? 0) + Math.sin(angle) * SPAWN_RADIUS_M;
    const r = Math.sqrt(x * x + y * y + z * z);
    this.px[i] = (x / r) * MOON_RADIUS_M;
    this.py[i] = (y / r) * MOON_RADIUS_M;
    this.pz[i] = (z / r) * MOON_RADIUS_M;
    this.vx[i] = 0;
    this.vy[i] = 0;
    this.vz[i] = 0;
    this.yaw[i] = angle;
  }

  /**
   * Sets a seat's control from a consumed input: raw wire integers (move -127..127, yaw u16). Integer arguments are
   * small integers in V8 (no boxing); doubles are only computed and stored into typed arrays here.
   */
  setControl(seat: number, moveXi: number, moveYi: number, yawU16: number): void {
    const mx = moveXi / 127;
    const my = moveYi / 127;
    // Server normalises the move vector length to <= 1 (netcode.md section 4.1).
    const len = Math.sqrt(mx * mx + my * my);
    const k = len > 1 ? 1 / len : 1;
    this.moveX[seat] = mx * k;
    this.moveY[seat] = my * k;
    this.inputYawU16[seat] = yawU16;
    this.inputYaw[seat] = (yawU16 / 65536) * Math.PI * 2;
  }

  /** One fixed step: every body (avatars from input, vehicles and filler on circles) and every robot. */
  step(dt: number, activeSeat: Uint8Array): void {
    this.dt = dt;
    this.time += dt;
    for (let i = 0; i < this.bodyCount; i++) {
      if (i < this.seats) {
        if (activeSeat[i] !== 1) continue;
        this.stepBody(i, AVATAR_SPEED_MPS);
      } else {
        // Circle: yaw rate 0.4-0.6 rad/s keeps every body inside the spawn cluster.
        this.yaw[i] = (this.yaw[i] ?? 0) + (0.4 + (i % 5) * 0.05) * dt;
        this.stepBody(i, i < this.seats + this.vehicles ? VEHICLE_SPEED_MPS : FILLER_SPEED_MPS);
      }
    }
    for (let r = 0; r < this.robotCount; r++) this.stepRobot(r);
  }

  /**
   * Recomputes interest for `ceil(activeSeats / (tickHz / 2))` seats (each seat every 0.5 s, netcode.md section 3
   * step 5). Horizon-aware stub: distance test plus "above the local horizon" test per pair.
   */
  recomputeInterest(activeSeat: Uint8Array, activeCount: number, tickHz: number): void {
    if (activeCount === 0) return;
    let budget = Math.ceil(activeCount / (tickHz / 2));
    let guard = this.seats;
    while (budget > 0 && guard-- > 0) {
      const seat = this.interestCursor;
      this.interestCursor = (this.interestCursor + 1) % this.seats;
      if (activeSeat[seat] !== 1) continue;
      this.recomputeSeat(seat);
      budget--;
    }
  }

  /** Recomputes one seat's interest row now (pair test inline: no double-valued calls, so no boxing). */
  recomputeSeat(seat: number): void {
    const flags = this.interest[seat] as Uint8Array;
    const ox = this.px[seat] ?? 0;
    const oy = this.py[seat] ?? 0;
    const oz = this.pz[seat] ?? 0;
    const or = Math.sqrt(ox * ox + oy * oy + oz * oz);
    const ux = ox / or;
    const uy = oy / or;
    const uz = oz / or;
    const r2 = INTEREST_RADIUS_M * INTEREST_RADIUS_M;
    const total = this.bodyCount + this.robotCount;
    for (let j = 0; j < total; j++) {
      const isBody = j < this.bodyCount;
      const r = j - this.bodyCount;
      const dx = (isBody ? (this.px[j] ?? 0) : (this.rx[r] ?? 0)) - ox;
      const dy = (isBody ? (this.py[j] ?? 0) : (this.ry[r] ?? 0)) - oy;
      const dz = (isBody ? (this.pz[j] ?? 0) : (this.rz[r] ?? 0)) - oz;
      const d2 = dx * dx + dy * dy + dz * dz;
      // Horizon stub: the target may sit at most (d^2 / 2R) + 2 m below the observer's tangent plane.
      const below = -(dx * ux + dy * uy + dz * uz);
      flags[j] = d2 <= r2 && below <= d2 / (2 * MOON_RADIUS_M) + 2 ? 1 : 0;
    }
  }

  private stepBody(i: number, speed: number): void {
    const dt = this.dt;
    const avatar = i < this.seats;
    const mx = avatar ? (this.moveX[i] ?? 0) : 0;
    const my = avatar ? (this.moveY[i] ?? 0) : 1;
    const yawRad = avatar ? (this.inputYaw[i] ?? 0) : (this.yaw[i] ?? 0);
    let x = this.px[i] ?? 0;
    let y = this.py[i] ?? 0;
    let z = this.pz[i] ?? 0;
    const r = Math.sqrt(x * x + y * y + z * z);
    const ux = x / r;
    const uy = y / r;
    const uz = z / r;
    // east = normalize(Z x up), north = up x east.
    let ex = -uy;
    let ey = ux;
    const el = Math.sqrt(ex * ex + ey * ey);
    if (el < 1e-6) {
      ex = 1;
      ey = 0;
    } else {
      ex /= el;
      ey /= el;
    }
    const nx = -uz * ey;
    const ny = uz * ex;
    const nz = ux * ey - uy * ex;
    const c = Math.cos(yawRad);
    const s = Math.sin(yawRad);
    const fx = nx * c + ex * s;
    const fy = ny * c + ey * s;
    const fz = nz * c;
    const rx = ex * c - nx * s;
    const ry = ey * c - ny * s;
    const rz = -nz * s;
    const vx = (fx * my + rx * mx) * speed;
    const vy = (fy * my + ry * mx) * speed;
    const vz = (fz * my + rz * mx) * speed;
    x += vx * dt;
    y += vy * dt;
    z += vz * dt;
    const len = Math.sqrt(x * x + y * y + z * z);
    const dx = x / len;
    const dy = y / len;
    const dz = z / len;
    // Suspension stub: centre sample (weight 2) + 4 probes east/west/north/south, averaged. Inline (no calls).
    const o = PROBE_M / MOON_RADIUS_M;
    let hsum = 0;
    for (let k = 0; k < 6; k++) {
      const sign = k === 2 || k === 4 ? 1 : k === 3 || k === 5 ? -1 : 0;
      const east = k === 2 || k === 3;
      const sx = dx + sign * o * (east ? ex : nx);
      const sy = dy + sign * o * (east ? ey : ny);
      const sz = dz + sign * o * (east ? 0 : nz);
      hsum +=
        6 * Math.sin(sx * 37 + sy * 11) * Math.cos(sz * 29) +
        2 * Math.sin(sx * 113 - sz * 71) +
        0.7 * Math.sin(sy * 301 + sz * 257);
    }
    const radius = MOON_RADIUS_M + hsum / 6;
    this.px[i] = dx * radius;
    this.py[i] = dy * radius;
    this.pz[i] = dz * radius;
    this.vx[i] = vx;
    this.vy[i] = vy;
    this.vz[i] = vz;
    this.yaw[i] = yawRad;
  }

  private stepRobot(r: number): void {
    // Robots orbit the cluster centre on a 20-60 m ring (tangent plane approximated by y/z, see placeNearCentre).
    const ring = 20 + (r % 9) * 5;
    const heading = (this.rh[r] ?? 0) + (ROBOT_SPEED_MPS / ring) * this.dt;
    this.rh[r] = heading;
    const x = this.centre[0] ?? 0;
    const y = (this.centre[1] ?? 0) + Math.cos(heading) * ring;
    const z = (this.centre[2] ?? 0) + Math.sin(heading) * ring;
    const len = Math.sqrt(x * x + y * y + z * z);
    const sx = x / len;
    const sy = y / len;
    const sz = z / len;
    const h =
      6 * Math.sin(sx * 37 + sy * 11) * Math.cos(sz * 29) +
      2 * Math.sin(sx * 113 - sz * 71) +
      0.7 * Math.sin(sy * 301 + sz * 257);
    const k = (MOON_RADIUS_M + h) / len;
    this.rx[r] = x * k;
    this.ry[r] = y * k;
    this.rz[r] = z * k;
  }
}
