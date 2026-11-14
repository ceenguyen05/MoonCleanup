// Dynamic resolution controller (docs/architecture/rendering-pipeline.md section 9). Pure logic: no three, no DOM, no
// allocation after construction. The render module feeds it one sample per frame and applies the scale it returns through
// `RenderScale.set` -> `FramePipeline.setRenderScale` (per-pass `setResolutionScale`; the canvas and the DOM UI stay native).
//
// Control law (section 9), evaluated every 0.5 s on the p90 of the last 30 frames:
//   p90 > 1.05 x target                 -> scale - 0.10
//   p90 < 0.80 x target for 4 s         -> scale + 0.05
//   hysteresis: no reverse step within 4 s of a step, at most one change per 2 s, clamp to the preset range.
//
// Signal. `gpu`: GPU frame time (timestamp queries), target = the preset's GPU budget. `interval`: the frame interval, target
// = 1000 / targetFps; this is what runs when no GPU time is reported (WebGL2, WebGPU without `timestamp-query`, or while the
// reports are older than 1 s). In production the `GpuTimingModule` (gpu-timing.ts) feeds the GPU signal on WebGPU.
// Under vsync the interval is quantised to the display refresh: a frame that meets the target sits exactly ON it and never
// below 0.80 x target, so headroom is invisible. The interval signal therefore adds a guarded probe: after the budget has been
// met for `probeHoldS`, try + 0.05; if the next evaluations (>= 1 s later) miss the budget the step is taken back at once and
// the hold doubles (up to `probeHoldMaxS`), so a scene that cannot afford more pixels is probed ever more rarely; a probe that
// survives 4 s resets the hold.
//
// Stalls (tab switch, shader compile hitch: one interval above `stallMs`) are not GPU load: the sample is dropped and the
// window restarts. After every step or range change the window is cleared, so a verdict never mixes two scales.

export type DynresSignal = "gpu" | "interval";

export interface DynresRange {
  readonly scaleMin: number;
  readonly scaleMax: number;
}

export interface DynresTuning {
  /** Seconds between evaluations. */
  readonly evaluateEveryS: number;
  /** Frames in the percentile window. */
  readonly windowFrames: number;
  /** Fewest frames a verdict needs (slow frame rates fill the window slowly). */
  readonly minFrames: number;
  /** Percentile of the window the law reads, 0..1. */
  readonly percentile: number;
  /** Above `downAbove` x target: step down. */
  readonly downAbove: number;
  /** Below `upBelow` x target for `upHoldS`: step up. */
  readonly upBelow: number;
  readonly upHoldS: number;
  readonly stepDown: number;
  readonly stepUp: number;
  /** No step in the opposite direction within this many seconds of a step. */
  readonly reverseLockS: number;
  /** At most one change per this many seconds. */
  readonly minChangeIntervalS: number;
  /** Interval signal only: budget met for this long -> probe + stepUp. Doubles after a failed probe. */
  readonly probeHoldS: number;
  readonly probeHoldMaxS: number;
  /** A probe step is judged from this many seconds after it; over budget -> taken back. */
  readonly probeJudgeAfterS: number;
  /** An interval longer than this is a stall, not load. */
  readonly stallMs: number;
  /** Samples ignored after a reset (pipelines compile, targets reallocate). */
  readonly settleS: number;
}

/** Section 9 values. */
export const DYNRES_TUNING: DynresTuning = {
  evaluateEveryS: 0.5,
  windowFrames: 30,
  minFrames: 5,
  percentile: 0.9,
  downAbove: 1.05,
  upBelow: 0.8,
  upHoldS: 4,
  stepDown: 0.1,
  stepUp: 0.05,
  reverseLockS: 4,
  minChangeIntervalS: 2,
  probeHoldS: 8,
  probeHoldMaxS: 64,
  probeJudgeAfterS: 1,
  stallMs: 250,
  settleS: 1,
};

