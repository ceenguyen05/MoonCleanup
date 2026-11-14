// Bench scene barrel (rendering-engineer). `?scene=bench` is created by the render module; the rest is for tests and tools.

export { BENCH_FILLER_POOL, BENCH_WARMUP_FRAMES, BenchScene, type BenchHooks, type BenchStats } from "./bench-scene";
export {
  BENCH_DEFAULT_DRAWS,
  BENCH_DRAW_STEPS,
  BENCH_SCENE_ID,
  parseBenchOptions,
  type BenchOptions,
  type BenchPathId,
} from "./options";
export { benchPathSpec, p1Pose, p3Pose, type PathPose, type PathSpec } from "./camera-paths";
export { CameraOnlyVelocity, cameraOnlyVelocityNdc } from "./camera-velocity";
export { cascadeEndsM, makeSplitsCallback } from "./csm-splits";
export { DrawCalibrator } from "./draw-calibration";
export {
  BENCH_DEFAULT_LOOK,
  BENCH_LOOK_IDS,
  parseBenchLook,
  type BenchLookId,
  type LookContext,
  type LookFactory,
  type LookProvider,
} from "./look";
