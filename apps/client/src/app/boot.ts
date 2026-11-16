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
import { AnimationModule } from "../animation";
import { AudioModule, browserEnv } from "../audio";
import { DebugModule } from "../debug";
import { GameplayModule, PlotFrameMapper, type GameplayDebugHost, type PlotCardMode } from "../gameplay";
import { UiModule, sphereBearingDeg, type OnlineEntryPort } from "../ui";
import { DUST_SCENE_SITE, VisualsModule, type DustFeedPort } from "../visuals";
import type { CreateLocalRoomHostOptions, LocalRoomHostImpl, SoloDustView } from "../sim-host";
import { readClientConfig } from "./config";
import {
  DUST_SCENE_STORAGE_PREFIX,
  DustSceneSweeper,
  createDustFeedPort,
  dustSceneHostOptions,
  prefixedStore,
} from "./dust-feed";
import { createErrorBoundary, describeError, type ErrorBoundary } from "./error-boundary";
import { createEventBus } from "./event-bus";
import {
  integratedGpuPreset,
  launchSearch,
  planScene,
  wantsAudio,
  wantsHostDustFeed,
  wantsSoloHost,
  wantsTimestampQueries,
} from "./launch-policy";
import { assertInstallableStore } from "./install-guard";
import { AppNetModule } from "./modules";
import { createOnlineDevHooks, type OnlineDevHooks, type OnlineRoomSlot } from "./online-launch";
import {
  bindSaveSyncRequests,
  createLocalInstallPort,
  createSummaryProvider,
  deviceLabelOf,
  saveEventForwarder,
  signInUntilReady,
  soloRegistration,
  storeReader,
} from "./save-sync-wiring";
import { gameDataVersionOf } from "./game-data-version";
import { createOverlay } from "./overlay";
import { REQUIRED_SERVICES, type ClientServices } from "./services";
import { createServiceRegistry } from "./service-registry";
import {
  createRoomHostService,
  loadSoloIdentity,
  startSoloHost,
  type KeyValueStore,
  type SoloHostHandle,
  type SoloIdentity,
} from "./solo-host";
import { createUiStore } from "./ui-store";
import { HudWriter, withHudPump } from "./hud-writer";
import { installHandbookKey } from "./handbook-key";
import { ObjectiveMarkers, markerSink, type MarkerStation } from "./objective-markers";
import { OnboardingWriter, createOnboardingStorage } from "./onboarding-writer";
import { createPurchasePort, InteractionWriter, outpostStations } from "./hud-interaction";
import { MenuWriter, UiFrameBridge, catalogItemIds, createMenuPricing, menuCatalogFromGameData } from "./menu-writer";
import { createControlsPort } from "./controls-port";
import { applyInputSettings, choosePlotCardMode } from "./input-settings";
import { createSettingsStorage } from "./settings-storage";
import { createUiIntents } from "./ui-intents";
import { ReadoutLink } from "./readout-link";
import { ParcelFeed, type ParcelReadoutSource } from "./parcel-feed";
import { ReadoutWriter, attachSimReadouts, type SimReadoutSource } from "./readout-writer";

