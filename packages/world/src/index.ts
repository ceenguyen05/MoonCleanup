// Public barrel of @moon-cleanup/world: plot grid (GP(m,0)), point -> plot, frames, display ids, golden digests and
// the ground height function. Environment-agnostic (no DOM, Node, three.js or Colyseus imports).

export { IcoPlotGrid, createPlotGrid, type PlotLattice } from "./grid/plot-grid";
export {
  buildCentersAndLattice,
  buildFrames,
  buildNeighborSets,
  canonicalPlotId,
  isPowerOfTwo,
  orderNeighbors,
  type PlotGridTables,
} from "./grid/build";
export { ICO_LOWER, ICO_NORTH, ICO_SOUTH, ICO_UPPER, diamondCorners, type Vec3Tuple } from "./grid/icosahedron";
export { formatPlotDisplayId, parsePlotDisplayId, plotIdFromDisplayId } from "./grid/display-id";
export {
  GOLDEN_POINT_COUNT,
  GOLDEN_POINT_SEED,
  computeGridGoldenDigests,
  goldenPoints,
  gridGoldenBytes,
  mulberry32,
  pointToPlotGoldenAnswers,
  type GridGoldenDigests,
} from "./grid/golden";
export { sha256, sha256Hex, toHex } from "./hash/sha256";
export {
  CUBE_FACE_ACROSS,
  CUBE_FACE_BASIS,
  CUBE_FACE_COUNT,
  cubeABOnFace,
  cubeDirectionFromAB,
  cubeFaceAndAB,
  cubeFaceOf,
  type CubeFaceAB,
} from "./height/cube-mapping";
export { HeightCube, type HeightCubeLayout } from "./height/height-cube";
export {
  DEFAULT_HEIGHT_DETAIL,
  GroundHeight,
  padMasksFromManifest,
  pcgHash,
  valueNoise3,
  type CraterBand,
  type GroundHeightOptions,
  type HeightDetailParams,
  type NoiseOctave,
  type PadMask,
} from "./height/ground-height";
