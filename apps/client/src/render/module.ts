// The `render` ClientModule (M0-W1-T01): detects the backend, boots the renderer, picks tier and preset, owns the
// frame pipeline and survives device loss. Registers the `renderer`, `sceneRoots` and `quality` services.
// docs/architecture/rendering-pipeline.md sections 2, 4, 8.1 and 18; module-boundaries.md section 4.
//
// Everything that touches three's renderer goes through RenderRuntime, so the module's flow is unit-tested with a
// fake runtime (no GPU, no DOM).

import type {
  ClientModule,
  EventBus,
  FrameInfo,
  HardwareTier,
  ModuleContext,
  QualityPresetId,
  QualitySettings,
  RenderBackend,
  RendererService,
  ServiceTypes,
  Unsubscribe,
  ViewportSize,
} from "@moon-cleanup/shared";
import type { WebGPURenderer } from "three/webgpu";
import { detectBackend, type BackendDecision, type BlocklistEntry, type GpuLike } from "./backend";
import { DrawBudgetCounter, type DrawBudgetState } from "./draw-budget";
import { DynamicResolution, type DynresSignal } from "./dynres";
import { frameTargetFor, parseFrameTarget, type FrameTarget, type FrameTargetOverride } from "./frame-target";
import { GpuMemoryLedger, textureBytes } from "./memory-ledger";
import { PipelineWarmup, warmupBudgetMs, type WarmupReason, type WarmupState } from "./warmup";
import blocklistData from "./blocklist.json";
import gpuClassData from "./gpu-classes.json";
import { FramePipeline, toneMappingFor, type FramePipelineLike, type PipelineStages } from "./pipeline";
import { QualityController, type RenderCapabilities, type RenderQualityService } from "./quality-service";
import { RenderScale } from "./render-scale";
import {
  RendererHost,
  type CanvasMount,
  type DeviceLossInfo,
  type FrameScheduler,
  type RendererDriver,
  type RendererRecreatedEvent,
} from "./renderer-host";
import { BENCH_SCENE_ID, BenchScene } from "./bench";
import { VERIFY_SCENE_ID, VerifyScene } from "./verify";
import { applyCameraProjection, createSceneRoots, type SceneRoots } from "./scene-roots";
import { SmokeScene } from "./smoke-scene";
import {
  createCanvasMount,
  createThreeDriver,
  probeFeatures,
  probeWebGl2,
  type ProbedFeatures,
  type WebGl2Probe,
} from "./three-renderer";
import { classifyGpu, defaultPresetFor, tierFor, type GpuClassTable } from "./tier";
import { parseRenderUrlOptions, SMOKE_SCENE_ID, type RenderUrlOptions } from "./url-options";
import { ViewportTracker, type ResizeObserverLike } from "./viewport";

// ---- Services -----------------------------------------------------------------------------------------------------

/** Draw statistics of the last rendered frame (three `renderer.info.render`). */
export interface RenderFrameStats {
  drawCalls: number;
  triangles: number;
}

/** Read-out of the dynamic-resolution controller (HUD, capture sidecars). Updated in place: read it, do not keep it. */
export interface DynamicResolutionState {
  /** The controller is steering the scale (not pinned, not capturing, not switched off). */
  enabled: boolean;
  /** `?scale=` or capture mode holds the scale; `setRenderScale` is ignored. */
  pinned: boolean;
  scale: number;
  scaleMin: number;
  scaleMax: number;
  /** What the controller reads: GPU frame time when it is reported, else the frame interval. */
  signal: DynresSignal;
  /** p90 of the last evaluation and its budget (ms); 0 before the first evaluation. */
  p90Ms: number;
  targetMs: number;
  /** Scale steps since boot. */
  steps: number;
  /** At the floor and still over budget for 10 s: the UI may offer a lower preset (section 9). */
  floorHint: boolean;
  /** Frame rate the controller steers to (`frame-target.ts`: 60 on every preset unless `?fps=` says otherwise). */
  targetFps: number;
  /** Pace guard (gpu signal): p90 of the frame interval and its budget (ms); 0 when the interval is the signal. */
  paceP90Ms: number;
  paceTargetMs: number;
  /** The last verdict was over budget because frames missed the display, not because of GPU time. */
  paceLimited: boolean;
}

/** What three's own tracker reports for the live renderer (`renderer.info.memory`). Filled in place. */
export interface RendererInfoSample {
  /** Render and compute pipelines (programs) alive. */
  pipelines: number;
  /** Bytes of textures (render targets and shadow maps included) and of vertex / index / storage attributes. */
  textureBytes: number;
  geometryBytes: number;
  totalBytes: number;
}

/** GPU frame times older than this are not used as the controller's signal (the reporter stopped). */
export const GPU_SIGNAL_MAX_AGE_MS = 1000;

