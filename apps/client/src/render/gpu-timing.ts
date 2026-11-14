// GPU frame-time feed for the dynamic-resolution controller (rendering-pipeline.md section 9). three-free and DOM-free.
//
// Production needs this without the debug tooling: the controller steers on GPU milliseconds when they are reported and
// falls back to the CPU frame interval (frame pacing) otherwise. `GpuTimingPump` asks three to resolve its timestamp queries
// every `everyFrames` frames (sparse: the resolve is a GPU copy plus an async buffer map), at most one request in flight, and
// forwards the last frame's render + compute time to `renderer.reportGpuFrameMs`. It does nothing (no query, no promise)
// when the timestamp-query feature is missing or the backend is WebGL2: three's WebGL2 timer path nests queries around the
// post pipeline's render calls and logs `beginQuery: a query is already active`, so WebGL2 reports CPU pacing only.
//
// Cost: one counter increment per frame; every `everyFrames`-th frame schedules two resolve promises through callbacks bound
// once at construction (the promises themselves are the browser's, about 1 small allocation set per 16 frames, off the
// per-frame path). Dev builds share this class with the debug module (which additionally records the sample).
//
// `GpuTimingModule` is the production wrapper: a `ClientModule` the composition root registers in the last (`debug`) frame
// slot when the full debug module is not registered, so it runs after `render` has presented the frame.

import type { ClientModule, ModuleContext } from "@moon-cleanup/shared";
import type { RenderServices } from "./module";

/** Frames between timestamp resolves. 16 is about 0.27 s at 60 fps, well inside the controller's 1 s freshness window. */
export const GPU_TIMING_RESOLVE_EVERY_FRAMES = 16;

/** The slice of three's renderer the pump uses (`resolveTimestampsAsync`, `info.render|compute.timestamp`). */
export interface GpuTimedRendererLike {
  readonly info: {
    readonly render: { readonly timestamp: number };
    readonly compute: { readonly timestamp: number };
  };
  resolveTimestampsAsync(type: "render" | "compute"): Promise<unknown>;
}

/** The slice of the `renderer` service the pump reads and feeds. */
export interface GpuTimingRendererService {
  readonly backend: string;
  readonly renderer: unknown;
  reportGpuFrameMs(ms: number): void;
}

/** Where the numbers come from: `timestamp-query` (WebGPU timestamp queries) or `none` (CPU frame pacing only). */
export type GpuTimingMode = "timestamp-query" | "none";

export interface GpuTimingOptions {
  /** Frames between resolves. Default {@link GPU_TIMING_RESOLVE_EVERY_FRAMES}. */
  readonly everyFrames?: number;
  /** Called with each fresh sample (render ms, compute ms) before it is reported; the debug module records it. */
  readonly onSample?: (renderMs: number, computeMs: number) => void;
}

/** `timestamp-query` only on WebGPU with the feature present; WebGL2 timer queries are deliberately not used. */
export function gpuTimingMode(backend: string, gpuTiming: boolean): GpuTimingMode {
  return gpuTiming && backend !== "webgl2" ? "timestamp-query" : "none";
}

export class GpuTimingPump {
  private readonly everyFrames: number;
  private readonly onSample: ((renderMs: number, computeMs: number) => void) | undefined;
  private framesSinceResolve = 0;
  private resolving = false;
  private disposed = false;
  private renderer: GpuTimedRendererLike | null = null;
  private service: GpuTimingRendererService | null = null;
  /** Samples forwarded to the renderer service since construction (test and HUD read-out). */
  samples = 0;

  // Bound once: no closure allocation when a resolve is scheduled.
  private readonly resolveCompute = (): Promise<unknown> =>
    this.renderer?.resolveTimestampsAsync("compute") ?? Promise.resolve();
  private readonly publish = (): void => {
    const renderer = this.renderer;
    const service = this.service;
    if (renderer === null || service === null || this.disposed) return;
    const { render, compute } = renderer.info;
    // A render timestamp of 0 means "no result yet" (no query was available), not 0 ms of GPU work.
    if (!(render.timestamp > 0)) return;
    this.onSample?.(render.timestamp, compute.timestamp);
    service.reportGpuFrameMs(render.timestamp + compute.timestamp);
    this.samples += 1;
  };
  private readonly swallow = (): undefined => undefined;
  private readonly done = (): void => {
    this.resolving = false;
  };

  constructor(options: GpuTimingOptions = {}) {
    this.everyFrames = Math.max(1, Math.floor(options.everyFrames ?? GPU_TIMING_RESOLVE_EVERY_FRAMES));
    this.onSample = options.onSample;
  }

  /** Call once per frame, after the frame has been rendered. `mode` is `gpuTimingMode(...)`. */
  update(service: GpuTimingRendererService, mode: GpuTimingMode): void {
    if (this.disposed || mode === "none" || this.resolving) return;
    const renderer = service.renderer as GpuTimedRendererLike | null;
    if (renderer === null || typeof renderer.resolveTimestampsAsync !== "function") return;
    this.framesSinceResolve += 1;
    if (this.framesSinceResolve < this.everyFrames) return;
    this.framesSinceResolve = 0;
    this.resolving = true;
    this.renderer = renderer;
    this.service = service;
    try {
      renderer
        .resolveTimestampsAsync("render")
        .then(this.resolveCompute)
        .then(this.publish)
        .catch(this.swallow)
        .then(this.done);
    } catch {
      this.resolving = false;
    }
  }

  dispose(): void {
    this.disposed = true;
    this.renderer = null;
    this.service = null;
  }
}

/** The slice of the quality service the production hook reads. */
interface QualityCapabilitiesLike {
  readonly capabilities: { readonly gpuTiming: boolean };
}

/**
 * Production GPU-timing hook. Registered by the composition root in the `debug` frame slot (last step of the frame)
 * only when the full debug module is absent; it creates no DOM, no window hook and no HUD.
 */
export class GpuTimingModule implements ClientModule<RenderServices> {
  readonly id = "debug" as const;
  private readonly pump: GpuTimingPump;
  private service: GpuTimingRendererService | null = null;
  private quality: QualityCapabilitiesLike | null = null;

  constructor(options: GpuTimingOptions = {}) {
    this.pump = new GpuTimingPump(options);
  }

  /** GPU samples forwarded to the dynamic-resolution controller so far. */
  get samples(): number {
    return this.pump.samples;
  }

  init(ctx: ModuleContext<RenderServices>): void {
    this.service = ctx.services.get("renderer");
    this.quality = ctx.services.get("quality");
  }

  update(): void {
    const service = this.service;
    const quality = this.quality;
    if (service === null || quality === null) return;
    this.pump.update(service, gpuTimingMode(service.backend, quality.capabilities.gpuTiming));
  }

  dispose(): void {
    this.pump.dispose();
    this.service = null;
    this.quality = null;
  }
}
