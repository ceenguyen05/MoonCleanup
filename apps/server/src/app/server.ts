// Server composition root (M0-W1-T06). Boot order: env -> logger -> stats -> db (lazy) -> health routes -> game
// server -> listen. `/healthz` is served as soon as the port is bound, before any room exists. The process
// lifecycle (signals, exit codes) lives in ./index.ts and ./shutdown.ts; this module only builds and starts the parts
// and returns a handle, so tests can boot it on port 0 with an injected environment.

import { matchMaker } from "@colyseus/core";
import {
  createDbConnection,
  createMoonRepository,
  createPostgresRoomRepository,
  errorCodeForLog,
  type DbConnection,
  type MoonRepository,
  type PgDb,
} from "@moon-cleanup/db";
import { loadGameData } from "@moon-cleanup/game-data";
import { STANDARD_GRID_PARAMS } from "@moon-cleanup/shared";
import type { SimWorld } from "@moon-cleanup/sim";
import { createPlotGrid } from "@moon-cleanup/world";
import { createAccountApi, createHealthRoutes, type VerifyToken } from "../api";
import { randomUUID } from "node:crypto";
import {
  DurableShiftDustStore,
  MemoryRoomSaveRepository,
  SHUTDOWN_CHECKPOINT_DEADLINE_MS,
  UsagePersister,
  checkpointRooms,
  type CheckpointableRoom,
  type RoomCheckpointReport,
  type RoomSaveRepository,
  type UsageRepository,
} from "../persistence";
import {
  SHIFT_ROOM_NAME,
  ShiftRoom,
  createGameServer,
  type GameServer,
  type ShiftMember,
  type ShiftMembership,
  type TransportLoaders,
  type TransportMode,
} from "../net";
import {
  StatsReporter,
  createLogger,
  createNodeProcessProbe,
  describeEnvForLog,
  type Logger,
  type ServerEnv,
} from "../ops";

export interface ServerApp {
  readonly env: ServerEnv;
  readonly logger: Logger;
  readonly gameServer: GameServer;
  readonly stats: StatsReporter;
  readonly db: DbConnection;
  /** Account/contract repository for PERSISTENCE_DRIVER (memory or postgres). */
  readonly repo: MoonRepository;
  /**
   * Bearer access-token verifier (never throws, `null` = reject). The shift join route (`POST /v1/contracts/:id/join`)
   * uses it; ShiftRoom.onAuth then redeems the server-side join ticket (no token in the WebSocket URL).
   */
  readonly verifyToken: VerifyToken;
  /** Bound TCP port (differs from `env.port` when that was 0). */
  readonly port: number;
  /** Outcome of the SIGTERM checkpoint of every live room (`undefined` until `shutdown` ran). */
  shutdownCheckpoint(): RoomCheckpointReport | undefined;
  /** True once `beginDrain` ran: `/readyz` reports `draining`. */
  draining(): boolean;
  /** Marks the server as draining. Idempotent. */
  beginDrain(): void;
  /**
   * Stops accepting work and releases everything: reporter, game server (rooms close with 4001), database pool.
   * Never exits the process. Idempotent.
   */
  shutdown(): Promise<void>;
}

export interface StartServerOptions {
  /** Process start time for /healthz uptime. Default: now. */
  readonly startedAtMs?: number;
  /** Test override of `env.transport` (TRANSPORT: auto | uws | ws, validated in ops/env). */
  readonly transport?: TransportMode;
  /** Test seam: transport adapter loaders. */
  readonly transportLoaders?: TransportLoaders;
  /** Refresh-token purge period in ms. Default one day; 0 disables (tests). */
  readonly purgeIntervalMs?: number;
  /** Test seam: the room/usage repository (default: SQL for PERSISTENCE_DRIVER=postgres, a fresh memory one otherwise). */
  readonly roomRepository?: RoomSaveRepository & UsageRepository;
  /** Test seam: bake hash of the server world (64 lower-case hex). Default none (the server world is not baked yet). */
  readonly bakeHash?: string;
  /** SIGTERM room-checkpoint deadline in ms (default `SHUTDOWN_CHECKPOINT_DEADLINE_MS`). */
  readonly shutdownCheckpointDeadlineMs?: number;
}

/** Daily housekeeping period: expired/replaced refresh tokens (no database wake-up at boot, only after a full day up). */
export const DEFAULT_PURGE_INTERVAL_MS = 24 * 60 * 60 * 1000;

/** Sim world of the shift room: the Standard plot grid on flat ground (same as the client's current solo world). */
export function createShiftWorld(): SimWorld {
  return { grid: createPlotGrid(STANDARD_GRID_PARAMS), ground: { heightAtXYZ: () => 0 } };
}

