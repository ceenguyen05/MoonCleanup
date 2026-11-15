// `POST /v0/hello/join` - the M0 REST seat reservation for HelloRoom (ADR-0025 REST-only join flow).
//
// Public matchmake methods are disabled (`matchMaker.controller.exposedMethods = []`), so the server reserves the
// seat itself through `Admission` (MAX_ROOMS / MAX_CLIENTS / per-IP room creation, ./admission) and the client calls
// `consumeSeatReservation`. The M1 `shift` room replaces this route with `POST /v1/contracts/:id/join` (Bearer,
// membership, lease; netcode.md section 9.3).
//
// The body is validated with JoinOptionsSchema; the protocol-version EQUALITY check stays in the room so the
// client sees the specified close code 4100 (netcode.md section 13).

import { JoinOptionsSchema, type HttpRouteDef, type HttpResponse } from "@moon-cleanup/shared";
import { IpRateLimiter, retryAfterHeader, type Admission } from "./admission";
import { HELLO_ROOM_NAME } from "./hello-room";
import type { NetLogger } from "./http-routes";

export const HELLO_JOIN_PATH = "/v0/hello/join";

/** Room joins per client IP per minute (security.md section 5). */
export const ROOM_JOINS_PER_IP_PER_MIN = 30;
/** Room joins per minute for the shared `unknown` bucket (missing edge header; tighter, logged; review N2). */
export const ROOM_JOINS_UNKNOWN_PER_MIN = 10;

/** What the route returns on success: a Colyseus seat reservation for `consumeSeatReservation`. */
export interface HelloJoinResponse {
  readonly reservation: {
    readonly name: string;
    readonly sessionId: string;
    readonly roomId: string;
    readonly processId: string;
  };
}

export function createHelloJoinRoute(logger: NetLogger, admission: Admission): HttpRouteDef {
  const limiter = new IpRateLimiter("hello_join", ROOM_JOINS_PER_IP_PER_MIN, ROOM_JOINS_UNKNOWN_PER_MIN, 60, logger);

  return {
    method: "POST",
    path: HELLO_JOIN_PATH,
    async handle(request): Promise<HttpResponse> {
      const wait = await limiter.check(request.remoteAddress);
      if (wait > 0) return { status: 429, headers: retryAfterHeader(wait), body: { error: "RATE_LIMITED" } };
      const parsed = JoinOptionsSchema.safeParse(request.body);
      if (!parsed.success) return { status: 400, body: { error: "BAD_REQUEST", message: "invalid join options" } };
      const result = await admission.reserve(HELLO_ROOM_NAME, parsed.data, request.remoteAddress);
      if (!result.ok) return result.response;
      const seat = result.seat;
      const body: HelloJoinResponse = {
        reservation: {
          name: seat.name,
          sessionId: seat.sessionId,
          roomId: seat.roomId,
          processId: seat.processId ?? "",
        },
      };
      return { status: 200, body };
    },
  };
}
