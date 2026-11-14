// DOM status overlay of the hello-world client: build version, backend, tier, preset, server state and RTT.
// Plain DOM (no React yet; the HUD arrives with the ui module). Text is rewritten only when the UI store changes
// (<= 15 Hz) or a render event arrives. The `data-*` attributes are the stable hooks for e2e tests.

import type { EventBus, UiState, UiStore, Unsubscribe } from "@moon-cleanup/shared";

export interface Overlay {
  dispose(): void;
}

export interface OverlayOptions {
  readonly doc: Document;
  readonly parent: HTMLElement;
  readonly events: EventBus;
  readonly store: UiStore;
  readonly buildVersion: string;
  readonly envLabel: string;
  /** Hidden overlays still track state (so `data-*` stays correct) but are `display: none`. */
  readonly visible: boolean;
}

const SERVER_TEXT = {
  asleep: "asleep",
  waking: "waking the server...",
  connecting: "joining the room...",
  connected: "connected",
  lost: "lost",
} as const satisfies Record<UiState["session"]["conn"], string>;

export function createOverlay(options: OverlayOptions): Overlay {
  const { doc, events, store } = options;
  const root = doc.createElement("div");
  root.id = "mc-overlay";
  root.style.cssText = [
    "position:fixed",
    "left:8px",
    "top:8px",
    "z-index:10",
    "pointer-events:none",
    "white-space:pre",
    "font:12px/1.35 ui-monospace,Consolas,monospace",
    "color:#e8ecf4",
    "text-shadow:0 1px 2px #000",
    options.visible ? "display:block" : "display:none",
  ].join(";");
  options.parent.append(root);

  let backend = "?";
  let tier = "?";
  let preset = "?";
  let forced = false;

  const paint = (): void => {
    const { conn, rttMs, closeCode } = store.getState().session;
    const rtt = rttMs === null ? "" : ` | rtt ${Math.round(rttMs)} ms`;
    const code = conn === "lost" && closeCode !== null ? ` (close ${closeCode})` : "";
    root.textContent =
      `Clean The Moon!  ${options.buildVersion} (${options.envLabel})\n` +
      `backend ${backend}${forced ? " (forced)" : ""} | tier ${tier} | preset ${preset}\n` +
      `server ${SERVER_TEXT[conn]}${code}${rtt}`;
    root.dataset["backend"] = backend;
    root.dataset["tier"] = tier;
    root.dataset["preset"] = preset;
    root.dataset["serverState"] = conn;
    root.dataset["rttMs"] = rttMs === null ? "" : String(Math.round(rttMs));
  };

  const subscriptions: Unsubscribe[] = [
    store.subscribe(paint),
    events.on("render.backendSelected", (event) => {
      backend = event.backend;
      tier = event.tier;
      forced = event.forced;
      paint();
    }),
    events.on("quality.changed", (event) => {
      preset = event.settings.preset;
      paint();
    }),
  ];
  paint();

  return {
    dispose() {
      for (const unsubscribe of subscriptions) unsubscribe();
      root.remove();
    },
  };
}