/** The `renderer` service: the shared contract plus the render module's real handles. */
export interface RenderRendererService extends RendererService {
  /** Backend the renderer runs on. May change after a device loss (a recreated renderer can fall back). */
  readonly backend: RenderBackend;
  readonly tier: HardwareTier;
  /** `true` when `?backend=` chose the backend. */
  readonly forced: boolean;
  /** The live renderer; `null` while it is being recreated after a device loss, or after a fatal loss. */
  readonly renderer: WebGPURenderer | null;
  /** The game canvas; replaced when the renderer is recreated. */
  readonly canvas: HTMLCanvasElement | null;
  /** Canvas size and capped DPR in effect. Updated in place: read it, do not keep it. */
  readonly viewport: ViewportSize;
  /** Viewport source for the frame loop (`FrameLoopOptions.viewport`). */
  readonly viewportSource: { readonly current: ViewportSize; poll(): boolean };
  /** Frame source for the frame loop (`FrameLoopOptions.scheduler`); follows the renderer across recreations. */
  readonly scheduler: FrameScheduler;
  /** Render scale in effect (fraction of the output resolution per axis). */
  readonly renderScale: number;
  /** Dynamic-resolution read-out (section 9). */
  readonly dynamicResolution: Readonly<DynamicResolutionState>;
  /**
   * Sets the render scale now (settings screen, launch policy), clamped to the preset's dynamic-resolution range. The
   * controller, when on, continues from it. Returns the scale in effect; a `?scale=` / capture pin wins and is returned.
   */
  setRenderScale(scale: number): number;
  /** Switches the dynamic-resolution controller on or off (off = the scale stays where it is). No effect while pinned. */
  setDynamicResolution(enabled: boolean): void;
  /**
   * Reports a measured GPU frame time (timestamp queries, e.g. from the perf collector). While reports are fresh the
   * controller steers on them (budget `dynres.gpuBudgetMs`); otherwise it reads the frame interval.
   */
  reportGpuFrameMs(ms: number): void;
  /** Frames presented since boot. */
  readonly framesRendered: number;
  /** Device losses since boot. */
  readonly lossCount: number;
  /**
   * Installs the post stages (visuals/post). They are kept and re-applied when the renderer is recreated; the
   * stage functions must therefore build fresh nodes on every call.
   */
  setPipelineStages(stages: PipelineStages | null): void;
  /** Fills `out` with the draw statistics of the last rendered frame (all passes). Allocates nothing. */
  readStats(out: RenderFrameStats): void;
  /** Last frame against the preset's draw-call / triangle budget (section 10.2). Updated in place. */
  readonly drawBudget: Readonly<DrawBudgetState>;
  /** GPU memory ledger (section 13): owners record every GPU allocation here (`memory-ledger.ts`). */
  readonly memory: GpuMemoryLedger;
  /** What three's tracker reports for the live renderer (cross-check of the ledger). Updated in place once per frame. */
  readonly rendererInfo: Readonly<RendererInfoSample>;
  /** Pipeline warm-up read-out (section 12): phase, `pipelinesReadyMs`, pipelines created after warm-up. */
  readonly pipelineWarmup: Readonly<WarmupState>;
  /**
   * Registers a warm-up source: called with `true` when a warm-up starts (show one instance of every variant the owner
   * will ever draw, culling off) and with `false` when it ends. Called at once with `true` if a warm-up is running.
   */
  addWarmupSource(source: (active: boolean) => void): Unsubscribe;
  /** Starts a warm-up now (an owner added content with new pipelines behind a loading screen). */
  requestWarmup(): void;
  /** Resolves when no warm-up is running (at once if none is): gate "Clock In" and the settings overlay on it. */
  whenPipelinesReady(): Promise<void>;
  /** The renderer was lost; GPU-only resources (render targets, storage textures) are gone. */
  onLost(listener: (info: DeviceLossInfo, lossCount: number) => void): Unsubscribe;
  /** A new renderer is ready: rebuild GPU-only resources against `service.renderer`. */
  onRecreated(listener: () => void): Unsubscribe;
  /** Recovery gave up; rendering has stopped for good (show the error screen). */
  onFatal(listener: (error: Error) => void): Unsubscribe;
}

/** Service types as the render module registers them. The client's own registry type extends this. */
export interface RenderServices extends ServiceTypes {
  renderer: RenderRendererService;
  sceneRoots: SceneRoots;
  quality: RenderQualityService;
}

/** No backend can start (rendering-pipeline.md section 2.1 step 8): show the "browser not supported" page. */
export class RenderUnsupportedError extends Error {
  override readonly name = "RenderUnsupportedError";
}

// ---- Runtime seam -------------------------------------------------------------------------------------------------

/** Everything the module does to a renderer of type `R` on a canvas of type `C`. */
export interface RenderRuntime<R, C> {
  readonly driver: RendererDriver<R, C>;
  readonly canvases: CanvasMount<C>;
  probeFeatures(renderer: R): ProbedFeatures;
  /** Applies the canvas size and DPR (`setPixelRatio` + `setSize` without touching CSS). */
  applyViewport(renderer: R, viewport: ViewportSize): void;
  applyToneMapping(renderer: R, toneMapping: QualitySettings["post"]["toneMapping"]): void;
  createPipeline(renderer: R, roots: SceneRoots, stages: PipelineStages | null): FramePipelineLike;
  readStats(renderer: R, out: RenderFrameStats): void;
  /** three's memory tracker and pipeline count. Optional: without it warm-up ends on its minimum frame count. */
  readInfo?(renderer: R, out: RendererInfoSample): void;
}

