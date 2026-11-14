// Static dust mask of bench v1 (M0-W3-T07): the "berm from a static mask" input of the real regolith material. A plain RGBA8
// sampled texture filled CPU-side (the WebGL2 backend cannot write storage textures), following the mask contract of
// visuals/materials/mask-texture.ts: R remaining dust, G berm height, B polish, one world rectangle, dusty border.
// The strokes mirror the v0 bench dust (serpentine of Lane Broom passes, outpost lanes, Desk Duster scribbles) so the
// two terrain paths show the same worksite.

import {
  createMaskBuffer,
  createMaskTextureFromBuffer,
  stampStroke,
  type MaskBuffer,
  type MaskWorldRect,
  type StrokeSpec,
} from "../../visuals/materials";
import type { DataTexture } from "three/webgpu";

/** World rectangle the mask covers: 64 m x 64 m around the worksite, 3.1 cm texels at 2048^2 (M1 ring: 2.5 cm). */
export const BENCH_MASK_RECT: MaskWorldRect = { originX: -32, originZ: -52, sizeX: 64, sizeZ: 64 };
export const BENCH_MASK_SIZE = 2048;

/** Strokes in stamping order (later passes remove earlier berms where they overlap). Kept 1.2 m inside the rectangle. */
export function benchMaskStrokes(): StrokeSpec[] {
  const out: StrokeSpec[] = [];
  // Lane Broom (1.6 m) serpentine on a 2.2 m pitch: each pass leaves a 0.6 m ridge of dust with its berm between clean lanes.
  for (let i = 0; i < 8; i++) {
    const z = -38 + i * 2.2;
    const ltr = i % 2 === 0;
    out.push({ x0: ltr ? -30 : 30, z0: z, x1: ltr ? 30 : -30, z1: z, widthM: 1.6 });
  }
  // Narrower lanes (0.9 m) beside the serpentine, an outpost lane and a diagonal that leaves the rectangle.
  for (let i = 0; i < 4; i++) out.push({ x0: -30, z0: -17 + i * 1.8, x1: -4, z1: -17 + i * 1.8, widthM: 0.9 });
  out.push({ x0: 0, z0: -11, x1: 12, z1: -18, widthM: 1.2 });
  out.push({ x0: -18, z0: 6, x1: 19, z1: 9, widthM: 1.6 });
  // Desk Duster scribbles (0.15 m: narrower than 5 texels).
  for (let i = 0; i < 6; i++) {
    out.push({
      x0: -9 + i * 0.5,
      z0: 8,
      x1: -9 + i * 0.5 + 3,
      z1: 8 + (i % 2 === 0 ? 1.4 : -1.4),
      widthM: 0.15,
      bermHeightM: 0.015,
      bermWidthM: 0.06,
    });
  }
  return out;
}

export interface BenchMask {
  readonly texture: DataTexture;
  readonly buffer: MaskBuffer;
  /** Bytes of the base level (mip chain adds one third). */
  readonly bytes: number;
}

export function createBenchMask(anisotropy: number, size = BENCH_MASK_SIZE): BenchMask {
  const buffer = createMaskBuffer(size, size, BENCH_MASK_RECT);
  for (const stroke of benchMaskStrokes()) stampStroke(buffer, stroke);
  const texture = createMaskTextureFromBuffer(buffer, { mipmaps: true, anisotropy });
  texture.name = "mc:bench-mask";
  return { texture, buffer, bytes: size * size * 4 };
}
