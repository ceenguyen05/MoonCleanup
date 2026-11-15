// Client net session (M0-W1-T04): wake probe -> REST seat reservation -> HelloRoom -> PING/PONG RTT.
//
// States (events/catalog `net.status`): asleep -> waking -> connecting -> connected -> lost.
// - `wake()` is called by the UI on the FIRST title-screen interaction (never on page load, netcode.md section 10);
//   use `shouldProbe()` to honour the no-probe rules (automation, bots, prerender, hidden tab).
// - `/healthz` is probed with a 3 s timeout every 3 s until our JSON arrives; anything else (Render's waking page,
//   CORS failure, timeout) means the host is still waking.
// - RTT updates re-emit `net.status` with the same state (previous === state) so the UI store can mirror `rttMs`.
// The transport is injected (`connect`) so the state machine is testable without a server; `colyseusConnect` is the
// real implementation.

import {
  HealthResponseSchema,
  MESSAGE_CATALOG,
  PING_INTERVAL_MS,
  PROTOCOL_VERSION,
  type EventBus,
  type NetConnectionState,
  type NetStatusEvent,
} from "@moon-cleanup/shared";
import { PING_BODY_BYTES, readPongBody, rttFromPong, writePingBody, type PongTarget } from "@moon-cleanup/protocol";

/** Wake probe cadence and timeout (netcode.md section 10). */
export const PROBE_INTERVAL_MS = 3000;
export const PROBE_TIMEOUT_MS = 3000;
/** M0 REST seat reservation path (server: apps/server/src/net/hello-join-route.ts). */
export const HELLO_JOIN_PATH = "/v0/hello/join";

/** Seat reservation as returned by the server. */
export interface SeatReservation {
  readonly name: string;
  readonly sessionId: string;
  readonly roomId: string;
  readonly processId: string;
}

/** The part of a Colyseus SDK room the session uses. */
export interface RoomLike {
  onMessage(type: string | number, callback: (payload: never) => void): unknown;
  onLeave(callback: (code: number) => void): unknown;
  sendBytes(type: number, bytes: Uint8Array): void;
  leave(consented?: boolean): unknown;
}

/** Opens the room for a reservation. Rejects with `{ code }` when the server closes the join (for example 4100). */
export type ConnectFn = (wsUrl: string, reservation: SeatReservation) => Promise<RoomLike>;

export interface NetSessionOptions {
  /** Base HTTP URL of the server (VITE_SERVER_HTTP_URL). */
  readonly httpUrl: string;
  /** WebSocket URL of the server (VITE_SERVER_WS_URL). */
  readonly wsUrl: string;
  /** VITE_BUILD_VERSION. */
  readonly clientBuild: string;
  readonly events: EventBus;
  readonly connect?: ConnectFn;
  readonly fetch?: typeof fetch;
  /** Monotonic clock in ms (default `performance.now`). */
  readonly now?: () => number;
}

export interface NetSession {
  readonly state: NetConnectionState;
  readonly rttMs: number | null;
  /** Starts (or restarts after `lost`) the wake probe. No-op while waking, connecting or connected. */
  wake(): void;
  dispose(): void;
}

/** Real transport: Colyseus SDK `consumeSeatReservation`, loaded on demand (keeps the SDK off the solo boot path). */
export const colyseusConnect: ConnectFn = async (wsUrl, reservation) => {
  const { ColyseusSDK } = await import("@colyseus/sdk");
  const sdk = new ColyseusSDK(wsUrl);
  const room = await sdk.consumeSeatReservation(reservation);
  return room as unknown as RoomLike;
};

/** Environment facts for the no-probe rules of netcode.md section 10. */
export interface ProbeEnvironment {
  readonly webdriver: boolean;
  readonly userAgent: string;
  readonly prerendering: boolean;
  readonly hidden: boolean;
  /** Explicit opt-in for automated tests (e2e) that must connect. */
  readonly allowAutomation?: boolean;
}

const BOT_UA = /bot|crawl|spider|slurp|headless|lighthouse|preview|facebookexternalhit|embedly/i;

/** Whether the client may wake the server now. */
export function shouldProbe(env: ProbeEnvironment): boolean {
  if (env.prerendering || env.hidden) return false;
  if (env.allowAutomation === true) return true;
  return !env.webdriver && !BOT_UA.test(env.userAgent);
}

