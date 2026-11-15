// Shift seat reservation (netcode.md section 9.3, security.md section 3): the REST face of ShiftRoom.
//
// `POST /v1/contracts/:id/join` (Bearer JWT, never in a URL): verify the JWT (injected `verifyToken`), check
// membership through the injected `ShiftMembership` (owned by the api/db layer), reserve a seat in the Contract's
// single room through `Admission` (MAX_ROOMS / MAX_CLIENTS / per-IP seat cap / room-creation rate; rooms are filtered
// by `contractId`, so every join of one Contract lands in the same room), then issue the single-use join ticket bound
// to (playerId, roomId, sessionId) and kept server-side for onAuth. The client connects with `consumeSeatReservation`
// and sends NO auth token (the Colyseus SDK would put it in the `_authToken` URL query; security.md section 3 allows
// only the reservation id in the URL). Tokens and tickets are never logged.
//
// Not here (gaps, see the M1-W4-T02 report): the DB lease compare-and-set, `CONTRACT_BUSY`, and save loading.

import { JoinOptionsSchema, type HttpResponse, type HttpRouteDef } from "@moon-cleanup/shared";
import type { ContractRole, ShiftType } from "@moon-cleanup/shared";
import { IpRateLimiter, retryAfterHeader, type Admission } from "../admission";
import type { NetLogger } from "../http-routes";
import { ROOM_JOINS_PER_IP_PER_MIN, ROOM_JOINS_UNKNOWN_PER_MIN } from "../hello-join-route";
import type { JoinTickets } from "./join-ticket";
import { SHIFT_ROOM_NAME, type ShiftReservedOptions } from "./shift-room";

export const SHIFT_JOIN_PATH = "/v1/contracts/:id/join";

/** What the api layer answers for a (player, contract) pair; `null` = not a member, banned or unknown Contract. */
export interface ShiftMember {
  readonly role: ContractRole;
  readonly displayName: string;
  readonly shiftType: ShiftType;
}
export type ShiftMembership = (playerId: string, contractId: string) => Promise<ShiftMember | null>;
export type ShiftVerifyToken = (token: string) => Promise<{ readonly playerId: string } | null>;

export interface ShiftJoinDeps {
  readonly admission: Admission;
  readonly tickets: JoinTickets;
  readonly verifyToken: ShiftVerifyToken;
  readonly membership: ShiftMembership;
  readonly logger: NetLogger;
  /** Durable dust store: its lease is taken before a room is created (409 CONTRACT_BUSY, 503 when storage is down). */
  readonly leases?: { ensureLease(contractId: string): Promise<void> };
}

const CONTRACT_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Reserves a seat for an already authenticated member. Shared by the route and tests. */
export async function reserveShiftSeat(
  deps: Pick<ShiftJoinDeps, "admission" | "tickets">,
  contractId: string,
  playerId: string,
  member: ShiftMember,
  join: { readonly protocolVersion: number; readonly clientBuild: string },
  ip: string,
): Promise<HttpResponse> {
  const options: ShiftReservedOptions = {
    protocolVersion: join.protocolVersion,
    clientBuild: join.clientBuild,
    contractId,
    shiftType: member.shiftType,
    playerId,
    displayName: member.displayName,
    role: member.role,
  };
  const result = await deps.admission.reserve(SHIFT_ROOM_NAME, options, ip);
  if (!result.ok) return result.response;
  const seat = result.seat;
  // Kept server-side for onAuth (never sent back over the WebSocket URL, see ./join-ticket).
  // The response (REST contract v0.5.0 `JoinContractResponse`) no longer carries it.
  const joinTicket = deps.tickets.grant({ playerId, roomId: seat.roomId, sessionId: seat.sessionId });
  if (joinTicket === null) return { status: 503, headers: retryAfterHeader(5), body: { error: "RETRY_LATER" } };
  return {
    status: 200,
    body: {
      reservation: {
        name: seat.name,
        sessionId: seat.sessionId,
        roomId: seat.roomId,
        processId: seat.processId ?? "local",
      },
      role: member.role,
    },
  };
}

export function createShiftJoinRoute(deps: ShiftJoinDeps): HttpRouteDef {
  const limiter = new IpRateLimiter(
    "shift_join",
    ROOM_JOINS_PER_IP_PER_MIN,
    ROOM_JOINS_UNKNOWN_PER_MIN,
    60,
    deps.logger,
  );
  return {
    method: "POST",
    path: SHIFT_JOIN_PATH,
    async handle(request): Promise<HttpResponse> {
      const wait = await limiter.check(request.remoteAddress);
      if (wait > 0) return { status: 429, headers: retryAfterHeader(wait), body: { error: "RATE_LIMITED" } };
      const auth = request.headers["authorization"] ?? "";
      const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
      const verified = token.length > 0 && token.length <= 4096 ? await deps.verifyToken(token) : null;
      if (verified === null) return { status: 401, body: { error: "UNAUTHORIZED" } };
      const contractId = request.params["id"] ?? "";
      if (!CONTRACT_ID_RE.test(contractId)) return { status: 404, body: { error: "NOT_FOUND" } };
      const parsed = JoinOptionsSchema.safeParse(request.body);
      if (!parsed.success) return { status: 400, body: { error: "BAD_REQUEST", message: "invalid join options" } };
      let member: ShiftMember | null;
      try {
        member = await deps.membership(verified.playerId, contractId.toLowerCase());
      } catch {
        return { status: 503, body: { error: "RETRY_LATER" } };
      }
      if (member === null) return { status: 403, body: { error: "FORBIDDEN" } };
      if (deps.leases !== undefined) {
        try {
          await deps.leases.ensureLease(contractId.toLowerCase());
        } catch (error) {
          const busy = typeof error === "object" && error !== null && (error as { reason?: unknown }).reason === "busy";
          return busy
            ? { status: 409, headers: retryAfterHeader(5), body: { error: "CONTRACT_BUSY" } }
            : { status: 503, headers: retryAfterHeader(5), body: { error: "RETRY_LATER" } };
        }
      }
      return reserveShiftSeat(
        deps,
        contractId.toLowerCase(),
        verified.playerId,
        member,
        parsed.data,
        request.remoteAddress,
      );
    },
  };
}
