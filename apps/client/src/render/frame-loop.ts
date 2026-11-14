// Frame orchestration: one callback per display frame that calls every client module's `update(frame)` in the
// fixed order of docs/architecture/module-boundaries.md section 4 (rendering-pipeline.md section 3.1):
//
//   input -> net ingest -> sim predict (fixed step) -> gameplay -> animation -> terrain/dust -> visuals/VFX ->
//   render -> audio -> UI flush (-> debug, last, so its HUD sees the whole frame)
//
// `input` and `sim predict` are not ClientModules; the composition root passes them as optional phases.
// Every step is wrapped in a User Timing span `mc:<module>:update` (performance.mark + performance.measure), and
// its duration is kept in a typed array for the perf HUD. The loop itself allocates nothing per frame; the span
// entries are the browser's (switch them off with `setSpansEnabled(false)` when nothing reads them).
//
// three-free and DOM-free: time, the frame source and the performance API are injected.

import {
  CLIENT_MODULE_IDS,
  type ClientModule,
  type ClientModuleId,
  type FrameInfo,
  type QualitySettings,
  type ServiceTypes,
  type ViewportSize,
} from "@moon-cleanup/shared";
import type { FrameScheduler } from "./renderer-host";

/** Per-frame `update` order of the client modules (module-boundaries.md section 4). */
export const MODULE_UPDATE_ORDER = [
  "net",
  "gameplay",
  "animation",
  "terrain",
  "visuals",
  "render",
  "audio",
  "ui",
  "debug",
] as const satisfies readonly ClientModuleId[];

/** Every step of a frame in execution order: the two non-module phases plus the modules. */
export const FRAME_STEP_IDS = [
  "input",
  "net",
  "sim",
  "gameplay",
  "animation",
  "terrain",
  "visuals",
  "render",
  "audio",
  "ui",
  "debug",
] as const;
export type FrameStepId = (typeof FRAME_STEP_IDS)[number];

/** User Timing span name of a step: `mc:<module>:update`. */
export function spanName(step: FrameStepId): string {
  return `mc:${step}:update`;
}

/** Longest `dt` a frame reports, in seconds (a background tab or a breakpoint must not explode the simulation). */
export const MAX_FRAME_DT_S = 0.1;

/** Frames kept for the frame-time statistics. */
export const FRAME_TIME_WINDOW = 240;

/** Latest predicted sim tick and interpolation factor; read after the `sim` phase. */
export interface SimClockLike {
  readonly alpha: number;
  readonly simTick: number;
}

/** Viewport source polled once per frame (the render module's ViewportTracker). */
export interface ViewportSourceLike {
  readonly current: ViewportSize;
  poll(): boolean;
}

/** The subset of the Performance API the loop uses. */
export interface PerformanceLike {
  now(): number;
  mark(name: string): unknown;
  measure(name: string, startMark: string): unknown;
  clearMarks(name: string): void;
  clearMeasures(name: string): void;
}

export interface FrameLoopOptions<S extends ServiceTypes = ServiceTypes> {
  /** The registered modules, in any order; missing ids are skipped. */
  readonly modules: readonly ClientModule<S>[];
  /** Frame source (the renderer host's scheduler, which follows the renderer across recreations). */
  readonly scheduler: FrameScheduler;
  /** Quality settings in effect (the `quality` service's `current`). */
  readonly getQuality: () => QualitySettings;
  /** When given, polled at the start of every frame; a change calls `resize` on every module that has one. */
  readonly viewport?: ViewportSourceLike;
  /** Samples input devices; runs first. */
  readonly input?: (frame: FrameInfo) => void;
  /** Runs the fixed-step sim prediction; runs after net ingest. */
  readonly simPredict?: (frame: FrameInfo) => void;
  readonly simClock?: SimClockLike;
  /** Called when a step throws; the frame continues with the next step. Omitted: the error propagates. */
  readonly onError?: (step: FrameStepId, error: unknown) => void;
  /** Default: `globalThis.performance`. */
  readonly performance?: PerformanceLike;
  /** Default `true`. */
  readonly spans?: boolean;
}

export interface FrameTimeStats {
  /** Frames in the sample (at most FRAME_TIME_WINDOW). */
  readonly samples: number;
  /** Mean interval between frames in milliseconds; 0 without samples. */
  readonly avgMs: number;
  readonly p95Ms: number;
}

interface MutableFrameInfo {
  dt: number;
  time: number;
  alpha: number;
  simTick: number;
  quality: QualitySettings;
}

type StepFn = (frame: FrameInfo) => void;

