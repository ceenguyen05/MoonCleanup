// Animation tuning (M1-W5-T04). Every number cites docs/design/animation-spec.md. These are presentation values only:
// balance numbers (gravity, landing thresholds, stroke periods, speeds) arrive per frame from sim/game-data through
// `AvatarAnimInput`, so this table never drifts from the sim.

/** Locomotion blend nodes (spec 3.2 / 2.2): idle, shuffle (sweep-walk), walk (skip-jog), lope. */
export const LOCO = {
  /** Node speeds, m/s (idle, shuffle, walk, lope). Integrator may overwrite 1..3 from movement.json. */
  nodeSpeeds: [0, 2.2, 3.4, 5.0] as const,
  /** Cycle duration (2 steps) of each moving clip, seconds (spec 2.2). Index 0 (idle) unused. */
  cycleS: [1, 0.84, 1.0, 1.2] as const,
  /** Flight time per step at rate 1, seconds (spec 4.1). */
  flightS: [0, 0, 0.2, 0.45] as const,
  /** Stance dip of the pelvis, metres (spec 4.1). */
  stanceDipM: [0, 0.03, 0.04, 0.065] as const,
  /** Playback rate clamp (spec 3.2). */
  rateMin: 0.75,
  rateMax: 1.25,
  /** Strafe (2D) speed node and entry angle/time (spec 3.2). */
  strafeSpeed: 2.2,
  strafeAngleRad: (35 * Math.PI) / 180,
  strafeEnterS: 0.15,
  /** 1D <-> 2D crossfade (spec 3.2). */
  strafeBlendS: 0.25,
  /** Remote speed floor (spec 3.3) and threshold hysteresis (spec 3.6). */
  speedFloor: 0.15,
  speedHysteresis: 0.2,
  /** Underflow: crossfade to idle (spec 3.6). */
  underflowIdleS: 0.3,
} as const;

/** Air 1D blend by v_up (spec 3.2) and air extras (spec 4.2). */
export const AIR = {
  riseVUp: 1.0,
  apexVUp: 0.4,
  fallVUp: -1.0,
  hangAfterS: 0.8,
  hangFadeS: 0.4,
  landPrepS: 0.25,
  landPrepMinBlendS: 0.06,
  /** !grounded for this long before the walk-off air state (spec 3.5). */
  airDebounceS: 0.05,
} as const;

/** Bounce and landing (spec 4.1, 4.2). */
export const BOUNCE = {
  gainMin: 0.6,
  gainMax: 1.6,
  /** The only allowed readability knob, [1, 1.5], default 1 (physical). */
  exaggeration: 1.0,
  /** No landing clip below this impact (m/s). Soft/hard/faceplant split arrives from movement.json per input. */
  landClipMinMps: 2.0,
  compressionPerMps: 0.055,
  compressionMinM: 0.02,
  compressionMaxM: 0.32,
  compressionReachS: 0.09,
  springHz: 1.8,
  springZeta: 0.55,
  /** Torso pitch at full compression: 0.4 x 18 deg (spec 4.2). */
  torsoPitchRadAtMax: (0.4 * 18 * Math.PI) / 180,
} as const;

/** Procedural lean (spec 3.2). */
export const LEAN = {
  fwdRadPerMps2: (1.2 * Math.PI) / 180,
  fwdMinRad: (-6 * Math.PI) / 180,
  fwdMaxRad: (10 * Math.PI) / 180,
  bankPerSpeedYawRate: (4.0 * Math.PI) / 180,
  bankMaxRad: (12 * Math.PI) / 180,
  /** spine_01, spine_02, spine_03 share. */
  spineShare: [0.3, 0.3, 0.4] as const,
  /** Smoothing of the acceleration estimate, seconds. */
  accelTauS: 0.12,
} as const;

/** Foot IK on the sphere (spec 4.3). */
export const FOOT_IK = {
  windowUpM: 0.6,
  windowDownM: 0.6,
  normalProbeM: 0.08,
  pitchMaxRad: (30 * Math.PI) / 180,
  rollMaxRad: (18 * Math.PI) / 180,
  stretchCap: 0.999,
  weightRampS: 0.06,
  landPrepWeight: 0.5,
  lockReleaseM: 0.12,
  lockBlendOutS: 0.08,
  pelvisMinM: -0.35,
  pelvisMaxM: 0.05,
  pelvisTauUpS: 0.07,
  pelvisTauDownS: 0.05,
  slopeStartRad: (10 * Math.PI) / 180,
  slopeShiftPerRad: 0.004 * (180 / Math.PI),
  slopeShiftMaxM: 0.06,
  slopeLeanPerRad: 0.3,
  slopeLeanMaxRad: (8 * Math.PI) / 180,
} as const;

