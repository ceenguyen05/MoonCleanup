// P1 client visuals, part 2 (CPU reference): the procedural dissolve that turns a plot's L0 fraction into a dust mask
// wherever the ring has nothing (WDS 7.8, "P1 style"). A GPU twin would evaluate the same noise per fragment.
import { pcgHash, valueNoise3 } from "../../../../packages/world/src/index";

/** Noise cell of the dissolve in metres (WDS 7.8: 2 m), plus one finer octave for a natural ragged edge. */
export const DISSOLVE_CELL_M = 2;
const FINE_CELL_M = 0.5;
const FINE_WEIGHT = 0.35;
const QUANTILES = 256;

/**
 * Dust mask from an L0 fraction. A point is dusty where its noise value ranks below the remaining fraction R, so the
 * dusty area share of a plot equals R (the quantile table maps R to a noise threshold) and the dust only ever shrinks
 * as R falls (the noise is fixed per plot). `seed` 0 gives one moon-wide field; the documented P1 style seeds per plot.
 */
export class Dissolve {
  /** threshold[q] = noise value below which q / 255 of all points fall. */
  readonly threshold = new Float32Array(QUANTILES);

  constructor() {
    // Empirical distribution of the noise from a fixed lattice-free sample walk (deterministic, built once).
    const n = 1 << 15;
    const samples = new Float32Array(n);
    for (let k = 0; k < n; k++) {
      const a = pcgHash(k * 3 + 1) / 4294967296;
      const b = pcgHash(k * 3 + 2) / 4294967296;
      const c = pcgHash(k * 3 + 3) / 4294967296;
      samples[k] = dissolveNoise(a * 4000, b * 4000, c * 4000, 0);
    }
    samples.sort();
    for (let q = 0; q < QUANTILES; q++) {
      this.threshold[q] = samples[Math.min(n - 1, Math.floor((q / (QUANTILES - 1)) * n))] ?? 1;
    }
    this.threshold[0] = -1;
    this.threshold[QUANTILES - 1] = 2;
  }

  /**
   * Dust presence 0..1 at a moon-centred position in metres. `frac` is the plot's remaining fraction 0..255,
   * `softness` the half-width of the edge in noise units (the GPU derives it from screen-space derivatives).
   */
  coverage(xM: number, yM: number, zM: number, frac: number, seed: number, softness: number): number {
    return this.coverageOf(dissolveNoise(xM, yM, zM, seed), frac, softness);
  }

  /** Same as coverage() for an already evaluated noise value `v` (lets the caller derive softness from fwidth(v)). */
  coverageOf(v: number, frac: number, softness: number): number {
    if (frac >= 255) return 1;
    if (frac <= 0) return 0;
    const thr = this.threshold[frac] ?? 0;
    const t = (thr + softness - v) / (2 * softness);
    const c = t < 0 ? 0 : t > 1 ? 1 : t;
    return c * c * (3 - 2 * c);
  }
}

/** Two-octave value noise of world position, about -1 .. 1. */
export function dissolveNoise(xM: number, yM: number, zM: number, seed: number): number {
  const a = valueNoise3(xM / DISSOLVE_CELL_M, yM / DISSOLVE_CELL_M, zM / DISSOLVE_CELL_M, seed);
  const b = valueNoise3(xM / FINE_CELL_M, yM / FINE_CELL_M, zM / FINE_CELL_M, seed ^ 0x9e3779b9);
  return (a + FINE_WEIGHT * b) / (1 + FINE_WEIGHT);
}

/** Noise seed of a plot (the documented plot-seeded dissolve). */
export function plotSeed(plotId: number): number {
  return pcgHash(plotId ^ 0x50315031);
}
