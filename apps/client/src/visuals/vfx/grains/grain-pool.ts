// Grains v0, CPU half (M1-W3-T07): the ring buffer of ballistic dust grains and the stroke emitter. Three-free and
// allocation-free after construction, so it is unit-tested and shared by both backends.
//
// Physics (art-direction 3.6, rendering-pipeline 11): pure ballistics, g = 1.62 m/s^2 along the pool's local -Y, no
// drag, no clouds. A grain is fully described by its launch (p0, v0, t0) and its landing time, so the GPU evaluates
// x(t) = p0 + v0 t + g t^2 / 2 in closed form: nothing is integrated per frame and only new grains are uploaded.
// Ground hit: the emitter's tangent plane (`groundY`), solved at launch; the grain vanishes within VANISH_S of landing.

export const GRAIN_G = 1.62;
/** Seconds from landing to gone (art-direction 3.6 / D-16: <= 0.15 s). */
export const VANISH_S = 0.1;
/** Share of glint grains (art-direction 3.6). */
export const GLINT_SHARE = 0.15;
/** Floats per grain in each instanced attribute (vec4). */
export const GRAIN_STRIDE = 4;

export interface StrokeEmission {
  /** Number of grains in this burst. */
  count: number;
  /** Launch speed range (m/s): hand tools 0.5-1.5 (art-direction 3.6). */
  speedMin: number;
  speedMax: number;
  /** Elevation range (rad): 20-60 degrees (rendering-pipeline 11). */
  elevMin: number;
  elevMax: number;
  /** Half spread (rad) of the launch azimuth around the stroke direction. */
  spread: number;
  /** Grain radius range (m): 1-3 cm diameter. */
  radiusMin: number;
  radiusMax: number;
  /** Launch-point scatter radius (m) around the contact point. */
  scatter: number;
}

/** A Desk Duster stroke burst: small and fussy, same count on every preset (minimum-juice floor). */
export const DESK_DUSTER_BURST: StrokeEmission = {
  count: 14,
  speedMin: 0.5,
  speedMax: 1.5,
  elevMin: (20 * Math.PI) / 180,
  elevMax: (60 * Math.PI) / 180,
  spread: 1.0,
  radiusMin: 0.005,
  radiusMax: 0.015,
  scatter: 0.03,
};

/** Seeded PRNG (mulberry32): emission is reproducible for the ballistics telemetry. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Flight time until the grain falls back to `groundY` (launch height `y0`, upward speed `vy`). */
export function landingTime(y0: number, vy: number, groundY: number, g = GRAIN_G): number {
  const drop = Math.max(0, y0 - groundY);
  return (vy + Math.sqrt(vy * vy + 2 * g * drop)) / g;
}

export class GrainPool {
  /** x, y, z (pool-local launch point), t0 (pool clock). */
  readonly p0: Float32Array;
  /** vx, vy, vz (m/s), landing age (s). */
  readonly v0: Float32Array;
  /** radius (m), brightness variation, glint (0/1), tumble seed. */
  readonly look: Float32Array;
  /** Pool clock (s); rebased to 0 when the pool is empty so float32 never loses precision. */
  time = 0;
  /** Next slot to write (oldest-first recycling). */
  private next = 0;
  /** Highest slot ever written + 1 (instance count to draw). */
  used = 0;
  /** Dirty slot range written since the last `takeDirty` (inclusive start, exclusive end); wrap marks everything. */
  dirtyStart = Number.POSITIVE_INFINITY;
  dirtyEnd = 0;
  /** Pool-clock time when the last grain dies. */
  private lastDeath = 0;
  emitted = 0;
  private readonly rand: () => number;

  constructor(
    readonly capacity: number,
    seed = 1,
  ) {
    this.p0 = new Float32Array(capacity * GRAIN_STRIDE);
    this.v0 = new Float32Array(capacity * GRAIN_STRIDE);
    this.look = new Float32Array(capacity * GRAIN_STRIDE);
    // Unused slots start long dead.
    for (let i = 0; i < capacity; i++) this.p0[i * GRAIN_STRIDE + 3] = -1e6;
    this.rand = mulberry32(seed);
  }

  /** Number of grains alive at the pool clock. */
  live(): number {
    let n = 0;
    const t = this.time;
    for (let i = 0; i < this.used; i++) {
      const age = t - this.p0[i * GRAIN_STRIDE + 3]!;
      if (age >= 0 && age < this.v0[i * GRAIN_STRIDE + 3]! + VANISH_S) n++;
    }
    return n;
  }

