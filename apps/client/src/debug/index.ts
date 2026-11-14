// Public surface of the debug module (performance-profiler). The composition root imports `DebugModule` from here.

export { DebugModule, type DebugHookTarget, type DebugModuleOptions, type StepTimeSource } from "./module";
export { HUD_ELEMENT_ID, HUD_REFRESH_HZ, formatHudText, PerfHud } from "./hud";
export { PerfCollector, DEFAULT_WINDOW_FRAMES } from "./collector";
export { PERF_SNAPSHOT_SCHEMA, type GpuTimingSource, type PerfSnapshot } from "./snapshot";
export { RollingWindow, percentileSorted, emptySummary, type WindowSummary } from "./stats";
export {
  sampleCameraPath,
  validateCameraPath,
  type CameraKey,
  type CameraPathSpec,
  type CameraPose,
} from "./camera-path";