function closeCodeOf(error: unknown): number | null {
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = (error as { code: unknown }).code;
    if (typeof code === "number") return code;
  }
  return null;
}

export function createNetSession(options: NetSessionOptions): NetSession {
  const doFetch = options.fetch ?? globalThis.fetch.bind(globalThis);
  const connect = options.connect ?? colyseusConnect;
  const now = options.now ?? (() => performance.now());
  const httpBase = options.httpUrl.replace(/\/+$/, "");

  let state: NetConnectionState = "asleep";
  let rttMs: number | null = null;
  let disposed = false;
  let generation = 0;
  let probeTimer: ReturnType<typeof setTimeout> | undefined;
  let pingTimer: ReturnType<typeof setInterval> | undefined;
  let room: RoomLike | undefined;
  const pingBody = new Uint8Array(PING_BODY_BYTES);
  const pong: PongTarget = { clientTimeMs: 0, serverTick: 0 };

  const emit = (next: NetConnectionState, closeCode: number | null = null): void => {
    const event: NetStatusEvent = { state: next, previous: state, closeCode, rttMs };
    state = next;
    options.events.emit("net.status", event);
  };

  const stopTimers = (): void => {
    if (probeTimer !== undefined) clearTimeout(probeTimer);
    if (pingTimer !== undefined) clearInterval(pingTimer);
    probeTimer = undefined;
    pingTimer = undefined;
  };

  const lose = (gen: number, closeCode: number | null): void => {
    if (gen !== generation || disposed) return;
    stopTimers();
    room = undefined;
    emit("lost", closeCode);
  };

  const sendPing = (): void => {
    if (room === undefined) return;
    writePingBody(Math.floor(now()), pingBody);
    room.sendBytes(MESSAGE_CATALOG.PING.id, pingBody);
  };

  const join = async (gen: number): Promise<void> => {
    let reservation: SeatReservation;
    try {
      const res = await doFetch(`${httpBase}${HELLO_JOIN_PATH}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ protocolVersion: PROTOCOL_VERSION, clientBuild: options.clientBuild }),
      });
      if (!res.ok) return lose(gen, null);
      reservation = ((await res.json()) as { reservation: SeatReservation }).reservation;
    } catch {
      return lose(gen, null);
    }
    let joined: RoomLike;
    try {
      joined = await connect(options.wsUrl, reservation);
    } catch (error) {
      return lose(gen, closeCodeOf(error));
    }
    if (gen !== generation || disposed) {
      joined.leave();
      return;
    }
    room = joined;
    joined.onMessage(MESSAGE_CATALOG.PONG.id, (body: Uint8Array) => {
      if (!readPongBody(body, pong)) return;
      const rtt = rttFromPong(Math.floor(now()), pong.clientTimeMs);
      if (rtt < 0 || gen !== generation) return;
      rttMs = rtt;
      emit(state);
    });
    joined.onLeave((code) => lose(gen, code));
    emit("connected");
    sendPing();
    pingTimer = setInterval(sendPing, PING_INTERVAL_MS);
  };

  const probe = async (gen: number): Promise<void> => {
    let awake = false;
    try {
      const res = await doFetch(`${httpBase}/healthz`, { signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
      awake = res.ok && HealthResponseSchema.safeParse(await res.json()).success;
    } catch {
      awake = false; // waking page, CORS failure, timeout or non-JSON
    }
    if (gen !== generation || disposed) return;
    if (!awake) {
      probeTimer = setTimeout(() => void probe(gen), PROBE_INTERVAL_MS);
      return;
    }
    emit("connecting");
    await join(gen);
  };

  options.events.emit("net.status", { state, previous: null, closeCode: null, rttMs });

  return {
    get state() {
      return state;
    },
    get rttMs() {
      return rttMs;
    },
    wake() {
      if (disposed || (state !== "asleep" && state !== "lost")) return;
      generation++;
      rttMs = null;
      emit("waking");
      void probe(generation);
    },
    dispose() {
      disposed = true;
      generation++;
      stopTimers();
      room?.leave();
      room = undefined;
    },
  };
}
