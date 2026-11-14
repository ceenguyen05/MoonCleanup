// `ui` ClientModule: mounts the React 19 root over the canvas, flushes the UI store (at most 15 Hz inside the store)
// once per frame and keeps the display metrics (DPR, hairline, HUD scale) current. It reads the game only through the
// typed UI store and the event bus, never from sim state, and never imports three.js.

import type { ClientModule, FrameInfo, ModuleContext, ServiceTypes, UiStore } from "@moon-cleanup/shared";
import { createRoot, type Root } from "react-dom/client";
import interUrl from "../../../../assets/ui/fonts/inter-latin-wght.woff2?url";
import spaceGroteskUrl from "../../../../assets/ui/fonts/space-grotesk-latin-wght.woff2?url";
import "./tokens/fonts.css";
import "./tokens/tokens.css";
import { installDisplayMetrics, type DisplayMetricsHandle } from "./tokens/display-metrics";
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
}

export const UI_HOST_ID = "mc-ui";

export class UiModule<S extends ServiceTypes = ServiceTypes> implements ClientModule<S> {
  readonly id = "ui" as const;
  private host: HTMLElement | null = null;
  private root: Root | null = null;
  private metrics: DisplayMetricsHandle | null = null;
  private preloads: HTMLLinkElement[] = [];
  private onVisibility: (() => void) | null = null;

  constructor(private readonly options: UiModuleOptions) {}

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

    this.metrics = installDisplayMetrics(win, host, { userScale: urlOptions.hudScale });
    this.onVisibility = () => {
      host.dataset["hidden"] = String(doc.visibilityState === "hidden");
    };
    doc.addEventListener("visibilitychange", this.onVisibility);

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
        <UiRoot options={urlOptions} />
      </UiProvider>,
    );
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