declare global {
  interface Window {
    __mcReady?: HarnessHookTarget["__mcReady"];
    __mcStep?: HarnessHookTarget["__mcStep"];
    __mcInfo?: HarnessHookTarget["__mcInfo"];
    __mcDustFeed?: DustFeedHooks;
    __mcOnline?: OnlineDevHooks;
    __mcGameplay?: GameplayDebugHost["__mcGameplay"];
    __mcGameplayTeleportDir?: GameplayDebugHost["__mcGameplayTeleportDir"];
    __mcStations?: () => readonly { kind: string; x: number; y: number; z: number }[];
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
    // The `roomHost` facade exists from the start (current === null) so every module can bind in `init`; the Solo
    // LocalRoom host is published after the first frame (below).
    const roomHost = createRoomHostService();
    services.register("roomHost", roomHost);
    // In-game HUD slices (wallet, Shine, Holster, day ring, Next Requisition, notices) follow whichever host is
    // published; the writer is pumped before each UI flush at <= HUD_WRITE_HZ. Tool names come from game-data, loaded
    // in a lazy chunk off the first-frame path.
    const hudWriter = new HudWriter({ store });
    disposers.push(hudWriter.follow(roomHost), () => hudWriter.dispose());
    // Induction Checklist, DOT lines and achievements from real room events (progress persists in localStorage).
    const onboarding = new OnboardingWriter({
      store,
      storage: createOnboardingStorage(safeLocalStorage(win), (source, error) => boundary.report(source, error)),
    });
    disposers.push(onboarding.follow(roomHost), () => onboarding.dispose());
    void import("@moon-cleanup/game-data")
      .then((data) => {
        const gameData = data.loadGameData();
        onboarding.setCatalog({
          induction: gameData.onboarding.induction.map((s) => ({ id: s.id, trigger: s.trigger })),
          achievementIds: gameData.achievements.achievements.map((a) => a.id),
        });
        const tools = data.loadGameData().tools.tools;
        const catalog = menuCatalogFromGameData(data.loadGameData());
        menuWriter.setCatalog(catalog);
        readoutLink.setItemIds(catalogItemIds(catalog));
        hudWriter.setCatalog({
          toolIds: tools.map((t) => t.id),
          cellBaseGrams: tools.map((t) => Math.round(t.cellBaseKg * 1000)),
        });
      })
      .catch((error: unknown) => boundary.report("HUD tool catalog", error));
    // Purchases (Desk / Promotions Board / suit gear): one port on whichever host is published; refusals become notices.
    const purchasePort = createPurchasePort({
      roomHost,
      store,
      newRequestId: () => win.crypto.randomUUID(),
    });
    disposers.push(() => purchasePort.dispose());
    // Interaction prompt (Assay Counter / Gates / Desk): set once gameplay and the sim's sell points are loaded.
    // Desk / Ops Console slices (menus) from game-data + shift state; the frame bridge (gamepad menu nav, open Desk,
    // compass heading) is set once gameplay exists. All pumped right before each UI flush.
    const menuWriter = new MenuWriter(store);
    disposers.push(menuWriter.follow(roomHost), () => menuWriter.dispose());
    // Sim read-outs (Hop gauge, Crown Lamp mode, Plot Card, Desk / Board price quotes): the authoritative sim runs in the
    // Solo worker, so these stay unfed until a `SimReadoutSource` is attached (`interactionPump.attachSimReadouts`).
    const readoutSlot = (): number => (roomHost.current?.kind === "remote" ? store.getState().shift.mySlot : 0);
    const readoutWriter = new ReadoutWriter({ store, mySlot: readoutSlot });
    const interactionPump: {
      writer: InteractionWriter | null;
      bridge: UiFrameBridge | null;
      attachSimReadouts(source: SimReadoutSource | null): void;
      parcels: ParcelFeed | null;
      markers: ObjectiveMarkers | null;
      pump(nowMs: number): void;
    } = {
      writer: null,
      bridge: null,
      parcels: null,
      markers: null,
      attachSimReadouts(source) {
        attachSimReadouts({ readouts: readoutWriter, menus: menuWriter, mySlot: readoutSlot }, source);
      },
      pump(nowMs) {
        this.writer?.pump(nowMs);
        menuWriter.pump(nowMs);
        readoutWriter.pump(nowMs);
        this.parcels?.pump(nowMs);
        this.markers?.pump(nowMs);
        this.bridge?.pump();
      },
    };
    disposers.push(() => interactionPump.attachSimReadouts(null));
    // Solo: the worker-fed read-out cache of the published local host; remote hosts stay unfed.
    let nearSource: ParcelReadoutSource | null = null;
    // Assay Counter / Desk positions for the Induction objective marker (set with the interaction stations).
    let markerStations: readonly MarkerStation[] = [];
    const readoutLink = new ReadoutLink((source) => {
      nearSource = source;
      interactionPump.attachSimReadouts(source);
    });
    disposers.push(
      roomHost.onChange((host) => readoutLink.setHost(host)),
      () => readoutLink.setHost(null),
    );
    const settings = createSettingsStorage(safeLocalStorage(win), (source, error) => boundary.report(source, error));
    const savedHudPct = settings.loadHudScalePct();
    if (savedHudPct !== null) store.dispatch({ type: "settings.set", patch: { hudScalePct: savedHudPct } });
    // Persist the UI size slider (the store flushes at <= 15 Hz; the write happens only when the value changed).
    let lastHudPct = store.getState().settings.hudScalePct;
    disposers.push(
      store.subscribe(() => {
        const pct = store.getState().settings.hudScalePct;
        if (pct === lastHudPct) return;
        lastHudPct = pct;
        settings.saveHudScalePct(pct);
      }),
    );

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
    // Online room slot (M1-W4-T04): stays empty in solo; the room chunk is loaded only when a remote room is opened.
    const online: OnlineRoomSlot = { current: null };

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

    // `?scene=dust` with the Solo host (M1-W3-T02b): the scene's atlas is fed by the host's main-thread ledger view,
    // so the sim-host chunk is loaded before the visuals module builds the scene (the dev scene waits for it; the game
    // launch does not). The view exists before the host; it shows an untouched moon until the host's dust state arrives.
    let dustView: SoloDustView | null = null;
    let dustFeed: DustFeedPort | null = null;
    let simHostModule: typeof import("../sim-host") | null = null;
    if (wantsHostDustFeed(win.location.search)) {
      simHostModule = await import("../sim-host");
      const t0 = performance.now();
      const view = new simHostModule.SoloDustView();
      const constructMs = performance.now() - t0;
      dustView = view;
      dustFeed = createDustFeedPort(view, DUST_SCENE_SITE, () => ({ viewConstructMs: constructMs }));
      disposers.push(() => view.dispose());
    }

    const render = new RenderModule({
      container: stage,
      search: moduleSearch,
      smokeScene: scenePlan.smokeScene,
      trackTimestamp,
    });
    // Player input (M1-W3-T05): keyboard / mouse / gamepad -> the Solo host (or an open online room), Solo
    // prediction, camera rig. On where the player plays: `?play=1`, or the dust scene without its scripted sweeper
    // (`&bot=0`), so perf captures of the dust scene keep their fixed camera and bot.
    // One guest account per tab, shared by checkpoint sync and the online entry UI (lazy chunk, created on first use).
    let guestAuth: Promise<GuestAuthInstance> | null = null;
    const loadGuestAuth = (): Promise<GuestAuthInstance> =>
      (guestAuth ??= import("../net/guest-auth").then((m) =>
        m.createGuestAuth({ httpUrl: config.httpUrl, storage: safeLocalStorage(win) }),
      ));
    // Online room open/close (M1-W4-T04): created for every build so the online entry UI works in production; the room
    // code loads only on `open` (dynamic import inside online-launch). The `__mcOnline` console hook stays dev/perf-only.
    // Animation pool (M1-W5-T04): unbound in Solo (update is one null check); an open room binds its avatar entities.
    const animation = new AnimationModule();
    // `?scene=dust`: an open room's mirror feed replaces the Solo feed (setDustFeed is a no-op for every other scene;
    // a cold path on room open / close only, so solo frames pay nothing).
    const visuals = new VisualsModule({ search: moduleSearch, dustFeed });
    const onlineHooks = createOnlineDevHooks(
      online,
      {
        httpUrl: config.httpUrl,
        wsUrl: config.wsUrl,
        clientBuild: config.buildVersion,
        events,
        onProblem: (source, error) => boundary.report(source, error),
        ...(dustFeed !== null ? { sitePlot: DUST_SCENE_SITE } : {}),
      },
      (source, error) => boundary.report(source, error),
      // While a room is open its RemoteRoomHost is the `roomHost` (gameplay / UI bind unchanged); the Solo host is
      // paused and restored on close. Reconnect token refreshes go through the shared guest account.
      {
        publisher: roomHost,
        auth: () => loadGuestAuth(),
        animation,
        dustFeed: { bind: (feed) => void visuals.setDustFeed(feed ?? dustFeed) },
      },
    );
    disposers.push(() => onlineHooks.close());
    const netModule = new AppNetModule({
      httpUrl: config.httpUrl,
      wsUrl: config.wsUrl,
      clientBuild: config.buildVersion,
      wakeAtBoot: config.wakeAtBoot,
      win,
      online,
    });
    // Online intent is the only thing (besides `?wake=1`) that wakes the server: solo play makes no request.
    const onlinePort: OnlineEntryPort = {
      httpUrl: config.httpUrl,
      auth: () => {
        netModule.wakeForOnline();
        return loadGuestAuth();
      },
      open: (contractId, accessToken) => {
        netModule.wakeForOnline();
        return onlineHooks.open(contractId, accessToken);
      },
      close: () => onlineHooks.close(),
    };
    const gameplay = wantsPlayerInput(win.location.search)
      ? new GameplayModule({
          win,
          lockTarget: stage,
          online: online as { current: OnlineRoomSlot["current"] },
          debugHost: perfEnabled ? win : null,
          ...(dustView !== null
            ? { mapper: PlotFrameMapper.fromGrid(dustView.grid, DUST_SCENE_SITE, dustView.grid.params.radiusM) }
            : {}),
        })
      : null;
    if (gameplay !== null) {
      void Promise.all([import("@moon-cleanup/sim"), import("@moon-cleanup/game-data")])
        .then(([sim, data]) => {
          const gameData = data.loadGameData();
          const moonRadiusM = gameData.world.moonRadiusM;
          menuWriter.setPricing(
            createMenuPricing(
              new sim.PromotionsBoard(gameData),
              sim.STAT_PURCHASE_DISCOUNT_FRAC,
              sim.discountedPriceLm,
            ),
          );
          // Compass chips: the sim's outpost list is static (home first, always visited).
          readoutWriter.setOutposts(sim.BOREAL_STAND_IN_OUTPOSTS.map((o, k) => ({ id: o.id, visited: k === 0 })));
          const feet = gameplay.rig.feet;
          const stations = outpostStations(
            sim.borealStandInSellPoints(moonRadiusM),
            moonRadiusM,
            sim.ASSAY_POUR_REACH_M,
            sim.DUMP_PLATE_RADIUS_M,
          );
          markerStations = stations;
          if (perfEnabled) {
            win.__mcStations = () => stations; // dev / perf only (smoke tests teleport next to the Desk)
          }
          interactionPump.writer = new InteractionWriter({
            store,
            moonRadiusM,
            stations,
            samplePos: (out) => {
              if (gameplay.stats.posedFrames === 0) return false;
              out[0] = feet[0]!;
              out[1] = feet[1]!;
              out[2] = feet[2]!;
              return true;
            },
          });
        })
        .catch((error: unknown) => boundary.report("HUD interaction prompt", error));
    }
    // Rebinding: the real input binding table (stored rebind first; a corrupt one is reported and ignored).
    let controls: ReturnType<typeof createControlsPort> | undefined;
    let plotCardMode: PlotCardMode = "toggle";
    if (gameplay !== null) {
      const inputSettings = applyInputSettings({
        input: gameplay.input,
        storage: safeLocalStorage(win),
        storedBindings: settings.loadBindings(),
        saveBindings: (t) => settings.saveBindings(t),
        report: (source, error) => boundary.report(source, error),
      });
      plotCardMode = inputSettings.plotCardMode;
      controls = createControlsPort({
        input: gameplay.input,
        initial: inputSettings.initial,
        save: (t) => settings.saveBindings(t),
      });
    }
    const uiModule = new UiModule<ClientServices>({
      store: withHudPump(store, hudWriter, interactionPump),
      win,
      search: win.location.search,
      online: onlinePort,
      intents: createUiIntents({
        store,
        purchase: (itemId, priceLm) => purchasePort.purchase(itemId, priceLm),
        quality: { setPreset: (preset, source) => services.get("quality").setPreset(preset, source) },
        saveQuality: (preset) => settings.saveQuality(preset),
        ...(gameplay !== null
          ? {
              setPlotCardMode: (mode: PlotCardMode) => {
                if (!choosePlotCardMode(gameplay.input, safeLocalStorage(win), mode))
                  boundary.report("settings save", new Error("Plot Card mode could not be saved"));
              },
            }
          : {}),
      }),
      plotCardMode,
      ...(controls !== undefined ? { controls } : {}),
    });
    if (gameplay !== null) {
      const feet = gameplay.rig.feet;
      interactionPump.parcels = new ParcelFeed({
        ui: uiModule,
        source: () => nearSource,
        samplePos: (out) => {
          if (gameplay.stats.posedFrames === 0) return false;
          out.x = feet[0]!;
          out.y = feet[1]!;
          out.z = feet[2]!;
          return true;
        },
        bearing: sphereBearingDeg,
      });
      interactionPump.markers = new ObjectiveMarkers({
        store,
        setMarkerBearing: markerSink(uiModule, (message) => console.warn(`[app] ${message}`)),
        step: () => (onboarding.inductionComplete ? null : onboarding.currentStepId),
        source: () => nearSource,
        stations: () => markerStations,
        samplePos: (out) => {
          if (gameplay.stats.posedFrames === 0) return false;
          out.x = feet[0]!;
          out.y = feet[1]!;
          out.z = feet[2]!;
          return true;
        },
        bearing: sphereBearingDeg,
      });
      // H opens / closes the DOT Handbook (keyboard + mouse).
      disposers.push(installHandbookKey({ win, store }));
      interactionPump.bridge = new UiFrameBridge({
        store,
        ui: uiModule,
        input: gameplay.input,
        station: () => interactionPump.writer?.currentKind ?? null,
        onInspect: (on) => {
          readoutWriter.setInspecting(on);
          readoutLink.setInspecting(on);
          if (on) onboarding.plotCardOpened();
        },
      });
    }
    const registered = new Map<ClientModuleId, ClientModule<ClientServices>>([
      ["render", render],
      ["visuals", visuals],
      ["animation", animation],
      ["net", netModule],
      ["ui", uiModule],
    ]);
    // Audio: synthesis runs in a Worker. The AudioContext is built suspended during boot (below, before the frame loop
    // starts) because its construction blocks the main thread for ~300 ms on some machines; the first gesture then only
    // calls resume() (about 0.4 ms). The module's own idle hook and gesture path stay as fallbacks.
    const audio = wantsAudio(win.location.search) ? new AudioModule<ClientServices>({ env: browserEnv(win) }) : null;
    if (audio !== null) registered.set("audio", audio);
    if (gameplay !== null) registered.set("gameplay", gameplay);
    if (perfEnabled) {
      registered.set("debug", new DebugModule({ getLoop: () => loop, win, doc, startVisible: perfHudVisible }));
    } else if (trackTimestamp) {
      // Production: no HUD, no window hooks, no overlays; only the sparse GPU-timing feed for dynamic resolution. It takes
      // the (otherwise empty) last frame slot, after render has presented the frame. Without timestamp-query support it
      // is a no-op and dynres steers on the frame interval.
      registered.set("debug", new GpuTimingModule());
    }

    // Fixed order; modules without an implementation yet (terrain) or not enabled (gameplay, audio) are skipped;
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
        if (module.id === "render") {
          applyIntegratedGpuDefault(services.get("quality"), renderUrl.preset !== null);
          // A preset the player chose in Settings wins over the detected default (not over an explicit `?preset=`).
          const savedQuality = settings.loadQuality();
          if (savedQuality !== null && renderUrl.preset === null)
            services.get("quality").setPreset(savedQuality, "user");
        }
      } catch (error) {
        if (error instanceof RenderUnsupportedError) boundary.showUnsupported(error);
        else boundary.showFatal(`module "${module.id}" init`, error);
        throw error;
      }
    }
    for (const key of REQUIRED_SERVICES) {
      if (!services.has(key)) throw new Error(`composition root: service "${key}" was not registered by any module`);
    }

    // Loading phase: build the suspended AudioContext (and start the cue Worker) before the first frame and before any
    // gameplay input can arrive, so the construction stall never lands in play. Failure (no Web Audio) leaves the
    // module's gesture path to retry; the game then runs silent.
    audio?.prepare();

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

    // Solo LocalRoom (ADR-0031): started after the loop so the first frame never waits for it; the sim runs in its own
    // Worker, so the render thread sees only message handling. Harness lanes (look-dev, bench, capture) skip it.
    if (wantsSoloHost(win.location.search)) {
      const storage: KeyValueStore | null = (() => {
        try {
          return win.localStorage;
        } catch {
          return null; // storage blocked by the browser: ephemeral Contract identity
        }
      })();
      const random = (bytes: Uint8Array<ArrayBuffer>): Uint8Array<ArrayBuffer> => win.crypto.getRandomValues(bytes);
      const onProblem = (source: string, error: unknown): void => boundary.report(source, error);
      if (dustView !== null && simHostModule !== null) {
        // Dust scene: its own Contract (never the player's), spawn on the scene's site, the ledger view follows the
        // host, and a scripted sweeper holds the tool (`&bot=0`: no sweeper, the moon only shows restored dust).
        const view = dustView;
        const loaded = simHostModule;
        const sweepers: DustSceneSweeper[] = [];
        const solo = startSoloHost<LocalRoomHostImpl>({
          publisher: roomHost,
          identity: loadSoloIdentity(prefixedStore(storage, DUST_SCENE_STORAGE_PREFIX), Date.now(), random),
          onProblem,
          load: () => Promise.resolve(loaded),
          hostOverrides: dustSceneHostOptions(view, DUST_SCENE_SITE),
          onHost: (host) => {
            view.attach(host);
            const sweeper = new DustSceneSweeper(host);
            sweepers.push(sweeper);
            if (new URLSearchParams(win.location.search).get("bot") !== "0") sweeper.start();
            if (perfEnabled) installDustFeedHooks(win, host, view, sweeper);
          },
        });
        disposers.push(() => {
          for (const s of sweepers) s.stop();
          view.detach();
          void solo.stop();
        });
      } else {
        const identity = loadSoloIdentity(storage, Date.now(), random);
        const solo: { handle: SoloHostHandle | null } = { handle: null };
        const startHost = (): void => {
          solo.handle = startSoloHost({
            publisher: roomHost,
            identity,
            onProblem,
            load: () => import("../sim-host"),
            // `save.checkpointed` / `save.restored` / `save.storage_warning` reach the bus (checkpoint sync listens).
            hostOverrides: {
              onSaveEvent: saveEventForwarder(events),
              // Dev / perf only: `?lm=500` starts a fresh Solo game with that wallet (smoke tests buy at the Desk).
              ...devWallet(perfEnabled, win.location.search),
            },
          });
        };
        startHost();
        disposers.push(() => void solo.handle?.stop());
        // Background checkpoint sync (and its guest sign-in POST) only when a game server is configured for this build
        // (VITE_SERVER_HTTP_URL), or forced with `?sync=1`: a local/preview build without a server makes no request.
        // It never blocks boot or solo input: lazy chunks, network failures back off 30 s -> 5 min, nothing is thrown.
        if (wantsCheckpointSync(win.location.search, import.meta.env["VITE_SERVER_HTTP_URL"] as string | undefined))
          startCheckpointSync({
            win,
            config,
            events,
            store,
            identity,
            solo,
            startHost,
            onProblem,
            disposers,
            loadGuestAuth,
          });
      }
    }

    // Dev / `?perf=1` only: join a remote room from the console (`__mcOnline.open(contractId, accessToken)`). Production
    // installs no console hook; solo never loads the online chunk.
    if (perfEnabled) {
      win.__mcOnline = onlineHooks;
      disposers.push(() => {
        delete win.__mcOnline;
      });
    }

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

