// App-owned adapter that makes the net session look like a ClientModule for the M0 hello world. A placeholder for the
// real module: the net folder (apps/client/src/net) exports a session factory, not a ClientModule yet.

import type { ClientModule, ModuleContext, Unsubscribe } from "@moon-cleanup/shared";
import { createNetSession, shouldProbe, type NetSession } from "../net";
import type { ClientServices } from "./services";

export interface NetAdapterOptions {
  readonly httpUrl: string;
  readonly wsUrl: string;
  readonly clientBuild: string;
  /** Wake immediately on init (automation opt-in `?wake=1`); otherwise on the first user interaction. */
  readonly wakeAtBoot: boolean;
  readonly win: Window;
}

/** `net` ClientModule: owns the session, mirrors `net.status` into the UI store, wakes on first interaction. */
export class AppNetModule implements ClientModule<ClientServices> {
  readonly id = "net" as const;
  private session: NetSession | null = null;
  private readonly cleanup: Unsubscribe[] = [];
  private readonly listenerTargets: { target: EventTarget; type: string; handler: () => void }[] = [];

  constructor(private readonly options: NetAdapterOptions) {}

  init(ctx: ModuleContext<ClientServices>): void {
    const { options } = this;
    const store = ctx.services.get("uiStore");
    this.cleanup.push(
      ctx.events.on("net.status", (event) => {
        store.dispatch({
          type: "session.set",
          patch: { conn: event.state, rttMs: event.rttMs, closeCode: event.closeCode },
        });
      }),
    );

    const session = createNetSession({
      httpUrl: options.httpUrl,
      wsUrl: options.wsUrl,
      clientBuild: options.clientBuild,
      events: ctx.events,
    });
    this.session = session;
    ctx.services.register("netSession", session);

    const wake = (): void => {
      const { win } = options;
      const allowed = shouldProbe({
        webdriver: win.navigator.webdriver === true,
        userAgent: win.navigator.userAgent,
        prerendering: "prerendering" in win.document && win.document["prerendering"] === true,
        hidden: win.document.visibilityState === "hidden",
        allowAutomation: options.wakeAtBoot,
      });
      if (allowed) session.wake();
    };

    if (options.wakeAtBoot) {
      wake();
    } else {
      // netcode.md section 10: never on page load; the first interaction starts the probe (once).
      const once = (): void => {
        for (const entry of this.listenerTargets) entry.target.removeEventListener(entry.type, entry.handler);
        this.listenerTargets.length = 0;
        wake();
      };
      for (const type of ["pointerdown", "keydown"]) {
        options.win.addEventListener(type, once);
        this.listenerTargets.push({ target: options.win, type, handler: once });
      }
    }
  }

  update(): void {
    // Transport work is event driven (timers + socket callbacks); nothing to ingest per frame in M0.
  }

  dispose(): void {
    for (const entry of this.listenerTargets) entry.target.removeEventListener(entry.type, entry.handler);
    this.listenerTargets.length = 0;
    for (const unsubscribe of this.cleanup) unsubscribe();
    this.cleanup.length = 0;
    this.session?.dispose();
    this.session = null;
  }
}
