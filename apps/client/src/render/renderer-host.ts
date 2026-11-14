// Renderer lifetime: create -> init -> read back the backend (rendering-pipeline.md section 2.1 step 6), and
// recreate after a device loss / WebGL context loss (section 18, "Device loss").
//
// The host is three-free: the renderer `R` and the canvas `C` are opaque and reached through a RendererDriver and a
// CanvasMount, so the whole loss/recreate state machine is unit-tested with mocks. three-renderer.ts holds the real
// driver.
//
// Recovery: a lost renderer is disposed, the canvas is REPLACED (a canvas whose WebGL context was lost cannot hand
// out a fresh context, and a fresh canvas is equally valid for WebGPU), a new renderer is created and initialised,
// and listeners are told so they can rebuild what lived only on the GPU (render targets; three re-uploads
// geometries, textures and materials from their CPU copies by itself). While there is no renderer the frame
// scheduler keeps ticking on plain requestAnimationFrame so net, sim and audio do not stall.

import type { RenderBackend, Unsubscribe } from "@moon-cleanup/shared";

export interface DeviceLossInfo {
  /** `WebGPU` or `WebGL`. */
  readonly api: string;
  readonly message: string;
  /** WebGPU loss reason (`unknown`, ...); `null` on WebGL. */
  readonly reason: string | null;
}

export interface RendererRequest<C> {
  readonly canvas: C;
  /** `true` asks for the WebGL2 backend (`forceWebGL`). */
  readonly forceWebGL: boolean;
}

export type FrameCallback = (timeMs: number) => void;

/** Everything the host does to a renderer. */
export interface RendererDriver<R, C> {
  /** Constructs the renderer (not yet initialised). */
  create(request: RendererRequest<C>): R;
  /** `await renderer.init()`. Rejects when no backend can start. */
  init(renderer: R): Promise<void>;
  /** Which backend actually started; valid after `init`. */
  readBackend(renderer: R): RenderBackend;
  /** Routes the renderer's device-lost / context-lost callback to `handler`. */
  onDeviceLost(renderer: R, handler: (info: DeviceLossInfo) => void): void;
  /** Sets or clears (`null`) the renderer-driven animation loop. */
  setAnimationLoop(renderer: R, callback: FrameCallback | null): void;
  dispose(renderer: R): void;
}

/** Where canvases come from and go. */
export interface CanvasMount<C> {
  create(): C;
  /** Puts `canvas` into the page, replacing `previous` when there is one. */
  mount(canvas: C, previous: C | null): void;
  unmount(canvas: C): void;
}

/** Runs a callback once per display frame. */
export interface FrameScheduler {
  /** Starts calling `callback` every frame (replaces a previous callback). */
  start(callback: FrameCallback): void;
  stop(): void;
}

export const RENDERER_HOST_STATES = ["idle", "starting", "ready", "recovering", "failed", "disposed"] as const;
export type RendererHostState = (typeof RENDERER_HOST_STATES)[number];

/** Losses after which the host stops recreating and reports a fatal error. */
export const DEFAULT_MAX_DEVICE_LOSSES = 5;

export interface RendererRecreatedEvent<R, C> {
  readonly renderer: R;
  readonly canvas: C;
  readonly backend: RenderBackend;
  /** Device losses so far in this session (>= 1). */
  readonly lossCount: number;
}

export interface RendererHostOptions<R, C> {
  readonly driver: RendererDriver<R, C>;
  readonly canvases: CanvasMount<C>;
  readonly forceWebGL: boolean;
  readonly maxLosses?: number;
  /** Wait before the n-th recreation (1-based). Default: none for the first, then 500 ms. */
  readonly delay?: (lossCount: number) => Promise<void>;
  /** Frame source used while there is no renderer. Default: `requestAnimationFrame` when it exists. */
  readonly requestFrame?: (callback: FrameCallback) => number;
  readonly cancelFrame?: (id: number) => void;
}

function defaultDelay(lossCount: number): Promise<void> {
  if (lossCount <= 1) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, 500));
}

export class RendererHost<R, C> {
  /** The live renderer; `null` before `start()` resolves, while recovering, after a fatal error or dispose. */
  current: R | null = null;
  canvas: C | null = null;
  /** Backend of `current`; keeps the last value while recovering. `null` before the first start. */
  backend: RenderBackend | null = null;
  state: RendererHostState = "idle";
  /** Device losses in this session. */
  lossCount = 0;
  lastLoss: DeviceLossInfo | null = null;

