// r187 feature-verification matrix scenes (M0-W2-T07): `?scene=verify&row=<n>`. Internal to the render module.

export { VERIFY_ROWS, findRow } from "./rows";
export { VERIFY_SCENE_ID, VerifyScene, parseRowId, type VerifyHooks } from "./verify-scene";
export { analyseRegions, regionStats, type Rect, type RegionStats } from "./analysis";