/** Seconds at the floor while still over budget after which the UI may offer a lower preset (section 9). */
export const DYNRES_FLOOR_HINT_S = 10;

/** Budget in ms of a signal for a preset's dynres block. */
export function dynresTargetMs(signal: DynresSignal, dynres: { targetFps: number; gpuBudgetMs: number }): number {
  return signal === "gpu" ? dynres.gpuBudgetMs : 1000 / dynres.targetFps;
}

function snap(scale: number): number {
  // Steps are multiples of 0.05; keep the value free of float drift (0.6000000000000001).
  return Math.round(scale * 1000) / 1000;
}

export class DynamicResolution {
  /** Scale the controller wants in effect. */
  scale: number;
  /** Signal of the last sample. */
  signal: DynresSignal = "interval";
  /** p90 of the last evaluation (ms); 0 before the first. */
  lastP90Ms = 0;
  /** Budget of the last evaluation (ms). */
  lastTargetMs = 0;
  /** Steps taken since construction (both directions). */
  steps = 0;
  /** Seconds spent at the floor while over budget (reset when the budget is met or the scale leaves the floor). */
  floorSeconds = 0;

  private readonly tuning: DynresTuning;
  private readonly window: Float32Array;
  private readonly sorted: Float32Array;
  private count = 0;
  private cursor = 0;
  private min: number;
  private max: number;
  /** Controller clock: seconds of sampled time. */
  private clockS = 0;
  private sinceEvaluateS = 0;
  private settleLeftS: number;
  private lastStepAtS = Number.NEGATIVE_INFINITY;
  private lastStepDirection = 0;
  private underSinceS = Number.NaN;
  private metSinceS = Number.NaN;
  private probeHoldS: number;
  private probing = false;

  constructor(range: DynresRange, initialScale: number, tuning: DynresTuning = DYNRES_TUNING) {
    this.tuning = tuning;
    this.window = new Float32Array(tuning.windowFrames);
    this.sorted = new Float32Array(tuning.windowFrames);
    this.min = range.scaleMin;
    this.max = range.scaleMax;
    this.scale = snap(Math.min(this.max, Math.max(this.min, initialScale)));
    this.settleLeftS = tuning.settleS;
    this.probeHoldS = tuning.probeHoldS;
  }

  /** `true` once the scale has sat at the floor over budget long enough to offer a lower preset. */
  get floorHint(): boolean {
    return this.floorSeconds >= DYNRES_FLOOR_HINT_S;
  }

  /** New range (preset change) and / or a scale set from outside: history is dropped, the law restarts from `scale`. */
  reset(range: DynresRange, scale: number): void {
    this.min = range.scaleMin;
    this.max = range.scaleMax;
    this.scale = snap(Math.min(this.max, Math.max(this.min, scale)));
    this.clearWindow();
    this.settleLeftS = this.tuning.settleS;
    this.lastStepAtS = Number.NEGATIVE_INFINITY;
    this.lastStepDirection = 0;
    this.underSinceS = Number.NaN;
    this.metSinceS = Number.NaN;
    this.probeHoldS = this.tuning.probeHoldS;
    this.probing = false;
    this.floorSeconds = 0;
  }

