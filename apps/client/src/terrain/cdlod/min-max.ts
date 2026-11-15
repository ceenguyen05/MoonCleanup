// Min / max height per CDLOD node (WDS section 3.6 "Culling"): a quadtree pyramid over the height cube, built once at
// load. The finest stored level covers 4 x 4 texels per node (level 8 for the 1024 cube, 256^2 nodes per face); deeper
// levels (Ultra's L9) read their stored ancestor. Raw uint16 values are kept (2.1 MB for the 1024 cube).
// Pure: no three, no DOM.

import type { HeightCube } from "@moon-cleanup/world";

const TEXELS_PER_NODE = 4;

export class HeightMinMax {
  /** Finest stored level. */
  readonly baseLevel: number;
  /** Lowest and highest H_base of the whole cube, metres. */
  readonly globalMinM: number;
  readonly globalMaxM: number;
  /** Result of the last `get`, metres (H_base only; callers add their procedural-detail margin). */
  lo = 0;
  hi = 0;

  private readonly mins: Uint16Array[] = [];
  private readonly maxs: Uint16Array[] = [];
  private readonly offsetM: number;
  private readonly scaleM: number;

  constructor(cube: HeightCube) {
    const n = cube.faceSize;
    const baseLevel = Math.round(Math.log2(n / TEXELS_PER_NODE));
    if (baseLevel < 0 || TEXELS_PER_NODE << baseLevel !== n) {
      throw new RangeError(`height cube face ${String(n)} is not ${String(TEXELS_PER_NODE)} x a power of two`);
    }
    this.baseLevel = baseLevel;
    this.offsetM = cube.offsetM;
    this.scaleM = cube.scaleM;

    const p = cube.padded;
    const data = cube.data;
    const side = 1 << baseLevel;
    let mins = new Uint16Array(6 * side * side);
    let maxs = new Uint16Array(6 * side * side);
    // A node spans texel coordinates [4x + 0.5, 4x + 4.5] in padded space, so its bilinear taps are the padded texels
    // 4x .. 4x + 5 (6 x 6), gutter included.
    for (let face = 0; face < 6; face++) {
      const faceBase = face * p * p;
      for (let y = 0; y < side; y++) {
        for (let x = 0; x < side; x++) {
          let lo = 65535;
          let hi = 0;
          for (let j = 0; j < TEXELS_PER_NODE + 2; j++) {
            const row = faceBase + (y * TEXELS_PER_NODE + j) * p + x * TEXELS_PER_NODE;
            for (let i = 0; i < TEXELS_PER_NODE + 2; i++) {
              const v = data[row + i]!;
              if (v < lo) lo = v;
              if (v > hi) hi = v;
            }
          }
          const k = (face * side + y) * side + x;
          mins[k] = lo;
          maxs[k] = hi;
        }
      }
    }
    this.mins[baseLevel] = mins;
    this.maxs[baseLevel] = maxs;
    for (let level = baseLevel - 1; level >= 0; level--) {
      const s = 1 << level;
      const s2 = s * 2;
      const nextMins = new Uint16Array(6 * s * s);
      const nextMaxs = new Uint16Array(6 * s * s);
      for (let face = 0; face < 6; face++) {
        for (let y = 0; y < s; y++) {
          for (let x = 0; x < s; x++) {
            const c = (face * s2 + y * 2) * s2 + x * 2;
            nextMins[(face * s + y) * s + x] = Math.min(mins[c]!, mins[c + 1]!, mins[c + s2]!, mins[c + s2 + 1]!);
            nextMaxs[(face * s + y) * s + x] = Math.max(maxs[c]!, maxs[c + 1]!, maxs[c + s2]!, maxs[c + s2 + 1]!);
          }
        }
      }
      mins = nextMins;
      maxs = nextMaxs;
      this.mins[level] = mins;
      this.maxs[level] = maxs;
    }
    let gLo = 65535;
    let gHi = 0;
    for (let k = 0; k < 6; k++) {
      gLo = Math.min(gLo, mins[k]!);
      gHi = Math.max(gHi, maxs[k]!);
    }
    this.globalMinM = cube.offsetM + gLo * cube.scaleM;
    this.globalMaxM = cube.offsetM + gHi * cube.scaleM;
  }

  /** Bytes held by the pyramid. */
  get byteLength(): number {
    let total = 0;
    for (const a of this.mins) total += a.byteLength * 2;
    return total;
  }

  /** Writes `lo` / `hi` for node (face, level, x, y). Allocation-free. */
  get(face: number, level: number, x: number, y: number): void {
    let l = level;
    let nx = x;
    let ny = y;
    if (l > this.baseLevel) {
      const shift = l - this.baseLevel;
      nx >>= shift;
      ny >>= shift;
      l = this.baseLevel;
    }
    const side = 1 << l;
    const k = (face * side + ny) * side + nx;
    this.lo = this.offsetM + this.mins[l]![k]! * this.scaleM;
    this.hi = this.offsetM + this.maxs[l]![k]! * this.scaleM;
  }
}
