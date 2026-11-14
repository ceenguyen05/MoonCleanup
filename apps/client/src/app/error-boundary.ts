// Error boundary of the composition root. Every failure (frame step, event listener, renderer loss, window errors,
// unhandled rejections, unsupported browser) is logged with `console.error` AND shown on screen; nothing is
// swallowed. The first report opens a banner, later ones only bump a counter so a per-frame error cannot flood the DOM.

export interface ErrorBoundary {
  /** Reports a recoverable error: banner + console. */
  report(source: string, error: unknown): void;
  /** Replaces the page with the "browser not supported" screen (no backend can start). */
  showUnsupported(error: unknown): void;
  /** Replaces the page with a fatal screen (recovery gave up). */
  showFatal(source: string, error: unknown): void;
  /** Hooks `error` and `unhandledrejection` on `target`. */
  installGlobalHandlers(target: Window): void;
  /** Number of reports so far. */
  readonly count: number;
}

export function describeError(error: unknown): string {
  if (error instanceof Error) return error.message === "" ? error.name : `${error.name}: ${error.message}`;
  return typeof error === "string" ? error : "unknown error";
}

function makeLayer(doc: Document, id: string): HTMLElement {
  const layer = doc.createElement("div");
  layer.id = id;
  layer.setAttribute("role", "alert");
  Object.assign(layer.style, {
    position: "fixed",
    zIndex: "1000",
    font: "13px/1.4 ui-monospace, Consolas, monospace",
    color: "#fff",
  });
  return layer;
}

export function createErrorBoundary(doc: Document): ErrorBoundary {
  let count = 0;
  let banner: HTMLElement | null = null;
  let screen: HTMLElement | null = null;

  const showScreen = (id: string, title: string, detail: string): void => {
    screen?.remove();
    const layer = makeLayer(doc, id);
    Object.assign(layer.style, {
      inset: "0",
      background: "#0b0d12",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      gap: "12px",
      padding: "24px",
      textAlign: "center",
    });
    const heading = doc.createElement("h1");
    heading.textContent = title;
    heading.style.cssText = "font: 600 22px/1.3 system-ui, sans-serif; margin: 0";
    const body = doc.createElement("p");
    body.textContent = detail;
    body.style.cssText = "margin: 0; max-width: 60ch; opacity: 0.85";
    layer.append(heading, body);
    doc.body.append(layer);
    screen = layer;
    doc.documentElement.dataset["mcError"] = id;
  };

  const report = (source: string, error: unknown): void => {
    count += 1;
    console.error(`[app] ${source}:`, error);
    if (banner === null) {
      banner = makeLayer(doc, "mc-error-banner");
      Object.assign(banner.style, {
        left: "0",
        right: "0",
        bottom: "0",
        padding: "8px 12px",
        background: "rgba(150, 20, 20, 0.92)",
      });
      doc.body.append(banner);
      doc.documentElement.dataset["mcError"] = "banner";
    }
    banner.textContent = `${source}: ${describeError(error)}${count > 1 ? ` (${count} errors, see console)` : ""}`;
  };

  return {
    get count() {
      return count;
    },
    report,
    showUnsupported(error) {
      console.error("[app] unsupported browser:", error);
      showScreen(
        "mc-unsupported",
        "Clean The Moon! needs a newer browser",
        `${describeError(error)} Try a current desktop Chrome, Edge, Firefox or Safari with hardware acceleration enabled.`,
      );
    },
    showFatal(source, error) {
      count += 1;
      console.error(`[app] fatal ${source}:`, error);
      showScreen(
        "mc-fatal",
        "Clean The Moon! stopped",
        `${source}: ${describeError(error)} Reload the page to try again.`,
      );
    },
    installGlobalHandlers(target) {
      target.addEventListener("error", (event) => report("window error", event.error ?? event.message));
      target.addEventListener("unhandledrejection", (event) => report("unhandled rejection", event.reason));
    },
  };
}