function createThreeRuntime(
  container: HTMLElement,
  trackTimestamp: boolean,
): RenderRuntime<WebGPURenderer, HTMLCanvasElement> {
  return {
    driver: createThreeDriver({ trackTimestamp }),
    canvases: createCanvasMount(container),
    probeFeatures,
    applyViewport(renderer, viewport) {
      renderer.setPixelRatio(viewport.dpr);
      renderer.setSize(viewport.widthCssPx, viewport.heightCssPx, false);
    },
    applyToneMapping(renderer, toneMapping) {
      renderer.toneMapping = toneMappingFor(toneMapping);
      // Exposure is pre-applied on the CPU (section 8.4); the tone-map exposure stays 1.
      renderer.toneMappingExposure = 1;
    },
    createPipeline(renderer, roots, stages) {
      return new FramePipeline(renderer, roots.scene, roots.camera, stages);
    },
    readStats(renderer, out) {
      out.drawCalls = renderer.info.render.drawCalls;
      out.triangles = renderer.info.render.triangles;
    },
    readInfo(renderer, out) {
      const memory = renderer.info.memory as unknown as Record<string, number | undefined>;
      out.pipelines = memory["programs"] ?? 0;
      out.textureBytes = memory["texturesSize"] ?? 0;
      out.geometryBytes =
        (memory["attributesSize"] ?? 0) +
        (memory["indexAttributesSize"] ?? 0) +
        (memory["storageAttributesSize"] ?? 0) +
        (memory["indirectStorageAttributesSize"] ?? 0);
      out.totalBytes = memory["total"] ?? 0;
    },
  };
}

// ---- Options ------------------------------------------------------------------------------------------------------

export interface RenderModuleOptions {
  /**
   * Element the canvas is put into (as its first child). It must have a CSS size (for example `position: fixed;
   * inset: 0`); the DOM UI is a sibling layer above it.
   */
  readonly container: HTMLElement;
  /** `location.search`. Default: the current page's. */
  readonly search?: string;
  /** Preset the player saved in the profile; `?preset=` still wins. */
  readonly savedPreset?: QualityPresetId | null;
  /** Adds the built-in parity test mesh. Default: only for `?scene=smoke`. */
  readonly smokeScene?: boolean;
  /** GPU timestamp queries for the perf HUD / dynamic resolution. Default `false`. */
  readonly trackTimestamp?: boolean;
  /** Line logger. Default `console.info`. */
  readonly log?: (line: string) => void;
  /** Test seams; the defaults read the real browser. */
  readonly env?: RenderEnvironment;
}

export interface RenderEnvironment {
  /** `navigator.gpu`. */
  readonly gpu?: GpuLike | null;
  readonly probeWebGl2?: () => WebGl2Probe;
  /** `window.devicePixelRatio` (before `?dpr=` and the preset cap). */
  readonly getDeviceDpr?: () => number;
  /** Starts observing the container's box; `null` polls the client size every frame. */
  readonly observeResize?: ((onResize: () => void) => ResizeObserverLike) | null;
  // The fake runtime of the unit tests stands in for three's renderer and the DOM canvas.
  readonly runtime?: RenderRuntime<WebGPURenderer, HTMLCanvasElement>;
  readonly blocklist?: readonly BlocklistEntry[];
  readonly gpuClasses?: GpuClassTable;
  readonly hostDelay?: (lossCount: number) => Promise<void>;
  /** Clock of the dynamic-resolution controller in ms. Default `performance.now()`. */
  readonly now?: () => number;
}

/** A device loss count at which the preset drops one step (section 18: "drop a preset after 2 losses"). */
export const LOSSES_PER_PRESET_DROP = 2;

function browserGpu(): GpuLike | null {
  if (typeof navigator === "undefined" || !("gpu" in navigator)) return null;
  const gpu: unknown = navigator.gpu;
  return typeof gpu === "object" && gpu !== null ? (gpu as GpuLike) : null;
}

// ---- Module -------------------------------------------------------------------------------------------------------

export class RenderModule implements ClientModule<RenderServices>, RenderRendererService {
  readonly id = "render" as const;

  backend: RenderBackend = "webgl2";
  tier: HardwareTier = "C";
  forced = false;
  framesRendered = 0;

  private readonly options: RenderModuleOptions;
  private readonly url: RenderUrlOptions;
  private readonly log: (line: string) => void;

