// Stand-in terrain DATA of bench v0 (M0-W2-T02), pure and deterministic: a procedural height function on a sphere,
// the 64-chunk layout, dust strokes rasterised into atlas / ring images, a horizon map and a plot table.
//
// Bench v1 (M0-W3-T07): `setTerrainHeightSource` swaps `terrainHeightM` for the baked height cube; the dust images, plot
// tables and horizon images below only feed the v0 stand-in path (`terrain=standin`), whose shader (terrain-material.ts)
// keeps its fetch and ALU count. The real path uses bench-mask.ts and the regolith material instead.

/** Moon radius (world-and-dust-simulation.md section 1). The bench puts the moon centre 2 km below the origin. */
export const MOON_RADIUS_M = 2000;

/** World-space chunk boundaries along x and z (metres): small chunks near the origin, large ones far away. 8 x 8 = 64. */
export const CHUNK_EDGES_M: readonly number[] = [-900, -260, -80, -24, 0, 24, 80, 260, 900];
export const CHUNK_QUADS = 32;

export interface ChunkRect {
  readonly index: number;
  readonly x0: number;
  readonly x1: number;
  readonly z0: number;
  readonly z1: number;
  /** Chunks within 260 m of the origin cast shadows (the others are beyond every CSM far distance). */
  readonly castsShadow: boolean;
}

export function chunkRects(): ChunkRect[] {
  const out: ChunkRect[] = [];
  const n = CHUNK_EDGES_M.length - 1;
  for (let iz = 0; iz < n; iz++) {
    for (let ix = 0; ix < n; ix++) {
      const x0 = CHUNK_EDGES_M[ix] ?? 0;
      const x1 = CHUNK_EDGES_M[ix + 1] ?? 0;
      const z0 = CHUNK_EDGES_M[iz] ?? 0;
      const z1 = CHUNK_EDGES_M[iz + 1] ?? 0;
      const castsShadow = Math.max(Math.abs(x0), Math.abs(x1), Math.abs(z0), Math.abs(z1)) <= 260;
      out.push({ index: iz * n + ix, x0, x1, z0, z1, castsShadow });
    }
  }
  return out;
}

// ---- Height ------------------------------------------------------------------------------------------------------

interface Crater {
  readonly x: number;
  readonly z: number;
  readonly radius: number;
  readonly depth: number;
}
const CRATERS: readonly Crater[] = [
  { x: 46, z: -34, radius: 15, depth: 2.4 },
  { x: -72, z: 24, radius: 10, depth: 1.5 },
  { x: 22, z: 74, radius: 22, depth: 3.2 },
  { x: -34, z: -66, radius: 7, depth: 1.0 },
];

/** Planar-offset height function that replaces the procedural stand-in (bench v1: the baked height cube). */
export type HeightSource = (x: number, z: number) => number;
let heightSource: HeightSource | null = null;

/**
 * Bench v1 (M0-W3-T07): routes `terrainHeightM`, `groundY` and the chunk builder to the real baked cube. `null` restores
 * the v0 stand-in. Set before anything that places objects on the ground is built.
 */
export function setTerrainHeightSource(source: HeightSource | null): void {
  heightSource = source;
}

/** Ground height above the sphere (metres) at planar offset (x, z): rolling terrain plus four craters. */
export function terrainHeightM(x: number, z: number): number {
  if (heightSource !== null) return heightSource(x, z);
  let h =
    0.9 * Math.sin(x * 0.045 + 0.6) * Math.cos(z * 0.039 - 0.3) +
    0.35 * Math.sin(x * 0.12 + z * 0.09 + 1.7) +
    0.12 * Math.sin(x * 0.41 - 0.7) * Math.sin(z * 0.37 + 0.2) +
    0.04 * Math.sin(x * 1.3 + z * 1.1);
  for (const c of CRATERS) {
    const d = Math.hypot(x - c.x, z - c.z);
    if (d < c.radius) {
      const u = d / c.radius;
      h -= c.depth * (1 - u * u);
    }
    const rim = (d - c.radius) / (0.18 * c.radius);
    h += 0.28 * c.depth * Math.exp(-rim * rim);
  }
  // The outpost pad is levelled.
  const pad = Math.hypot(x, z);
  if (pad < 14) {
    const w = 1 - Math.min(1, Math.max(0, (pad - 9) / 5));
    h = h * (1 - w);
  }
  return h;
}

/**
 * Point on the sphere under planar offset (x, z) lifted by `h`: direction from the moon centre (0, -R, 0) through
 * (x, 0, z) in the tangent plane (gnomonic mapping). At (0, 0) it returns (0, h, 0).
 */