const STEP_COUNT = FRAME_STEP_IDS.length;

export class FrameLoop<S extends ServiceTypes = ServiceTypes> {
  /** The frame being (or last) processed. Reused every frame: read it, do not keep it. */
  readonly frame: FrameInfo;
  /** Frames processed since construction. */
  frameCount = 0;
  running = false;

  private readonly info: MutableFrameInfo;
  private readonly options: FrameLoopOptions<S>;
  private readonly perf: PerformanceLike;
  private readonly steps: (StepFn | null)[] = [];
  private readonly resizable: ClientModule<S>[] = [];
  private readonly startMarks: string[] = [];
  private readonly spanNames: string[] = [];
  private readonly stepMs = new Float64Array(STEP_COUNT);
  private readonly frameIntervalsMs = new Float32Array(FRAME_TIME_WINDOW);
  private intervalCount = 0;
  private intervalHead = 0;
  private spans: boolean;
  private lastTimeMs = Number.NaN;

  private manual = false;
  private pendingSteps = 0;
  private stepDt = 0;
  private stepSettling = false;
  private stepResolve: (() => void) | null = null;
  private frameWaiters: { target: number; resolve: () => void }[] = [];

  private readonly tick = (timeMs: number): void => {
    this.onTick(timeMs);
  };

  constructor(options: FrameLoopOptions<S>) {
    this.options = options;
    this.perf = options.performance ?? globalThis.performance;
    this.spans = options.spans ?? true;
    this.info = { dt: 0, time: 0, alpha: 0, simTick: 0, quality: options.getQuality() };
    this.frame = this.info;

    const byId = new Map<ClientModuleId, ClientModule<S>>();
    for (const module of options.modules) {
      if (byId.has(module.id)) throw new Error(`FrameLoop: module "${module.id}" is registered twice`);
      byId.set(module.id, module);
    }
    for (const id of FRAME_STEP_IDS) {
      let step: StepFn | null = null;
      if (id === "input") step = options.input ?? null;
      else if (id === "sim") step = options.simPredict ?? null;
      else {
        const module = byId.get(id);
        if (module !== undefined) step = module.update.bind(module);
      }
      this.steps.push(step);
      this.spanNames.push(spanName(id));
      this.startMarks.push(`${spanName(id)}:start`);
    }
    // Resize in registration order (render first, so the others see the new drawing-buffer size).
    for (const id of CLIENT_MODULE_IDS) {
      const module = byId.get(id);
      if (module?.resize !== undefined) this.resizable.push(module);
    }
  }

