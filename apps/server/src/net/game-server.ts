// Server factory: Colyseus 0.18 rooms and the REST routes in one Node process on uWebSockets.js, or on Colyseus'
// built-in `ws` transport when uWebSockets.js cannot load (env TRANSPORT, ./transport).
//
// - HTTP: `HttpRouteDef[]` mounted by the transport adapter (uWS handlers or a Node request handler; both run the
//   same pipeline in ./http-routes, see there for why not Colyseus' router).
// - CORS / WS origin: exact allowlist (./cors); upgrades without an allowed Origin get 403 before the socket opens.
// - Matchmaking: public matchmake methods disabled (`exposedMethods = []`, ADR-0025); seats are reserved by REST.
// - Colyseus' own SIGINT/SIGTERM/uncaughtException hooks are off: the composition root owns the process lifecycle
//   and calls `gracefullyShutdown()` (netcode.md section 9.3 drain sequence lands with the shift room).
//
// One GameServer per process: Colyseus' matchmaker is a process-wide singleton.

import { Server, matchMaker, type BeforeUpgradeHandler } from "@colyseus/core";
import type { HttpRouteDef } from "@moon-cleanup/shared";
import { Admission, SOCKET_CAP_RETRY_AFTER_S, retryAfterHeader, type AdmissionLimits } from "./admission";
import { DEFAULT_CLIENT_IP_HEADER, resolveUpgradeClientIp } from "./client-ip";
import { createOriginPolicy, type OriginPolicy } from "./cors";
import { createHelloJoinRoute } from "./hello-join-route";
import { HELLO_ROOM_NAME, HelloRoom, assertRates, type HelloRoomOptions } from "./hello-room";
import type { NetLogger, RawBodyAuth } from "./http-routes";
import type { IdleLimits } from "./idle-watch";
import type { GameData } from "@moon-cleanup/game-data";
import type { SimWorld } from "@moon-cleanup/sim";
import { createSpikeJoinRoute, defineLoadTestRoom, type SpikeStatsSink } from "./spike";
import {
  JoinTickets,
  createShiftJoinRoute,
  defineShiftRoom,
  type ShiftDustStore,
  type ShiftMembership,
  type ShiftVerifyToken,
} from "./shift";
import {
  DEFAULT_TRANSPORT_MODE,
  selectTransport,
  type TransportKind,
  type TransportLoaders,
  type TransportMode,
} from "./transport";
import { checkUpgradeHeaders, refusalHeaders } from "./upgrade-handshake";

export { WS_MAX_BACKPRESSURE_BYTES, WS_MAX_PAYLOAD_BYTES } from "./limits";

/** Default admission limits (environments.md: MAX_ROOMS 3, MAX_CLIENTS 12). */
export const DEFAULT_ADMISSION: AdmissionLimits = { maxRooms: 3, maxClients: 12 };

export interface GameServerRates {
  /** SIM_TICK_HZ from the validated env. */
  readonly simTickHz: number;
  /** SNAPSHOT_HZ from the validated env; must divide simTickHz. */
  readonly snapshotHz: number;
}

