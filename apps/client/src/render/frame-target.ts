// Frame-rate goal of the dynamic-resolution controller (M1-W2-T03).
//
// The preset contract (`shared/render/quality.ts`, rendering-pipeline section 14.1) gives Low and Medium a 30 fps target
// with a 28 ms GPU budget. The owner's later direction (CLAUDE.md, 2026-11-13: solo play first; graphics, animation, fps
// and game feel must never lag; the UHD 620 on Medium is the quality floor) makes 60 fps the goal on every preset, so the
// render module steers every preset to at least `FRAME_TARGET_FPS` and at most `FRAME_TARGET_GPU_BUDGET_MS` of GPU time
// (the section 9 budget of a 60 fps frame). Contract values that are already stricter stay as they are.
// Measured reason (UHD 620, Medium): with the contract's numbers the controller climbed from scale 0.60 to 0.85 in 24 s
// and settled at 42 fps (S06) and 54 fps (`moon`) on WebGPU, 51 fps (S06) on WebGL2.
// `?fps=contract` restores the contract's targets (A/B captures); `?fps=<n>` sets another goal.
//
// This is a deviation from the canonical preset table, recorded for the contracts owner: Low / Medium
// `dynres.targetFps` / `gpuBudgetMs` should become 60 / 14 in the shared contract, after which this file is a pass-through.

/** Frames per second every preset is steered to, at least. */
export const FRAME_TARGET_FPS = 60;
/** GPU frame-time budget of a 60 fps frame (rendering-pipeline section 9), the most any preset may spend. */
export const FRAME_TARGET_GPU_BUDGET_MS = 14;

/** `null` = the module default (60 fps), `"contract"` = the preset's own numbers, a number = that goal in fps. */
export type FrameTargetOverride = number | "contract" | null;

export interface FrameTarget {
  targetFps: number;
  gpuBudgetMs: number;
}

/** Reads `?fps=`: `contract`, or a rate from 20 to 240. Anything else is `null`. */
export function parseFrameTarget(search: string): FrameTargetOverride {
  const raw = new URLSearchParams(search).get("fps");
  if (raw === null) return null;
  if (raw.trim().toLowerCase() === "contract") return "contract";
  const fps = Number(raw);
  return raw.trim() !== "" && Number.isFinite(fps) && fps >= 20 && fps <= 240 ? fps : null;
}

/**
 * The targets the controller steers to for a preset's dynres block. Writes `out` (no allocation). The GPU budget scales
 * with the frame period: 14 ms of a 16.7 ms frame.
 */
export function frameTargetFor(
  dynres: { readonly targetFps: number; readonly gpuBudgetMs: number },
  override: FrameTargetOverride,
  out: FrameTarget,
): FrameTarget {
  if (override === "contract") {
    out.targetFps = dynres.targetFps;
    out.gpuBudgetMs = dynres.gpuBudgetMs;
    return out;
  }
  const fps = override === null ? Math.max(dynres.targetFps, FRAME_TARGET_FPS) : override;
  out.targetFps = fps;
  out.gpuBudgetMs = Math.min(dynres.gpuBudgetMs, (FRAME_TARGET_GPU_BUDGET_MS * FRAME_TARGET_FPS) / fps);
  return out;
}
