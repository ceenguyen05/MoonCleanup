// Public barrel of apps/client/src/gameplay (M1-W3-T05): player input (keyboard / mouse / gamepad -> sim input
// contract), the one-input-per-tick pump, own-avatar pose sources, camera rig and tool aim, and the client module.
export {
  FLAT_GROUND,
  GameplayModule,
  type GameplayDebugHost,
  type GameplayModuleOptions,
  type GameplaySnapshot,
  type OnlineRoomLike,
} from "./module";
export {
  SOLO_CORRECTION_HALF_LIFE_MS,
  SOLO_PREDICTION_HISTORY,
  SOLO_PREDICTION_MAX_REPLAY,
  SoloPredictor,
  type SelfLike,
  type SoloPredictorStats,
} from "./avatar/solo-predictor";
export {
  DEFAULT_BINDINGS,
  EXTRA_ACTIONS,
  compileBindings,
  rebind,
  type BindingTable,
  type CompiledBindings,
  type ExtraAction,
  type InputAction,
} from "./input/bindings";
export {
  InputState,
  PAD_NAV_BACK,
  PAD_NAV_CONFIRM,
  PAD_NAV_DOWN,
  PAD_NAV_LEFT,
  PAD_NAV_NEXT,
  PAD_NAV_PREV,
  PAD_NAV_RIGHT,
  PAD_NAV_UP,
  DEFAULT_LOOK,
  PITCH_LIMIT_RAD,
  codeToYaw,
  createInputCommand,
  pitchToCode,
  yawToCode,
  type FrameTime,
  type LookSettings,
  type MutableInputCommand,
} from "./input/input-state";
export { INPUT_PREFILL, InputPump, MAX_INPUTS_PER_FRAME, type InputSink } from "./input/input-pump";
export { DomInput, type DomInputHost, type GamepadLike, type PointerLockTarget } from "./input/dom-input";
export {
  FrameAvatarSource,
  PredictorPoseSource,
  standardGridPlotCount,
  type AvatarPoseSource,
  type FrameHostLike,
  type PredictorLike,
} from "./avatar/pose-source";
export {
  CAMERA_MODES,
  CameraRig,
  DEFAULT_CAMERA_RIG,
  DEFAULT_TOOL_REACH_M,
  PlotFrameMapper,
  TangentPlaneMapper,
  aimDistanceM,
  toolParamFor,
  type CameraMode,
  type CameraRigSettings,
  type LookAngles,
  type RenderMapper,
} from "./camera/camera-rig";
