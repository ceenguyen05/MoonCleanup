// Public barrel of @moon-cleanup/asset-pipeline. CLI entries: src/build.ts (assets:build), src/check.ts (assets:check).
export { ASSETS, type AssetSource } from "./assets.js";
export { CLASS_BUDGETS, type ClassBudget, MAX_FILE_BYTES } from "./budgets/budgets.js";
export {
  type AssetReport,
  type CheckOptions,
  type CheckResult,
  checkDirectory,
  checkStats,
  type Finding,
  type FindingCode,
  type FindingLevel,
  formatResult,
} from "./budgets/check.js";
export {
  createIo,
  documentStats,
  type GlbStats,
  glbStats,
  optimizeDocument,
  optimizeGlb,
  type TextureStats,
} from "./gltf/io.js";
export {
  type AssetManifest,
  HASH_LENGTH,
  HASHED_NAME_PATTERN,
  hashedFileName,
  MANIFEST_FILE,
  type ManifestAsset,
  readManifest,
  sha256Hex,
  writeManifest,
} from "./manifest.js";
export { detectKtx, type KtxStatus } from "./textures/ktx.js";
