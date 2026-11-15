// Draw-call and triangle budget counter (docs/architecture/rendering-pipeline.md section 10.2; performance-budgets
// section 4): High / Ultra at most 600 draws per frame over all passes, Low / Medium at most 350. The budget itself is the
// preset's (`quality.budgets`); this counter records every frame against it so the debug HUD can flag a frame in red and a
// perf run can assert "never over". Pure, no allocation per frame.

import type { QualitySettings } from "@moon-cleanup/shared";

/** Read-out of the counter. Updated in place: read it, do not keep it. */
export interface DrawBudgetState {
  /** Draw calls and triangles of the last frame, all passes. */
  drawCalls: number;
  triangles: number;
  /** The preset's ceilings. */
  budgetDrawCalls: number;
  budgetTriangles: number;
  /** The last frame was over either ceiling. */
  over: boolean;
  /** Frames counted, and how many of them were over, since the last `reset()`. */
  frames: number;
  overFrames: number;
  /** Highest values seen since the last `reset()`. */
  peakDrawCalls: number;
  peakTriangles: number;
}

export class DrawBudgetCounter {
  readonly state: DrawBudgetState = {
    drawCalls: 0,
    triangles: 0,
    budgetDrawCalls: 0,
    budgetTriangles: 0,
    over: false,
    frames: 0,
    overFrames: 0,
    peakDrawCalls: 0,
    peakTriangles: 0,
  };

  /** New preset: its ceilings apply from the next frame and the history restarts. */
  setBudget(budgets: QualitySettings["budgets"]): void {
    this.state.budgetDrawCalls = budgets.drawCalls;
    this.state.budgetTriangles = budgets.triangles;
    this.reset();
  }

  /** One rendered frame. */
  record(drawCalls: number, triangles: number): void {
    const s = this.state;
    s.drawCalls = drawCalls;
    s.triangles = triangles;
    s.frames += 1;
    s.over =
      (s.budgetDrawCalls > 0 && drawCalls > s.budgetDrawCalls) ||
      (s.budgetTriangles > 0 && triangles > s.budgetTriangles);
    if (s.over) s.overFrames += 1;
    if (drawCalls > s.peakDrawCalls) s.peakDrawCalls = drawCalls;
    if (triangles > s.peakTriangles) s.peakTriangles = triangles;
  }

  /** Drops the history (frames, over count, peaks); the ceilings stay. */
  reset(): void {
    const s = this.state;
    s.frames = 0;
    s.overFrames = 0;
    s.peakDrawCalls = 0;
    s.peakTriangles = 0;
    s.over = false;
  }
}
