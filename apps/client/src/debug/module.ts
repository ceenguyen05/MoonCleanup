// The `debug` ClientModule (M0-W2-T01): F3 perf HUD, GPU timestamp capture, `window.__mcStats()` export and the
// scripted camera path for tools/perf. Registers last; `dispose` removes the DOM, the key listener and the window
// hooks, so removing the module has no side effects (module-boundaries.md section 4).
//
// Cost: collection is a few typed-array writes per frame and runs while the module exists (the runner needs it with
// the HUD hidden); the DOM is touched at 4 Hz and only while the HUD is visible. The composition root registers this
// module only in dev or with `?perf=1`, so production carries nothing (see the report for the wiring).

import type { ClientModule, FrameInfo, ModuleContext } from "@moon-cleanup/shared";
import {
  FRAME_STEP_IDS,
  gpuTimingMode,
  GpuTimingPump,
  type FrameStepId,
  type RenderFrameStats,
  type RenderServices,
} from "../render";
import { emptyRenderReadout, PerfCollector, type CollectorContext, type RenderReadout } from "./collector";
import { sampleCameraPath, validateCameraPath, type CameraPathSpec, type CameraPose } from "./camera-path";
import { formatHudText, PerfHud } from "./hud";
import type { GpuTimingSource, PerfSnapshot } from "./snapshot";
import { emptySummary } from "./stats";

/** The window properties this module installs. */
export interface DebugHookTarget {
  __mcStats?: () => PerfSnapshot;
  __mcStatsReset?: () => void;
  __mcCameraPath?: (spec: CameraPathSpec | null) => void;
  __mcPerfHud?: (visible?: boolean) => boolean;
}

/** The slice of the frame loop the module reads (`FrameLoop.lastStepMs`). */
export interface StepTimeSource {
  lastStepMs(step: FrameStepId): number;
}

/** What the module reads from three's `renderer.info` / timestamp API; a seam so unit tests need no GPU. */
export interface GpuInfoLike {
  readonly render: { readonly drawCalls: number; readonly triangles: number; readonly timestamp: number };
  readonly compute: { readonly timestamp: number };
  readonly memory: {
    readonly geometries: number;
    readonly textures: number;
    readonly total: number;
    readonly texturesSize: number;
  };
}
export interface TimedRendererLike {
  readonly info: GpuInfoLike;
  resolveTimestampsAsync(type: "render" | "compute"): Promise<unknown>;
}

export interface DebugModuleOptions {
  /** The frame loop; it is created after module init, so the composition root passes a getter. */
  readonly getLoop: () => StepTimeSource | null;
  readonly win?: Window & DebugHookTarget;
  readonly doc?: Document;
  /** Start with the HUD visible (`?perf=1`). Default false: off until F3. */
  readonly startVisible?: boolean;
  /** Frames between GPU timestamp resolves. Default 8 (the resolve is async and not free). */
  readonly gpuResolveEvery?: number;
  /** Pipelines created since warm-up completed (render module counter when it exists); null when unknown. */
  readonly pipelinesAfterWarmup?: () => number | null;
  readonly now?: () => number;
}

interface PerfMemory {
  readonly usedJSHeapSize: number;
}

export class DebugModule implements ClientModule<RenderServices> {
  readonly id = "debug" as const;

  private readonly collector = new PerfCollector(FRAME_STEP_IDS);
  private readonly stepMs = new Float64Array(FRAME_STEP_IDS.length);
  private readonly readout: RenderReadout = emptyRenderReadout();
  private readonly drawStats: RenderFrameStats = { drawCalls: 0, triangles: 0 };
  private readonly pose: CameraPose = { px: 0, py: 0, pz: 0, tx: 0, ty: 0, tz: 0 };
  private readonly selfSummary = emptySummary();
  private readonly options: DebugModuleOptions;
  private ctx: ModuleContext<RenderServices> | null = null;
  private hud: PerfHud | null = null;
  private win: (Window & DebugHookTarget) | null = null;
  private lastNowMs = Number.NaN;
  private path: CameraPathSpec | null = null;
  private pathStartS = 0;
  private readonly gpuPump: GpuTimingPump;
  private disposed = false;
  private readonly onKey = (event: KeyboardEvent): void => {
    if (event.key === "F3") {
      event.preventDefault();
      this.hud?.toggle();
    }
  };

  constructor(options: DebugModuleOptions) {
    this.options = options;
    this.gpuPump = new GpuTimingPump({
      everyFrames: options.gpuResolveEvery ?? 8,
      onSample: (renderMs, computeMs) => this.collector.recordGpu(renderMs, computeMs),
    });
  }

  init(ctx: ModuleContext<RenderServices>): void {
    this.ctx = ctx;
    const win = this.options.win ?? (globalThis.window as (Window & DebugHookTarget) | undefined);
    const doc = this.options.doc ?? win?.document;
    if (win === undefined || doc === undefined) return;
    this.win = win;
    const hud = new PerfHud(doc);
    hud.setVisible(this.options.startVisible === true);
    this.hud = hud;
    win.addEventListener("keydown", this.onKey);
    win.__mcStats = () => this.snapshot();
    win.__mcStatsReset = () => this.collector.reset();
    win.__mcCameraPath = (spec) => this.setCameraPath(spec);
    win.__mcPerfHud = (visible) => {
      if (visible !== undefined) hud.setVisible(visible);
      return hud.isVisible;
    };
  }

