// Regolith / dust material barrel (technical-artist, M0-W3-T04). Import from here, not from the files.
export {
  ALBEDO_CLEAN,
  ALBEDO_GRIME,
  BERM_HEIGHT_MAX_M,
  CHART_PATCHES,
  CHART_TOLERANCE_LUMA,
  CLEAN_TINT,
  GRIME_TINT,
} from "./regolith-constants";
export { agxToneMap, displayLuma, lumaOfCodes, neutralAlbedoLuma, srgbEncode } from "./agx";
export { DETAIL_GRAD_RANGE, DETAIL_SIZE, generateDetailTile, type DetailTile } from "./detail-texture";
export {
  createMaskBuffer,
  packMaskRgba8,
  sampleGrime,
  stampStroke,
  type MaskBuffer,
  type MaskWorldRect,
  type StrokeSpec,
} from "./stroke-mask";
export { createMaskTexture, createMaskTextureFromBuffer, type MaskTextureOptions } from "./mask-texture";
export {
  createChipMaterial,
  createDetailTexture,
  createRegolithMaterial,
  type MaskTapSource,
  type MaskTaps,
  type RegolithMaterial,
  type RegolithMaterialOptions,
  type RegolithUniforms,
} from "./regolith-material";
