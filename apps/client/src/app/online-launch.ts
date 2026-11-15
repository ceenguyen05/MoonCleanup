// Opens an online (remote) room (M1-W4-T04 wiring). This file is in the main chunk and holds no netcode: the room code
// (session, dust mirror, predictor, game data and world grid) is loaded by a dynamic `import()` the first time a remote
// room is opened. Solo play never calls `openOnlineRoom`, so it constructs nothing online and pays no cost
// (ADR-0031). Only type imports point at ./online-room.

import type { LocalRoomHost, RoomHost } from "@moon-cleanup/shared";
import type { AccessTokenSource } from "../net";
import type { AnimInputProvider, AnimGround } from "../animation";
import type { OnlineRoom, OnlineRoomOptions, RemoteAvatarFeed, RemoteRoomHostImpl } from "./online-room";
import type { RoomHostPublisher } from "./solo-host";

/** What the composition root holds while a room is open; `frame` runs from the net module's per-frame update. */
export interface OnlineRoomSlot {
  current: OnlineRoom | null;
}

/** Loads the online-room chunk, builds the room and starts joining. */
export async function openOnlineRoom(options: OnlineRoomOptions): Promise<OnlineRoom> {
  const { createOnlineRoom } = await import("./online-room");
  const room = createOnlineRoom(options);
  room.start();
  return room;
}

/** Room plus its RoomHost facade (published through the `roomHost` service while open). */
export async function openRemoteHost(
  options: OnlineRoomOptions,
): Promise<{ readonly room: OnlineRoom; readonly host: RemoteRoomHostImpl; readonly avatars: RemoteAvatarFeed }> {
  const m = await import("./online-room");
  const room = m.createOnlineRoom(options);
  const host = m.createRemoteRoomHost(room, options.contractId);
  const avatars = m.createRemoteAvatarFeed(room);
  room.start();
  return { room, host, avatars };
}

/** The animation pool as the online hooks see it (AnimationModule.bind). */
export interface AnimationBinder {
  bind(provider: AnimInputProvider | null, ground: AnimGround | null, moonRadiusM: number): void;
  /** Pool slot of the local player (LOD bucket 0); -1 for none. */
  setLocalSlot(slot: number): void;
}

/** Flat ground for remote avatars: the server room is flat until terrain hands the sim its height cube (online-room). */
const FLAT_ANIM_GROUND: AnimGround = {
  heightsAt(_dirs: Float64Array, out: Float64Array, n: number): void {
    out.fill(0, 0, n);
  },
};

/** Optional wiring of the hooks (boot): host publishing and a refreshable token source. */
export interface OnlineHookWiring {
  /** While a room is open its RemoteRoomHost is published here; a running local host is paused, then restored. */
  readonly publisher?: RoomHostPublisher;
  /**
   * Token source for reconnects and forced refreshes (the shared GuestAuth). The first join uses the token handed to
   * `open`; a refresh (401 / 4101, or a reconnect after expiry) asks this source.
   */
  readonly auth?: () => Promise<AccessTokenSource>;
  /** While a room is open its avatar entities feed this pool; unbound (null provider) on close. */
  readonly animation?: AnimationBinder;
}

/** Dev / `?perf=1` console hooks to join a remote room by hand (no lobby or sign-in UI exists yet). */
export interface OnlineDevHooks {
  /** Joins `contractId` with an access token the developer obtained from `POST /v1/auth/guest`. Never put it in a URL. */
  open(contractId: string, accessToken: string): Promise<void>;
  close(): void;
  stats(): unknown;
}

export function createOnlineDevHooks(
  slot: OnlineRoomSlot,
  base: Omit<OnlineRoomOptions, "contractId" | "auth">,
  onProblem: (source: string, error: unknown) => void,
  wiring: OnlineHookWiring = {},
): OnlineDevHooks {
  const publisher = wiring.publisher;
  let host: RemoteRoomHostImpl | null = null;
  /** The host that was current before the room opened (restored on close); `paused` when we paused it. */
  let previous: RoomHost | null = null;
  let pausedLocal: LocalRoomHost | null = null;
  let generation = 0;
  const close = (): void => {
    generation++;
    const room = slot.current;
    slot.current = null;
    const h = host;
    host = null;
    if (h !== null) void h.close("return_to_solo");
    else if (room !== null) {
      room.leave();
      room.dispose();
    }
    if (publisher !== undefined && h !== null && publisher.current === h) {
      const back = previous !== null && previous.state !== "closed" && previous.state !== "failed" ? previous : null;
      publisher.publish(back);
    }
    if (h !== null || room !== null) {
      wiring.animation?.bind(null, null, 0);
      wiring.animation?.setLocalSlot(-1);
    }
    pausedLocal?.resume();
    pausedLocal = null;
    previous = null;
  };
  const tokenSource = (accessToken: string): AccessTokenSource => {
    let first = true;
    return {
      getAccessToken: async (forceRefresh) => {
        if (first && !forceRefresh) {
          first = false;
          return accessToken;
        }
        if (wiring.auth === undefined) return forceRefresh ? null : accessToken;
        return (await wiring.auth()).getAccessToken(forceRefresh);
      },
    };
  };
  return {
    async open(contractId, accessToken) {
      close();
      const mine = generation;
      try {
        const opts = { ...base, contractId, auth: tokenSource(accessToken) };
        if (publisher === undefined) {
          slot.current = await openOnlineRoom(opts);
          return;
        }
        const opened = await openRemoteHost(opts);
        if (mine !== generation) {
          void opened.host.close("return_to_solo");
          return;
        }
        slot.current = opened.room;
        host = opened.host;
        previous = publisher.current;
        if (previous?.kind === "local" && previous.state === "running") {
          previous.pause();
          pausedLocal = previous;
        }
        publisher.publish(opened.host);
        wiring.animation?.bind(opened.avatars.provider, FLAT_ANIM_GROUND, opened.room.config.moonRadiusM);
        wiring.animation?.setLocalSlot(opened.avatars.ownSlot);
      } catch (error) {
        onProblem("online room open", error);
      }
    },
    close,
    stats() {
      const room = slot.current;
      if (room === null) return null;
      return {
        phase: room.session.phase,
        room: { ...room.stats },
        dust: { ...room.dust.stats, ready: room.dust.ready, wanted: room.dust.wantedCount },
        predictor: { ...room.predictor.stats },
        feed: room.feed.info(),
        host: host === null ? null : { state: host.state, rttMs: host.rttMs, ...host.stats },
      };
    },
  };
}
