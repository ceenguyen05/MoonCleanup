// Public barrel of the client dust replay (M1-W3-T02): tile atlas bookkeeping, the per-frame replay batch with its
// CPU reference, and the GPU pass (three r187 WebGPURenderer + TSL, one fragment path).
export {
  BATCH_MAX_FILLS,
  BATCH_MAX_RESIDUALS,
  BATCH_MAX_STROKES,
  CpuAtlas,
  DustReplayBatch,
  KIND_CLEAR,
  KIND_STROKE,
  atlasHeight,
  atlasWidth,
  type AtlasLayout,
} from "./replay-batch";
export { DUST_TILE_PRESETS, DustTileAtlas, type DustLedgerView, type DustTileAtlasOptions } from "./tile-atlas";
export { DustReplayPass } from "./replay-pass";
export { DustLayer } from "./dust-layer";
export {
  DustFlatLookup,
  FLAT_LOOKUP_CELLS,
  FLAT_LOOKUP_CELL_M,
  FLAT_LOOKUP_FETCHES,
  FLAT_LOOKUP_MAX_PLOTS,
} from "./flat-lookup";
export { DUST_SCENE_ID, DUST_SCENE_SITE, DustWorksite, type DustFeedPort } from "./dust-worksite";
