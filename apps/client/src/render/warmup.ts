// Pipeline warm-up tracker (docs/architecture/rendering-pipeline.md section 12). Pure state machine: no three, no DOM.
//
// How warm-up works in this build. three r187's `compileAsync` holds renderer state across its awaits and leaves the game
// black when a frame renders meanwhile (W3-T02 finding), so warm-up is a run of ordinary SYNCHRONOUS frames rendered behind
// the Clock In screen: the full frame pipeline (scene pass, every shadow cascade, lamp shadows, post chain) is rendered with
// the warm-up sources switched on, which builds every pipeline the frame needs, including the shadow pipelines
// `compileAsync` skips (#35086). A warm-up source is a callback an owner registers: it is called with `true` when a warm-up
// starts (show one instance of every variant it will ever draw: both lamp states, hidden LODs, VFX quads, with culling
// off) and with `false` when it ends.
//
// The tracker watches the renderer's pipeline (program) count once per frame:
//   warming  the count is still growing, or fewer than `minFrames` frames have been rendered;
//   ready    the count stood still for `stableFrames` frames (or `maxMs` passed: a warm-up never blocks play for good).
// After `ready` every new pipeline is a runtime creation: it is counted in `pipelinesAfterWarmup` (budget: 0) until the
// next warm-up. A preset change, new post stages or a recreated renderer start a new warm-up.

export type WarmupPhase = "idle" | "warming" | "ready";

/** Why a warm-up ran. */
export type WarmupReason = "boot" | "preset" | "stages" | "device" | "request";

export interface WarmupTuning {
  /** Fewest frames a warm-up renders (section 12 step 3: 2 hidden frames). */
  readonly minFrames: number;
  /** Frames in a row without a new pipeline that end the warm-up. */
  readonly stableFrames: number;
  /** A warm-up ends after this long even if pipelines still appear (ms). */
  readonly maxMs: number;
}

export const WARMUP_TUNING: WarmupTuning = { minFrames: 2, stableFrames: 3, maxMs: 8000 };

/** Section 12 budget: pipelines ready within 4 s on Tier A, 8 s on Tier B (and C). */
export function warmupBudgetMs(tier: string): number {
  return tier === "A" ? 4000 : 8000;
}

/** Read-out of the tracker. Updated in place: read it, do not keep it. */
export interface WarmupState {
  phase: WarmupPhase;
  reason: WarmupReason;
  /** Warm-ups completed since boot. */
  completed: number;
  /** Duration of the first (boot) warm-up in ms: the `pipelinesReadyMs` telemetry value. 0 until it has completed. */
  pipelinesReadyMs: number;
  /** Duration of the last completed warm-up in ms, and the frames it rendered. */
  lastMs: number;
  lastFrames: number;
  /** `true` when the last warm-up ended on the time cap instead of a stable count. */
  timedOut: boolean;
  /** Pipelines alive now, and at the end of the last warm-up. */
  pipelines: number;
  pipelinesAtReady: number;
  /** Pipelines created since the last warm-up completed (budget 0). */
  pipelinesAfterWarmup: number;
  /** Frames since the last warm-up in which at least one pipeline was created. */
  runtimeCreationFrames: number;
}

export class PipelineWarmup {
  readonly state: WarmupState = {
    phase: "idle",
    reason: "boot",
    completed: 0,
    pipelinesReadyMs: 0,
    lastMs: 0,
    lastFrames: 0,
    timedOut: false,
    pipelines: 0,
    pipelinesAtReady: 0,
    pipelinesAfterWarmup: 0,
    runtimeCreationFrames: 0,
  };

  private readonly tuning: WarmupTuning;
  private startedAtMs = 0;
  private frames = 0;
  private stable = 0;
  private lastCount = -1;

  constructor(tuning: WarmupTuning = WARMUP_TUNING) {
    this.tuning = tuning;
  }

  get warming(): boolean {
    return this.state.phase === "warming";
  }

  /** Starts (or restarts) a warm-up at `nowMs`. Returns `true` when the phase changed to warming. */
  begin(reason: WarmupReason, nowMs: number): boolean {
    const s = this.state;
    const changed = s.phase !== "warming";
    // A warm-up already running keeps its start time and reason: the new cause is folded into it.
    if (changed) {
      s.phase = "warming";
      s.reason = reason;
      this.startedAtMs = nowMs;
      this.frames = 0;
    }
    this.stable = 0;
    return changed;
  }

  /**
   * One rendered frame: `pipelines` is the renderer's pipeline (program) count after it, `nowMs` the clock. Returns `true`
   * on the frame that completes a warm-up. Allocates nothing.
   */
  frame(pipelines: number, nowMs: number): boolean {
    const s = this.state;
    const previous = this.lastCount;
    this.lastCount = pipelines;
    s.pipelines = pipelines;
    if (s.phase === "ready") {
      if (previous >= 0 && pipelines > previous) {
        s.runtimeCreationFrames += 1;
        s.pipelinesAfterWarmup += pipelines - previous;
      }
      return false;
    }
    if (s.phase !== "warming") return false;

    this.frames += 1;
    if (previous >= 0 && pipelines === previous) this.stable += 1;
    else this.stable = 0;
    const elapsed = nowMs - this.startedAtMs;
    const settled = this.frames >= this.tuning.minFrames && this.stable >= this.tuning.stableFrames;
    const timedOut = elapsed >= this.tuning.maxMs;
    if (!settled && !timedOut) return false;

    s.phase = "ready";
    s.timedOut = !settled;
    s.completed += 1;
    s.lastMs = elapsed;
    s.lastFrames = this.frames;
    if (s.completed === 1) s.pipelinesReadyMs = elapsed;
    s.pipelinesAtReady = pipelines;
    s.pipelinesAfterWarmup = 0;
    s.runtimeCreationFrames = 0;
    return true;
  }
}