  /** Frame scheduler that follows the renderer across recreations. */
  readonly scheduler: FrameScheduler;

  private readonly options: RendererHostOptions<R, C>;
  private readonly maxLosses: number;
  private readonly lostListeners = new Set<(info: DeviceLossInfo, lossCount: number) => void>();
  private readonly recreatedListeners = new Set<(event: RendererRecreatedEvent<R, C>) => void>();
  private readonly fatalListeners = new Set<(error: Error) => void>();

  /** The renderer being initialised, and a loss reported for it before `init` settled. */
  private creating: R | null = null;
  private creatingLost: DeviceLossInfo | null = null;

  private frameCallback: FrameCallback | null = null;
  private loopRenderer: R | null = null;
  private fallbackFrameId: number | null = null;
  private readonly fallbackTick: FrameCallback = (timeMs) => {
    this.fallbackFrameId = this.requestFallbackFrame();
    this.frameCallback?.(timeMs);
  };

  constructor(options: RendererHostOptions<R, C>) {
    this.options = options;
    this.maxLosses = options.maxLosses ?? DEFAULT_MAX_DEVICE_LOSSES;
    this.scheduler = {
      start: (callback) => {
        this.frameCallback = callback;
        this.rebindLoop();
      },
      stop: () => {
        this.frameCallback = null;
        this.rebindLoop();
      },
    };
  }

  /** Creates and initialises the first renderer. Rejects when no backend can start. */
  async start(): Promise<void> {
    if (this.state !== "idle") throw new Error(`RendererHost.start: already ${this.state}`);
    this.state = "starting";
    try {
      await this.bringUp();
    } catch (error) {
      if (this.isDisposed()) throw error;
      this.state = "failed";
      throw error;
    }
    if (this.isDisposed()) return;
    this.state = "ready";
    this.rebindLoop();
  }

  /** Called when the renderer is lost; rendering must stop until `onRecreated` fires. */
  onLost(listener: (info: DeviceLossInfo, lossCount: number) => void): Unsubscribe {
    this.lostListeners.add(listener);
    return () => {
      this.lostListeners.delete(listener);
    };
  }

  /** Called after a lost renderer was replaced by a new, initialised one. */
  onRecreated(listener: (event: RendererRecreatedEvent<R, C>) => void): Unsubscribe {
    this.recreatedListeners.add(listener);
    return () => {
      this.recreatedListeners.delete(listener);
    };
  }

  /** Called once when recovery gave up (too many losses, or recreation failed). */
  onFatal(listener: (error: Error) => void): Unsubscribe {
    this.fatalListeners.add(listener);
    return () => {
      this.fatalListeners.delete(listener);
    };
  }

  dispose(): void {
    if (this.isDisposed()) return;
    this.state = "disposed";
    this.frameCallback = null;
    this.rebindLoop();
    const renderer = this.current;
    const canvas = this.canvas;
    this.current = null;
    this.canvas = null;
    if (renderer !== null) this.safeDispose(renderer);
    if (canvas !== null) this.options.canvases.unmount(canvas);
    this.lostListeners.clear();
    this.recreatedListeners.clear();
    this.fatalListeners.clear();
  }

  // ---- Internals ----------------------------------------------------------------------------------------------

  // A method (not an inline comparison) because `state` changes across awaits, behind the compiler's narrowing.
  private isDisposed(): boolean {
    return this.state === "disposed";
  }