/** Checkpoint sync runs when the build names a game server (or `?sync=1`); `?sync=0` turns it off. */
export function wantsCheckpointSync(search: string, serverUrl: string | undefined): boolean {
  const forced = new URLSearchParams(search).get("sync");
  if (forced === "0") return false;
  if (forced === "1") return true;
  return typeof serverUrl === "string" && serverUrl.trim() !== "";
}

/** The tab's guest account (net/guest-auth, lazy chunk). */
type GuestAuthInstance = ReturnType<typeof import("../net/guest-auth").createGuestAuth>;

/** `localStorage`, or null when the browser blocks it (the account then lives for this tab only). */
function safeLocalStorage(win: Window): Storage | null {
  try {
    return win.localStorage;
  } catch {
    return null;
  }
}

/** Player input runs with the Solo host on `?play=1`, or in the dust scene when its sweeper is off (`&bot=0`). */
export function wantsPlayerInput(search: string): boolean {
  if (!wantsSoloHost(search)) return false;
  const params = new URLSearchParams(search);
  if (params.get("play") === "1") return true;
  return planScene(search).scene === "dust" && params.get("bot") === "0";
}

/** Simulation tick rate of the Solo host (SIM_TICK_HZ); playtime in the save summary is derived from it. */
const SOLO_TICK_HZ = 20;
/** The Solo host's IndexedDB name (sim-host default `dbName`). */
const SOLO_DB_NAME = "moon-cleanup-solo";