  private events: EventBus | null = null;
  private host: RendererHost<WebGPURenderer, HTMLCanvasElement> | null = null;
  private runtime: RenderRuntime<WebGPURenderer, HTMLCanvasElement> | null = null;
  private tracker: ViewportTracker | null = null;
  private quality: QualityController | null = null;
  private roots: SceneRoots | null = null;
  private pipeline: FramePipelineLike | null = null;
  private stages: PipelineStages | null = null;
  private scale: RenderScale | null = null;
  private smoke: SmokeScene | null = null;
  private bench: BenchScene | null = null;
  private verify: VerifyScene | null = null;
  private decision: BackendDecision | null = null;
  private webgl: WebGl2Probe = { supported: false, renderer: "" };
  private appliedQuality: QualitySettings | null = null;
  private dynres: DynamicResolution | null = null;
  private dynresWanted = true;
  private lastFrameAtMs = Number.NaN;
  private gpuFrameMs = 0;
  private gpuReportedAtMs = Number.NEGATIVE_INFINITY;
  private now: () => number = () => performance.now();
  private readonly dynresState: DynamicResolutionState = {
    enabled: false,
    pinned: false,
    scale: 1,
    scaleMin: 1,
    scaleMax: 1,
    signal: "interval",
    p90Ms: 0,
    targetMs: 0,
    steps: 0,
    floorHint: false,
    targetFps: 0,
    paceP90Ms: 0,
    paceTargetMs: 0,
    paceLimited: false,
  };
  private readonly frameTargetOverride: FrameTargetOverride;
  private readonly frameTarget: FrameTarget = { targetFps: 60, gpuBudgetMs: 14 };
  private readonly budget = new DrawBudgetCounter();
  readonly memory = new GpuMemoryLedger();
  readonly rendererInfo: RendererInfoSample = { pipelines: 0, textureBytes: 0, geometryBytes: 0, totalBytes: 0 };
  private readonly warmup = new PipelineWarmup();
  private readonly warmupSources = new Set<(active: boolean) => void>();
  private warmupWaiters: (() => void)[] = [];
  private warmupReason: WarmupReason = "boot";
  private runtimeCreationsLogged = 0;
  /** Ledger entry of the HDR scene pass target (colour RGBA16F + depth), sized for the render scale in effect. */
  private sceneTargetEntry = 0;
  private reversedDepth = true;
  private disposed = false;
  /** Draw statistics copied right after each render: three zeroes `renderer.info` at the next display frame. */
  private readonly lastStats: RenderFrameStats = { drawCalls: 0, triangles: 0 };
  private readonly unsubscribe: Unsubscribe[] = [];
  private readonly recreatedListeners = new Set<() => void>();
  private readonly idleViewport: ViewportSize = { widthCssPx: 0, heightCssPx: 0, dpr: 1 };
  private readonly idleScheduler: FrameScheduler = {
    start: () => {
      throw new Error("render: scheduler used before init()");
    },
    stop: () => undefined,
  };

  constructor(options: RenderModuleOptions) {
    this.options = options;
    const search = options.search ?? (typeof location === "undefined" ? "" : location.search);
    this.url = parseRenderUrlOptions(search);
    this.frameTargetOverride = parseFrameTarget(search);
    this.log = options.log ?? ((line) => console.info(line));
  }

  // ---- ClientModule -------------------------------------------------------------------------------------------

