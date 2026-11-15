// End-of-tick state quantisation and the FNV-1a state hash used by golden replays.
//
// Authoritative kinematic state (positions, velocities, facing, tool-head points) is rounded to a 2^-16 grid at the
// end of every tick. The only engine-dependent math on the sim path is the ground height (packages/world uses
// Math.atan for the cube-face projection, about 1e-13 m between engines); rounding to 1.5e-5 m collapses those
// last-bit differences so Node, browsers and the Web Worker keep identical state tick after tick (ADR-0010 still holds:
// the server wins if a boundary case ever flips).

/** Quantisation scale: values are multiples of 1 / STATE_QUANTUM_SCALE (2^-16 m, m/s). */
export const STATE_QUANTUM_SCALE = 65_536;

/** Rounds `x` to the state grid (never returns -0). */
export function quantize(x: number): number {
  return Math.round(x * STATE_QUANTUM_SCALE) / STATE_QUANTUM_SCALE + 0;
}

/** FNV-1a 32 offset basis and prime (same constants as the dust ledger hash). */
export const FNV_OFFSET = 0x811c9dc5;
export const FNV_PRIME = 0x01000193;

/** Incremental FNV-1a over 32-bit integers (little-endian bytes). */
export class Fnv1a32 {
  private h = FNV_OFFSET;

  reset(): void {
    this.h = FNV_OFFSET;
  }

  /** Mixes the 4 little-endian bytes of the int32 `v`. */
  int(v: number): void {
    let h = this.h;
    const x = v | 0;
    h = Math.imul(h ^ (x & 0xff), FNV_PRIME);
    h = Math.imul(h ^ ((x >>> 8) & 0xff), FNV_PRIME);
    h = Math.imul(h ^ ((x >>> 16) & 0xff), FNV_PRIME);
    h = Math.imul(h ^ ((x >>> 24) & 0xff), FNV_PRIME);
    this.h = h;
  }

  /** Mixes a quantised real as two int32 words (exact for |x| < 2^37 / STATE_QUANTUM_SCALE). */
  real(x: number): void {
    const q = Math.round(x * STATE_QUANTUM_SCALE);
    const hi = Math.floor(q / 4294967296);
    this.int(q - hi * 4294967296);
    this.int(hi);
  }

  get value(): number {
    return this.h >>> 0;
  }
}