interface CheckpointSyncDeps {
  readonly win: Window;
  readonly config: ReturnType<typeof readClientConfig>;
  readonly events: ReturnType<typeof createEventBus>;
  readonly store: ReturnType<typeof createUiStore>;
  readonly identity: SoloIdentity;
  readonly solo: { handle: SoloHostHandle | null };
  readonly startHost: () => void;
  readonly onProblem: (source: string, error: unknown) => void;
  readonly disposers: (() => void)[];
  /** The tab's shared guest account (also the online entry UI's). */
  readonly loadGuestAuth: () => Promise<GuestAuthInstance>;
}

/**
 * Background checkpoint sync of the Solo Contract (M1-W5-T08). Loaded after the host starts (dynamic chunks), never
 * on the first-frame path. Auth is a guest account (M1-W4-T04b, `net/guest-auth`): the stored refresh token is
 * rotated, or a guest is created on first run; once signed in the queue is released with `notifyAuthChanged()`.
 * A sleeping or unreachable server just leaves the queue held (signed out) until the next boot.
 */
function startCheckpointSync(d: CheckpointSyncDeps): void {
  let disposed = false;
  let teardown: (() => void) | null = null;
  d.disposers.push(() => {
    disposed = true;
    teardown?.();
  });
  void (async () => {
    // Deep import on purpose: the net barrel would pull the room/protocol code into this solo background chunk.
    const [syncModule, hostModule, auth, gameData] = await Promise.all([
      import("../sync"),
      import("../sim-host"),
      d.loadGuestAuth(),
      import("@moon-cleanup/game-data"),
    ]);
    if (disposed) return;
    let opened: Promise<import("../sim-host").CheckpointStore> | null = null;
    const hostStore = (): Promise<import("../sim-host").CheckpointStore> =>
      (opened ??= hostModule.openCheckpointStore("auto", SOLO_DB_NAME, () =>
        d.onProblem("save sync", new Error("IndexedDB is unavailable: checkpoints cannot sync from this tab")),
      ));
    const meta = await syncModule.openSyncMetaStore("auto", "moon-cleanup-sync", () => undefined);
    if (disposed) return;
    const sync = syncModule.createSaveSync({
      api: syncModule.createSaveApi({
        baseUrl: d.config.httpUrl,
        auth,
      }),
      store: storeReader(hostStore),
      install: createLocalInstallPort({
        store: hostStore,
        stopHost: async () => {
          // Refuse before touching the host: a main-thread MemoryCheckpointStore (IndexedDB failed here) is never read
          // by the worker host, so an install through it would "succeed" while changing nothing. The rejection leaves
          // the host running and reaches the sync controller as a failed restore.
          await assertInstallableStore(hostStore);
          await (d.solo.handle?.stop("conflict_resolved") ?? Promise.resolve());
        },
        startHost: d.startHost,
      }),
      meta,
      events: d.events,
      sink: (patch) => d.store.dispatch({ type: "saveSync.set", patch }),
      summary: createSummaryProvider(d.store, SOLO_TICK_HZ, deviceLabelOf(d.win.navigator.userAgent)),
      // Derived from the real game data (app/game-data-version.ts), not the build string.
      gameDataVersion: gameDataVersionOf(gameData.RAW_GAME_DATA),
    });
    const offRequests = bindSaveSyncRequests(d.store, sync, d.onProblem);
    let stopSignIn: () => void = () => undefined;
    teardown = () => {
      stopSignIn();
      offRequests();
      sync.dispose();
      void opened?.then((s) => s.close());
    };
    if (disposed) {
      teardown();
      return;
    }
    // Clock In in the background: the host already runs from the local copy; a newer server copy becomes a prompt.
    void sync
      .clockIn(d.identity.contractId, { registration: soloRegistration(d.identity.contractId), maxWaitMs: 0 })
      .catch((error: unknown) => d.onProblem("save sync", error));
    stopSignIn = signInUntilReady({
      signIn: () => auth.signIn(),
      notify: () => {
        if (!disposed) sync.notifyAuthChanged();
      },
      onProblem: d.onProblem,
    });
  })().catch((error: unknown) => d.onProblem("save sync start", error));
}

