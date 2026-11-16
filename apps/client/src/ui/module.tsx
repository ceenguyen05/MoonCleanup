// `ui` ClientModule: mounts the React 19 root over the canvas, flushes the UI store (at most 15 Hz inside the store)
// once per frame and keeps the display metrics (DPR, hairline, HUD scale) current. It reads the game only through the
// typed UI store and the event bus, never from sim state, and never imports three.js.

import type { ClientModule, FrameInfo, ModuleContext, ServiceTypes, UiStore } from "@moon-cleanup/shared";
import { createRoot, type Root } from "react-dom/client";
import interUrl from "../../../../assets/ui/fonts/inter-latin-wght.woff2?url";
import spaceGroteskUrl from "../../../../assets/ui/fonts/space-grotesk-latin-wght.woff2?url";
import "./tokens/fonts.css";
import "./tokens/tokens.css";
import { installDisplayMetrics, userScaleFromSetting, type DisplayMetricsHandle } from "./tokens/display-metrics";
import type { QualityPresetId } from "@moon-cleanup/shared";
import type { ControlsPort } from "./menus/controls-model";
import { commitCapture, createUiPrefsStore, type UiPrefsStore } from "./menus/ui-local";
import { createCompassWriter } from "./hud/CompassStrip";
import {
  createParcelsStore,
  type NearParcelSource,
  type ParcelBearingFn,
  type ParcelsStore,
} from "./hud/parcels-store";
import { activateFocused, moveFocus, type UiNavAction } from "./menus/focus-nav";
import { NO_INTENTS, type PlotCardActivation, type UiIntentPort } from "./menus/intents";
import { MENU_NAV_ATTR } from "./menus/MenuHost";
import { promptVisible } from "./save/save-sync-model";
import { SAVE_PROMPT_ATTR } from "./save/SaveConflictPrompt";
import { parseInviteLink, type OnlineEntryPort } from "./online/online-model";
import { UiProvider } from "./ui-context";
import { parseUiUrlOptions } from "./ui-options";
import { UiRoot } from "./UiRoot";
import { STRINGS } from "./strings";

/** The store the composition root creates: the contract plus the per-frame flush. */
export interface FlushableUiStore extends UiStore {
  flush(nowMs: number): boolean;
}

export interface UiModuleOptions {
  readonly store: FlushableUiStore;
  readonly win: Window;
  /** Where the UI layer mounts (default: `document.body`). */
  readonly parent?: HTMLElement;
  /** `location.search`. */
  readonly search: string;
  /**
   * Online entry (M1): when given, the UI shows a "Play online" launcher / connection chip and a lazy panel. The port is
   * the only way the UI reaches online code (the app backs it with the dynamic-import hook of app/online-launch.ts), so
   * solo builds that omit it, and solo play in general, load and run nothing online.
   */
  readonly online?: OnlineEntryPort;
  /** Purchase and settings intents raised by the menus (Requisitions Desk, Ops Console, Settings). Default: no-ops. */
  readonly intents?: UiIntentPort;
  /**
   * The purchase port of the composition root (`PurchasePort.purchase`): `(itemId, priceLm?) => requestId | null`. When
   * given (and `intents` is not), the Requisitions Desk and Ops Console call it; the sim answers through the store.
   */
  readonly purchase?: (itemId: string, priceLm?: number) => string | null;
  /**
   * The input module's binding table for the rebinding screen (Settings > Controls): `table()` returns the current
   * `BindingTable` (device code -> action id), `apply(next)` validates, compiles and persists it, `reset()` restores the
   * defaults, `subscribe` notifies after any change. Absent: the screen says remapping is not available.
   */
  readonly controls?: ControlsPort;
  /** Stored Plot Card activation, so Settings shows the live value at boot (default "toggle"). */
  readonly plotCardMode?: PlotCardActivation;
}

export const UI_HOST_ID = "mc-ui";

export class UiModule<S extends ServiceTypes = ServiceTypes> implements ClientModule<S> {
  readonly id = "ui" as const;
  private host: HTMLElement | null = null;
  private root: Root | null = null;
  private metrics: DisplayMetricsHandle | null = null;
  private preloads: HTMLLinkElement[] = [];
  private onVisibility: (() => void) | null = null;
  private readonly prefs: UiPrefsStore;
  private readonly parcels: ParcelsStore = createParcelsStore();
  private readonly teardown: Array<() => void> = [];