  /** Starts calling the modules every display frame. */
  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastTimeMs = Number.NaN;
    this.options.scheduler.start(this.tick);
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;
    this.options.scheduler.stop();
  }

  setSpansEnabled(enabled: boolean): void {
    this.spans = enabled;
  }

  /**
   * Manual mode (`?capture=1`): display frames no longer advance the game; only `step()` does. Used by the
   * screenshot harness for deterministic captures.
   */
  setManual(manual: boolean): void {
    this.manual = manual;
    this.lastTimeMs = Number.NaN;
  }

  get isManual(): boolean {
    return this.manual;
  }

  /**
   * Manual mode: advances exactly `count` frames with a fixed `dtSeconds`, one per display frame (three advances
   * its node frame once per display frame, so several renders inside one would reuse the first scene pass). The
   * promise resolves on the display frame after the last one, when that frame has been presented.
   */
  step(count: number, dtSeconds: number): Promise<void> {
    if (!this.manual) return Promise.reject(new Error("FrameLoop.step: not in manual mode"));
    if (!this.running) return Promise.reject(new Error("FrameLoop.step: the loop is not running"));
    if (this.stepResolve !== null) return Promise.reject(new Error("FrameLoop.step: a step is already in progress"));
    const frames = Math.max(0, Math.floor(count));
    if (frames === 0) return Promise.resolve();
    this.pendingSteps = frames;
    this.stepDt = Number.isFinite(dtSeconds) && dtSeconds >= 0 ? dtSeconds : 0;
    this.stepSettling = false;
    return new Promise((resolve) => {
      this.stepResolve = resolve;
    });
  }

  /** Resolves once `frameCount` has reached `count`. */
  whenFrameCount(count: number): Promise<void> {
    if (this.frameCount >= count) return Promise.resolve();
    return new Promise((resolve) => {
      this.frameWaiters.push({ target: count, resolve });
    });
  }

  /** Duration of `step` in the last frame, in milliseconds (0 when the step does not exist). */
  lastStepMs(step: FrameStepId): number {
    return this.stepMs[FRAME_STEP_IDS.indexOf(step)] ?? 0;
  }

  /** Mean and 95th percentile of the recent frame intervals. Allocates; call it from tools, not every frame. */
  frameTimeStats(): FrameTimeStats {
    const samples = this.intervalCount;
    if (samples === 0) return { samples: 0, avgMs: 0, p95Ms: 0 };
    const sorted = this.frameIntervalsMs.slice(0, samples).sort();
    let sum = 0;
    for (const value of sorted) sum += value;
    const p95Index = Math.min(samples - 1, Math.ceil(samples * 0.95) - 1);
    return { samples, avgMs: sum / samples, p95Ms: sorted[p95Index] ?? 0 };
  }

  dispose(): void {
    this.stop();
    this.frameWaiters.length = 0;
    this.stepResolve = null;
    this.pendingSteps = 0;
  }

  // ---- Internals ----------------------------------------------------------------------------------------------

  private onTick(timeMs: number): void {
    // three calls the loop once without a timestamp when it starts.
    const now = Number.isFinite(timeMs) ? timeMs : this.perf.now();

    // Wall-clock interval since the previous display frame; NaN on the first one.
    const intervalMs = Math.max(0, now - this.lastTimeMs);
    this.lastTimeMs = now;

    if (this.manual) {
      if (this.pendingSteps > 0) {
        this.pendingSteps -= 1;
        this.stepSettling = this.pendingSteps === 0;
        // The game advances by the fixed step; the statistics still record what the frame really cost.
        if (!Number.isNaN(intervalMs)) this.recordInterval(intervalMs);
        this.runFrame(this.stepDt);
      } else if (this.stepSettling) {
        this.stepSettling = false;
        const resolve = this.stepResolve;
        this.stepResolve = null;
        resolve?.();
      }
      return;
    }

    let dt = 0;
    if (!Number.isNaN(intervalMs)) {
      this.recordInterval(intervalMs);
      dt = Math.min(MAX_FRAME_DT_S, intervalMs / 1000);
    }
    this.runFrame(dt);
  }

  private recordInterval(intervalMs: number): void {
    this.frameIntervalsMs[this.intervalHead] = intervalMs;
    this.intervalHead = (this.intervalHead + 1) % FRAME_TIME_WINDOW;
    if (this.intervalCount < FRAME_TIME_WINDOW) this.intervalCount += 1;
  }

  private runFrame(dt: number): void {
    const info = this.info;
    const options = this.options;
    info.dt = dt;
    info.time += dt;
    info.quality = options.getQuality();
    this.readSimClock();

    const viewport = options.viewport;
    if (viewport !== undefined && viewport.poll()) {
      for (const module of this.resizable) module.resize?.(viewport.current);
    }

    for (let i = 0; i < STEP_COUNT; i++) {
      const step = this.steps[i];
      if (step === null || step === undefined) {
        this.stepMs[i] = 0;
        continue;
      }
      this.runStep(i, step);
      // The sim phase moves the tick and the interpolation factor the later modules render with.
      if (FRAME_STEP_IDS[i] === "sim") this.readSimClock();
    }

    this.frameCount += 1;
    if (this.frameWaiters.length > 0) this.settleFrameWaiters();
  }

  private runStep(index: number, step: StepFn): void {
    const perf = this.perf;
    const spans = this.spans;
    const startMark = this.startMarks[index] ?? "";
    const name = this.spanNames[index] ?? "";
    if (spans) {
      // Keep exactly one frame of entries in the timeline buffer.
      perf.clearMarks(startMark);
      perf.clearMeasures(name);
      perf.mark(startMark);
    }
    const startMs = perf.now();
    try {
      step(this.info);
    } catch (error) {
      const onError = this.options.onError;
      if (onError === undefined) throw error;
      onError(FRAME_STEP_IDS[index] ?? "render", error);
    } finally {
      this.stepMs[index] = perf.now() - startMs;
      if (spans) perf.measure(name, startMark);
    }
  }

  private readSimClock(): void {
    const clock = this.options.simClock;
    if (clock === undefined) return;
    this.info.alpha = clock.alpha;
    this.info.simTick = clock.simTick;
  }

  private settleFrameWaiters(): void {
    const waiters = this.frameWaiters;
    for (let i = waiters.length - 1; i >= 0; i--) {
      const waiter = waiters[i];
      if (waiter !== undefined && this.frameCount >= waiter.target) {
        waiters.splice(i, 1);
        waiter.resolve();
      }
    }
  }
}