/** Dev / `?perf=1` hooks of the dust scene's host feed: stats, a worker crash (restore check) and the sweeper. */
interface DustFeedHooks {
  stats(): { view: SoloDustView["stats"]; host: ReturnType<LocalRoomHostImpl["stats"]>; inputsSent: number };
  crashWorker(): void;
  checkpoint(): Promise<unknown>;
  hash(): Promise<{ tick: number; hash: number; dustHash: number }>;
  viewHash(): number;
  sweep(on: boolean): void;
}

function installDustFeedHooks(
  win: Window,
  host: LocalRoomHostImpl,
  view: SoloDustView,
  sweeper: DustSceneSweeper,
): void {
  const hooks: DustFeedHooks = {
    stats: () => ({ view: { ...view.stats }, host: host.stats(), inputsSent: sweeper.sent }),
    crashWorker: () => host.crashWorkerForTest(),
    checkpoint: () => host.checkpoint("timer"),
    hash: () => host.requestHash(),
    viewHash: () => view.front.worldHash(),
    sweep: (on) => (on ? sweeper.start() : sweeper.stop()),
  };
  win.__mcDustFeed = hooks;
}

/** Entry used by `main.ts`: fire and forget; failures are already on screen and in the console. */
export function boot(): void {
  bootApp().catch(() => undefined);
}

/** `?lm=N` (dev / perf builds only): fresh-game wallet override; empty in production. */
function devWallet(perfEnabled: boolean, search: string): Partial<CreateLocalRoomHostOptions> {
  if (!perfEnabled) return {};
  const lm = Number(new URLSearchParams(search).get("lm"));
  return Number.isFinite(lm) && lm > 0 ? { fresh: { walletLm: lm, spawnDirection: undefined } } : {};
}