  async init(ctx: ModuleContext<RenderServices>): Promise<void> {
    const { options, url } = this;
    const env = options.env ?? {};
    const container = options.container;
    this.events = ctx.events;

    // Section 2.1 steps 1-5 and 8.
    this.webgl = (env.probeWebGl2 ?? (() => probeWebGl2(container.ownerDocument)))();
    const decision = await detectBackend({
      override: url.backend,
      gpu: env.gpu === undefined ? browserGpu() : env.gpu,
      webgl2Supported: this.webgl.supported,
      blocklist: env.blocklist ?? (blocklistData.entries as readonly BlocklistEntry[]),
    });
    this.decision = decision;
    if (decision.request === "unsupported") {
      throw new RenderUnsupportedError("Neither WebGPU nor WebGL2 is available in this browser.");
    }

    // Step 6: create, init, read back.
    // `?gputime=0` switches the timestamp queries off (A/B of their cost; dynres then steers on the frame interval).
    const gpuTime = new URLSearchParams(options.search ?? (typeof location === "undefined" ? "" : location.search)).get(
      "gputime",
    );
    const runtime = env.runtime ?? createThreeRuntime(container, options.trackTimestamp === true && gpuTime !== "0");
    this.runtime = runtime;
    const host = new RendererHost({
      driver: runtime.driver,
      canvases: runtime.canvases,
      forceWebGL: decision.request === "webgl2",
      ...(env.hostDelay === undefined ? {} : { delay: env.hostDelay }),
    });
    this.host = host;
    try {
      await host.start();
    } catch (error) {
      host.dispose();
      this.host = null;
      throw new RenderUnsupportedError("The renderer could not start on any backend.", { cause: error });
    }
    const renderer = host.current;
    if (renderer === null || host.backend === null) throw new Error("render: disposed during init");

    // Section 2.3 tier and default preset; step 7 capabilities into the quality service.
    const capabilities = this.readCapabilities(renderer, host.backend);
    this.backend = capabilities.backend;
    this.tier = capabilities.tier;
    this.forced = decision.forced;
    const recommended = defaultPresetFor(capabilities.tier, capabilities.backend, capabilities.gpuClass);
    const saved = options.savedPreset ?? null;
    const quality = new QualityController({
      events: ctx.events,
      capabilities,
      recommendedPreset: recommended,
      initialPreset: url.preset ?? saved ?? recommended,
      initialSource: url.preset !== null ? "url" : saved !== null ? "user" : "detect",
    });
    this.quality = quality;

    // Capture mode pins the scale (dynamic resolution is off in captures, section 9).
    this.scale = new RenderScale(quality.current.dynres, url.scale ?? (url.capture ? "ceil" : null));
    if (env.now !== undefined) this.now = env.now;
    this.dynresWanted = url.dynres !== false;
    this.scale.set(this.startingScale());
    this.dynres = new DynamicResolution(quality.current.dynres, this.scale.current);

    const dprOverride = url.dpr;
    const getDeviceDpr = env.getDeviceDpr ?? (() => globalThis.devicePixelRatio);
    const observeResize =
      env.observeResize === undefined
        ? typeof ResizeObserver === "undefined"
          ? null
          : (onResize: () => void): ResizeObserverLike => {
              const observer = new ResizeObserver(onResize);
              observer.observe(container);
              return observer;
            }
        : env.observeResize;
    this.tracker = new ViewportTracker({
      element: container,
      getDeviceDpr: dprOverride === null ? getDeviceDpr : () => dprOverride,
      getDprCap: () => quality.current.dprCap,
      ...(observeResize === null ? {} : { observe: observeResize }),
    });

    const roots = ctx.services.has("sceneRoots") ? ctx.services.get("sceneRoots") : createSceneRoots();
    this.roots = roots;
    // `?scene=bench` / `?scene=verify` replace the hello-world mesh even when the composition root asks for it.
    const ownsScene = url.scene === BENCH_SCENE_ID || url.scene === VERIFY_SCENE_ID;
    const wantSmoke = ownsScene ? false : (options.smokeScene ?? url.scene === SMOKE_SCENE_ID);
    if (wantSmoke) {
      this.smoke = new SmokeScene();
      this.smoke.addTo(roots.world);
    }

    this.bindRenderer(renderer);

    this.unsubscribe.push(
      host.onLost((info, lossCount) => {
        this.handleLost(info, lossCount);
      }),
      host.onRecreated((event) => {
        this.handleRecreated(event);
      }),
      host.onFatal((error) => {
        console.error(`[render] fatal: ${error.message}`);
      }),
    );

    if (!ctx.services.has("sceneRoots")) ctx.services.register("sceneRoots", roots);
    ctx.services.register("quality", quality);
    ctx.services.register("renderer", this);

    // M0-W2-T02 render spike scene; needs the renderer, quality and scene roots registered above.
    if (url.scene === BENCH_SCENE_ID) {
      this.bench = new BenchScene({
        roots,
        renderer: this,
        quality,
        search: options.search ?? (typeof location === "undefined" ? "" : location.search),
        log: this.log,
      });
    }

    // M0-W2-T07 r187 feature-verification rows: `?scene=verify&row=<n>`.
    if (url.scene === VERIFY_SCENE_ID) {
      this.verify = new VerifyScene({
        roots,
        renderer: this,
        quality,
        search: options.search ?? (typeof location === "undefined" ? "" : location.search),
        log: this.log,
      });
    }

    this.announce(capabilities, decision);
  }

  update(frame: FrameInfo): void {
    const renderer = this.host?.current ?? null;
    const pipeline = this.pipeline;
    if (renderer === null || pipeline === null) return;
    if (frame.quality !== this.appliedQuality) this.applyQuality(renderer, frame.quality);
    this.stepDynamicResolution(frame);
    this.smoke?.update(frame);
    this.bench?.update(frame);
    this.verify?.update(frame);
    pipeline.render();
    const runtime = this.runtime;
    if (runtime !== null) {
      runtime.readStats(renderer, this.lastStats);
      runtime.readInfo?.(renderer, this.rendererInfo);
    }
    this.budget.record(this.lastStats.drawCalls, this.lastStats.triangles);
    this.stepWarmup();
    this.framesRendered += 1;
  }

