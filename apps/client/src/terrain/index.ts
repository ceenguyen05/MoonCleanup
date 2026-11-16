// Public surface of the terrain module (M1-W2-T01): the CDLOD sphere terrain on the baked height cube, its material
// hooks, the height asset loader and the Pilot Fence.

export { HeightMinMax } from "./cdlod/min-max";
export { buildPatchGrid, type PatchGrid } from "./cdlod/patch-grid";
export {
  CdlodSelector,
  createCdlodView,
  DETAIL_ABOVE_M,
  DETAIL_BELOW_M,
  MORPH_STAGES,
  MORPH_START,
  sidePlanesFromViewProjection,
  type CdlodSelectorOptions,
  type CdlodStats,
  type CdlodView,
} from "./cdlod/select";
export {
  applyTerrainSurface,
  createHorizonArrayTexture,
  createTerrainSurface,
  DETAIL_FADES_M,
  type TerrainHorizon,
  type TerrainSurface,
  type TerrainSurfaceOptions,
  type TerrainSurfaceUniforms,
} from "./cdlod/terrain-surface";
export {
  CdlodTerrain,
  createPlainTerrainMaterial,
  createSpecularTerrainMaterial,
  type CdlodQuality,
  type CdlodTerrainOptions,
  type TerrainMaterialFactory,
} from "./cdlod/cdlod-terrain";
export {
  createHeightTexture,
  createHeightTwin,
  type DetailWeights,
  type HeightTwin,
  type HeightTwinOptions,
} from "./height/height-twin";
export {
  decodeHeightCubeFile,
  decodeHorizonFile,
  loadHorizonAsset,
  type HorizonAsset,
  inflateRaw,
  loadTerrainAsset,
  type TerrainAsset,
  type TerrainAssetOptions,
} from "./height-asset";
export {
  BOREAL_DIRECTION,
  borealPilotFence,
  fenceArcDistanceM,
  fenceRingDirections,
  PILOT_FENCE_NEAR_M,
  PilotFenceWatch,
  type PilotFenceHooks,
  type PilotFenceReport,
  type PilotFenceSpec,
  type PilotFenceZone,
} from "./pilot-fence";
export { PilotFenceMarkers, type PilotFenceMarkerOptions } from "./pilot-fence-markers";
export {
  MOON_SCENE_ID,
  selectTerrainMaterial,
  TerrainScene,
  type TerrainSceneInfo,
  type TerrainSceneOptions,
} from "./terrain-scene";