export interface CreateGameServerOptions {
  /** TCP port; 0 picks a free port (tests). */
  readonly port: number;
  /** REST routes (health, readiness, later /v1/...). */
  readonly routes: readonly HttpRouteDef[];
  /** Exact allowed origins (ALLOWED_ORIGINS). */
  readonly allowedOrigins: readonly string[];
  readonly logger: NetLogger;
  readonly rates: GameServerRates;
  /** BUILD_VERSION, reported in HELLO and the 4100 mismatch info. */
  readonly serverBuild: string;
  /**
   * Header carrying the client address at the edge (security.md section 5). Default `true-client-ip`. `null` = socket
   * mode: the TCP peer address, no header trusted (env validation allows it only for ENV_NAME=local).
   */
  readonly clientIpHeader?: string | null;
  /** MAX_ROOMS / MAX_CLIENTS and the per-IP caps (./admission). Default DEFAULT_ADMISSION. */
  readonly admission?: AdmissionLimits;
  /** Register HelloRoom and `POST /v0/hello/join` (M0 connectivity). Default true. */
  readonly helloRoom?: boolean;
  /** Handshake/silence limits for HelloRoom seats (./idle-watch); default 10 s / 120 s. */
  readonly helloIdle?: Partial<IdleLimits>;
  /**
   * M0 netcode spike (M0-W2-T03): registers LoadTestRoom and `POST /v0/spike/join` only when `enabled` is true.
   * The composition root passes `{ enabled: env.netSpike, stats }` (NET_SPIKE, default 0; refused in production).
   */
  readonly loadTest?: { readonly enabled: boolean; readonly stats: SpikeStatsSink };
  /**
   * M1 ShiftRoom (`shift`, ./shift). Registered when given; the join route `POST /v1/contracts/:id/join` is mounted
   * only when `membership` is provided (the api layer owns membership/ban checks). Default: not registered.
   */
  readonly shift?: ShiftServerOptions;
  /**
   * Bearer verifier for raw-body REST routes (solo checkpoint upload), resolving the account key or `null`. Run before
   * an upload slot is taken (security review M1). Absent: prefix check only, slots keyed by address.
   */
  readonly rawBodyAuth?: RawBodyAuth;
  /** TRANSPORT (./transport): `auto` (default) tries uWebSockets.js and falls back to `ws`. */
  readonly transport?: TransportMode;
  /** Adapter loaders (tests inject a failing uWS loader). Default: dynamic imports. */
  readonly transportLoaders?: TransportLoaders;
}

/** What the composition root hands the shift room (see CreateGameServerOptions.shift). */
export interface ShiftServerOptions {
  readonly data: GameData;
  readonly world: SimWorld;
  /** Account access-token verifier (api `verifyToken`); used by the REST join route only. */
  readonly verifyToken: ShiftVerifyToken;
  readonly membership?: ShiftMembership;
  readonly stats?: SpikeStatsSink;
  readonly idle?: Partial<IdleLimits>;
  readonly seatHoldS?: number;
  /** Ticket store (tests inject one to mint tickets); default a fresh per-process store. */
  readonly tickets?: JoinTickets;
  /** Room dust persistence (restore on create, save every 30 s when dirty and on dispose). Absent: not kept. */
  readonly dustStore?: ShiftDustStore;
}

export interface GameServer {
  /** Binds the port. Rejects when the port cannot be bound. Resolves with the bound port. */
  listen(): Promise<number>;
  /** The bound port (after `listen`), else the requested one. */
  readonly port: number;
  readonly policy: OriginPolicy;
  /** The transport actually serving (`uws`, or `ws` after a fallback / TRANSPORT=ws). */
  readonly transport: TransportKind;
  /** The underlying Colyseus server (room definitions for later rooms). */
  readonly colyseus: Server;
  /** Join and socket admission (limits, refusal counters). */
  readonly admission: Admission;
  /**
   * Locks and disposes every room (clients get close 4001 SERVER_SHUTDOWN), closes the listen socket. Never exits
   * the process; the composition root decides the exit code. Idempotent.
   */
  gracefullyShutdown(): Promise<void>;
}

/** Applies our CORS policy to the Colyseus matchmake controller (its defaults allow credentials and any origin). */
function hardenMatchmaker(policy: OriginPolicy): void {
  const controller = matchMaker.controller;
  controller.exposedMethods = [];
  controller.standardHttpStatus = true;
  controller.DEFAULT_CORS_HEADERS = {} as typeof controller.DEFAULT_CORS_HEADERS;
  controller.getCorsHeaders = (headers: Headers) => policy.responseHeaders(headers.get("origin"));
}

/**
 * Builds the server: selects and constructs the transport (async: the adapters are loaded lazily), mounts the REST
 * routes, defines the rooms. Rejects when TRANSPORT=uws (or ws) cannot be loaded; `auto` falls back to ws.
 */
