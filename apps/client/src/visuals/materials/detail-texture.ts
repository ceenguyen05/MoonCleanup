// Procedural, tileable regolith detail tile (M0-W3-T04). Pure CPU maths, no three; original (no source asset, so no
// licence row). One RGBA8 tile feeds both detail scales of the material (pebbles at ~0.6 m per tile, clods at ~4.3 m):
//
//   R  relief height 0..1 (peaks clean first: presence threshold of partial removal, art-direction 3.3)
//   G  d(height)/d(u), packed as 0.5 + 0.5 * g / DETAIL_GRAD_RANGE (g in height-per-tile units)
//   B  d(height)/d(v), packed the same way
//   A  low-frequency albedo breakup 0..1 (0.5 = neutral)
//
// Packed gradients rather than a normal map: the shader scales them per scale and per distance, and mip filtering of a
// signed gradient flattens the relief with distance by itself (no shimmer).

export const DETAIL_SIZE = 256;
/** g is stored over +-DETAIL_GRAD_RANGE (height difference of 1 across 1/DETAIL_GRAD_RANGE of the tile). */
export const DETAIL_GRAD_RANGE = 64;

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Lattice of random values on a `period` x `period` torus. */
function lattice(period: number, rand: () => number): Float32Array {
  const values = new Float32Array(period * period);
  for (let i = 0; i < values.length; i++) values[i] = rand();
  return values;
}

/** Tileable value noise at (u, v) in 0..1 with `period` cells per tile. */
function tileNoise(values: Float32Array, period: number, u: number, v: number): number {
  const x = u * period;
  const y = v * period;
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const at = (a: number, b: number): number =>
    values[(((b % period) + period) % period) * period + (((a % period) + period) % period)] ?? 0;
  const top = at(ix, iy) * (1 - sx) + at(ix + 1, iy) * sx;
  const bottom = at(ix, iy + 1) * (1 - sx) + at(ix + 1, iy + 1) * sx;
  return top * (1 - sy) + bottom * sy;
}

export interface DetailTile {
  readonly size: number;
  readonly data: Uint8Array;
  /** Largest |g| found before packing (must stay below DETAIL_GRAD_RANGE). */
  readonly maxGradient: number;
}

/** Builds the tile. Deterministic for a given seed. */
export function generateDetailTile(size = DETAIL_SIZE, seed = 4711): DetailTile {
  const rand = mulberry32(seed);
  const octaves = [
    { period: 4, weight: 0.3 },
    { period: 8, weight: 0.24 },
    { period: 16, weight: 0.18 },
    { period: 32, weight: 0.12 },
    { period: 64, weight: 0.08 },
    { period: 128, weight: 0.05 },
  ].map((o) => ({ ...o, values: lattice(o.period, rand) }));
  const albedoOctaves = [
    { period: 3, weight: 0.65, values: lattice(3, rand) },
    { period: 9, weight: 0.35, values: lattice(9, rand) },
  ];

  const height = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = (x + 0.5) / size;
      const v = (y + 0.5) / size;
      let h = 0;
      for (const o of octaves) h += tileNoise(o.values, o.period, u, v) * o.weight;
      height[y * size + x] = h;
    }
  }

  // Pebbles: toroidal hemispherical bumps (radius 1.5-6 texels) that sit on the ground noise.
  const pebbles = Math.round((size * size) / 420);
  for (let n = 0; n < pebbles; n++) {
    const cx = rand() * size;
    const cy = rand() * size;
    const r = 1.5 + Math.pow(rand(), 2.2) * 4.5;
    const top = 0.25 + rand() * 0.45;
    const reach = Math.ceil(r);
    for (let dy = -reach; dy <= reach; dy++) {
      for (let dx = -reach; dx <= reach; dx++) {
        const d2 = ((dx + 0.5 - (cx - Math.floor(cx))) ** 2 + (dy + 0.5 - (cy - Math.floor(cy))) ** 2) / (r * r);
        if (d2 >= 1) continue;
        const px = (((Math.floor(cx) + dx) % size) + size) % size;
        const py = (((Math.floor(cy) + dy) % size) + size) % size;
        const k = py * size + px;
        const bump = 0.55 + top * Math.sqrt(1 - d2);
        if (bump > (height[k] ?? 0)) height[k] = bump;
      }
    }
  }

  let lo = Infinity;
  let hi = -Infinity;
  for (const h of height) {
    lo = Math.min(lo, h);
    hi = Math.max(hi, h);
  }
  const span = hi - lo || 1;
  for (let k = 0; k < height.length; k++) height[k] = ((height[k] ?? 0) - lo) / span;

  const data = new Uint8Array(size * size * 4);
  let maxGradient = 0;
  const wrap = (a: number): number => ((a % size) + size) % size;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const k = y * size + x;
      const gu = (((height[y * size + wrap(x + 1)] ?? 0) - (height[y * size + wrap(x - 1)] ?? 0)) * size) / 2;
      const gv = (((height[wrap(y + 1) * size + x] ?? 0) - (height[wrap(y - 1) * size + x] ?? 0)) * size) / 2;
      maxGradient = Math.max(maxGradient, Math.abs(gu), Math.abs(gv));
      const u = (x + 0.5) / size;
      const v = (y + 0.5) / size;
      let a = 0;
      for (const o of albedoOctaves) a += tileNoise(o.values, o.period, u, v) * o.weight;
      const pack = (g: number): number =>
        Math.round(Math.min(Math.max(0.5 + (0.5 * g) / DETAIL_GRAD_RANGE, 0), 1) * 255);
      data[k * 4] = Math.round((height[k] ?? 0) * 255);
      data[k * 4 + 1] = pack(gu);
      data[k * 4 + 2] = pack(gv);
      data[k * 4 + 3] = Math.round(Math.min(Math.max(a, 0), 1) * 255);
    }
  }
  return { size, data, maxGradient };
}
