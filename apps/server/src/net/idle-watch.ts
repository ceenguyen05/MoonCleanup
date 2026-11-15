// Handshake and silence watch for room seats (security review NB1).
//
// Transport pings keep a silent socket alive forever, so a seat could be held by a connection that never speaks.
// The watch closes such a seat with 4107 IDLE_TIMEOUT:
// - handshake: no valid app message within HANDSHAKE_TIMEOUT_MS of the join (the client sends its first PING on join);
// - silence: no valid app message for SILENCE_TIMEOUT_MS afterwards. Generous on purpose: a background tab's timers
//   can be throttled to about one per minute, and a tab that is merely hidden must not lose its seat.
// Rooms call `add` on join, `touch` for every VALID app message, `remove` on leave and `sweep` about once a second.
// No timers of its own and no per-sweep allocation. The AFK/input-idle rule of the shift room (netcode.md section 10)
// is separate.

import { CloseCode } from "@moon-cleanup/shared";

/** First valid app message must arrive within this long of the join. */
export const HANDSHAKE_TIMEOUT_MS = 10_000;
/** Longest silence tolerated after the first message. */
export const SILENCE_TIMEOUT_MS = 120_000;

export interface IdleLimits {
  readonly handshakeMs: number;
  readonly silenceMs: number;
}

export const DEFAULT_IDLE_LIMITS: IdleLimits = { handshakeMs: HANDSHAKE_TIMEOUT_MS, silenceMs: SILENCE_TIMEOUT_MS };

/** The part of a Colyseus client the watch needs. */
export interface IdleClient {
  readonly sessionId: string;
  leave(code?: number, data?: string): void;
}

interface Entry {
  readonly client: IdleClient;
  lastActivityAt: number;
  talked: boolean;
}

export class IdleWatch {
  /** Seats closed for idling (tests, ops counters). */
  closed = 0;
  private readonly entries = new Map<string, Entry>();
  private readonly limits: IdleLimits;

  constructor(limits: Partial<IdleLimits> = {}) {
    this.limits = { ...DEFAULT_IDLE_LIMITS, ...limits };
  }

  get size(): number {
    return this.entries.size;
  }

  add(client: IdleClient, now: number): void {
    this.entries.set(client.sessionId, { client, lastActivityAt: now, talked: false });
  }

  /** A valid app message arrived. */
  touch(sessionId: string, now: number): void {
    const entry = this.entries.get(sessionId);
    if (entry === undefined) return;
    entry.lastActivityAt = now;
    entry.talked = true;
  }

  remove(sessionId: string): void {
    this.entries.delete(sessionId);
  }

  /** Closes every seat past its limit with 4107. Returns how many were closed. */
  sweep(now: number): number {
    let closed = 0;
    for (const [sessionId, entry] of this.entries) {
      const limit = entry.talked ? this.limits.silenceMs : this.limits.handshakeMs;
      if (now - entry.lastActivityAt < limit) continue;
      this.entries.delete(sessionId);
      closed++;
      try {
        entry.client.leave(CloseCode.IDLE_TIMEOUT);
      } catch {
        // A client already gone: nothing to close.
      }
    }
    this.closed += closed;
    return closed;
  }
}
