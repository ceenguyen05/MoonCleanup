// Client composition root (M0-W1-T06). Builds the event bus, UI store and ServiceRegistry, registers the modules in
// the fixed order of module-boundaries.md section 4 (render, visuals, terrain, animation, gameplay, net, audio, ui,
// debug; the ones with no implementation yet are simply absent), starts the frame loop, installs the DOM overlay and
// the capture hooks (`__mcReady`, `__mcStep`, `__mcInfo`), and routes every failure to the error boundary.

import { CLIENT_MODULE_IDS, type ClientModule, type ClientModuleId, type ModuleContext } from "@moon-cleanup/shared";
import {
  FrameLoop,
  GpuTimingModule,
  RenderModule,
  RenderUnsupportedError,
  installHarnessHooks,
  parseRenderUrlOptions,
  type HarnessHookTarget,
} from "../render";
import { DebugModule } from "../debug";
import { UiModule } from "../ui";
import { VisualsModule } from "../visuals";
import { readClientConfig } from "./config";
import { createErrorBoundary, describeError, type ErrorBoundary } from "./error-boundary";
import { createEventBus } from "./event-bus";
import { integratedGpuPreset, launchSearch, planScene, wantsTimestampQueries } from "./launch-policy";
import { AppNetModule } from "./modules";
import { createOverlay } from "./overlay";
import { REQUIRED_SERVICES, type ClientServices } from "./services";
import { createServiceRegistry } from "./service-registry";
import { createUiStore } from "./ui-store";

declare global {
  interface Window {
    __mcReady?: HarnessHookTarget["__mcReady"];
    __mcStep?: HarnessHookTarget["__mcStep"];
    __mcInfo?: HarnessHookTarget["__mcInfo"];
  }
}

export interface AppHandle {
  readonly boundary: ErrorBoundary;
  /** Stops the frame loop and disposes the overlay and every module in reverse registration order. */
  dispose(): void;
}

/**
 * Integrated GPUs (UHD 620 class) start on Low, never Medium/High; an explicit `?preset=` wins. Runs right after the
 * render module's init so every later module (visuals) sees the final preset. `quality.recommendedPreset` still reports
 * the render module's own detection ("Restore recommended").
 */
function applyIntegratedGpuDefault(quality: ClientServices["quality"], explicit: boolean): void {
  const target = integratedGpuPreset({
    gpuClass: quality.capabilities.gpuClass,
    current: quality.current.preset,
    explicit,
  });
  if (target !== null) quality.setPreset(target, "detect");
}

/** Mounts the stage element (the canvas container) as a full-window layer. */
function createStage(doc: Document): HTMLElement {
  doc.documentElement.style.cssText = "margin:0;height:100%;background:#000";
  doc.body.style.cssText = "margin:0;height:100%;background:#000;overflow:hidden";
  const stage = doc.createElement("div");
  stage.id = "mc-stage";
  stage.style.cssText = "position:fixed;inset:0;background:#000";
  doc.body.append(stage);
  return stage;
}

/**
 * Boots the game. Resolves with a handle once the first frames have rendered; configuration, unsupported-browser and
 * module init failures are shown by the error boundary and reject so a caller (or test) can see them.
 */