export function surfacePoint(x: number, z: number, h: number, out: { x: number; y: number; z: number }): void {
  const len = Math.sqrt(x * x + MOON_RADIUS_M * MOON_RADIUS_M + z * z);
  const r = MOON_RADIUS_M + h;
  out.x = (x / len) * r;
  out.y = -MOON_RADIUS_M + (MOON_RADIUS_M / len) * r;
  out.z = (z / len) * r;
}

/** Height of the ground (world y) under (x, z), for camera and prop placement. Allocation-free. */
const _p = { x: 0, y: 0, z: 0 };
export function groundY(x: number, z: number): number {
  surfacePoint(x, z, terrainHeightM(x, z), _p);
  return _p.y;
}

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

// ---- Dust strokes ------------------------------------------------------------------------------------------------

export interface Stroke {
  readonly ax: number;
  readonly az: number;
  readonly bx: number;
  readonly bz: number;
  /** Brush width in metres. */
  readonly width: number;
  /** Share of the plot's dust one pass removes, 0-1 (thinning: below 1 leaves a lighter layer). */
  readonly strength: number;
}

/** A serpentine of Lane Broom passes in the atlas area, a thinner second pass, and a few strokes near the outpost. */
export function benchStrokes(): Stroke[] {
  const out: Stroke[] = [];
  // Lanes 1.6 m wide on a 2.2 m pitch: each leaves a 0.6 m ridge of dust (with its berm) between two clean paths.
  for (let i = 0; i < 8; i++) {
    const z = -38 + i * 2.2;
    const ltr = i % 2 === 0;
    out.push({ ax: ltr ? -44 : 44, az: z, bx: ltr ? 44 : -44, bz: z, width: 1.6, strength: i === 5 ? 0.55 : 1 });
  }
  for (let i = 0; i < 4; i++) {
    out.push({ ax: -50, az: -17 + i * 1.8, bx: -4, bz: -17 + i * 1.8, width: 0.9, strength: 0.6 });
  }
  // Outpost surroundings (inside the detail ring): a lane from the habitat door, a diagonal that leaves the ring.
  out.push({ ax: 0, az: -11, bx: 12, bz: -18, width: 1.2, strength: 1 });
  out.push({ ax: -18, az: 12, bx: 19, bz: 17, width: 1.6, strength: 1 });
  // Desk Duster scribbles (0.15 m, narrower than an atlas texel).
  for (let i = 0; i < 6; i++) {
    out.push({
      ax: -9 + i * 0.5,
      az: 8,
      bx: -9 + i * 0.5 + 3,
      bz: 8 + (i % 2 === 0 ? 1.4 : -1.4),
      width: 0.15,
      strength: 1,
    });
  }
  return out;
}

export interface DustImages {
  /** RGBA8: R remaining dust (255 grimy), G unpolish, B untrampled, A berm height. */
  readonly rgba: Uint8Array;
  /** R8 stroke heading where coverage > 0.5 (0..255 over 360 degrees). */
  readonly direction: Uint8Array;
  readonly size: number;
}

/**
 * Rasterises strokes into an image covering `[-halfExtentM, +halfExtentM]` on both axes. Semantics follow
 * world-and-dust-simulation.md section 7.3: R <- R - s * c, G <- G - 0.25 * c, A <- max(A, berm profile). The
 * coverage c has a one-texel anti-aliased edge (analytic), so a stroke narrower than a texel stays a faint line.
 */
