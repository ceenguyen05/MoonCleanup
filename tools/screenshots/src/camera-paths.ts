import { lumaPlane, clampRect, type Img, type Rect } from "./measure/image";
import type { Tod } from "./naming";

/**
 * Camera paths of visual-target 6.3. Stepped capture: the harness moves the scene's camera to `view(t)` through
 * `window.__mcLook.setView`, advances a few fixed-dt frames, and saves a native PNG, so the path is deterministic.
 */
export interface CameraPath {
  readonly id: string;
  readonly scene: string;
  readonly tod: Tod;
  readonly durationS: number;
  readonly checks: string;
  /** Client view name at path position t in [0, 1]. */
  view(t: number): string;
}

export const CAMERA_PATHS: Readonly<Record<string, CameraPath>> = {
  P4: {
    id: "P4",
    scene: "S01",
    tod: "dawn",
    durationS: 30,
    checks: "LOD pop, CSM to horizon-shadow handoff",
    // S01Approach.setView("fly:<t>"): 300 m along +z at 30 m altitude, pitched 8 degrees down.
    view: (t) => `fly:${t.toFixed(4)}`,
  },
};

/** Mean absolute luma difference between two same-size frames inside `rect` (default: whole frame). */
export function meanAbsLumaDiff(a: Img, b: Img, rect?: Rect): number {
  const r = clampRect(a, rect ?? { x: 0, y: 0, w: a.width, h: a.height });
  const pa = lumaPlane(a, r).plane;
  const pb = lumaPlane(b, r).plane;
  let s = 0;
  for (let i = 0; i < pa.length; i++) s += Math.abs(pa[i]! - pb[i]!);
  return pa.length ? s / pa.length : 0;
}

export interface PathSummary {
  readonly frames: number;
  /** Mean abs luma difference of each consecutive pair (whole frame and lower third = ground). */
  readonly pairDiffWhole: readonly number[];
  readonly pairDiffGround: readonly number[];
  /** Largest ground pair difference divided by the median pair difference: a pop shows as a spike, steady motion near 1. */
  readonly groundSpikeRatio: number | null;
  readonly maxGroundDiffAt: number | null;
}

/** LOD-pop proxy over a stepped sequence: spike of the ground-region frame-to-frame difference. NOT a verdict by itself. */
export function summarizePath(frames: readonly Img[]): PathSummary {
  const whole: number[] = [];
  const ground: number[] = [];
  for (let i = 1; i < frames.length; i++) {
    const a = frames[i - 1]!;
    const b = frames[i]!;
    whole.push(meanAbsLumaDiff(a, b));
    ground.push(
      meanAbsLumaDiff(a, b, { x: 0, y: Math.round(a.height * (2 / 3)), w: a.width, h: Math.round(a.height / 3) }),
    );
  }
  const sorted = [...ground].sort((x, y) => x - y);
  const median = sorted.length ? sorted[Math.floor(sorted.length / 2)]! : 0;
  const max = ground.length ? Math.max(...ground) : 0;
  return {
    frames: frames.length,
    pairDiffWhole: whole,
    pairDiffGround: ground,
    groundSpikeRatio: median > 0 ? max / median : null,
    maxGroundDiffAt: ground.length ? ground.indexOf(max) + 1 : null,
  };
}
