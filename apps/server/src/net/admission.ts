// Admission control at the edge (security review B1; netcode.md section 15, security.md section 5).
//
// - Seat reservations go through ONE serialized queue, so the limits below are exact even under concurrent joins:
//   * clients: joined clients + live seat reservations (the sum of room listing `clients`, which Colyseus increments
//     on reservation) must stay below MAX_CLIENTS;
//   * rooms: when no room with a free seat matches, a new room is created only below MAX_ROOMS (hard ceiling) and
//     within the per-IP room-creation rate.
//   Refusal: 503 `{ error: "AT_CAPACITY", message: "at_capacity:<rooms|clients>" }` + `retry-after` (the REST face of
//   close 4105 ROOM_FULL; REST code AT_CAPACITY from contract api/rest v0.1.2).
// - Concurrent WebSockets per IP (8): counted from the accepted upgrade until the socket closes (or 10 s when the
//   upgrade never opens). Refused at upgrade with 429.
// - Per-IP limiters key the shared `unknown` bucket (missing edge header) with a tighter limit and log it at most
//   once a minute (security review N2).

import { matchMaker } from "@colyseus/core";

/** A Colyseus seat reservation (what `joinOrCreate` resolves). */
export type SeatReservation = Awaited<ReturnType<typeof matchMaker.joinOrCreate>>;
import type { HttpResponse } from "@moon-cleanup/shared";
import { RateLimiterMemory } from "rate-limiter-flexible";
import { UNKNOWN_CLIENT_IP } from "./client-ip";
import type { NetLogger } from "./http-routes";

/** Concurrent WebSockets per IP (security.md section 5). */
export const MAX_SOCKETS_PER_IP = 8;
/** Concurrent WebSockets for the shared `unknown` bucket (tighter, N2). */
export const MAX_SOCKETS_UNKNOWN = 8;
/** New rooms one IP may cause per minute (B1: every room is a ticking timer on a 0.1-CPU instance). */
export const ROOM_CREATES_PER_IP_PER_MIN = 3;
/** Same for the shared `unknown` bucket. */
export const ROOM_CREATES_UNKNOWN_PER_MIN = 2;
/** Seconds a client is told to wait after an at-capacity refusal. */
export const AT_CAPACITY_RETRY_AFTER_S = 30;
/** How long an accepted upgrade may take to open before its socket slot is released. */
export const PENDING_UPGRADE_MS = 10_000;
/** The `unknown` bucket is logged at most this often per limiter. */
export const UNKNOWN_LOG_INTERVAL_MS = 60_000;

export interface AdmissionLimits {
  /** MAX_ROOMS: hard ceiling on live rooms. */
  readonly maxRooms: number;
  /** MAX_CLIENTS: joined clients + pending reservations. */
  readonly maxClients: number;
  readonly maxSocketsPerIp?: number;
  readonly roomCreatesPerIpPerMin?: number;
}

/** Per-IP fixed-window limiter with a separate, tighter bucket for `unknown` that is logged once a minute. */
export class IpRateLimiter {
  private readonly known: RateLimiterMemory;
  private readonly unknown: RateLimiterMemory;
  private lastUnknownLogAt = Number.NEGATIVE_INFINITY;

  constructor(
    private readonly name: string,
    points: number,
    unknownPoints: number,
    durationS: number,
    private readonly logger: NetLogger,
    private readonly now: () => number = Date.now,
  ) {
    this.known = new RateLimiterMemory({ points, duration: durationS });
    this.unknown = new RateLimiterMemory({ points: unknownPoints, duration: durationS });
  }

  /** Consumes one point. Resolves false when the key is over its limit. Never rejects. */
  async consume(ip: string): Promise<boolean> {
    const isUnknown = ip === UNKNOWN_CLIENT_IP;
    if (isUnknown) {
      const t = this.now();
      if (t - this.lastUnknownLogAt >= UNKNOWN_LOG_INTERVAL_MS) {
        this.lastUnknownLogAt = t;
        this.logger.warn({ limiter: this.name }, "client ip header missing: using the shared unknown bucket");
      }
    }
    try {
      await (isUnknown ? this.unknown : this.known).consume(ip);
      return true;
    } catch {
      return false;
    }
  }
}

export type AdmissionResult =
  { readonly ok: true; readonly seat: SeatReservation } | { readonly ok: false; readonly response: HttpResponse };

interface PendingSocket {
  readonly ip: string;
  timer: ReturnType<typeof setTimeout> | undefined;
}

export class Admission {
  readonly maxRooms: number;
  readonly maxClients: number;
  readonly maxSocketsPerIp: number;
  /** Refusals by reason (tests, ops). */
  readonly refused = { rooms: 0, clients: 0, createRate: 0, sockets: 0 };

  private queue: Promise<unknown> = Promise.resolve();
  private readonly creates: IpRateLimiter;
  private readonly sockets = new Map<string, number>();
  private readonly pending = new WeakMap<object, PendingSocket>();