export function rasterizeDust(size: number, halfExtentM: number, strokes: readonly Stroke[]): DustImages {
  const rgba = new Uint8Array(size * size * 4);
  const direction = new Uint8Array(size * size);
  const texel = (2 * halfExtentM) / size;
  const remaining = new Float32Array(size * size).fill(1);
  const unpolish = new Float32Array(size * size).fill(1);
  const berm = new Float32Array(size * size);
  for (const s of strokes) {
    const bandOuter = s.width / 2 + Math.max(0.15, 0.3 * s.width);
    const pad = bandOuter + texel;
    const minX = Math.max(0, Math.floor((Math.min(s.ax, s.bx) - pad + halfExtentM) / texel));
    const maxX = Math.min(size - 1, Math.ceil((Math.max(s.ax, s.bx) + pad + halfExtentM) / texel));
    const minZ = Math.max(0, Math.floor((Math.min(s.az, s.bz) - pad + halfExtentM) / texel));
    const maxZ = Math.min(size - 1, Math.ceil((Math.max(s.az, s.bz) + pad + halfExtentM) / texel));
    const dx = s.bx - s.ax;
    const dz = s.bz - s.az;
    const len2 = dx * dx + dz * dz;
    const heading = Math.round(((Math.atan2(dz, dx) / (2 * Math.PI) + 0.5) % 1) * 255);
    for (let j = minZ; j <= maxZ; j++) {
      const pz = (j + 0.5) * texel - halfExtentM;
      for (let i = minX; i <= maxX; i++) {
        const px = (i + 0.5) * texel - halfExtentM;
        const t = len2 === 0 ? 0 : Math.min(1, Math.max(0, ((px - s.ax) * dx + (pz - s.az) * dz) / len2));
        const d = Math.hypot(px - (s.ax + dx * t), pz - (s.az + dz * t));
        const c = Math.min(1, Math.max(0, 0.5 + (s.width / 2 - d) / texel));
        const k = j * size + i;
        if (c > 0) {
          // s.c is quantised to 1/255 before subtracting so overlapping strokes commute (section 7.3).
          const q = Math.round(c * s.strength * 255) / 255;
          remaining[k] = Math.max(0, (remaining[k] ?? 1) - q);
          unpolish[k] = Math.max(0, (unpolish[k] ?? 1) - 0.25 * c);
          if (c > 0.5) direction[k] = heading;
        } else if (d < bandOuter) {
          const u = (d - s.width / 2) / (bandOuter - s.width / 2);
          const profile = u < 0.35 ? u / 0.35 : (1 - u) / 0.65;
          berm[k] = Math.max(berm[k] ?? 0, profile * s.strength);
        }
      }
    }
  }
  for (let k = 0; k < size * size; k++) {
    rgba[k * 4] = Math.round((remaining[k] ?? 1) * 255);
    rgba[k * 4 + 1] = Math.round((unpolish[k] ?? 1) * 255);
    rgba[k * 4 + 2] = 255;
    rgba[k * 4 + 3] = Math.round((berm[k] ?? 0) * 255);
  }
  return { rgba, direction, size };
}

// ---- Horizon map -------------------------------------------------------------------------------------------------

/**
 * Two RGBA8 images (8 azimuths, 8 bits each) of the horizon elevation, scaled so 255 = 45 degrees. Gentle ground
 * (about 2 degrees) with raised horizons behind the craters, so the shader's smoothstep has something to read.
 */
export function bakeHorizonImages(size: number, halfExtentM: number): { a: Uint8Array; b: Uint8Array } {
  const a = new Uint8Array(size * size * 4);
  const b = new Uint8Array(size * size * 4);
  const texel = (2 * halfExtentM) / size;
  for (let j = 0; j < size; j++) {
    const z = (j + 0.5) * texel - halfExtentM;
    for (let i = 0; i < size; i++) {
      const x = (i + 0.5) * texel - halfExtentM;
      const base = 2 + 1.5 * Math.sin(x * 0.03) * Math.cos(z * 0.025);
      for (let az = 0; az < 8; az++) {
        const ang = (az / 8) * Math.PI * 2;
        // Probe 70 m along the azimuth: the rim of a crater there lifts the horizon.
        const h0 = terrainHeightM(x, z);
        const h1 = terrainHeightM(x + Math.cos(ang) * 70, z + Math.sin(ang) * 70);
        const elev = Math.max(base, (Math.atan2(h1 - h0, 70) * 180) / Math.PI + base);
        const v = Math.min(255, Math.max(0, Math.round((elev / 45) * 255)));
        const arr = az < 4 ? a : b;
        arr[(j * size + i) * 4 + (az % 4)] = v;
      }
    }
  }
  return { a, b };
}

// ---- Plot table --------------------------------------------------------------------------------------------------

export const PLOT_SPACING_M = 19;
export const PLOT_GRID = 54;
export const PLOT_TABLE_WIDTH = 64;
/** Packed plot data texture: 128 x 192 RGBA32F (centres rows 0-63, neighbours 64-127, table 128-191). One binding. */
export const PLOT_PACK_WIDTH = 128;
export const PLOT_PACK_HEIGHT = 192;
export const PLOT_ROW_CENTRES = 0;
export const PLOT_ROW_NEIGHBOURS = 64;
export const PLOT_ROW_TABLE = 128;
export const PLOT_ID_SIZE = 512;
export const PLOT_ID_HALF_EXTENT_M = 512;

export interface PlotData {
  readonly plotCount: number;
  /** RGBA8 `PLOT_ID_SIZE`^2: plot index low byte, high byte. */
  readonly idImage: Uint8Array;
  /**
   * RGBA32F `PLOT_PACK_WIDTH` x `PLOT_PACK_HEIGHT`. Centres: unit direction of the plot centre (xyz) at
   * (col, row + PLOT_ROW_CENTRES). Neighbours: two texels per plot at (2 col + 0|1, row + PLOT_ROW_NEIGHBOURS), six
   * indices (4 + 2). Table: R remaining (1 grimy, 0 clean), G state / 2 at (col, row + PLOT_ROW_TABLE).
   * col = index mod 64, row = floor(index / 64).
   */
  readonly packed: Float32Array;
}

