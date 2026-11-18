// Juicy-moment VFX, CPU half (M1-W6-T03): the timing curves and grain bursts for the Inspector's Stamp, the Assay pour and
// the Railshot launch. Three-free and allocation-free per event: a fixed slot table holds the live envelopes, bursts go
// through the existing GrainPool (ballistic, g = 1.62, no drag, vanish <= VANISH_S). A render layer reads the MomentFx
// slots (kind, age, position, size) and draws the outline, emblem and flash. Visual acceptance (VT-M1-22, VM-03, VM-04)
// is NOT run here: no GPU.

import { GRAIN_G, type GrainPool, type StrokeEmission } from "../grains";

/** Stamp outline draw time (s): VT-M1-22 wants 0.6-1.0. */
export const STAMP_OUTLINE_S = 0.8;
/** Emblem lands after the outline closes: drop, one overshoot, settle (s). */
export const STAMP_EMBLEM_S = 0.35;
export const STAMP_GLOW_FADE_S = 1.2;
export const STAMP_TOTAL_S = STAMP_OUTLINE_S + STAMP_EMBLEM_S + STAMP_GLOW_FADE_S;
/** Emblem scale at the overshoot trough: it drops in large, dips to this, settles at 1 (one overshoot). */
export const STAMP_OVERSHOOT = 0.92;
export const POUR_FLASH_S = 0.35;
export const RAILSHOT_LAUNCH_S = 0.6;

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);
const easeOutCubic = (t: number): number => 1 - (1 - t) ** 3;

/** Outline progress 0..1 at `age` seconds (ease-out: fast start, settles as it closes). */
export function stampOutlineProgress(age: number): number {
  return easeOutCubic(clamp01(age / STAMP_OUTLINE_S));
}

/**
 * Emblem scale at `age`: 0 until the outline closes, then it lands from 1.5 down through 1 to the overshoot trough
 * (0.92, the squash) and settles back to exactly 1. One overshoot, no ringing.
 */
export function stampEmblemScale(age: number): number {
  const t = (age - STAMP_OUTLINE_S) / STAMP_EMBLEM_S;
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  if (t < 0.55) return 1.5 + (STAMP_OVERSHOOT - 1.5) * easeOutCubic(t / 0.55);
  return STAMP_OVERSHOOT + (1 - STAMP_OVERSHOOT) * easeOutCubic((t - 0.55) / 0.45);
}

/** Outline glow 0..1: full while drawing, fades after the emblem lands. */
export function stampGlow(age: number): number {
  const fadeStart = STAMP_OUTLINE_S + STAMP_EMBLEM_S;
  if (age <= fadeStart) return 1;
  return 1 - clamp01((age - fadeStart) / STAMP_GLOW_FADE_S);
}

/** Lumen-gold "ka-ching" flash 0..1: instant rise, quadratic fall over POUR_FLASH_S. */
export function pourFlash(age: number): number {
  if (age < 0 || age >= POUR_FLASH_S) return 0;
  return (1 - age / POUR_FLASH_S) ** 2;
}

/** Launch glow 0..1 over RAILSHOT_LAUNCH_S (peak at 0, linear tail). */
export function railshotGlow(age: number): number {
  return age < 0 || age >= RAILSHOT_LAUNCH_S ? 0 : 1 - age / RAILSHOT_LAUNCH_S;
}

/** Inspector's Stamp burst: about 64 stylised grains, all around (rendering-pipeline 11). */
export const STAMP_BURST: StrokeEmission = {
  count: 64,
  speedMin: 0.8,
  speedMax: 2.2,
  elevMin: (30 * Math.PI) / 180,
  elevMax: (70 * Math.PI) / 180,
  spread: Math.PI,
  radiusMin: 0.008,
  radiusMax: 0.02,
  scatter: 0.4,
};