export async function bootApp(win: Window = window): Promise<AppHandle> {
  const doc = win.document;
  const boundary = createErrorBoundary(doc);
  boundary.installGlobalHandlers(win);

  const disposers: (() => void)[] = [];
  const dispose = (): void => {
    for (const fn of disposers.splice(0).reverse()) {
      try {
        fn();
      } catch (error) {
        boundary.report("dispose", error);
      }
    }
  };

  try {
    const config = readClientConfig(import.meta.env, win.location.search);
    const renderUrl = parseRenderUrlOptions(win.location.search);

    const events = createEventBus({
      onListenerError: (eventName, error) => boundary.report(`event listener (${eventName})`, error),
    });
    const store = createUiStore();
    const services = createServiceRegistry<ClientServices>();
    services.register("eventBus", events);
    services.register("uiStore", store);

    const stage = createStage(doc);
    disposers.push(() => stage.remove());
    const overlay = createOverlay({
      doc,
      parent: doc.body,
      events,
      store,
      buildVersion: config.buildVersion,
      envLabel: config.envLabel,
      visible: config.showOverlay,
    });
    disposers.push(() => overlay.dispose());

    // Perf tooling (M0-W2-T06): the debug module (HUD, window hooks) exists only in dev builds or with `?perf=1`, so
    // production carries none of it. Production keeps only the GpuTimingModule below.
    const perfEnabled = import.meta.env.DEV || new URLSearchParams(win.location.search).get("perf") === "1";
    const perfHudVisible = new URLSearchParams(win.location.search).get("perf") === "1";
    let loop: FrameLoop<ClientServices> | null = null;

    // Scene routing: `?scene=bench|verify` is routed inside the render module, `?scene=s01|s05|s06` inside the visuals
    // module; every other id keeps the M0 hello-world parity mesh until the world module exists. S02/S03 are not in the
    // visuals barrel yet (see the T06 report): they warn and fall back to the hello world.
    const scenePlan = planScene(win.location.search);
    if (scenePlan.unrouted) {
      console.warn(
        `[app] ?scene=${scenePlan.scene} is not routed yet (S02/S03 are not exported by the visuals barrel)`,
      );
    }
    // GPU timestamp queries only on the WebGPU lane (the WebGL2 timer-query path logs beginQuery warnings). Requested
    // for the perf tooling and for production dynamic resolution (it steers on GPU ms when they are reported, else on the
    // frame interval); not when dynres cannot run (`?dynres=off`, a `?scale=` pin, capture mode), so those frames carry no
    // query cost. three itself drops the tracking when the adapter lacks `timestamp-query`.
    const dynresSteers = renderUrl.dynres !== false && renderUrl.scale === null && !renderUrl.capture;
    const trackTimestamp = wantsTimestampQueries({
      perfEnabled: perfEnabled || dynresSteers,
      search: win.location.search,
      hasNavigatorGpu: "gpu" in win.navigator,
    });
    // Production builds drop the dev-only asset-origin params (`terrainBase`, `terrain`) before any module sees them
    // (security review N8); dev builds pass the URL through unchanged.
    const moduleSearch = launchSearch(win.location.search, import.meta.env.PROD);
    const render = new RenderModule({
      container: stage,
      search: moduleSearch,
      smokeScene: scenePlan.smokeScene,
      trackTimestamp,
    });
    const registered = new Map<ClientModuleId, ClientModule<ClientServices>>([
      ["render", render],
      ["visuals", new VisualsModule({ search: moduleSearch })],
      [
        "net",
        new AppNetModule({
          httpUrl: config.httpUrl,
          wsUrl: config.wsUrl,
          clientBuild: config.buildVersion,
          wakeAtBoot: config.wakeAtBoot,
          win,
        }),
      ],
      ["ui", new UiModule<ClientServices>({ store, win, search: win.location.search })],
    ]);
    if (perfEnabled) {
      registered.set("debug", new DebugModule({ getLoop: () => loop, win, doc, startVisible: perfHudVisible }));
    } else if (trackTimestamp) {
      // Production: no HUD, no window hooks, no overlays; only the sparse GPU-timing feed for dynamic resolution. It takes
      // the (otherwise empty) last frame slot, after render has presented the frame. Without timestamp-query support it
      // is a no-op and dynres steers on the frame interval.
      registered.set("debug", new GpuTimingModule());
    }

    // Fixed order; modules without an implementation yet (terrain, animation, gameplay, audio) are skipped;
    // debug (when enabled) is always last.
    const ordered = CLIENT_MODULE_IDS.flatMap((id) => {
      const module = registered.get(id);
      return module === undefined ? [] : [module];
    });

    const ctx: ModuleContext<ClientServices> = { services, events };
    for (const module of ordered) {
      disposers.push(() => module.dispose());
      try {
        await module.init(ctx);
        if (module.id === "render") applyIntegratedGpuDefault(services.get("quality"), renderUrl.preset !== null);
      } catch (error) {
        if (error instanceof RenderUnsupportedError) boundary.showUnsupported(error);
        else boundary.showFatal(`module "${module.id}" init`, error);
        throw error;
      }
    }
    for (const key of REQUIRED_SERVICES) {
      if (!services.has(key)) throw new Error(`composition root: service "${key}" was not registered by any module`);
    }

    const quality = services.get("quality");
    disposers.push(render.onFatal((error) => boundary.showFatal("renderer", error)));
    const frameLoop = new FrameLoop<ClientServices>({
      modules: ordered,
      scheduler: render.scheduler,
      getQuality: () => quality.current,
      viewport: render.viewportSource,
      onError: (step, error) => boundary.report(`frame step "${step}"`, error),
    });
    loop = frameLoop;
    disposers.push(() => frameLoop.dispose());
    frameLoop.start();

    await installHarnessHooks(win, { loop: frameLoop, renderer: render, quality, capture: renderUrl.capture });
    return { boundary, dispose };
  } catch (error) {
    // Unsupported / fatal screens were already shown for module init; anything else (config, wiring) is shown here.
    if (doc.documentElement.dataset["mcError"] === undefined) boundary.showFatal("boot", error);
    else console.error("[app] boot failed:", describeError(error));
    dispose();
    throw error;
  }
}

/** Entry used by `main.ts`: fire and forget; failures are already on screen and in the console. */
export function boot(): void {
  bootApp().catch(() => undefined);
}