  constructor(private readonly options: UiModuleOptions) {
    this.prefs = createUiPrefsStore(
      options.plotCardMode !== undefined ? { plotCardMode: options.plotCardMode } : undefined,
    );
  }

  init(ctx: ModuleContext<S>): void {
    const { win, store, search } = this.options;
    const doc = win.document;
    const urlOptions = parseUiUrlOptions(search);

    for (const href of [interUrl, spaceGroteskUrl]) {
      const link = doc.createElement("link");
      link.rel = "preload";
      link.as = "font";
      link.type = "font/woff2";
      link.crossOrigin = "anonymous";
      link.href = href;
      doc.head.append(link);
      this.preloads.push(link);
    }

    const host = doc.createElement("div");
    host.id = UI_HOST_ID;
    host.setAttribute("role", "region");
    host.setAttribute("aria-label", STRINGS.a11y.uiRoot);
    host.style.cssText = "position:fixed;inset:0;z-index:5;pointer-events:none;overflow:hidden";
    host.dataset["glass"] = urlOptions.glass;
    host.dataset["motion"] = "full";
    (this.options.parent ?? doc.body).append(host);
    this.host = host;

    // UI size: the settings slice drives the display metrics (`--mc-hud-scale`), so every size, line height and font size
    // re-snaps to whole device pixels at the new scale; nothing is scaled with `transform`.
    const metrics = installDisplayMetrics(win, host, {
      userScale: userScaleFromSetting(store.getState().settings.hudScalePct, urlOptions.hudScale),
    });
    this.metrics = metrics;
    let appliedPct = store.getState().settings.hudScalePct;
    this.teardown.push(
      store.subscribe(() => {
        const pct = store.getState().settings.hudScalePct;
        if (pct === appliedPct) return;
        appliedPct = pct;
        metrics.setUserScale(userScaleFromSetting(pct, urlOptions.hudScale));
      }),
    );

    // Render quality: mirror the renderer's real preset (and the highest one the backend offers) into the UI-local store.
    const quality = ctx.services.has("quality") ? ctx.services.get("quality") : null;
    if (quality !== null) {
      const max = (quality as { readonly maxPreset?: QualityPresetId }).maxPreset;
      this.prefs.setQuality({ preset: quality.current.preset, ...(max !== undefined ? { maxPreset: max } : {}) });
    }
    this.teardown.push(
      ctx.events.on("quality.changed", (event) => this.prefs.setQuality({ preset: event.settings.preset })),
    );
    this.onVisibility = () => {
      host.dataset["hidden"] = String(doc.visibilityState === "hidden");
    };
    doc.addEventListener("visibilitychange", this.onVisibility);

    // Invite link (`/join/<code>` or `?join=<code>`): only meaningful when the app offers online play.
    const invite =
      this.options.online === undefined
        ? null
        : parseInviteLink(search, (win as { location?: Location }).location?.pathname ?? "");
    this.root = createRoot(host);
    this.root.render(
      <UiProvider
        store={store}
        events={ctx.events}
        host={host}
        win={win}
        motion={urlOptions.motion}
        glass={urlOptions.glass}
      >
        <UiRoot
          options={urlOptions}
          online={this.options.online ?? null}
          invite={invite}
          intents={this.intents()}
          prefs={this.prefs}
          parcels={this.parcels}
          controls={this.options.controls ?? null}
        />
      </UiProvider>,
    );
    this.compassWriter = createCompassWriter(host);
  }

  private intents(): UiIntentPort {
    const { intents, purchase, store } = this.options;
    if (intents !== undefined) return intents;
    if (purchase === undefined) return NO_INTENTS;
    return {
      ...NO_INTENTS,
      purchaseDeskItem: (itemId) => {
        const item = store.getState().desk.items.find((candidate) => candidate.itemId === itemId);
        purchase(itemId, item?.priceLm);
      },
      purchaseBoardNode: (nodeId) => {
        const node = store.getState().board.nodes.find((candidate) => candidate.nodeId === nodeId);
        purchase(nodeId, node?.nextCostLm ?? undefined);
      },
    };
  }

  private compassWriter: ((headingDeg: number) => void) | null = null;