export async function createGameServer(options: CreateGameServerOptions): Promise<GameServer> {
  assertRates(options.rates.simTickHz, options.rates.snapshotHz);
  const policy = createOriginPolicy(options.allowedOrigins);
  const logger = options.logger;
  hardenMatchmaker(policy);

  const clientIpHeader =
    options.clientIpHeader === null ? null : (options.clientIpHeader ?? DEFAULT_CLIENT_IP_HEADER).toLowerCase();
  const admission = new Admission(options.admission ?? DEFAULT_ADMISSION, logger);

  const beforeUpgrade: BeforeUpgradeHandler = (request, context) => {
    const origin = request.headers.get("origin");
    if (!policy.isAllowed(origin)) {
      logger.info({ origin: origin ?? null }, "websocket upgrade refused: origin not allowed");
      return new Response(null, { status: 403 });
    }
    // Handshake shape BEFORE the slot claim (review NB2): a handshake the transport would refuse never opens, so a
    // claimed slot would sit until the 10 s pending timer. AuthContext headers: see ./upgrade-handshake.
    const refusal = checkUpgradeHeaders((name) => context.headers.get(name));
    if (refusal !== null) {
      logger.debug({ reason: refusal.reason }, "websocket upgrade refused: malformed handshake");
      return new Response(null, { status: refusal.status, headers: refusalHeaders(refusal) });
    }
    const ip = resolveUpgradeClientIp((name) => request.headers.get(name), clientIpHeader, context.ip);
    if (!admission.claimSocket(context, ip)) {
      return new Response(null, { status: 429, headers: retryAfterHeader(SOCKET_CAP_RETRY_AFTER_S) });
    }
    return undefined;
  };

  const routes: HttpRouteDef[] = [...options.routes];
  if (options.helloRoom !== false) routes.push(createHelloJoinRoute(logger, admission));
  const loadTest = options.loadTest?.enabled === true ? options.loadTest : undefined;
  if (loadTest !== undefined) routes.push(createSpikeJoinRoute(logger, admission));
  const shift = options.shift;
  const tickets = shift === undefined ? undefined : (shift.tickets ?? new JoinTickets());
  if (shift?.membership !== undefined && tickets !== undefined) {
    routes.push(
      createShiftJoinRoute({
        admission,
        tickets,
        verifyToken: shift.verifyToken,
        membership: shift.membership,
        logger,
        ...(shift.dustStore?.ensureLease === undefined
          ? {}
          : { leases: { ensureLease: (id) => shift.dustStore!.ensureLease!(id) } }),
      }),
    );
  }

  const bound = await selectTransport(
    options.transport ?? DEFAULT_TRANSPORT_MODE,
    {
      routes,
      policy,
      clientIpHeader,
      logger,
      admission,
      beforeUpgrade,
      ...(options.rawBodyAuth === undefined ? {} : { rawBodyAuth: options.rawBodyAuth }),
    },
    options.transportLoaders,
  );

  const colyseus = new Server({ transport: bound.transport, greet: false, gracefullyShutdown: false, logger });
  if (options.helloRoom !== false) {
    const helloOptions: HelloRoomOptions = {
      ...options.rates,
      serverBuild: options.serverBuild,
      ...(options.helloIdle === undefined ? {} : { idle: options.helloIdle }),
    };
    colyseus.define(HELLO_ROOM_NAME, HelloRoom, helloOptions);
  }
  if (loadTest !== undefined) {
    defineLoadTestRoom(colyseus, { stats: loadTest.stats, serverBuild: options.serverBuild });
    logger.info({ room: "load_test" }, "NET_SPIKE=1: LoadTestRoom registered");
  }

  if (shift !== undefined && tickets !== undefined) {
    defineShiftRoom(colyseus, {
      data: shift.data,
      world: shift.world,
      simTickHz: options.rates.simTickHz,
      snapshotHz: options.rates.snapshotHz,
      serverBuild: options.serverBuild,
      tickets,
      ...(shift.stats === undefined ? {} : { stats: shift.stats }),
      ...(shift.idle === undefined ? {} : { idle: shift.idle }),
      ...(shift.seatHoldS === undefined ? {} : { seatHoldS: shift.seatHoldS }),
      ...(shift.dustStore === undefined ? {} : { dustStore: shift.dustStore }),
      logger,
    });
  }

  let boundPort = options.port;
  let shutdown: Promise<void> | undefined;

  return {
    get port() {
      return boundPort;
    },
    transport: bound.kind,
    policy,
    colyseus,
    admission,
    async listen() {
      boundPort = await bound.listen(() => colyseus.listen(options.port), options.port);
      logger.info({ port: boundPort, transport: bound.kind }, "game server listening");
      return boundPort;
    },
    gracefullyShutdown() {
      shutdown ??= colyseus.gracefullyShutdown(false);
      return shutdown;
    },
  };
}
