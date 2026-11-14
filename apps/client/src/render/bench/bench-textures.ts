// GPU textures of the bench's terrain stub (M0-W2-T02). One owner (`BenchTextures`), one `dispose()`.
// All data is procedural (terrain-data.ts and the noise below); nothing is loaded, nothing is licensed.

import {
  ClampToEdgeWrapping,
  DataTexture,
  FloatType,
  LinearFilter,
  LinearMipmapLinearFilter,
  NearestFilter,
  RGBAFormat,
  RedFormat,
  RepeatWrapping,
  UnsignedByteType,
  type Texture,
} from "three/webgpu";
import {
  PLOT_ID_SIZE,
  PLOT_PACK_HEIGHT,
  PLOT_PACK_WIDTH,
  bakeHorizonImages,
  benchStrokes,
  buildPlotData,
  mulberry32,
  rasterizeDust,
} from "./terrain-data";

export const ATLAS_SIZE = 1024;
/** The atlas covers 128 m (12.5 cm texels); the ring 40 m (3.9 cm texels) around the origin. */
export const ATLAS_HALF_EXTENT_M = 64;
export const RING_SIZE = 1024;
export const RING_HALF_EXTENT_M = 20;
export const HORIZON_SIZE = 256;
export const HORIZON_HALF_EXTENT_M = 512;
export const DETAIL_SIZE = 256;

/** Periodic value noise (period `cells` over the image) summed over three octaves; fills 4 channels. */
export function makeDetailImage(seed: number, size: number): Uint8Array {
  const rand = mulberry32(seed);
  const out = new Uint8Array(size * size * 4);
  const octaves = [8, 16, 32];
  const lattices = octaves.map((n) => {
    const per = new Float32Array(n * n * 4);
    for (let i = 0; i < per.length; i++) per[i] = rand();
    return per;
  });
  const fade = (t: number): number => t * t * (3 - 2 * t);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      for (let ch = 0; ch < 4; ch++) {
        let v = 0;
        let amp = 0.55;
        let norm = 0;
        for (let o = 0; o < octaves.length; o++) {
          const n = octaves[o] ?? 8;
          const lat = lattices[o];
          if (lat === undefined) continue;
          const fx = (x / size) * n;
          const fy = (y / size) * n;
          const ix = Math.floor(fx);
          const iy = Math.floor(fy);
          const tx = fade(fx - ix);
          const ty = fade(fy - iy);
          const at = (px: number, py: number): number => lat[(((py % n) * n + (px % n)) * 4 + ch) | 0] ?? 0;
          const top = at(ix, iy) * (1 - tx) + at(ix + 1, iy) * tx;
          const bottom = at(ix, iy + 1) * (1 - tx) + at(ix + 1, iy + 1) * tx;
          v += (top * (1 - ty) + bottom * ty) * amp;
          norm += amp;
          amp *= 0.5;
        }
        out[(y * size + x) * 4 + ch] = Math.round((v / norm) * 255);
      }
    }
  }
  return out;
}

function rgba8(data: Uint8Array, width: number, height: number): DataTexture {
  const t = new DataTexture(data, width, height, RGBAFormat, UnsignedByteType);
  t.needsUpdate = true;
  return t;
}

function mipmapped(t: DataTexture, anisotropy: number, wrap: boolean): DataTexture {
  t.generateMipmaps = true;
  t.minFilter = LinearMipmapLinearFilter;
  t.magFilter = LinearFilter;
  t.anisotropy = anisotropy;
  if (wrap) {
    t.wrapS = RepeatWrapping;
    t.wrapT = RepeatWrapping;
  }
  t.needsUpdate = true;
  return t;
}

function nearest(t: DataTexture): DataTexture {
  t.minFilter = NearestFilter;
  t.magFilter = NearestFilter;
  t.generateMipmaps = false;
  t.wrapS = ClampToEdgeWrapping;
  t.wrapT = ClampToEdgeWrapping;
  t.needsUpdate = true;
  return t;
}

function linearClamped(t: DataTexture): DataTexture {
  t.minFilter = LinearFilter;
  t.magFilter = LinearFilter;
  t.generateMipmaps = false;
  t.wrapS = ClampToEdgeWrapping;
  t.wrapT = ClampToEdgeWrapping;
  t.needsUpdate = true;
  return t;
}

