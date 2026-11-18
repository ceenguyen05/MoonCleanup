// Public barrel of apps/client/src/animation (M1-W5-T04 logic layer): locomotion blend, low-g bounce, foot IK on the
// sphere, tool layer, state machine, pooled presentation events and the per-slot animation module. Rig-agnostic: the
// custodian skeleton plugs in through `RigProfile` / `profileFromBindPose` and a rig adapter reading `AvatarPose`.
export { ANIM_EVENT, AnimEventQueue, AnimEventRecord, type AnimEventType } from "./anim-events";
export {
  AvatarAnimInput,
  AvatarAnimator,
  AvatarPose,
  RemoteVelocityEstimator,
  placeholderLegs,
} from "./avatar-animator";
export {
  FootIk,
  LegInput,
  batchedGround,
  footAlignment,
  footAlignmentIO,
  solveTwoBone,
  solveTwoBoneIO,
  type AnimGround,
} from "./foot-ik";
export {
  AIR_APEX,
  AIR_FALL,
  AIR_RISE,
  LOCO_IDLE,
  LOCO_LOPE,
  LOCO_SHUFFLE,
  LOCO_WALK,
  STRAFE_BWD,
  STRAFE_FWD,
  STRAFE_IDLE,
  STRAFE_LEFT,
  STRAFE_RIGHT,
  airBlend,
  bandWithHysteresis,
  gaitCycleS,
  gaitWeighted,
  locomotion1D,
  locomotion2D,
  rampWeight,
} from "./locomotion-blend";
export {
  LAND_HARD,
  LAND_NONE,
  LAND_SOFT,
  LAND_STUMBLE,
  LandingCompression,
  ballisticApex,
  bounceGain,
  compressionDepth,
  landingClass,
  stepPelvisOffset,
  timeToGround,
} from "./low-g";
export {
  AnimationModule,
  BUCKET_DIVISOR,
  BUCKET_EDGES_PX,
  MAX_ANIMATED_AVATARS,
  bucketFor,
  shouldUpdate,
  type AnimInputProvider,
} from "./module";
export {
  LOWER_BODY_JOINTS,
  PLACEHOLDER_RIG,
  RIG_JOINTS,
  profileFromBindPose,
  type BindPositions,
  type RigProfile,
} from "./rig-profile";
export { SphereFrame } from "./sphere-frame";
export { BASE, BASE_COUNT, BASE_NAMES, StateMachine, UPPER, crossfadeTo, type StateInput } from "./state-machine";
export { ToolLayer, crossed, strokeCurve, strokeCurveIO } from "./tool-layer";
export { TOOL, TOOL_CLASS, TOOL_CLASSES, toolClassOf, type ToolClass } from "./tuning";
