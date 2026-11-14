// PerfCollector: the data side of the perf HUD (M0-W2-T01). Windows of frame interval, per-step CPU, GPU totals and
// the HUD's own cost; builds the `PerfSnapshot` export. `record*` methods are per-frame and allocate nothing; `snapshot`
// allocates (export time only).

import { PERF_SNAPSHOT_SCHEMA, type GpuTimingSource, type PerfSnapshot } from "./snapshot";
import { emptySummary, RollingWindow, type WindowSummary } from "./stats";

/** Frames per statistics window (about 4 s at 60 FPS; the runner computes the 60 s statistics itself). */
export const DEFAULT_WINDOW_FRAMES = 240;

/** Draw and memory numbers read from the renderer once per frame. Reused object. */
export interface RenderReadout {
  drawCalls: number;
  triangles: number;
  geometries: number;
  textures: number;
  gpuMemoryBytes: number;
  texturesBytes: number;
  framesRendered: number;
  lossCount: number;
}

export function emptyRenderReadout(): RenderReadout {
  return {
    drawCalls: 0,
    triangles: 0,
    geometries: 0,
    textures: 0,
    gpuMemoryBytes: 0,
    texturesBytes: 0,
    framesRendered: 0,
    lossCount: 0,
  };
}

export interface CollectorEnv {
  readonly backend: string;
  readonly tier: string;
  readonly preset: string;
  readonly gpu: string;
  readonly userAgent: string;
  readonly dpr: number;
  readonly renderScale: number;
  readonly canvasCssPx: readonly [number, number];
}

export interface CollectorContext {
  readonly env: CollectorEnv;
  readonly gpuSource: GpuTimingSource;
  readonly pipelinesAfterWarmup: number | null;
  readonly jsHeapBytes: number | null;
  readonly net: { readonly rttMs: number | null; readonly conn: string | null };
  readonly nowMs: number;
}

export class PerfCollector {
  readonly frameWindow: RollingWindow;
  readonly totalWindow: RollingWindow;
  readonly gpuRenderWindow: RollingWindow;
  readonly gpuComputeWindow: RollingWindow;
  /** Cost of the debug module's own update (HUD + collection), ms. */
  readonly selfWindow: RollingWindow;
  readonly render: RenderReadout = emptyRenderReadout();
  frames = 0;
  private readonly stepWindows: RollingWindow[];

  constructor(
    readonly stepIds: readonly string[],
    windowFrames: number = DEFAULT_WINDOW_FRAMES,
  ) {
    this.frameWindow = new RollingWindow(windowFrames);
    this.totalWindow = new RollingWindow(windowFrames);
    this.gpuRenderWindow = new RollingWindow(windowFrames);
    this.gpuComputeWindow = new RollingWindow(windowFrames);
    this.selfWindow = new RollingWindow(windowFrames);
    this.stepWindows = stepIds.map(() => new RollingWindow(windowFrames));
  }

  /** `stepMs[i]` is the duration of `stepIds[i]` in the frame just finished. */
  recordFrame(intervalMs: number, stepMs: ArrayLike<number>): void {
    this.frames += 1;
    if (Number.isFinite(intervalMs)) this.frameWindow.push(intervalMs);
    let total = 0;
    for (let i = 0; i < this.stepWindows.length; i++) {
      const ms = stepMs[i] ?? 0;
      this.stepWindows[i]?.push(ms);
      total += ms;
    }
    this.totalWindow.push(total);
  }

  /** One resolved GPU timestamp pair (milliseconds). */
  recordGpu(renderMs: number, computeMs: number): void {
    this.gpuRenderWindow.push(renderMs);
    this.gpuComputeWindow.push(computeMs);
  }

  recordSelf(ms: number): void {
    this.selfWindow.push(ms);
  }

  stepSummary(index: number, out: WindowSummary): WindowSummary {
    const window = this.stepWindows[index];
    return window === undefined ? Object.assign(out, emptySummary()) : window.summarize(out);
  }

  reset(): void {
    this.frames = 0;
    for (const w of [
      this.frameWindow,
      this.totalWindow,
      this.gpuRenderWindow,
      this.gpuComputeWindow,
      this.selfWindow,
      ...this.stepWindows,
    ]) {
      w.clear();
    }
  }

  snapshot(ctx: CollectorContext): PerfSnapshot {
    const frameMs = this.frameWindow.summarize(emptySummary());
    const cpuMs: Record<string, WindowSummary> = {};
    this.stepIds.forEach((id, i) => {
      cpuMs[id] = this.stepSummary(i, emptySummary());
    });
    const measured = ctx.gpuSource !== "none" && this.gpuRenderWindow.size > 0;
    const r = this.render;
    return {
      schema: PERF_SNAPSHOT_SCHEMA,
      atMs: ctx.nowMs,
      env: ctx.env,
      frameMs,
      fps: frameMs.avg > 0 ? 1000 / frameMs.avg : 0,
      cpuMs,
      cpuTotalMs: this.totalWindow.summarize(emptySummary()),
      gpu: {
        source: ctx.gpuSource,
        measured,
        renderMs: measured ? this.gpuRenderWindow.summarize(emptySummary()) : emptySummary(),
        computeMs: measured ? this.gpuComputeWindow.summarize(emptySummary()) : emptySummary(),
        perPass: "unavailable",
      },
      render: {
        drawCalls: r.drawCalls,
        triangles: r.triangles,
        geometries: r.geometries,
        textures: r.textures,
        gpuMemoryBytes: r.gpuMemoryBytes,
        texturesBytes: r.texturesBytes,
        pipelinesAfterWarmup: ctx.pipelinesAfterWarmup,
        framesRendered: r.framesRendered,
        lossCount: r.lossCount,
      },
      memory: { jsHeapBytes: ctx.jsHeapBytes },
      net: ctx.net,
      frames: this.frames,
    };
  }
}