export class BenchTextures {
  /** One RGBA detail texture: the three layers sample it at three scales and read r, g and b. */
  readonly detail: DataTexture;
  readonly atlas: DataTexture;
  readonly atlasDirection: DataTexture;
  readonly ring: DataTexture;
  readonly ringDirection: DataTexture;
  /** Horizon azimuths 0-3 in the left half, 4-7 in the right half (2 * HORIZON_SIZE wide). */
  readonly horizon: DataTexture;
  readonly plotId: DataTexture;
  /** Plot centres, neighbours and table packed in one RGBA32F texture (terrain-data.ts PLOT_PACK_*). */
  readonly plotData: DataTexture;
  /** Bytes of texture data held (base level only; mipmaps add about a third on the mipmapped ones). */
  readonly bytes: number;

  constructor(anisotropy: number) {
    const strokes = benchStrokes();
    this.detail = mipmapped(rgba8(makeDetailImage(11, DETAIL_SIZE), DETAIL_SIZE, DETAIL_SIZE), anisotropy, true);
    const atlas = rasterizeDust(ATLAS_SIZE, ATLAS_HALF_EXTENT_M, strokes);
    const ring = rasterizeDust(RING_SIZE, RING_HALF_EXTENT_M, strokes);
    this.atlas = linearClamped(rgba8(atlas.rgba, ATLAS_SIZE, ATLAS_SIZE));
    this.ring = linearClamped(rgba8(ring.rgba, RING_SIZE, RING_SIZE));
    this.atlasDirection = linearClamped(
      new DataTexture(atlas.direction, ATLAS_SIZE, ATLAS_SIZE, RedFormat, UnsignedByteType),
    );
    this.ringDirection = linearClamped(
      new DataTexture(ring.direction, RING_SIZE, RING_SIZE, RedFormat, UnsignedByteType),
    );
    const horizon = bakeHorizonImages(HORIZON_SIZE, HORIZON_HALF_EXTENT_M);
    const joined = new Uint8Array(HORIZON_SIZE * 2 * HORIZON_SIZE * 4);
    for (let row = 0; row < HORIZON_SIZE; row++) {
      joined.set(horizon.a.subarray(row * HORIZON_SIZE * 4, (row + 1) * HORIZON_SIZE * 4), row * HORIZON_SIZE * 8);
      joined.set(
        horizon.b.subarray(row * HORIZON_SIZE * 4, (row + 1) * HORIZON_SIZE * 4),
        row * HORIZON_SIZE * 8 + HORIZON_SIZE * 4,
      );
    }
    this.horizon = linearClamped(rgba8(joined, HORIZON_SIZE * 2, HORIZON_SIZE));
    const plots = buildPlotData(strokes);
    this.plotId = nearest(rgba8(plots.idImage, PLOT_ID_SIZE, PLOT_ID_SIZE));
    this.plotData = nearest(new DataTexture(plots.packed, PLOT_PACK_WIDTH, PLOT_PACK_HEIGHT, RGBAFormat, FloatType));
    for (const t of [this.atlasDirection, this.ringDirection]) t.needsUpdate = true;

    this.bytes =
      DETAIL_SIZE * DETAIL_SIZE * 5 +
      ATLAS_SIZE * ATLAS_SIZE * 5 +
      RING_SIZE * RING_SIZE * 5 +
      2 * HORIZON_SIZE * HORIZON_SIZE * 4 +
      PLOT_ID_SIZE * PLOT_ID_SIZE * 4 +
      PLOT_PACK_WIDTH * PLOT_PACK_HEIGHT * 16;
  }

  all(): Texture[] {
    return [
      this.detail,
      this.atlas,
      this.atlasDirection,
      this.ring,
      this.ringDirection,
      this.horizon,
      this.plotId,
      this.plotData,
    ];
  }

  setAnisotropy(anisotropy: number): void {
    if (this.detail.anisotropy !== anisotropy) {
      this.detail.anisotropy = anisotropy;
      this.detail.needsUpdate = true;
    }
  }

  dispose(): void {
    for (const t of this.all()) t.dispose();
  }
}