  constructor(
    limits: AdmissionLimits,
    private readonly logger: NetLogger,
  ) {
    this.maxRooms = limits.maxRooms;
    this.maxClients = limits.maxClients;
    this.maxSocketsPerIp = limits.maxSocketsPerIp ?? MAX_SOCKETS_PER_IP;
    const createsPerMin = limits.roomCreatesPerIpPerMin ?? ROOM_CREATES_PER_IP_PER_MIN;
    this.creates = new IpRateLimiter(
      "room_create",
      createsPerMin,
      Math.min(createsPerMin, ROOM_CREATES_UNKNOWN_PER_MIN),
      60,
      logger,
    );
  }

  /** Reserves a seat in `roomName` (joining a room with a free seat, else creating one) within the limits. */
  reserve(roomName: string, options: Record<string, unknown>, ip: string): Promise<AdmissionResult> {
    const run = this.queue.then(() => this.reserveNow(roomName, options, ip));
    this.queue = run.catch(() => undefined);
    return run;
  }

  /** Open sockets currently counted for `ip` (tests, ops). */
  socketsOf(ip: string): number {
    return this.sockets.get(ip) ?? 0;
  }

  /**
   * Upgrade admission: claims a socket slot for `ip`, keyed by the upgrade's context object. Returns false (refuse
   * with 429) above the per-IP cap. The slot is released by `socketClosed`, or after PENDING_UPGRADE_MS when the
   * upgrade never opened.
   */
  claimSocket(context: object, ip: string): boolean {
    const cap = ip === UNKNOWN_CLIENT_IP ? Math.min(this.maxSocketsPerIp, MAX_SOCKETS_UNKNOWN) : this.maxSocketsPerIp;
    const open = this.sockets.get(ip) ?? 0;
    if (open >= cap) {
      this.refused.sockets++;
      this.logger.info({ ip: ip === UNKNOWN_CLIENT_IP ? ip : "[ip]", open }, "websocket upgrade refused: per-ip cap");
      return false;
    }
    this.sockets.set(ip, open + 1);
    const entry: PendingSocket = { ip, timer: undefined };
    entry.timer = setTimeout(() => {
      entry.timer = undefined;
      this.pending.delete(context);
      this.release(ip);
    }, PENDING_UPGRADE_MS);
    entry.timer.unref?.();
    this.pending.set(context, entry);
    return true;
  }

  /** The upgrade with this context opened: the slot now lives until `socketClosed`. Returns the claim's ip. */
  socketOpened(context: object): string | undefined {
    const entry = this.pending.get(context);
    if (entry === undefined) return undefined;
    if (entry.timer !== undefined) clearTimeout(entry.timer);
    entry.timer = undefined;
    return entry.ip;
  }

  /** Releases the slot of an opened socket. */
  socketClosed(context: object): void {
    const entry = this.pending.get(context);
    if (entry === undefined) return;
    this.pending.delete(context);
    if (entry.timer !== undefined) clearTimeout(entry.timer);
    this.release(entry.ip);
  }

  private release(ip: string): void {
    const open = (this.sockets.get(ip) ?? 0) - 1;
    if (open <= 0) this.sockets.delete(ip);
    else this.sockets.set(ip, open);
  }

  private async reserveNow(roomName: string, options: Record<string, unknown>, ip: string): Promise<AdmissionResult> {
    if (matchMaker.state === matchMaker.MatchMakerState.SHUTTING_DOWN) {
      return { ok: false, response: { status: 503, body: { error: "RETRY_LATER" } } };
    }
    try {
      const rooms = await matchMaker.query({});
      let seats = 0;
      for (const room of rooms) seats += room.clients;
      if (seats >= this.maxClients) return this.atCapacity("clients");
      const available = await matchMaker.findOneRoomAvailable(roomName, options);
      if (available === undefined || available === null) {
        if (matchMaker.stats.local.roomCount >= this.maxRooms) return this.atCapacity("rooms");
        if (!(await this.creates.consume(ip))) {
          this.refused.createRate++;
          return { ok: false, response: { status: 429, body: { error: "RATE_LIMITED", message: "room creation" } } };
        }
      }
      const seat = await matchMaker.joinOrCreate(roomName, options);
      return { ok: true, seat };
    } catch (error) {
      this.logger.warn({ err: error, room: roomName }, "seat reservation failed");
      return { ok: false, response: { status: 503, body: { error: "RETRY_LATER" } } };
    }
  }

  private atCapacity(reason: "rooms" | "clients"): AdmissionResult {
    this.refused[reason]++;
    this.logger.warn({ reason, maxRooms: this.maxRooms, maxClients: this.maxClients }, "join refused: at capacity");
    return {
      ok: false,
      response: {
        status: 503,
        headers: { "retry-after": String(AT_CAPACITY_RETRY_AFTER_S) },
        body: { error: "AT_CAPACITY", message: `at_capacity:${reason}` },
      },
    };
  }
}