export function buildPlotData(strokes: readonly Stroke[]): PlotData {
  const n = PLOT_GRID;
  const count = n * n;
  const rand = mulberry32(0x5eed);
  const cx = new Float32Array(count);
  const cz = new Float32Array(count);
  for (let iz = 0; iz < n; iz++) {
    for (let ix = 0; ix < n; ix++) {
      const k = iz * n + ix;
      cx[k] = (ix - n / 2 + 0.5 + (rand() - 0.5) * 0.35) * PLOT_SPACING_M;
      cz[k] = (iz - n / 2 + 0.5 + (rand() - 0.5) * 0.35) * PLOT_SPACING_M;
    }
  }
  const packed = new Float32Array(PLOT_PACK_WIDTH * PLOT_PACK_HEIGHT * 4);
  const texelAt = (x: number, y: number): number => (y * PLOT_PACK_WIDTH + x) * 4;
  const R = MOON_RADIUS_M;
  for (let k = 0; k < count; k++) {
    const x = cx[k] ?? 0;
    const z = cz[k] ?? 0;
    const len = Math.sqrt(x * x + R * R + z * z);
    const col = k % PLOT_TABLE_WIDTH;
    const row = Math.floor(k / PLOT_TABLE_WIDTH);
    const c0 = texelAt(col, PLOT_ROW_CENTRES + row);
    packed[c0] = x / len;
    packed[c0 + 1] = R / len;
    packed[c0 + 2] = z / len;
    // A plot is Polished when a stroke passes within 4 m of its centre (a coarse stand-in for the ledger).
    let clean = false;
    for (const s of strokes) {
      if (s.width < 0.5) continue;
      const dx = s.bx - s.ax;
      const dz = s.bz - s.az;
      const t = Math.min(1, Math.max(0, ((x - s.ax) * dx + (z - s.az) * dz) / (dx * dx + dz * dz)));
      if (Math.hypot(x - (s.ax + dx * t), z - (s.az + dz * t)) < 4 && s.strength > 0.9) {
        clean = true;
        break;
      }
    }
    const t0 = texelAt(col, PLOT_ROW_TABLE + row);
    packed[t0] = clean ? 0 : 1;
    packed[t0 + 1] = clean ? 1 : 0;
    // Six nearest neighbours by planar distance (grid search over the 5 x 5 block).
    const ix = k % n;
    const iz = Math.floor(k / n);
    const near: { id: number; d: number }[] = [];
    for (let oz = -2; oz <= 2; oz++) {
      for (let ox = -2; ox <= 2; ox++) {
        if (ox === 0 && oz === 0) continue;
        const jx = ix + ox;
        const jz = iz + oz;
        if (jx < 0 || jz < 0 || jx >= n || jz >= n) continue;
        const j = jz * n + jx;
        near.push({ id: j, d: Math.hypot((cx[j] ?? 0) - x, (cz[j] ?? 0) - z) });
      }
    }
    near.sort((p, q) => p.d - q.d);
    for (let m = 0; m < 6; m++) {
      const id = near[m]?.id ?? k;
      packed[texelAt(col * 2 + (m < 4 ? 0 : 1), PLOT_ROW_NEIGHBOURS + row) + (m % 4)] = id;
    }
  }
  const idImage = new Uint8Array(PLOT_ID_SIZE * PLOT_ID_SIZE * 4);
  const texel = (2 * PLOT_ID_HALF_EXTENT_M) / PLOT_ID_SIZE;
  for (let j = 0; j < PLOT_ID_SIZE; j++) {
    const z = (j + 0.5) * texel - PLOT_ID_HALF_EXTENT_M;
    for (let i = 0; i < PLOT_ID_SIZE; i++) {
      const x = (i + 0.5) * texel - PLOT_ID_HALF_EXTENT_M;
      const gx = Math.floor(x / PLOT_SPACING_M + n / 2);
      const gz = Math.floor(z / PLOT_SPACING_M + n / 2);
      let best = 0;
      let bestD = Number.POSITIVE_INFINITY;
      for (let oz = -1; oz <= 1; oz++) {
        for (let ox = -1; ox <= 1; ox++) {
          const jx = Math.min(n - 1, Math.max(0, gx + ox));
          const jz = Math.min(n - 1, Math.max(0, gz + oz));
          const id = jz * n + jx;
          const d = Math.hypot((cx[id] ?? 0) - x, (cz[id] ?? 0) - z);
          if (d < bestD) {
            bestD = d;
            best = id;
          }
        }
      }
      const o = (j * PLOT_ID_SIZE + i) * 4;
      idImage[o] = best & 255;
      idImage[o + 1] = best >> 8;
      idImage[o + 3] = 255;
    }
  }
  return { plotCount: count, idImage, packed };
}
