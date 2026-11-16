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
// Pace guard (M1-W2-T03). GPU time alone cannot see a missed display frame: on an integrated GPU the browser's compositor
// shares the device, and a frame whose own passes fit the GPU budget can still miss vsync. With the `gpu` signal the caller
// therefore also passes the frame interval's budget (`paceTargetMs`); the controller keeps the intervals in a second window
// and counts "over" when either the GPU time or the frame pace is over (the pace verdict needs a full 30-frame window, per
// section 9's "last 30 frames"). The pace budget is never tighter than the display
// allows: the fastest tenth of the windows stands in for the refresh interval (a 50 Hz display is not "over" a 60 fps target
// for ever). It is believed between 240 Hz and 29 Hz (slower is load), falls at once, is dropped by `reset()` and, on the gpu
// signal only, rises after a whole `refreshHorizonS` without a faster window (display 60 -> 30 Hz). The interval signal uses
// the same floor on its target. Known limits: a frame rate locked at exactly 2 x refresh from a reset on is read as the display
// rate; on the interval signal a mid-session drop of the display rate is learnt only at the next reset (preset change, warm-up). A step up taken on GPU headroom is then judged like a vsync probe: if the budget breaks it is taken back
// and the next attempt waits twice as long, so a scale the display cannot hold is not retried every 4 s.
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
  /**
   * A probe step is judged from this many seconds after it; over budget -> taken back. Never sooner than
   * `minChangeIntervalS` (at most one change per 2 s holds for a failed probe too).
   */
  readonly probeJudgeAfterS: number;
  /** An interval longer than this is a stall, not load. */
  readonly stallMs: number;
  /** Samples ignored after a reset (pipelines compile, targets reallocate). */
  readonly settleS: number;
  /**
   * The refresh estimate falls at once but rises only to the slowest-showing horizon: when no window in this many seconds
   * showed the current estimate, it becomes the fastest any of them showed (display went 60 -> 30 Hz). Longer than the time
   * to reach the floor plus `DYNRES_FLOOR_HINT_S`, so a real overload at the floor is reported before it is reinterpreted.
   */
  readonly refreshHorizonS: number;
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
  refreshHorizonS: 30,
};

/** Seconds at the floor while still over budget after which the UI may offer a lower preset (section 9). */
export const DYNRES_FLOOR_HINT_S = 10;

/** Budget in ms of a signal for a preset's dynres block. */
export function dynresTargetMs(signal: DynresSignal, dynres: { targetFps: number; gpuBudgetMs: number }): number {
  return signal === "gpu" ? dynres.gpuBudgetMs : 1000 / dynres.targetFps;
}