/** Tool layer (spec 2.6, 3.5). */
export const TOOL = {
  /** Body lead before each reversal, seconds (80-120 ms). */
  anticipationS: 0.1,
  /** Torso follow-through overshoot past a reversal (3-6 deg). */
  followThroughRad: (4.5 * Math.PI) / 180,
  /** Follow-through decay, seconds. */
  followThroughS: 0.18,
  sweepInS: 0.12,
  sweepOutS: 0.15,
  holdInS: 0.2,
  holdOutS: 0.2,
  palmWobbleM: 0.03,
  palmWobbleHz: 4,
  /** Sim contact fraction of the cycle (packages/sim tool.ts: 70 % contact, 30 % lift). Overridable per input. */
  defaultContactFrac: 0.7,
} as const;

/** Tool classes (spec 2.6). Index = TOOL_CLASS code. */
export const TOOL_CLASSES = ["none", "palm", "blade", "broom", "bar", "comb", "curtain", "gun"] as const;
export type ToolClass = (typeof TOOL_CLASSES)[number];
export const TOOL_CLASS = {
  none: 0,
  palm: 1,
  blade: 2,
  broom: 3,
  bar: 4,
  comb: 5,
  curtain: 6,
  gun: 7,
} as const satisfies Record<ToolClass, number>;

/** Torso twist amplitude per class, radians (spec 2.6; palm/blade estimated, labelled tuning). */
export const TOOL_TWIST_RAD: readonly number[] = [0, 0.1, 0.17, 0.436, 0.349, 0.3, 0.1, 0];
/** Two-handed classes drive the off hand with IK (spec 4.6 step 4). */
export const TOOL_TWO_HANDED: readonly boolean[] = [false, false, false, true, true, true, true, true];

/** Tool id (tools.json order) -> class. Common descriptive mapping; ids stay stable. */
export function toolClassOf(toolId: string): number {
  switch (toolId) {
    case "tool.desk_duster":
      return TOOL_CLASS.palm;
    case "tool.crescent_squeegee":
      return TOOL_CLASS.blade;
    case "tool.bristle_broom":
      return TOOL_CLASS.broom;
    case "tool.lane_broom":
      return TOOL_CLASS.bar;
    case "tool.static_rake":
      return TOOL_CLASS.comb;
    case "tool.ion_curtain":
      return TOOL_CLASS.curtain;
    case "tool.assembly_gun":
      return TOOL_CLASS.gun;
    default:
      return TOOL_CLASS.none;
  }
}

/** State-machine blend times, seconds (spec 3.5). */
export const BLEND = {
  takeoffIn: 0.08,
  walkOffIn: 0.2,
  airToLocoOut: 0.12,
  landSoftIn: 0.06,
  landSoftOut: 0.15,
  landHardIn: 0.05,
  landHardOut: 0.2,
  stumbleIn: 0.06,
  stumbleOut: 0.25,
  vehicleIn: 0.15,
  vehicleOut: 0.2,
  pourIn: 0.2,
  pourOut: 0.25,
  pickupIn: 0.1,
  pickupOut: 0.15,
  detailingIn: 0.18,
  detailingOut: 0.22,
  emoteIn: 0.25,
  emoteOut: 0.2,
  onBreakIn: 0.6,
  onBreakOut: 0.3,
  /** Min interval between base-state changes except priority 1-3 (spec 3.6). */
  minStateIntervalS: 0.15,
  /** Watchdog: a state never outlives its sim condition by more than this (spec 3.5 rule 4). */
  watchdogS: 2.0,
  /** Land clip lengths (spec 2.3) and earliest move/jump interrupts (spec 3.5). */
  landSoftS: 0.45,
  landHardS: 0.8,
  stumbleS: 2.2,
  landSoftMoveS: 0,
  landHardMoveS: 0.3,
  stumbleMoveS: 0.8,
} as const;

/** Teleport snap distance: larger displacement in one frame resets IK, locks and springs (spec 3.5 rule 2). */
export const TELEPORT_SNAP_M = 2;