  /** Advances the clock; rebases it to 0 once every grain is gone. */
  advance(dt: number): void {
    this.time += dt;
    if (this.time > this.lastDeath + 1 && this.time > 600) {
      // Everything is long dead: rebase (all t0 move by the same amount; dead slots stay dead).
      const shift = this.time;
      for (let i = 0; i < this.used; i++) this.p0[i * GRAIN_STRIDE + 3]! -= shift;
      this.lastDeath -= shift;
      this.time = 0;
      this.markDirty(0, this.used);
    }
  }

  /** One grain. Coordinates in the pool's local frame (+Y up); `groundY` is the local ground height under it. */
  emit(
    x: number,
    y: number,
    z: number,
    vx: number,
    vy: number,
    vz: number,
    radius: number,
    groundY: number,
    glint: boolean,
  ): number {
    const i = this.next;
    this.next = (i + 1) % this.capacity;
    if (i + 1 > this.used) this.used = i + 1;
    const k = i * GRAIN_STRIDE;
    const land = landingTime(y, vy, groundY);
    this.p0[k] = x;
    this.p0[k + 1] = y;
    this.p0[k + 2] = z;
    this.p0[k + 3] = this.time;
    this.v0[k] = vx;
    this.v0[k + 1] = vy;
    this.v0[k + 2] = vz;
    this.v0[k + 3] = land;
    this.look[k] = radius;
    this.look[k + 1] = 0.85 + 0.3 * this.rand();
    this.look[k + 2] = glint ? 1 : 0;
    this.look[k + 3] = this.rand() * 6.283;
    this.lastDeath = Math.max(this.lastDeath, this.time + land + VANISH_S);
    this.markDirty(i, i + 1);
    this.emitted++;
    return i;
  }

  /**
   * A stroke burst at contact point (x, y, z) on ground height `groundY`, thrown along the horizontal direction
   * (dirX, dirZ) (normalised here; zero = all around). Returns the first slot written.
   */
  emitStroke(x: number, y: number, z: number, dirX: number, dirZ: number, groundY: number, e: StrokeEmission): number {
    const r = this.rand;
    const len = Math.hypot(dirX, dirZ);
    const base = len > 1e-6 ? Math.atan2(dirX, dirZ) : 0;
    const spread = len > 1e-6 ? e.spread : Math.PI;
    const first = this.next;
    for (let n = 0; n < e.count; n++) {
      const az = base + (r() * 2 - 1) * spread;
      const el = e.elevMin + (e.elevMax - e.elevMin) * r();
      const speed = e.speedMin + (e.speedMax - e.speedMin) * r();
      const h = speed * Math.cos(el);
      const sa = r() * 6.283;
      const sr = e.scatter * Math.sqrt(r());
      const radius = e.radiusMin + (e.radiusMax - e.radiusMin) * r();
      this.emit(
        x + Math.sin(sa) * sr,
        y + radius,
        z + Math.cos(sa) * sr,
        Math.sin(az) * h,
        speed * Math.sin(el),
        Math.cos(az) * h,
        radius,
        groundY + radius * 0.5,
        r() < GLINT_SHARE,
      );
    }
    return first;
  }

  /** Position of grain `i` at pool time `t` (the shader's formula, for the ballistics telemetry). */
  sample(i: number, t: number, out: Float64Array): boolean {
    const k = i * GRAIN_STRIDE;
    const age = t - this.p0[k + 3]!;
    const land = this.v0[k + 3]!;
    if (age < 0 || age >= land + VANISH_S) return false;
    const a = Math.min(age, land);
    out[0] = this.p0[k]! + this.v0[k]! * a;
    out[1] = this.p0[k + 1]! + this.v0[k + 1]! * a - 0.5 * GRAIN_G * a * a;
    out[2] = this.p0[k + 2]! + this.v0[k + 2]! * a;
    return true;
  }

  private markDirty(start: number, end: number): void {
    if (start < this.dirtyStart) this.dirtyStart = start;
    if (end > this.dirtyEnd) this.dirtyEnd = end;
  }

  /** Clears the dirty range; returns false when nothing changed. */
  takeDirty(range: { start: number; count: number }): boolean {
    if (this.dirtyEnd <= this.dirtyStart) return false;
    range.start = this.dirtyStart;
    range.count = this.dirtyEnd - this.dirtyStart;
    this.dirtyStart = Number.POSITIVE_INFINITY;
    this.dirtyEnd = 0;
    return true;
  }
}