/** Slowest frame interval believed to be a display rate or browser cap (30 fps plus jitter), not load. */
const REFRESH_MAX_MS = 1000 / 29;

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
  /** Pace guard (gpu signal): p90 of the frame interval at the last evaluation and its budget (ms); 0 when not in use. */
  lastPaceP90Ms = 0;
  lastPaceTargetMs = 0;
  /** `true` when the last evaluation was over budget because of the frame pace alone. */
  paceLimited = false;

  private readonly tuning: DynresTuning;
  private readonly window: Float32Array;
  private readonly sorted: Float32Array;
  /** Frame intervals of the same frames as `window` (pace guard). */
  private readonly intervals: Float32Array;
  /** Fastest tenth of any window of frame intervals so far: the display's refresh interval, as far as it showed. */
  private refreshMs = Number.POSITIVE_INFINITY;
  /** Fastest tenth seen since `refreshHorizonAtS`: what the estimate rises to when the horizon ends. */
  private refreshCandidateMs = Number.POSITIVE_INFINITY;
  private refreshHorizonAtS = 0;
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
  /** Multiplier on the hold before the next upward step; doubles after a failed probe, 1 after one that held. */
  private backoff = 1;
  private probing = false;

  constructor(range: DynresRange, initialScale: number, tuning: DynresTuning = DYNRES_TUNING) {
    this.tuning = tuning;
    this.window = new Float32Array(tuning.windowFrames);
    this.sorted = new Float32Array(tuning.windowFrames);
    this.intervals = new Float32Array(tuning.windowFrames);
    this.min = range.scaleMin;
    this.max = range.scaleMax;
    this.scale = snap(Math.min(this.max, Math.max(this.min, initialScale)));
    this.settleLeftS = tuning.settleS;
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
    this.backoff = 1;
    this.probing = false;
    this.floorSeconds = 0;
    // A preset change, warm-up or device change may come with another display rate: learn it again.
    this.refreshMs = Number.POSITIVE_INFINITY;
    this.refreshCandidateMs = Number.POSITIVE_INFINITY;
    this.refreshHorizonAtS = this.clockS;
  }

  /**
   * One frame: `intervalMs` is the time since the previous frame, `valueMs` the signal's reading for it (the GPU frame time
   * for `gpu`, the interval itself for `interval`), `targetMs` the budget of that signal. `paceTargetMs` (gpu signal only,
   * 0 = off) is the frame interval's budget for the pace guard and `paceMs` the interval it judges (the display interval
   * of the frame; default `intervalMs`). Returns the scale to run.
   */
  sample(
    intervalMs: number,
    valueMs: number,
    targetMs: number,
    signal: DynresSignal = "interval",
    paceTargetMs = 0,
    paceMs = intervalMs,
  ): number {
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
    this.intervals[this.cursor] = paceMs;
    this.cursor = (this.cursor + 1) % this.window.length;
    if (this.count < this.window.length) this.count += 1;
    this.sinceEvaluateS += dtS;
    if (this.sinceEvaluateS < t.evaluateEveryS || this.count < t.minFrames) return this.scale;
    this.sinceEvaluateS = 0;

    const offset = this.window.length - this.count;
    // Unused slots are 0 and sort to the front: read percentiles from the filled tail. A partial window (slow frames right
    // after a clear) never reads its single largest value: one hitch among 5-9 frames is not a p90 miss.
    const rank = Math.max(0, Math.min(this.count - 2, Math.ceil(t.percentile * this.count) - 1));

    // Refresh estimate (both signals): display timestamps are multiples of the refresh interval, so the fastest tenth of a
    // window shows it as soon as a few frames in a row were presented without a miss (believed between 240 Hz and 29 Hz).
    this.sorted.set(this.intervals);
    this.sorted.sort();
    this.updateRefresh(this.sorted[offset + Math.floor(0.1 * this.count)] ?? 0);
    const refreshFloor = Number.isFinite(this.refreshMs) ? this.refreshMs : 0;

    // Pace guard: the same percentile of the frame intervals against the frame budget (never below the refresh interval).
    let paceOver = false;
    const paced = signal === "gpu" && paceTargetMs > 0;
    if (paced) {
      const paceTarget = Math.max(paceTargetMs, refreshFloor);
      const paceP90 = this.sorted[offset + rank] ?? 0;
      this.lastPaceP90Ms = paceP90;
      this.lastPaceTargetMs = paceTarget;
      // Section 9 judges the last 30 frames: a partial window right after a clear (e.g. 3 slow frames of 27) would read a
      // 10 % miss rate as a p90 miss, so the pace verdict waits for a full window. The GPU-time law keeps `minFrames`.
      paceOver = this.count >= this.window.length && paceP90 > t.downAbove * paceTarget;
    } else {
      this.lastPaceP90Ms = 0;
      this.lastPaceTargetMs = 0;
    }

    // The interval signal gets the same refresh floor: a 50 Hz panel or a 30 fps cap (Energy Saver) is not GPU load.
    const target = signal === "interval" ? Math.max(targetMs, refreshFloor) : targetMs;
    this.sorted.set(this.window);
    this.sorted.sort();
    const p90 = this.sorted[offset + rank] ?? 0;
    this.lastP90Ms = p90;
    this.lastTargetMs = target;
    this.evaluate(p90, target, paceOver, paced);
    return this.scale;
  }

  private evaluate(p90: number, targetMs: number, paceOver: boolean, paced: boolean): void {
    const t = this.tuning;
    const now = this.clockS;
    const valueOver = p90 > t.downAbove * targetMs;
    const over = valueOver || paceOver;
    const under = p90 < t.upBelow * targetMs && !paceOver;
    const sinceStep = now - this.lastStepAtS;
    this.paceLimited = paceOver && !valueOver;

    // Floor bookkeeping (section 9: after 10 s at the floor and still slow, the UI offers a lower preset).
    if (over && this.scale <= this.min) this.floorSeconds += t.evaluateEveryS;
    else this.floorSeconds = 0;

    if (this.probing) {
      if (sinceStep < Math.max(t.probeJudgeAfterS, t.minChangeIntervalS)) return;
      if (over) {
        // The probe did not hold: take it back now (not a law step, so the reverse lock does not apply) and wait longer.
        this.probing = false;
        this.backoff = Math.min(t.probeHoldMaxS / t.probeHoldS, this.backoff * 2);
        this.step(-t.stepUp, now);
        this.metSinceS = Number.NaN;
        this.underSinceS = Number.NaN;
        return;
      }
      if (sinceStep >= t.reverseLockS) {
        this.probing = false;
        this.backoff = 1;
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

    if (under && now - this.underSinceS >= t.upHoldS * (paced ? this.backoff : 1)) {
      this.step(t.stepUp, now);
      this.underSinceS = Number.NaN;
      // With the pace guard on, GPU headroom is a hint, not proof: judge the step like a probe.
      this.probing = paced;
      return;
    }
    // Vsync hides headroom on the interval signal: probe upward after the budget has been met for a while.
    if (this.signal === "interval" && !under && now - this.metSinceS >= t.probeHoldS * this.backoff) {
      this.step(t.stepUp, now);
      this.probing = true;
    }
  }

  /** Falls at once to a faster window; rises to the fastest of the last horizon when no window showed the estimate. */
  private updateRefresh(fastest: number): void {
    // 4 ms (240 Hz) to 1000 / 29 ms (a 30 fps cap such as Energy Saver, with jitter): anything slower is load, not a display.
    if (!(fastest >= 4 && fastest <= REFRESH_MAX_MS)) return;
    if (fastest < this.refreshMs) this.refreshMs = fastest;
    if (fastest < this.refreshCandidateMs) this.refreshCandidateMs = fastest;
    if (this.clockS - this.refreshHorizonAtS < this.tuning.refreshHorizonS) return;
    // Only the GPU signal may raise it: GPU time still sees real load there. On the interval signal a frame rate locked at
    // 2 x refresh by load looks exactly like a 30 Hz display, so the estimate falls only (until `reset()`).
    if (this.signal !== "gpu") {
      this.refreshCandidateMs = Number.POSITIVE_INFINITY;
      this.refreshHorizonAtS = this.clockS;
      return;
    }
    // The candidate is never below the estimate unless a window showed it, so this only raises a stale estimate.
    this.refreshMs = this.refreshCandidateMs;
    this.refreshCandidateMs = Number.POSITIVE_INFINITY;
    this.refreshHorizonAtS = this.clockS;
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
    // The pace window must be cleared too: its unused slots are read as the sorted front (offset), and stale intervals of
    // the previous window would shift the refresh estimate and the reported pace p90 of a partial window.
    this.intervals.fill(0);
    this.count = 0;
    this.cursor = 0;
    this.sinceEvaluateS = 0;
  }
}
