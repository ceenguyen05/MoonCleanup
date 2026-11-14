// Draw-count knob of the bench (`?draws=`): filler draws are added or removed until the renderer's own count for the
// last frame (all passes) matches the target. The controller is pure: feed it the measured count, get the filler count
// to show next. Each filler costs a fixed number of draws (1 main pass, +1 in a depth/normal prepass), and the control
// converges through measurement, so it needs no knowledge of how many passes there are.

export interface DrawCalibration {
  /** Fillers to make visible for the next frame. */
  fillers: number;
  /** `true` once the measured count equals the target (or the filler pool or zero is the limit). */
  settled: boolean;
}

export interface DrawCalibratorOptions {
  readonly target: number;
  readonly maxFillers: number;
  /** Frames to wait after a change before the measurement is trusted (stats lag the scene by a frame). */
  readonly lagFrames?: number;
  /** Give up after this many corrections. */
  readonly maxSteps?: number;
}

export class DrawCalibrator {
  fillers = 0;
  settled = false;
  /** Measured draws per filler (learned; starts at 1). */
  perFiller = 1;
  /** Corrections applied so far. */
  steps = 0;

  private readonly target: number;
  private readonly maxFillers: number;
  private readonly lagFrames: number;
  private readonly maxSteps: number;
  private framesSinceChange = 0;
  private lastMeasured = -1;
  private lastFillers = 0;

  constructor(options: DrawCalibratorOptions) {
    this.target = options.target;
    this.maxFillers = options.maxFillers;
    this.lagFrames = options.lagFrames ?? 2;
    this.maxSteps = options.maxSteps ?? 12;
  }

  /** Call once per frame with the draw count of the previous frame. Returns the filler count to show. */
  next(measuredDraws: number): number {
    if (this.settled) return this.fillers;
    this.framesSinceChange += 1;
    if (this.framesSinceChange <= this.lagFrames) return this.fillers;

    // Learn the draws added per filler from the last correction.
    if (this.lastMeasured >= 0 && this.fillers !== this.lastFillers) {
      const slope = (measuredDraws - this.lastMeasured) / (this.fillers - this.lastFillers);
      if (Number.isFinite(slope) && slope > 0) this.perFiller = slope;
    }
    const missing = this.target - measuredDraws;
    if (missing === 0 || this.steps >= this.maxSteps) {
      this.settled = true;
      return this.fillers;
    }
    const delta = Math.round(missing / this.perFiller) || Math.sign(missing);
    const wanted = Math.min(this.maxFillers, Math.max(0, this.fillers + delta));
    if (wanted === this.fillers) {
      this.settled = true; // at the pool limit or at zero: the target is not reachable
      return this.fillers;
    }
    this.lastMeasured = measuredDraws;
    this.lastFillers = this.fillers;
    this.fillers = wanted;
    this.steps += 1;
    this.framesSinceChange = 0;
    return this.fillers;
  }
}