/** Railshot launch burst: about 500 grains kicked up around the rail head (2-5 m/s). */
export const RAILSHOT_BURST: StrokeEmission = {
  count: 500,
  speedMin: 2,
  speedMax: 5,
  elevMin: (35 * Math.PI) / 180,
  elevMax: (80 * Math.PI) / 180,
  spread: Math.PI,
  radiusMin: 0.01,
  radiusMax: 0.03,
  scatter: 0.6,
};

/** One pour tick: a thin clean arc from the hopper lip toward the weighing deck. */
export const POUR_TICK: StrokeEmission = {
  count: 6,
  speedMin: 0.9,
  speedMax: 1.4,
  elevMin: (35 * Math.PI) / 180,
  elevMax: (50 * Math.PI) / 180,
  spread: 0.12,
  radiusMin: 0.008,
  radiusMax: 0.016,
  scatter: 0.02,
};

/** Launch speed that lands a grain `range` metres away on level ground at 45 degrees: v = sqrt(range * g). */
export function pourSpeedForRange(range: number): number {
  return Math.sqrt(Math.max(0, range) * GRAIN_G);
}

export type MomentKind = 0 | 1 | 2;
export const MOMENT_STAMP: MomentKind = 0;
export const MOMENT_POUR: MomentKind = 1;
export const MOMENT_RAILSHOT: MomentKind = 2;

/** Live-effect table: fixed slots, no allocation per event. Readers loop `0..CAPACITY-1` and skip `kind < 0`. */
export class MomentFx {
  static readonly CAPACITY = 16;
  readonly kind = new Int8Array(MomentFx.CAPACITY).fill(-1);
  readonly age = new Float32Array(MomentFx.CAPACITY);
  readonly x = new Float32Array(MomentFx.CAPACITY);
  readonly y = new Float32Array(MomentFx.CAPACITY);
  readonly z = new Float32Array(MomentFx.CAPACITY);
  /** Stamp: hex radius (m); pour: flash scale. */
  readonly size = new Float32Array(MomentFx.CAPACITY);
  private next = 0;

  constructor(private readonly grains: GrainPool | null) {}

  /** Starts a moment at local (x, y, z) on ground height `groundY`; the Railshot bursts immediately. */
  trigger(kind: MomentKind, x: number, y: number, z: number, size = 1, groundY = y): void {
    const i = this.next;
    this.next = (i + 1) % MomentFx.CAPACITY;
    this.kind[i] = kind;
    this.age[i] = 0;
    this.x[i] = x;
    this.y[i] = y;
    this.z[i] = z;
    this.size[i] = size;
    if (kind === MOMENT_RAILSHOT) this.grains?.emitStroke(x, y, z, 0, 0, groundY, RAILSHOT_BURST);
  }

  /** A pour tick toward (dirX, dirZ): call at a few Hz while the Assay Counter pours. */
  pourTick(x: number, y: number, z: number, dirX: number, dirZ: number, groundY: number): void {
    this.grains?.emitStroke(x, y, z, dirX, dirZ, groundY, POUR_TICK);
  }

  /** Advances ages; the Stamp grain burst fires at emblem impact, and finished slots free themselves. */
  update(dt: number): void {
    for (let i = 0; i < MomentFx.CAPACITY; i++) {
      const k = this.kind[i]!;
      if (k < 0) continue;
      const before = this.age[i]!;
      const after = before + dt;
      this.age[i] = after;
      if (k === MOMENT_STAMP) {
        if (before < STAMP_OUTLINE_S && after >= STAMP_OUTLINE_S) {
          this.grains?.emitStroke(this.x[i]!, this.y[i]!, this.z[i]!, 0, 0, this.y[i]!, STAMP_BURST);
        }
        if (after >= STAMP_TOTAL_S) this.kind[i] = -1;
      } else if (k === MOMENT_POUR) {
        if (after >= POUR_FLASH_S) this.kind[i] = -1;
      } else if (after >= RAILSHOT_LAUNCH_S) {
        this.kind[i] = -1;
      }
    }
  }

  liveCount(): number {
    let n = 0;
    for (let i = 0; i < MomentFx.CAPACITY; i++) if (this.kind[i]! >= 0) n++;
    return n;
  }
}
