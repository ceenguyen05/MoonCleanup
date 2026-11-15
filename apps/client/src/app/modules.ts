// App-owned adapter that makes the net session look like a ClientModule for the M0 hello world. A placeholder for the
// real module: the net folder (apps/client/src/net) exports a session factory, not a ClientModule yet.

import type { ClientModule, FrameInfo, ModuleContext, Unsubscribe } from "@moon-cleanup/shared";
import { createNetSession, shouldProbe, type NetSession } from "../net";
import type { OnlineRoomSlot } from "./online-launch";
import type { ClientServices } from "./services";

export interface NetAdapterOptions {
  readonly httpUrl: string;
  readonly wsUrl: string;
  readonly clientBuild: string;
  /**
   * Wake immediately on init (automation opt-in `?wake=1`). Otherwise the server is woken only on online intent
   * (`wakeForOnline()`: the online entry UI or a room open), never by Solo play: no request on the solo play path (E13).
   */
  readonly wakeAtBoot: boolean;
  readonly win: Window;
  /** The open online room, if any (empty in solo: `update` then does one null check and nothing else). */
  readonly online?: OnlineRoomSlot;
}

/** `net` ClientModule: owns the session, mirrors `net.status` into the UI store, wakes on first interaction. */
export class AppNetModule implements ClientModule<ClientServices> {
  readonly id = "net" as const;
  private session: NetSession | null = null;
  private readonly cleanup: Unsubscribe[] = [];
  private readonly listenerTargets: { target: EventTarget; type: string; handler: () => void }[] = [];
  private wakeFn: (() => void) | null = null;
  private woken = false;

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

    this.wakeFn = (): void => {
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
    // netcode.md section 10: never on page load. Solo-first (owner 2026-11-13, E13): not on the first click either
    // (that was a request to the server during solo play); only `?wake=1` automation or online intent wakes it.
    if (options.wakeAtBoot) this.wakeForOnline();
  }

  /** Online intent (entry UI opened, room open): start the server wake probe once. Solo never calls it. */
  wakeForOnline(): void {
    if (this.woken || this.wakeFn === null) return;
    this.woken = true;
    this.wakeFn();
  }

  update(frame: FrameInfo): void {
    // Transport work is event driven (timers + socket callbacks). An open online room advances its remote-entity
    // interpolation and decays the prediction correction once per rendered frame.
    const room = this.options.online?.current ?? null;
    if (room !== null) room.frame(frame.dt * 1000);
  }

  dispose(): void {
    const slot = this.options.online;
    if (slot?.current) {
      slot.current.dispose();
      slot.current = null;
    }
    for (const entry of this.listenerTargets) entry.target.removeEventListener(entry.type, entry.handler);
    this.listenerTargets.length = 0;
    for (const unsubscribe of this.cleanup) unsubscribe();
    this.cleanup.length = 0;
    this.session?.dispose();
    this.session = null;
  }
}