  /**
   * Creates a canvas and a renderer and initialises it; retries when the device is lost during `init`. On return
   * `current`, `canvas` and `backend` describe an initialised renderer (unless the host was disposed meanwhile).
   */
  private async bringUp(): Promise<void> {
    const { driver, canvases, forceWebGL } = this.options;
    for (;;) {
      const canvas = canvases.create();
      canvases.mount(canvas, this.canvas);
      this.canvas = canvas;

      const renderer = driver.create({ canvas, forceWebGL });
      this.creating = renderer;
      this.creatingLost = null;
      driver.onDeviceLost(renderer, (info) => {
        this.handleDeviceLost(renderer, info);
      });

      try {
        await driver.init(renderer);
      } catch (error) {
        this.creating = null;
        this.safeDispose(renderer);
        throw error;
      }
      this.creating = null;

      if (this.isDisposed()) {
        this.safeDispose(renderer);
        canvases.unmount(canvas);
        return;
      }

      const lostDuringInit = this.takeCreatingLost();
      if (lostDuringInit !== null) {
        this.safeDispose(renderer);
        this.lossCount += 1;
        this.lastLoss = lostDuringInit;
        if (this.lossCount > this.maxLosses) throw this.tooManyLosses();
        await (this.options.delay ?? defaultDelay)(this.lossCount);
        if (this.isDisposed()) return;
        continue;
      }

      this.current = renderer;
      this.backend = driver.readBackend(renderer);
      return;
    }
  }

  // Read through a method: the field is written by the device-lost callback during `await driver.init`.
  private takeCreatingLost(): DeviceLossInfo | null {
    const info = this.creatingLost;
    this.creatingLost = null;
    return info;
  }

  private handleDeviceLost(renderer: R, info: DeviceLossInfo): void {
    if (this.isDisposed()) return;
    if (renderer === this.creating) {
      this.creatingLost = info;
      return;
    }
    // A renderer that is no longer the live one (already replaced) has nothing left to lose.
    if (renderer !== this.current) return;

    this.lossCount += 1;
    this.lastLoss = info;
    this.current = null;
    this.state = "recovering";
    this.rebindLoop();
    for (const listener of this.lostListeners) listener(info, this.lossCount);
    void this.recover(renderer);
  }

  private async recover(lost: R): Promise<void> {
    this.safeDispose(lost);
    try {
      if (this.lossCount > this.maxLosses) throw this.tooManyLosses();
      await (this.options.delay ?? defaultDelay)(this.lossCount);
      if (this.isDisposed()) return;
      await this.bringUp();
    } catch (error) {
      if (this.isDisposed()) return;
      this.state = "failed";
      const fatal = error instanceof Error ? error : new Error(String(error));
      for (const listener of this.fatalListeners) listener(fatal);
      return;
    }
    if (this.isDisposed()) return;
    const renderer = this.current;
    const canvas = this.canvas;
    const backend = this.backend;
    if (renderer === null || canvas === null || backend === null) return;
    this.state = "ready";
    this.rebindLoop();
    const event: RendererRecreatedEvent<R, C> = { renderer, canvas, backend, lossCount: this.lossCount };
    for (const listener of this.recreatedListeners) listener(event);
  }

  private tooManyLosses(): Error {
    const last = this.lastLoss;
    return new Error(
      `Renderer lost ${String(this.lossCount)} times (limit ${String(this.maxLosses)}); last: ` +
        (last === null ? "unknown" : `${last.api} ${last.reason ?? ""} ${last.message}`.trim()),
    );
  }

  private safeDispose(renderer: R): void {
    try {
      this.options.driver.dispose(renderer);
    } catch {
      // A lost or half-initialised renderer may throw while releasing; there is nothing left to release then.
    }
  }

  private requestFallbackFrame(): number | null {
    const request = this.options.requestFrame ?? globalThis.requestAnimationFrame;
    return typeof request === "function" ? request(this.fallbackTick) : null;
  }

  /** Points the frame callback at the live renderer's loop, or at the fallback frame source when there is none. */
  private rebindLoop(): void {
    if (this.loopRenderer !== null) {
      // A renderer that is no longer current is being disposed, which stops its loop.
      if (this.loopRenderer === this.current) this.options.driver.setAnimationLoop(this.loopRenderer, null);
      this.loopRenderer = null;
    }
    if (this.fallbackFrameId !== null) {
      const cancel = this.options.cancelFrame ?? globalThis.cancelAnimationFrame;
      if (typeof cancel === "function") cancel(this.fallbackFrameId);
      this.fallbackFrameId = null;
    }
    // After a fatal error the fallback source keeps net, audio and the UI alive; only rendering is gone.
    if (this.frameCallback === null || this.isDisposed()) return;
    if (this.current !== null) {
      this.loopRenderer = this.current;
      this.options.driver.setAnimationLoop(this.current, this.frameCallback);
    } else {
      this.fallbackFrameId = this.requestFallbackFrame();
    }
  }
}
