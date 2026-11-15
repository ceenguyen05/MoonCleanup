// `POST /v0/spike/join` - REST seat reservation for LoadTestRoom (NET_SPIKE=1 only; same REST-only flow as HelloRoom,
// ADR-0025). Body: JoinOptions ({ protocolVersion, clientBuild }) plus the bounded spike options
// ({ tickHz: 20 | 30, snapshotHz: 10 | 15 | 20 | 30 (divides tickHz), bodies?: 1-64, robots?: 0-64 }). Rooms are
// filtered by those options, so clients asking for the same rates share a room (up to MAX_PLAYERS_PER_ROOM).
// Reservations go through the same Admission as HelloRoom (MAX_ROOMS / MAX_CLIENTS / per-IP room creation).

import { JoinOptionsSchema, type HttpResponse, type HttpRouteDef } from "@moon-cleanup/shared";
import { IpRateLimiter, retryAfterHeader, type Admission } from "../admission";
import type { NetLogger } from "../http-routes";
import { LOAD_TEST_ROOM_NAME } from "./load-test-room";
import { SpikeRoomOptionsSchema } from "./options";

export const SPIKE_JOIN_PATH = "/v0/spike/join";

/** Joins per client IP per minute (security.md section 5; bots run from one IP, so a bit above the 30 of hello). */
export const SPIKE_JOINS_PER_IP_PER_MIN = 60;
/** Joins per minute for the shared `unknown` bucket (tighter, logged; review N2). */
export const SPIKE_JOINS_UNKNOWN_PER_MIN = 10;

export interface SpikeJoinResponse {
  readonly reservation: {
    readonly name: string;
    readonly sessionId: string;
    readonly roomId: string;
    readonly processId: string;
  };
}

export function createSpikeJoinRoute(logger: NetLogger, admission: Admission): HttpRouteDef {
  const limiter = new IpRateLimiter("spike_join", SPIKE_JOINS_PER_IP_PER_MIN, SPIKE_JOINS_UNKNOWN_PER_MIN, 60, logger);
  return {
    method: "POST",
    path: SPIKE_JOIN_PATH,
    async handle(request): Promise<HttpResponse> {
      const wait = await limiter.check(request.remoteAddress);
      if (wait > 0) return { status: 429, headers: retryAfterHeader(wait), body: { error: "RATE_LIMITED" } };
      const join = JoinOptionsSchema.safeParse(request.body);
      const spike = SpikeRoomOptionsSchema.safeParse(request.body ?? {});
      if (!join.success || !spike.success) {
        return { status: 400, body: { error: "BAD_REQUEST", message: "invalid join or spike options" } };
      }
      const result = await admission.reserve(
        LOAD_TEST_ROOM_NAME,
        { ...join.data, ...spike.data },
        request.remoteAddress,
        // Load-test bots all come from one IP (NET_SPIKE only; refused in production): no per-IP seat cap.
        { exemptSeatCap: true },
      );
      if (!result.ok) return result.response;
      const seat = result.seat;
      const body: SpikeJoinResponse = {
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