  update(frame: FrameInfo): void {
    const ctx = this.ctx;
    if (ctx === null || this.disposed) return;
    const now = this.nowMs();
    const interval = now - this.lastNowMs;
    this.lastNowMs = now;

    const loop = this.options.getLoop();
    if (loop !== null) {
      for (let i = 0; i < FRAME_STEP_IDS.length; i++) {
        const id = FRAME_STEP_IDS[i];
        this.stepMs[i] = id === undefined || id === "debug" ? 0 : loop.lastStepMs(id);
      }
    }
    this.collector.recordFrame(interval, this.stepMs);

    const service = ctx.services.get("renderer");
    this.readRenderer(service.renderer as unknown as TimedRendererLike | null);
    this.applyCameraPath(frame.time);
    this.pumpGpuTimestamps();

    const hud = this.hud;
    if (hud?.due(now) === true) {
      const text = formatHudText(this.snapshot(), this.collector.selfWindow.summarize(this.selfSummary).p95);
      hud.show(text, now);
    }
    this.collector.recordSelf(this.nowMs() - now);
  }

  dispose(): void {
    this.disposed = true;
    this.gpuPump.dispose();
    const win = this.win;
    if (win !== null) {
      win.removeEventListener("keydown", this.onKey);
      delete win.__mcStats;
      delete win.__mcStatsReset;
      delete win.__mcCameraPath;
      delete win.__mcPerfHud;
    }
    this.hud?.dispose();
    this.hud = null;
    this.path = null;
    this.ctx = null;
    this.win = null;
  }

  /** The export behind `window.__mcStats()`. Allocates; call it from tools, not per frame. */
  snapshot(): PerfSnapshot {
    const ctx = this.ctx;
    const win = this.win;
    const renderer = ctx?.services.get("renderer");
    const quality = ctx?.services.get("quality");
    const state = ctx?.services.get("uiStore").getState();
    const perf = (win?.performance ?? globalThis.performance) as Performance & { memory?: PerfMemory };
    const context: CollectorContext = {
      env: {
        backend: renderer?.backend ?? "unknown",
        tier: renderer?.tier ?? "unknown",
        preset: quality?.current.preset ?? "unknown",
        gpu: quality?.capabilities.gpuDescription ?? "",
        userAgent: win?.navigator.userAgent ?? "",
        dpr: renderer?.viewport.dpr ?? 1,
        renderScale: renderer?.renderScale ?? 1,
        canvasCssPx: [renderer?.viewport.widthCssPx ?? 0, renderer?.viewport.heightCssPx ?? 0],
      },
      gpuSource: this.gpuSource(),
      pipelinesAfterWarmup: this.options.pipelinesAfterWarmup?.() ?? null,
      jsHeapBytes: perf.memory?.usedJSHeapSize ?? null,
      net: { rttMs: state?.session.rttMs ?? null, conn: state?.session.conn ?? null },
      nowMs: this.nowMs(),
    };
    return this.collector.snapshot(context);
  }

  private nowMs(): number {
    return this.options.now !== undefined ? this.options.now() : performance.now();
  }

  private gpuSource(): GpuTimingSource {
    const service = this.ctx?.services.get("renderer");
    const quality = this.ctx?.services.get("quality");
    if (service === undefined || quality === undefined) return "none";
    // WebGL2 timer queries are not used (see render/gpu-timing.ts): WebGL2 reports CPU-only timing.
    return gpuTimingMode(service.backend, quality.capabilities.gpuTiming);
  }

  private readRenderer(renderer: TimedRendererLike | null): void {
    const out = this.readout;
    const service = this.ctx?.services.get("renderer");
    if (service === undefined) return;
    service.readStats(this.drawStats);
    out.drawCalls = this.drawStats.drawCalls;
    out.triangles = this.drawStats.triangles;
    out.framesRendered = service.framesRendered;
    out.lossCount = service.lossCount;
    if (renderer !== null) {
      out.geometries = renderer.info.memory.geometries;
      out.textures = renderer.info.memory.textures;
      out.gpuMemoryBytes = renderer.info.memory.total;
      out.texturesBytes = renderer.info.memory.texturesSize;
    }
    Object.assign(this.collector.render, out);
  }

  /**
   * Every N frames asks three to resolve the GPU timestamps (shared `GpuTimingPump` from render/, the same code the
   * production `GpuTimingModule` runs), records the sample for the HUD and feeds the dynamic-resolution controller.
   */
  private pumpGpuTimestamps(): void {
    const service = this.ctx?.services.get("renderer");
    if (service === undefined) return;
    this.gpuPump.update(service, this.gpuSource() === "none" ? "none" : "timestamp-query");
  }

  private setCameraPath(spec: CameraPathSpec | null): void {
    if (spec === null) {
      this.path = null;
      return;
    }
    validateCameraPath(spec);
    this.path = spec;
    this.pathStartS = Number.NaN;
  }

  private applyCameraPath(timeS: number): void {
    const path = this.path;
    const ctx = this.ctx;
    if (path === null || ctx === null) return;
    if (Number.isNaN(this.pathStartS)) this.pathStartS = timeS;
    const pose = sampleCameraPath(path, timeS - this.pathStartS, this.pose);
    const camera = ctx.services.get("sceneRoots").camera;
    camera.position.set(pose.px, pose.py, pose.pz);
    camera.lookAt(pose.tx, pose.ty, pose.tz);
    camera.updateMatrixWorld();
  }
}