  resize(viewport: ViewportSize): void {
    const renderer = this.host?.current ?? null;
    if (renderer === null || this.runtime === null || this.roots === null) return;
    this.runtime.applyViewport(renderer, viewport);
    applyCameraProjection(this.roots.camera, viewport, this.reversedDepth);
    this.recordSceneTarget();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const off of this.unsubscribe) off();
    this.unsubscribe.length = 0;
    this.recreatedListeners.clear();
    this.warmupSources.clear();
    this.releaseWarmupWaiters();
    this.memory.remove(this.sceneTargetEntry);
    this.bench?.dispose();
    this.bench = null;
    this.verify?.dispose();
    this.verify = null;
    this.disposePipeline();
    this.smoke?.dispose();
    this.smoke = null;
    this.tracker?.dispose();
    this.tracker = null;
    this.host?.dispose();
    this.host = null;
    this.stages = null;
  }

  // ---- RenderRendererService ----------------------------------------------------------------------------------

  get renderer(): WebGPURenderer | null {
    return this.host?.current ?? null;
  }

  get canvas(): HTMLCanvasElement | null {
    return this.host?.canvas ?? null;
  }

  get viewport(): ViewportSize {
    return this.tracker?.current ?? this.idleViewport;
  }

  get viewportSource(): { readonly current: ViewportSize; poll(): boolean } {
    if (this.tracker === null) throw new Error("render: viewportSource used before init()");
    return this.tracker;
  }

  get scheduler(): FrameScheduler {
    return this.host?.scheduler ?? this.idleScheduler;
  }

  get renderScale(): number {
    return this.scale?.current ?? 1;
  }

  get lossCount(): number {
    return this.host?.lossCount ?? 0;
  }

  get dynamicResolution(): Readonly<DynamicResolutionState> {
    const state = this.dynresState;
    const scale = this.scale;
    const dynres = this.dynres;
    state.pinned = scale?.pinned ?? false;
    state.enabled = this.dynresActive();
    state.scale = scale?.current ?? 1;
    state.scaleMin = scale?.scaleMin ?? 1;
    state.scaleMax = scale?.scaleMax ?? 1;
    state.signal = dynres?.signal ?? "interval";
    state.p90Ms = dynres?.lastP90Ms ?? 0;
    state.targetMs = dynres?.lastTargetMs ?? 0;
    state.steps = dynres?.steps ?? 0;
    state.floorHint = dynres?.floorHint ?? false;
    state.targetFps = this.frameTarget.targetFps;
    state.paceP90Ms = dynres?.lastPaceP90Ms ?? 0;
    state.paceTargetMs = dynres?.lastPaceTargetMs ?? 0;
    state.paceLimited = dynres?.paceLimited ?? false;
    return state;
  }

  get drawBudget(): Readonly<DrawBudgetState> {
    return this.budget.state;
  }

  get pipelineWarmup(): Readonly<WarmupState> {
    return this.warmup.state;
  }

  addWarmupSource(source: (active: boolean) => void): Unsubscribe {
    this.warmupSources.add(source);
    if (this.warmup.warming) source(true);
    return () => {
      this.warmupSources.delete(source);
    };
  }

  requestWarmup(): void {
    this.beginWarmup("request");
  }

  whenPipelinesReady(): Promise<void> {
    if (!this.warmup.warming || this.disposed) return Promise.resolve();
    return new Promise((resolve) => {
      this.warmupWaiters.push(resolve);
    });
  }

  setRenderScale(scale: number): number {
    const holder = this.scale;
    if (holder === null) return 1;
    if (holder.pinned) return holder.current;
    const applied = holder.set(scale);
    this.dynres?.reset(holder.rangeOf(), applied);
    this.pipeline?.setRenderScale(applied);
    this.recordSceneTarget();
    return applied;
  }

  setDynamicResolution(enabled: boolean): void {
    this.dynresWanted = enabled;
    // A fresh window when it comes back on: frames measured while it was off say nothing about the trend at this scale.
    if (enabled && this.scale !== null) this.dynres?.reset(this.scale.rangeOf(), this.scale.current);
  }

  reportGpuFrameMs(ms: number): void {
    if (!(ms > 0) || !Number.isFinite(ms)) return;
    this.gpuFrameMs = ms;
    this.gpuReportedAtMs = this.now();
  }

  /** The backend decision of boot (reason, adapter description), for the debug overlay. */
  get backendDecision(): BackendDecision | null {
    return this.decision;
  }

  setPipelineStages(stages: PipelineStages | null): void {
    this.stages = stages;
    this.pipeline?.setStages(stages);
    // A new post chain brings new pipelines: warm them up before they count as runtime creations.
    if (this.pipeline !== null) this.beginWarmup("stages");
  }

  readStats(out: RenderFrameStats): void {
    out.drawCalls = this.lastStats.drawCalls;
    out.triangles = this.lastStats.triangles;
  }

  onLost(listener: (info: DeviceLossInfo, lossCount: number) => void): Unsubscribe {
    if (this.host === null) throw new Error("render: onLost used before init()");
    return this.host.onLost(listener);
  }

  onRecreated(listener: () => void): Unsubscribe {
    this.recreatedListeners.add(listener);
    return () => {
      this.recreatedListeners.delete(listener);
    };
  }

  onFatal(listener: (error: Error) => void): Unsubscribe {
    if (this.host === null) throw new Error("render: onFatal used before init()");
    return this.host.onFatal(listener);
  }

  // ---- Internals ----------------------------------------------------------------------------------------------

  private readCapabilities(renderer: WebGPURenderer, backend: RenderBackend): RenderCapabilities {
    const env = this.options.env ?? {};
    const decision = this.decision;
    const adapterDescription = decision?.adapterDescription ?? "";
    const gpuClass = classifyGpu(
      [adapterDescription, this.webgl.renderer],
      decision?.adapterVendor ?? "",
      env.gpuClasses ?? (gpuClassData as GpuClassTable),
    );
    const features = this.runtime?.probeFeatures(renderer);
    return {
      backend,
      tier: tierFor(backend, gpuClass),
      gpuClass,
      gpuDescription: this.webgl.renderer !== "" ? this.webgl.renderer : adapterDescription,
      gpuTiming: features?.gpuTiming ?? false,
      float32Filterable: features?.float32Filterable ?? false,
      textureCompressionBc: features?.textureCompressionBc ?? false,
      reversedDepth: features?.reversedDepth ?? false,
    };
  }

  /** Points every renderer-bound piece (pipeline, size, tone mapping) at `renderer`. */
  private bindRenderer(renderer: WebGPURenderer): void {
    const { runtime, roots, tracker, quality } = this;
    if (runtime === null || roots === null || tracker === null || quality === null) return;
    this.reversedDepth = quality.capabilities.reversedDepth;
    this.pipeline = runtime.createPipeline(renderer, roots, this.stages);
    this.warmupReason = this.framesRendered === 0 ? "boot" : "device";
    this.appliedQuality = null;
    this.applyQuality(renderer, quality.current);
    // Size the new drawing buffer now; the frame loop only reports later CHANGES.
    tracker.invalidate();
    tracker.poll();
    if (tracker.current.widthCssPx > 0 && tracker.current.heightCssPx > 0) this.resize(tracker.current);
  }

  private applyQuality(renderer: WebGPURenderer, settings: QualitySettings): void {
    const previous = this.appliedQuality;
    this.appliedQuality = settings;
    this.runtime?.applyToneMapping(renderer, settings.post.toneMapping);
    this.budget.setBudget(settings.budgets);
    this.memory.setPreset(settings.preset);
    frameTargetFor(settings.dynres, this.frameTargetOverride, this.frameTarget);
    // Section 12 step 5: a preset change rebuilds shadows and post; warm them up before play continues.
    this.beginWarmup(previous === null ? this.warmupReason : "preset");
    if (
      previous === null ||
      previous.dynres.scaleMin !== settings.dynres.scaleMin ||
      previous.dynres.scaleMax !== settings.dynres.scaleMax
    ) {
      const scale = this.scale;
      if (scale !== null) {
        scale.setRange(settings.dynres);
        scale.set(this.startingScale());
        this.dynres?.reset(settings.dynres, scale.current);
      }
    }
    this.pipeline?.setRenderScale(this.scale?.current ?? 1);
    this.recordSceneTarget();
    // The DPR cap is read by the viewport tracker on its next poll, which triggers `resize`.
  }

  // ---- Warm-up and memory (sections 12 and 13) ----------------------------------------------------------------

  private beginWarmup(reason: WarmupReason): void {
    if (this.disposed) return;
    if (!this.warmup.begin(reason, this.now())) return;
    for (const source of this.warmupSources) source(true);
  }

  /** Once per rendered frame: feeds the warm-up tracker; on completion ends the sources and releases the waiters. */
  private stepWarmup(): void {
    const warmup = this.warmup;
    const state = warmup.state;
    const done = warmup.frame(this.rendererInfo.pipelines, this.now());
    if (done) {
      for (const source of this.warmupSources) source(false);
      // Frames that compiled pipelines say nothing about the load at this scale.
      if (this.scale !== null) this.dynres?.reset(this.scale.rangeOf(), this.scale.current);
      this.log(
        `[render] pipelines ready: reason=${state.reason} ms=${state.lastMs.toFixed(0)} frames=${String(state.lastFrames)}` +
          ` pipelines=${String(state.pipelinesAtReady)} budgetMs=${String(warmupBudgetMs(this.tier))}` +
          ` timedOut=${String(state.timedOut)}`,
      );
      this.releaseWarmupWaiters();
      this.runtimeCreationsLogged = 0;
    } else if (state.phase === "ready" && state.pipelinesAfterWarmup > this.runtimeCreationsLogged) {
      // Budget 0 (section 12 "Never"): say so, a few times at most.
      if (state.runtimeCreationFrames <= 5) {
        console.warn(
          `[render] ${String(state.pipelinesAfterWarmup)} pipeline(s) created after warm-up (frame ${String(this.framesRendered)})`,
        );
      }
      this.runtimeCreationsLogged = state.pipelinesAfterWarmup;
    }
  }

  private releaseWarmupWaiters(): void {
    if (this.warmupWaiters.length === 0) return;
    const waiters = this.warmupWaiters;
    this.warmupWaiters = [];
    for (const resolve of waiters) resolve();
  }

  /** Keeps the scene pass target's ledger entry at its current size: (RGBA16F 8 B + depth 4 B) x scaled pixels. */
  private recordSceneTarget(): void {
    const viewport = this.tracker?.current;
    if (viewport === undefined) return;
    const scale = this.scale?.current ?? 1;
    const bytes = textureBytes(
      viewport.widthCssPx * viewport.dpr * scale,
      viewport.heightCssPx * viewport.dpr * scale,
      12,
    );
    if (this.sceneTargetEntry === 0) {
      this.sceneTargetEntry = this.memory.add("render", "renderTargets", "scene pass (RGBA16F + depth)", bytes);
    } else {
      this.memory.resize(this.sceneTargetEntry, bytes);
    }
  }

  /**
   * Scale a preset starts at: the ceiling, except on an integrated GPU, which starts at the floor and lets the controller
   * probe upward (the floor device must be smooth from the first frame; M0-W3-T02 measured the UHD 620 far over budget at
   * every ceiling). Ignored while pinned.
   */
  private startingScale(): number {
    const scale = this.scale;
    if (scale === null) return 1;
    const integrated = this.quality?.capabilities.gpuClass === "integrated";
    return integrated && this.dynresActive() ? scale.scaleMin : scale.scaleMax;
  }

  /** Controller steering right now: wanted, not pinned (`?scale=`, capture mode). */
  private dynresActive(): boolean {
    return this.dynresWanted && this.scale !== null && !this.scale.pinned;
  }

  /**
   * One controller sample per frame, before the frame renders. Allocates nothing. The frame interval is the frame loop's
   * `dt` (display timestamps: exact multiples of the refresh interval under vsync); the wall clock, which jitters with where
   * in the frame this module runs (measured +-6 ms on the UHD 620), only detects stalls (`dt` is clamped) and stale GPU reports.
   */
  private stepDynamicResolution(frame: FrameInfo): void {
    const now = this.now();
    const wallMs = now - this.lastFrameAtMs;
    this.lastFrameAtMs = now;
    const dynres = this.dynres;
    const scale = this.scale;
    if (dynres === null || scale === null || !this.dynresActive() || !(wallMs > 0)) return;
    // Warm-up frames compile pipelines: their times are not load.
    if (this.warmup.warming) return;
    const frameMs = frame.dt > 0 ? frame.dt * 1000 : wallMs;
    const gpuFresh = now - this.gpuReportedAtMs <= GPU_SIGNAL_MAX_AGE_MS;
    const signal: DynresSignal = gpuFresh ? "gpu" : "interval";
    // 60 fps on every preset (`frame-target.ts`); with GPU times the frame pace is guarded as well (`dynres.ts`).
    const target = this.frameTarget;
    const paceTargetMs = 1000 / target.targetFps;
    const wanted = dynres.sample(
      Math.max(wallMs, frameMs),
      gpuFresh ? this.gpuFrameMs : frameMs,
      gpuFresh ? target.gpuBudgetMs : paceTargetMs,
      signal,
      gpuFresh ? paceTargetMs : 0,
      frameMs,
    );
    if (wanted !== scale.current) {
      this.pipeline?.setRenderScale(scale.set(wanted));
      this.recordSceneTarget();
    }
  }

  private disposePipeline(): void {
    const pipeline = this.pipeline;
    this.pipeline = null;
    if (pipeline === null) return;
    try {
      pipeline.dispose();
    } catch {
      // The device behind these targets may already be gone.
    }
  }

  private handleLost(info: DeviceLossInfo, lossCount: number): void {
    console.warn(
      `[render] device lost (#${String(lossCount)}): ${info.api} ${info.reason ?? ""} ${info.message}`.trim(),
    );
    this.disposePipeline();
  }

  private handleRecreated(event: RendererRecreatedEvent<WebGPURenderer, HTMLCanvasElement>): void {
    const quality = this.quality;
    const decision = this.decision;
    if (quality === null || decision === null || this.disposed) return;

    const capabilities = this.readCapabilities(event.renderer, event.backend);
    const changed = capabilities.backend !== this.backend || capabilities.tier !== this.tier;
    this.backend = capabilities.backend;
    this.tier = capabilities.tier;
    quality.rebind(capabilities, defaultPresetFor(capabilities.tier, capabilities.backend, capabilities.gpuClass));
    if (event.lossCount % LOSSES_PER_PRESET_DROP === 0) quality.stepDown("detect");

    this.bindRenderer(event.renderer);
    this.log(`[render] renderer recreated after device loss #${String(event.lossCount)}`);
    // `render.backendSelected` describes the running renderer; repeat it only when the answer changed.
    if (changed) this.announce(capabilities, decision);
    for (const listener of this.recreatedListeners) listener();
  }

  private announce(capabilities: RenderCapabilities, decision: BackendDecision): void {
    const quality = this.quality;
    this.events?.emit("render.backendSelected", {
      backend: capabilities.backend,
      tier: capabilities.tier,
      forced: decision.forced,
    });
    // One `ops` line (section 2.1 step 7); the e2e smoke test looks for "backend" in the console.
    this.log(
      `[render] backend=${capabilities.backend} tier=${capabilities.tier} preset=${quality?.current.preset ?? "?"}` +
        ` recommended=${quality?.recommendedPreset ?? "?"} forced=${String(decision.forced)} reason=${decision.reason}` +
        ` gpuClass=${capabilities.gpuClass} gpu="${capabilities.gpuDescription}"` +
        ` reversedZ=${String(capabilities.reversedDepth)} gpuTiming=${String(capabilities.gpuTiming)}` +
        ` bc=${String(capabilities.textureCompressionBc)} f32filter=${String(capabilities.float32Filterable)}`,
    );
  }
}