  /**
   * Near Parcels feed (call at ~10 Hz or on change; allocation-free while nothing changed). `source` is the sim
   * (`MoonRoomSim.nearParcelCount` / `nearParcel(k, out)`) or any object of that shape; `bearing` maps a parcel's unit
   * direction to a compass bearing (see `sphereBearingDeg`), omit it for a count-only chip.
   */
  setNearParcels(source: NearParcelSource, bearing?: ParcelBearingFn, rewardLm?: number): void {
    this.parcels.setNearParcels(source, bearing, rewardLm);
  }

  /** Leaving / changing parcels: clears the Near Parcels chip and markers (outpost markers stay). No-op when already empty. */
  clearNearParcels(): void {
    this.parcels.clearNearParcels();
  }

  /** Bearing of an outpost on the compass track (whole degrees, 0 = north); `null` removes the marker. */
  setOutpostBearing(id: string, bearingDeg: number | null): void {
    this.parcels.setOutpostBearing(id, bearingDeg);
  }

  /**
   * Bearing of an objective marker on the compass track (whole degrees, 0 = north), by `compass.objectives` id such as
   * `landing_apron`, `assay_counter`, `requisitions_desk` or `near_parcel`; `null` removes the marker. Change-only.
   */
  setMarkerBearing(id: string, bearingDeg: number | null): void {
    this.parcels.setMarkerBearing(id, bearingDeg);
  }

  /** Per-frame heading for the compass strip (degrees, 0 = north, clockwise). A direct whole-pixel DOM write, no React render. */
  setCompassHeading(headingDeg: number): void {
    this.compassWriter?.(headingDeg);
  }

  /**
   * Which kind of input the rebinding screen is waiting for: `"pad"` while the player is choosing a gamepad button (the
   * input module then routes every pad button press to `offerInput` instead of `navigate`), `"key"` while a key is awaited
   * (the screen reads it itself), `null` otherwise.
   */
  capturing(): "key" | "pad" | null {
    return this.prefs.getState().capture?.kind ?? null;
  }

  /** Gives a gamepad button (`Pad<n>`, standard mapping) to a waiting capture. Returns true when it was consumed. */
  offerInput(code: string): boolean {
    return commitCapture(this.prefs, this.options.controls ?? null, code);
  }

  /**
   * Menu navigation for the input layer (gamepad D-pad / A / B): moves focus inside the open menu, clicks the focused
   * control on `confirm`, goes back on `back`. Returns true when a menu was open and took the action.
   */
  navigate(action: UiNavAction): boolean {
    const host = this.host;
    if (host === null) return false;
    // The "Which copy?" prompt sits above any menu: it takes the pad first. Back = "Decide later" (never a choice).
    const state = this.options.store.getState();
    if (promptVisible(state.saveSync, this.prefs.getState().savePromptDismissed)) {
      if (action === "back") {
        this.prefs.setSavePromptDismissed(true);
        return true;
      }
      const prompt = host.querySelector<HTMLElement>(`[${SAVE_PROMPT_ATTR}]`);
      if (prompt === null) return false;
      if (action === "confirm") return activateFocused(prompt);
      return moveFocus(prompt, action);
    }
    if (state.menus.open === null) return false;
    if (action === "back") {
      this.options.store.dispatch({ type: "menus.back" });
      return true;
    }
    const root = host.querySelector<HTMLElement>(`[${MENU_NAV_ATTR}]`);
    if (root === null) return false;
    if (action === "confirm") return activateFocused(root);
    return moveFocus(root, action);
  }

  update(frame: FrameInfo): void {
    this.options.store.flush(frame.time * 1000);
  }

  resize(): void {
    // Display metrics follow `resize` and the resolution media query on their own; nothing else depends on canvas size.
  }

  dispose(): void {
    if (this.onVisibility !== null)
      this.options.win.document.removeEventListener("visibilitychange", this.onVisibility);
    this.onVisibility = null;
    for (const off of this.teardown.splice(0)) off();
    this.parcels.clear();
    this.metrics?.dispose();
    this.metrics = null;
    this.root?.unmount();
    this.root = null;
    this.host?.remove();
    this.host = null;
    for (const link of this.preloads) link.remove();
    this.preloads = [];
  }
}
