// Procedural naked-eye star catalogue (rendering-pipeline.md section 6 allows "HYG-derived or procedural"; no Gaia, no
// third-party data, so there is nothing to attribute). Seeded and deterministic: the same sky on every machine and run.
// Pure: no three, no DOM.
//
// Counts per magnitude bin follow the real sky (about 9,100 stars with V <= 6.5; roughly 3x more per magnitude).

export interface StarCatalog {
  readonly count: number;
  /** Unit directions in the world frame, 3 floats per star. */
  readonly dirs: Float32Array;
  /** Visual magnitude per star. */
  readonly mag: Float32Array;
  /** Linear RGB tint (luminance about 1), 3 floats per star. */
  readonly colour: Float32Array;
}

/** [lowest magnitude, highest magnitude, number of stars in the bin]. */
export const MAGNITUDE_BINS: readonly (readonly [number, number, number])[] = [
  [-1.5, 1.5, 22],
  [1.5, 2.5, 66],
  [2.5, 3.5, 190],
  [3.5, 4.5, 610],
  [4.5, 5.5, 1840],
  [5.5, 6.5, 5570],
];

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

/** Linear RGB tint for a B-V colour index: blue-white (-0.2), white (0.3), yellow (0.8), orange (1.4). Writes `out[at..at+2]`. */
export function tintForColourIndex(bv: number, out: Float32Array, at: number): void {
  const stops: readonly (readonly [number, number, number, number])[] = [
    [-0.3, 0.62, 0.75, 1.0],
    [0.3, 1.0, 0.98, 0.96],
    [0.8, 1.0, 0.88, 0.66],
    [1.5, 1.0, 0.66, 0.4],
  ];
  const clamped = Math.min(1.5, Math.max(-0.3, bv));
  let r = 1;
  let g = 1;
  let b = 1;
  for (let i = 1; i < stops.length; i++) {
    const a = stops[i - 1];
    const c = stops[i];
    if (a === undefined || c === undefined) continue;
    if (clamped <= c[0]) {
      const t = (clamped - a[0]) / (c[0] - a[0]);
      r = a[1] + (c[1] - a[1]) * t;
      g = a[2] + (c[2] - a[2]) * t;
      b = a[3] + (c[3] - a[3]) * t;
      break;
    }
  }
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  out[at] = r / lum;
  out[at + 1] = g / lum;
  out[at + 2] = b / lum;
}

export function generateStars(seed = 20261117, bins: typeof MAGNITUDE_BINS = MAGNITUDE_BINS): StarCatalog {
  const rand = mulberry32(seed);
  let count = 0;
  for (const bin of bins) count += bin[2];
  const dirs = new Float32Array(count * 3);
  const mag = new Float32Array(count);
  const colour = new Float32Array(count * 3);
  let i = 0;
  for (const [lo, hi, n] of bins) {
    for (let k = 0; k < n; k++, i++) {
      // Uniform on the sphere.
      const z = rand() * 2 - 1;
      const phi = rand() * Math.PI * 2;
      const r = Math.sqrt(1 - z * z);
      dirs[i * 3] = r * Math.cos(phi);
      dirs[i * 3 + 1] = z;
      dirs[i * 3 + 2] = r * Math.sin(phi);
      // Within a bin the count rises about 10^(0.5 m): invert the CDF of an exponential density.
      const a = Math.pow(10, 0.5 * lo);
      const b = Math.pow(10, 0.5 * hi);
      mag[i] = 2 * Math.log10(a + rand() * (b - a));
      // Colour index: most stars are white to yellow, a tail of blue and orange giants.
      const u = rand();
      const bv = u < 0.18 ? -0.25 + rand() * 0.45 : u < 0.7 ? 0.2 + rand() * 0.6 : 0.8 + rand() * 0.7;
      tintForColourIndex(bv, colour, i * 3);
    }
  }
  return { count, dirs, mag, colour };
}

/** Limiting magnitude from the scripted exposure (rendering-pipeline section 6): 6.5 at night, about 2.5 at noon. */
export function limitingMagnitude(ev100: number, presetCap = 6.5): number {
  const m = 6.5 - (ev100 - 7.3) * (4 / 7);
  return Math.min(presetCap, Math.max(2.0, Math.min(6.5, m)));
}

/** Peak scene-linear value of a star of magnitude `mag` (about 4x per two magnitudes, clamped below the bloom threshold). */
export function starPeak(mag: number): number {
  return Math.min(2.6, 0.045 * Math.pow(10, -0.4 * (mag - 6.5) * 0.62));
}

/** Gaussian radius of the star disk in output pixels: 1.2 (faintest) to 2.0 (brightest). */
export function starRadiusPx(mag: number): number {
  const t = Math.min(1, Math.max(0, (6.5 - mag) / 8));
  return 1.2 + 0.8 * t;
}
