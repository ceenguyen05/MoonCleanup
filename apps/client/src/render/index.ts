// Public surface of the render module (rendering-engineer). Other client folders import from "../render" only,
// and reach the running renderer through the service registry (`renderer`, `sceneRoots`, `quality`).
// Hooks and usage: ./README.md.

export {
  BACKEND_DECISION_REASONS,
  describeAdapter,
  detectBackend,
  matchBlocklist,
  readStartedBackend,
  type BackendDecision,
  type BackendDecisionReason,
  type BackendDetectionInput,
  type BlocklistEntry,
  type GpuAdapterInfoLike,
  type GpuAdapterLike,
  type GpuLike,
} from "./backend";
export {
  FRAME_STEP_IDS,
  FRAME_TIME_WINDOW,
  FrameLoop,
  MAX_FRAME_DT_S,
  MODULE_UPDATE_ORDER,
  spanName,
  type FrameLoopOptions,
  type FrameStepId,
  type FrameTimeStats,
  type PerformanceLike,
  type SimClockLike,
  type ViewportSourceLike,
} from "./frame-loop";
export {
  GPU_TIMING_RESOLVE_EVERY_FRAMES,
  gpuTimingMode,
  GpuTimingModule,
  GpuTimingPump,
  type GpuTimedRendererLike,
  type GpuTimingMode,
  type GpuTimingOptions,
  type GpuTimingRendererService,
} from "./gpu-timing";
export {
  CAPTURE_FIXED_DT_S,
  installHarnessHooks,
  READY_WARMUP_FRAMES,
  type HarnessHookOptions,
  type HarnessHookTarget,
  type HarnessInfo,
} from "./harness-hooks";
export {
  LOSSES_PER_PRESET_DROP,
  RenderModule,
  RenderUnsupportedError,
  type DynamicResolutionState,
  type RenderEnvironment,
  type RenderFrameStats,
  type RenderModuleOptions,
  type RenderRendererService,
  type RenderRuntime,
  type RenderServices,
} from "./module";
export {
  FramePipeline,
  toneMappingFor,
  type FramePipelineLike,
  type PipelineStage,
  type PipelineStageContext,
  type PipelineStages,
} from "./pipeline";
export { type RenderCapabilities, type RenderQualityService } from "./quality-service";
export { clampScale, RenderScale } from "./render-scale";
export {
  DYNRES_FLOOR_HINT_S,
  DYNRES_TUNING,
  DynamicResolution,
  dynresTargetMs,
  type DynresRange,
  type DynresSignal,
  type DynresTuning,
} from "./dynres";
export {
  DEFAULT_MAX_DEVICE_LOSSES,
  RendererHost,
  type CanvasMount,
  type DeviceLossInfo,
  type FrameCallback,
  type FrameScheduler,
  type RendererDriver,
  type RendererHostState,
  type RendererRecreatedEvent,
} from "./renderer-host";
export {
  applyCameraProjection,
  CAMERA_DEFAULT_VFOV_DEG,
  CAMERA_FAR_FALLBACK_M,
  CAMERA_FAR_REVERSED_M,
  CAMERA_NEAR_FALLBACK_M,
  CAMERA_NEAR_REVERSED_M,
  cameraDepthRange,
  createSceneRoots,
  type SceneRoots,
} from "./scene-roots";
export {
  clampPresetToBackend,
  classifyGpu,
  defaultPresetFor,
  GPU_CLASSES,
  maxPresetFor,
  presetBelow,
  resolveQuality,
  tierFor,
  type GpuClass,
  type GpuClassTable,
} from "./tier";
export {
  BACKEND_OVERRIDES,
  parseRenderUrlOptions,
  SMOKE_SCENE_ID,
  type BackendOverride,
  type RenderScalePin,
  type RenderUrlOptions,
} from "./url-options";
export { drawingBufferSize, effectiveDpr, ViewportTracker } from "./viewport";
