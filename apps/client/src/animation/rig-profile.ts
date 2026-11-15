// Rig profile: the only numbers the procedural layers need from a skeleton. The placeholder below follows the
// `rig.custodian` joint list (animation-spec 1.1) and art-direction 4.1 proportions (1.85 m, hip joint ~0.86 m,
// ankle 0.095 m above the sole). When the M1-W4-T07 custodian ships, a new profile is built from its published
// bind pose (`profileFromBindPose`) and nothing else in this directory changes.

/** Exact rig.custodian joint names used by the procedural layer (spec 1.1). */
export const RIG_JOINTS = {
  root: "root",
  pelvis: "pelvis",
  spine: ["spine_01", "spine_02", "spine_03"],
  neck: "neck",
  head: "head",
  thigh: ["thigh_l", "thigh_r"],
  calf: ["calf_l", "calf_r"],
  foot: ["foot_l", "foot_r"],
  ball: ["ball_l", "ball_r"],
  upperarm: ["upperarm_l", "upperarm_r"],
  forearm: ["forearm_l", "forearm_r"],
  hand: ["hand_l", "hand_r"],
  socketToolR: "socket_tool_r",
} as const;

/** Lower-body track split (spec 3.1): every other joint is upper. */
export const LOWER_BODY_JOINTS: readonly string[] = [
  "root",
  "pelvis",
  "spine_01",
  "thigh_l",
  "calf_l",
  "foot_l",
  "ball_l",
  "thigh_r",
  "calf_r",
  "foot_r",
  "ball_r",
  "dust_cell",
];

export interface RigProfile {
  readonly id: string;
  /** Hip joint height above the sole in bind/stance, metres. */
  readonly hipHeightM: number;
  /** Lateral hip offset from the pelvis centre (+ = right for the right leg), metres. */
  readonly hipHalfWidthM: number;
  readonly thighM: number;
  readonly calfM: number;
  /** Ankle joint height above the sole (spec 4.3: 0.095). */
  readonly ankleHeightM: number;
  /** Shoulder height and arm segment lengths for tool/arm IK. */
  readonly shoulderHeightM: number;
  readonly shoulderHalfWidthM: number;
  readonly upperArmM: number;
  readonly forearmM: number;
}

/** Placeholder custodian until the W4-T07 bind pose lands. Leg reach 0.78 m > hip-to-ankle 0.765 m (soft knee). */
export const PLACEHOLDER_RIG: RigProfile = {
  id: "rig.custodian.placeholder",
  hipHeightM: 0.86,
  hipHalfWidthM: 0.1,
  thighM: 0.4,
  calfM: 0.38,
  ankleHeightM: 0.095,
  shoulderHeightM: 1.48,
  shoulderHalfWidthM: 0.2,
  upperArmM: 0.3,
  forearmM: 0.28,
};

/** Joint world positions from a bind pose (metres, +Y up), keyed by rig.custodian joint name. */
export type BindPositions = Readonly<Record<string, readonly [number, number, number]>>;

function dist(a: readonly [number, number, number], b: readonly [number, number, number]): number {
  const x = a[0] - b[0];
  const y = a[1] - b[1];
  const z = a[2] - b[2];
  return Math.sqrt(x * x + y * y + z * z);
}

/** Builds a profile from the real rig's bind-pose joint positions (load time only; allocates). */
export function profileFromBindPose(id: string, p: BindPositions, ankleHeightM = 0.095): RigProfile {
  const need = (n: string): readonly [number, number, number] => {
    const v = p[n];
    if (v === undefined) throw new Error(`rig ${id}: missing joint ${n}`);
    return v;
  };
  const thighR = need("thigh_r");
  const calfR = need("calf_r");
  const footR = need("foot_r");
  const upperR = need("upperarm_r");
  const foreR = need("forearm_r");
  const handR = need("hand_r");
  const sole = footR[1] - ankleHeightM;
  return {
    id,
    hipHeightM: thighR[1] - sole,
    hipHalfWidthM: Math.abs(thighR[0]),
    thighM: dist(thighR, calfR),
    calfM: dist(calfR, footR),
    ankleHeightM,
    shoulderHeightM: upperR[1] - sole,
    shoulderHalfWidthM: Math.abs(upperR[0]),
    upperArmM: dist(upperR, foreR),
    forearmM: dist(foreR, handR),
  };
}