  /**
   * One frame: `intervalMs` is the time since the previous frame, `valueMs` the signal's reading for it (the GPU frame time
   * for `gpu`, the interval itself for `interval`), `targetMs` the budget of that signal. Returns the scale to run.
   */
  sample(intervalMs: number, valueMs: number, targetMs: number, signal: DynresSignal = "interval"): number {
    const t = this.tuning;
    if (!(intervalMs > 0) || !(valueMs >= 0) || !(targetMs > 0)) return this.scale;
    if (intervalMs > t.stallMs) {
      // A stall says nothing about the GPU; restart the window so it does not poison the percentile.
      this.clearWindow();
      return this.scale;
    }
    if (signal !== this.signal) {
      this.signal = signal;
      this.clearWindow();
      this.underSinceS = Number.NaN;
      this.metSinceS = Number.NaN;
    }
    const dtS = intervalMs / 1000;
    this.clockS += dtS;
    if (this.settleLeftS > 0) {
      this.settleLeftS -= dtS;
      return this.scale;
    }

    this.window[this.cursor] = valueMs;
    this.cursor = (this.cursor + 1) % this.window.length;
    if (this.count < this.window.length) this.count += 1;
    this.sinceEvaluateS += dtS;
    if (this.sinceEvaluateS < t.evaluateEveryS || this.count < t.minFrames) return this.scale;
    this.sinceEvaluateS = 0;

    this.sorted.set(this.window);
    // Unused slots are 0 and sort to the front: read the percentile from the filled tail.
    this.sorted.sort();
    const offset = this.window.length - this.count;
    const rank = Math.min(this.count - 1, Math.max(0, Math.ceil(t.percentile * this.count) - 1));
    const p90 = this.sorted[offset + rank] ?? 0;
    this.lastP90Ms = p90;
    this.lastTargetMs = targetMs;
    this.evaluate(p90, targetMs);
    return this.scale;
  }

  private evaluate(p90: number, targetMs: number): void {
    const t = this.tuning;
    const now = this.clockS;
    const over = p90 > t.downAbove * targetMs;
    const under = p90 < t.upBelow * targetMs;
    const sinceStep = now - this.lastStepAtS;

    // Floor bookkeeping (section 9: after 10 s at the floor and still slow, the UI offers a lower preset).
    if (over && this.scale <= this.min) this.floorSeconds += t.evaluateEveryS;
    else this.floorSeconds = 0;

    if (this.probing) {
      if (sinceStep < t.probeJudgeAfterS) return;
      if (over) {
        // The probe did not hold: take it back now (not a law step, so the reverse lock does not apply) and wait longer.
        this.probing = false;
        this.probeHoldS = Math.min(t.probeHoldMaxS, this.probeHoldS * 2);
        this.step(-t.stepUp, now);
        this.metSinceS = Number.NaN;
        return;
      }
      if (sinceStep >= t.reverseLockS) {
        this.probing = false;
        this.probeHoldS = t.probeHoldS;
      }
    }

    if (over) {
      this.underSinceS = Number.NaN;
      this.metSinceS = Number.NaN;
      if (this.scale <= this.min) return;
      if (sinceStep < t.minChangeIntervalS) return;
      if (this.lastStepDirection > 0 && sinceStep < t.reverseLockS) return;
      this.step(-t.stepDown, now);
      return;
    }

    if (Number.isNaN(this.metSinceS)) this.metSinceS = now;
    if (!under) this.underSinceS = Number.NaN;
    else if (Number.isNaN(this.underSinceS)) this.underSinceS = now;
    if (this.scale >= this.max) return;
    if (sinceStep < t.minChangeIntervalS) return;
    if (this.lastStepDirection < 0 && sinceStep < t.reverseLockS) return;

    if (under && now - this.underSinceS >= t.upHoldS) {
      this.step(t.stepUp, now);
      this.underSinceS = Number.NaN;
      return;
    }
    // Vsync hides headroom on the interval signal: probe upward after the budget has been met for a while.
    if (this.signal === "interval" && !under && now - this.metSinceS >= this.probeHoldS) {
      this.step(t.stepUp, now);
      this.probing = true;
    }
  }

  private step(delta: number, now: number): void {
    const next = snap(Math.min(this.max, Math.max(this.min, this.scale + delta)));
    if (next === this.scale) return;
    this.lastStepDirection = next > this.scale ? 1 : -1;
    this.scale = next;
    this.lastStepAtS = now;
    this.steps += 1;
    this.metSinceS = Number.NaN;
    this.clearWindow();
  }

  private clearWindow(): void {
    this.window.fill(0);
    this.count = 0;
    this.cursor = 0;
    this.sinceEvaluateS = 0;
  }
}