/**
 * Membership check of the shift join route over the repository: an ACTIVE (not banned) member of a non-deleted,
 * non-solo Contract (solo Shifts never use a room, ADR-0031), with the profile's display name. `null` -> 403.
 * Repository errors propagate (the route answers 503 RETRY_LATER).
 */
export function createShiftMembership(repo: MoonRepository): ShiftMembership {
  return async (playerId, contractId): Promise<ShiftMember | null> => {
    const membership = await repo.getMembership(contractId, playerId);
    if (membership === null || membership.status !== "active") return null;
    if (membership.contractStatus === "deleted" || membership.shiftType === "solo") return null;
    const profile = await repo.getProfile(playerId);
    if (profile === null) return null;
    return { role: membership.role, displayName: profile.displayName, shiftType: membership.shiftType };
  };
}

/** Builds and starts the server for a validated environment. Rejects when the port cannot be bound. */
export async function startServer(env: ServerEnv, options: StartServerOptions = {}): Promise<ServerApp> {
  const startedAtMs = options.startedAtMs ?? Date.now();
  const bootStart = performance.now();
  const logger = createLogger({
    level: env.logLevel,
    nodeEnv: env.nodeEnv,
    envName: env.envName,
    buildVersion: env.buildVersion,
    gitCommit: env.gitCommit,
  });
  logger.info({ config: describeEnvForLog(env) }, "server config");

  const probe = createNodeProcessProbe();
  const stats = new StatsReporter({ logger, probe, netSpike: env.netSpike });

  // Lazy: nothing connects until /readyz or a repository asks (the free database may be powered off).
  const db = createDbConnection(
    env.databaseUrl === undefined
      ? undefined
      : { url: env.databaseUrl, caCert: env.databaseCaCert, schema: env.dbSchema, poolMax: env.dbPoolMax },
  );

  const repo = createMoonRepository(
    env.persistenceDriver === "memory" ? { driver: "memory" } : { driver: "postgres", connection: db },
  );
  const account = createAccountApi({
    repo,
    envName: env.envName,
    jwtSecret: env.jwtSecret,
    jwtSecretPrevious: env.jwtSecretPrevious,
    refreshTokenPepper: env.refreshTokenPepper,
    logger,
    storage: () => "ok",
    // Process-wide inflate budget (review R1), sized from env (ops/env.ts; defaults equal the code defaults).
    checkpoints: {
      inflateBytesPerMinute: env.checkpointInflateMibPerMin * 1024 * 1024,
      inflateMaxConcurrent: env.checkpointInflateConcurrency,
      maxQueued: env.checkpointInflateQueue,
    },
  });

  // Room durability (W5-T01): lease + outage policy over the room repository. PERSISTENCE_DRIVER=postgres uses the SQL
  // repository (contracts lease columns, contract_saves A/B header slots, contract_dust_chunks, ops_usage_daily);
  // memory keeps rooms for the life of this process only.
  const roomRepo: RoomSaveRepository & UsageRepository =
    options.roomRepository ??
    (env.persistenceDriver === "memory"
      ? new MemoryRoomSaveRepository()
      : createPostgresRoomRepository(db.db() as unknown as PgDb));
  const dustStore = new DurableShiftDustStore({
    repo: roomRepo,
    instance: `${env.envName}:${env.buildVersion}:${randomUUID()}`,
    logger,
    ...(options.bakeHash === undefined ? {} : { bakeHash: options.bakeHash }),
  });
  const usage = new UsagePersister({ repo: roomRepo, bandwidth: stats.bandwidth, logger });

  let draining = false;
  const healthRoutes = createHealthRoutes({
    envName: env.envName,
    buildVersion: env.buildVersion,
    maxRooms: env.maxRooms,
    db,
    persistenceDriver: env.persistenceDriver,
    startedAtMs,
    runtime: {
      draining: () => draining,
      rooms: () => matchMaker.stats.local.roomCount,
      // Same ceilings the join routes enforce (net/admission): room headroom and client headroom.
      admitting: () => matchMaker.stats.local.roomCount < env.maxRooms && matchMaker.stats.local.ccu < env.maxClients,
      storage: () => "ok",
    },
  });
  const routes = [...healthRoutes, ...account.routes];

  const gameServer = await createGameServer({
    // Raw uploads (solo checkpoints): the access token is verified and the per-account / per-address slot-attempt
    // allowance spent before an upload slot is taken (reviews M1 and R2).
    rawBodyAuth: account.admitRawUpload,
    // M1 ShiftRoom (`shift`) + `POST /v1/contracts/:id/join`. Multiplayer only: solo Shifts run LocalRoom in the
    // browser (ADR-0031) and never touch this. The world matches the client's current sim world (Standard grid, flat
    // ground, apps/client/src/app/solo-host.ts) until the server world API (apps/server/src/world) loads the bake.
    shift: {
      data: loadGameData(),
      world: createShiftWorld(),
      verifyToken: account.verifyToken,
      membership: createShiftMembership(repo),
      stats,
      // Durable room dust (W5-T01): Contract lease, restore, 30 s checkpoints, release on dispose.
      dustStore,
    },
    port: env.port,
    routes,
    allowedOrigins: env.allowedOrigins,
    logger,
    rates: { simTickHz: env.simTickHz, snapshotHz: env.snapshotHz },
    serverBuild: env.buildVersion,
    // NET_SPIKE=1 only (default 0, refused in production by env validation): registers LoadTestRoom + /v0/spike/join.
    loadTest: { enabled: env.netSpike, stats },
    // null = socket mode (ENV_NAME=local only, enforced by env validation; review N1).
    clientIpHeader: env.clientIpHeader,
    // Hard ceilings enforced at the join routes and the upgrade (review B1).
    admission: { maxRooms: env.maxRooms, maxClients: env.maxClients, maxSeatsPerIp: env.maxSeatsPerIp },
    transport: options.transport ?? env.transport,
    ...(options.transportLoaders === undefined ? {} : { transportLoaders: options.transportLoaders }),
  });

  const port = await gameServer.listen();
  stats.start();
  void usage.seed();
  usage.start();

  // Daily refresh-token purge. unref'd so it never keeps the process alive; failures are logged, never thrown.
  const purgeEveryMs = options.purgeIntervalMs ?? DEFAULT_PURGE_INTERVAL_MS;
  const purgeTimer =
    purgeEveryMs > 0
      ? setInterval(() => {
          repo.purgeRefreshTokens().then(
            (purged) => logger.info({ purged }, "refresh tokens purged"),
            (err: unknown) => logger.error({ code: errorCodeForLog(err) }, "refresh token purge failed"),
          );
        }, purgeEveryMs)
      : undefined;
  purgeTimer?.unref();

  logger.info(
    { port, transport: gameServer.transport, bootMs: Math.round(performance.now() - bootStart) },
    "server ready",
  );

  /** Every live ShiftRoom of this process as a checkpointable (SIGTERM drain). */
  const liveShiftRooms = async (): Promise<CheckpointableRoom[]> => {
    const out: CheckpointableRoom[] = [];
    for (const listing of await matchMaker.query({ name: SHIFT_ROOM_NAME })) {
      const room = matchMaker.getLocalRoomById(listing.roomId);
      if (!(room instanceof ShiftRoom)) continue;
      out.push({
        roomId: listing.roomId,
        async checkpoint() {
          const persistence = room.persistence;
          if (persistence === undefined || room.core === undefined) return;
          const failuresBefore = persistence.counters.saveFailures;
          await persistence.save(Date.now(), room.core.sim.tick);
          // `save` never rejects (it re-marks the chunks dirty); surface a failed write to the drain report.
          if (persistence.counters.saveFailures > failuresBefore) throw new Error("room checkpoint failed");
        },
      });
    }
    return out;
  };

  let shutdownPromise: Promise<void> | undefined;
  let shutdownReport: RoomCheckpointReport | undefined;
  return {
    env,
    logger,
    gameServer,
    stats,
    db,
    repo,
    verifyToken: account.verifyToken,
    port,
    draining: () => draining,
    shutdownCheckpoint: () => shutdownReport,
    beginDrain() {
      draining = true;
    },
    shutdown() {
      shutdownPromise ??= (async () => {
        draining = true;
        stats.stop();
        if (purgeTimer !== undefined) clearInterval(purgeTimer);
        try {
          // Netcode 9.3 drain: every live room writes its dirty chunks in parallel under one deadline BEFORE the rooms
          // are closed (their onDispose then writes whatever changed since, and releases the Contract lease).
          try {
            shutdownReport = await checkpointRooms(await liveShiftRooms(), {
              deadlineMs: options.shutdownCheckpointDeadlineMs ?? SHUTDOWN_CHECKPOINT_DEADLINE_MS,
            });
            logger.info({ ...shutdownReport }, "shutdown: room checkpoints");
          } catch (err) {
            logger.error({ code: errorCodeForLog(err) }, "shutdown: room checkpoint sweep failed");
          }
          await gameServer.gracefullyShutdown();
        } finally {
          usage.stop();
          await usage.flush();
          dustStore.dispose();
          probe.dispose();
          await db.close();
        }
      })();
      return shutdownPromise;
    },
  };
}
