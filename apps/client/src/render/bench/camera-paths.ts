// Camera paths P1 (walk loop) and P3 (orbit + sky pan) of the bench (rendering-pipeline.md section 19; performance
// budgets section 8). Pure functions of time: the same time gives the same pose, so two runs match frame for frame.
//
// Two ways to use them:
//   - `?path=p1|p3` makes the bench drive the camera itself (works without the debug module);
//   - `benchPathSpec(id)` returns a keyframe spec in the shape of `window.__mcCameraPath(spec)` (debug module), for
//     `tools/perf`. The spec type is repeated structurally here: render must not import debug.

export interface PathKey {
  readonly t: number;
  readonly position: readonly [number, number, number];
  readonly target: readonly [number, number, number];
}
export interface PathSpec {
  readonly keys: readonly PathKey[];
  readonly loop?: boolean;
}
export interface PathPose {
  px: number;
  py: number;
  pz: number;
  tx: number;
  ty: number;
  tz: number;
}

/** Eye height of a standing custodian above the local ground (rendering-pipeline.md section 4). */
export const EYE_HEIGHT_M = 1.7;
/** P1: walk speed in m/s and loop radius in metres around the outpost. */
export const P1_SPEED_MPS = 2.2;
export const P1_RADIUS_M = 26;
export const P1_PERIOD_S = (2 * Math.PI * P1_RADIUS_M) / P1_SPEED_MPS;
/** P3: one lap of the orbit and the sky pan that follows. */
export const P3_ORBIT_S = 40;
export const P3_PAN_S = 20;
export const P3_PERIOD_S = P3_ORBIT_S + P3_PAN_S;

export type GroundHeightFn = (x: number, z: number) => number;

const smooth = (x: number): number => {
  const c = Math.min(1, Math.max(0, x));
  return c * c * (3 - 2 * c);
};

/** P1: a circular walk at eye height, looking ahead and slightly down. Fills `out`; allocates nothing. */
export function p1Pose(time: number, ground: GroundHeightFn, out: PathPose): PathPose {
  const a = ((time % P1_PERIOD_S) / P1_PERIOD_S) * Math.PI * 2;
  const x = Math.cos(a) * P1_RADIUS_M;
  const z = Math.sin(a) * P1_RADIUS_M;
  // Look a quarter second ahead along the circle, at the walker's own height.
  const ahead = a + 0.5 / P1_RADIUS_M;
  const lx = Math.cos(ahead) * P1_RADIUS_M;
  const lz = Math.sin(ahead) * P1_RADIUS_M;
  out.px = x;
  out.py = ground(x, z) + EYE_HEIGHT_M;
  out.pz = z;
  // Aim toward the outpost side of the circle so props and the clean lanes stay in view, 6 m ahead.
  out.tx = lx * 0.62;
  out.ty = ground(lx, lz) + 1.1;
  out.tz = lz * 0.62;
  return out;
}

/** P3: orbit the outpost at 11 m height, then pan up to the sky (Earth and sun side). */
export function p3Pose(time: number, ground: GroundHeightFn, out: PathPose): PathPose {
  const t = time % P3_PERIOD_S;
  if (t < P3_ORBIT_S) {
    const a = (t / P3_ORBIT_S) * Math.PI * 2;
    const radius = 34;
    out.px = Math.cos(a) * radius;
    out.pz = Math.sin(a) * radius;
    out.py = ground(out.px, out.pz) + 11;
    out.tx = 0;
    out.ty = ground(0, 0) + 2;
    out.tz = 0;
    return out;
  }
  // Pan: stand at the start of the orbit and raise the look-at from the ground to the sky and back.
  const s = (t - P3_ORBIT_S) / P3_PAN_S;
  const up = smooth(s < 0.5 ? s * 2 : (1 - s) * 2);
  out.px = 34;
  out.pz = 0;
  out.py = ground(34, 0) + EYE_HEIGHT_M;
  out.tx = 34 - 60;
  out.tz = 0;
  out.ty = out.py - 4 + up * 120;
  return out;
}

/** Keyframe spec (0.5 s apart) for `__mcCameraPath`. Allocates; call once, not per frame. */
export function benchPathSpec(id: "p1" | "p3", ground: GroundHeightFn): PathSpec {
  const period = id === "p1" ? P1_PERIOD_S : P3_PERIOD_S;
  const step = 0.5;
  const keys: PathKey[] = [];
  const pose: PathPose = { px: 0, py: 0, pz: 0, tx: 0, ty: 0, tz: 0 };
  const count = Math.ceil(period / step);
  for (let i = 0; i <= count; i++) {
    const t = Math.min(period, i * step);
    // Sample just inside the period so the last key equals the first (the loop closes).
    const sampleT = t >= period ? 0 : t;
    if (id === "p1") p1Pose(sampleT, ground, pose);
    else p3Pose(sampleT, ground, pose);
    if (keys.length > 0 && (keys[keys.length - 1]?.t ?? -1) >= t) continue;
    keys.push({ t, position: [pose.px, pose.py, pose.pz], target: [pose.tx, pose.ty, pose.tz] });
  }
  return { keys, loop: true };
}
