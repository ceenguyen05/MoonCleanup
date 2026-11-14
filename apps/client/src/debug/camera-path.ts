// Scripted camera path for repeatable captures (M0-W2-T01): `window.__mcCameraPath(path)` installs it, the debug
// module samples it from the frame clock (`FrameInfo.time`, fixed-step in `?capture=1`), so two runs follow the same
// path frame for frame. Pure math; the module writes the pose to the camera.

export interface CameraKey {
  /** Seconds from the start of the path. Strictly increasing across keys. */
  readonly t: number;
  /** Camera position, metres (scene space). */
  readonly position: readonly [number, number, number];
  /** Point the camera looks at, metres. */
  readonly target: readonly [number, number, number];
}

export interface CameraPathSpec {
  readonly keys: readonly CameraKey[];
  /** Wrap around after the last key (default true) instead of holding it. */
  readonly loop?: boolean;
}

export interface CameraPose {
  px: number;
  py: number;
  pz: number;
  tx: number;
  ty: number;
  tz: number;
}

export function validateCameraPath(spec: CameraPathSpec): void {
  if (spec.keys.length < 2) throw new Error("camera path needs at least 2 keys");
  let previous = Number.NEGATIVE_INFINITY;
  for (const key of spec.keys) {
    if (!Number.isFinite(key.t) || key.t <= previous) {
      throw new Error("camera path key times must be strictly increasing");
    }
    previous = key.t;
    for (const v of [...key.position, ...key.target]) {
      if (!Number.isFinite(v)) throw new Error("camera path has a non-finite value");
    }
  }
}

/** Position and target at path time `time` (smoothstep per segment). Fills `out`; allocates nothing. */
export function sampleCameraPath(spec: CameraPathSpec, time: number, out: CameraPose): CameraPose {
  const keys = spec.keys;
  const first = keys[0];
  const last = keys[keys.length - 1];
  if (first === undefined || last === undefined) return out;
  const span = last.t - first.t;
  let t = time - first.t;
  t = spec.loop !== false && span > 0 ? ((t % span) + span) % span : Math.min(span, Math.max(0, t));
  t += first.t;
  let i = 0;
  while (i < keys.length - 2 && (keys[i + 1]?.t ?? Number.POSITIVE_INFINITY) <= t) i++;
  const a = keys[i] ?? first;
  const b = keys[i + 1] ?? last;
  const raw = Math.min(1, Math.max(0, (t - a.t) / (b.t - a.t)));
  const s = raw * raw * (3 - 2 * raw);
  out.px = a.position[0] + (b.position[0] - a.position[0]) * s;
  out.py = a.position[1] + (b.position[1] - a.position[1]) * s;
  out.pz = a.position[2] + (b.position[2] - a.position[2]) * s;
  out.tx = a.target[0] + (b.target[0] - a.target[0]) * s;
  out.ty = a.target[1] + (b.target[1] - a.target[1]) * s;
  out.tz = a.target[2] + (b.target[2] - a.target[2]) * s;
  return out;
}
