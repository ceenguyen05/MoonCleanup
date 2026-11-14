// Mask-input contract of the regolith material and the textures that carry it (M0-W3-T04).
//
// CONTRACT PROPOSAL for M1-W0 (the dust simulation / terrain writer fills it, the material only reads it):
//   * one plain sampled RGBA8 texture, linear filtering, colour space NONE (raw bytes), clamp-to-edge, mipmaps optional;
//   * R = remaining dust ("grime amount"): 255 = full dust layer, 0 = clean ground;
//   * G = berm height: 255 = BERM_HEIGHT_MAX_M (8 cm), written on the dusty side of an edge only;
//   * B = polish (0 = unpolished clean ground, 255 = fully polished); A = reserved (footprint depth, M1);
//   * the texture covers a world rectangle `MaskWorldRect` (uv = ((x, z) - origin) / size); outside it the clamp must
//     read as dusty ground, so the rectangle's border texels must be R = 255, G = 0;
//   * how the bytes get there is the writer's business: WebGPU may fill it from a compute pass, WebGL2 cannot write a
//     storage texture (M0-W2-T07 row 13), so the writer must have a fragment-pass (render target) path or a CPU upload.
//     Both end in a `Texture` the material samples; `RegolithMaterial.setMask` swaps it without a rebuild.

import {
  ClampToEdgeWrapping,
  DataTexture,
  LinearFilter,
  LinearMipmapLinearFilter,
  NoColorSpace,
  RGBAFormat,
  UnsignedByteType,
} from "three/webgpu";
import { packMaskRgba8, type MaskBuffer } from "./stroke-mask";

export interface MaskTextureOptions {
  /** Build mip levels (distance reads of thin strokes become area-correct lighter lines). Default true. */
  readonly mipmaps?: boolean;
  readonly anisotropy?: number;
}

/** Wraps RGBA8 mask bytes in a data texture that follows the contract above. */
export function createMaskTexture(
  bytes: Uint8Array,
  width: number,
  height: number,
  options: MaskTextureOptions = {},
): DataTexture {
  const texture = new DataTexture(bytes, width, height, RGBAFormat, UnsignedByteType);
  texture.name = "mc:regolith-mask";
  texture.colorSpace = NoColorSpace;
  texture.wrapS = ClampToEdgeWrapping;
  texture.wrapT = ClampToEdgeWrapping;
  texture.magFilter = LinearFilter;
  const mipmaps = options.mipmaps ?? true;
  texture.minFilter = mipmaps ? LinearMipmapLinearFilter : LinearFilter;
  texture.generateMipmaps = mipmaps;
  texture.anisotropy = options.anisotropy ?? 4;
  texture.flipY = false;
  texture.needsUpdate = true;
  return texture;
}

/** Packs a CPU `MaskBuffer` and wraps it. */
export function createMaskTextureFromBuffer(buffer: MaskBuffer, options?: MaskTextureOptions): DataTexture {
  return createMaskTexture(packMaskRgba8(buffer), buffer.width, buffer.height, options);
}
