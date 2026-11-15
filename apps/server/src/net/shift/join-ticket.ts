// Single-use join tickets (security.md section 3): HMAC-SHA256 over playerId, roomId, sessionId and expiry, valid for
// JOIN_TICKET_TTL_S. Issued by the shift join route next to the seat reservation and verified in ShiftRoom.onAuth.
// The key is random per process: a ticket only has to survive the 30 s between REST join and the WebSocket join on
// the same instance, so no env secret is needed and a restart invalidates every outstanding ticket.
//
// Tickets are never logged. Verification is constant-time on the MAC and consumes the ticket (replay -> rejected).
//
// Transport (security.md section 3: "the WebSocket URL carries only Colyseus' single-use seat reservation id"): the
// Colyseus SDK would put an auth token in the `_authToken` URL query, so the ticket is NOT sent by the client. `grant`
// keeps the issued ticket server-side keyed by the reserved sessionId; `ShiftRoom.onAuth` redeems it with
// `redeemSession` (same MAC / expiry / single-use checks). Any client-supplied `_authToken` is ignored, never logged.

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { JOIN_TICKET_TTL_S } from "@moon-cleanup/shared";

/** Upper bound on a ticket string we even look at (untrusted input). */
export const JOIN_TICKET_MAX_LENGTH = 512;
/** Outstanding tickets kept for replay detection (pruned by expiry; a hard cap bounds memory under abuse). */
const USED_MAX = 4096;
/** Unredeemed server-side grants kept at most (pruned by expiry; fail closed beyond). */
const PENDING_MAX = 4096;

export interface TicketClaims {
  readonly playerId: string;
  readonly roomId: string;
  readonly sessionId: string;
}

export class JoinTickets {
  private readonly key: Buffer;
  /** Consumed ticket MACs -> expiry ms. */
  private readonly used = new Map<string, number>();
  /** Server-side grants: reserved sessionId -> ticket + expiry (see the file header). */
  private readonly pending = new Map<string, { readonly ticket: string; readonly exp: number }>();

  constructor(
    private readonly now: () => number = Date.now,
    key?: Buffer,
    private readonly ttlMs: number = JOIN_TICKET_TTL_S * 1000,
  ) {
    this.key = key ?? randomBytes(32);
  }

  issue(claims: TicketClaims): string {
    const exp = this.now() + this.ttlMs;
    const body = Buffer.from(`${claims.playerId}|${claims.roomId}|${claims.sessionId}|${exp}`, "utf8").toString(
      "base64url",
    );
    return `${body}.${this.mac(body)}`;
  }

  /**
   * Issues a ticket AND keeps it server-side for `redeemSession` (the client never has to send it). Returns the ticket
   * (the REST response no longer carries it, JoinContractResponseSchema v0.5.0), or `null` when the pending store is full of
   * unexpired grants (fail closed; the route answers 503).
   */
  grant(claims: TicketClaims): string | null {
    const now = this.now();
    if (this.pending.size >= PENDING_MAX) {
      for (const [sessionId, g] of this.pending) if (g.exp < now) this.pending.delete(sessionId);
      if (this.pending.size >= PENDING_MAX) return null;
    }
    const ticket = this.issue(claims);
    this.pending.set(claims.sessionId, { ticket, exp: now + this.ttlMs });
    return ticket;
  }

  /** Redeems the server-side grant of `claims.sessionId` (single use, unexpired, bound to exactly these claims). */
  redeemSession(claims: TicketClaims): boolean {
    const grant = this.pending.get(claims.sessionId);
    if (grant === undefined) return false;
    this.pending.delete(claims.sessionId);
    return this.consume(grant.ticket, claims);
  }

  /** Outstanding (unredeemed) grants; tests and ops. */
  get pendingGrants(): number {
    return this.pending.size;
  }

  /** True when the ticket is authentic, unexpired, unused and bound to exactly these claims. Consumes it. */
  consume(ticket: unknown, claims: TicketClaims): boolean {
    if (typeof ticket !== "string" || ticket.length === 0 || ticket.length > JOIN_TICKET_MAX_LENGTH) return false;
    const dot = ticket.indexOf(".");
    if (dot <= 0) return false;
    const body = ticket.slice(0, dot);
    const mac = ticket.slice(dot + 1);
    const expected = this.mac(body);
    const a = Buffer.from(mac, "utf8");
    const b = Buffer.from(expected, "utf8");
    if (a.length !== b.length || !timingSafeEqual(a, b)) return false;
    const parts = Buffer.from(body, "base64url").toString("utf8").split("|");
    if (parts.length !== 4) return false;
    const exp = Number(parts[3]);
    const now = this.now();
    if (!Number.isFinite(exp) || exp < now) return false;
    if (parts[0] !== claims.playerId || parts[1] !== claims.roomId || parts[2] !== claims.sessionId) return false;
    this.prune(now);
    if (this.used.has(expected)) return false;
    if (this.used.size >= USED_MAX) return false; // fail closed under abuse
    this.used.set(expected, exp);
    return true;
  }

  private mac(body: string): string {
    return createHmac("sha256", this.key).update(body).digest("base64url");
  }

  private prune(now: number): void {
    for (const [mac, exp] of this.used) if (exp < now) this.used.delete(mac);
  }
}
