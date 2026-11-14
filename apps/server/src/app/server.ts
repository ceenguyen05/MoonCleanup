// Server composition root (M0-W1-T06). Boot order: env -> logger -> stats -> db (lazy) -> health routes -> game
// server -> listen. `/healthz` is served as soon as the port is bound, before any room exists. The process
// lifecycle (signals, exit codes) lives in ./index.ts and ./shutdown.ts; this module only builds and starts the parts
// and returns a handle, so tests can boot it on port 0 with an injected environment.

import { matchMaker } from "@colyseus/core";
import { createDbConnection, createMoonRepository, type DbConnection, type MoonRepository } from "@moon-cleanup/db";
import { createAccountApi, createHealthRoutes, type VerifyToken } from "../api";
import { createGameServer, type GameServer, type TransportLoaders, type TransportMode } from "../net";
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
   * Bearer access-token verifier for room `onAuth` (never throws, `null` = reject). No room authenticates yet
   * (HelloRoom is unauthenticated M0 connectivity); the shift room (W5) receives this when it lands.
   */
  readonly verifyToken: VerifyToken;
  /** Bound TCP port (differs from `env.port` when that was 0). */
  readonly port: number;
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
}

/** Daily housekeeping period: expired/replaced refresh tokens (no database wake-up at boot, only after a full day up). */
export const DEFAULT_PURGE_INTERVAL_MS = 24 * 60 * 60 * 1000;

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
  });

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
    admission: { maxRooms: env.maxRooms, maxClients: env.maxClients },
    transport: options.transport ?? env.transport,
    ...(options.transportLoaders === undefined ? {} : { transportLoaders: options.transportLoaders }),
  });

  const port = await gameServer.listen();
  stats.start();

  // Daily refresh-token purge. unref'd so it never keeps the process alive; failures are logged, never thrown.
  const purgeEveryMs = options.purgeIntervalMs ?? DEFAULT_PURGE_INTERVAL_MS;
  const purgeTimer =
    purgeEveryMs > 0
      ? setInterval(() => {
          repo.purgeRefreshTokens().then(
            (purged) => logger.info({ purged }, "refresh tokens purged"),
            (err: unknown) => logger.error({ err }, "refresh token purge failed"),
          );
        }, purgeEveryMs)
      : undefined;
  purgeTimer?.unref();

  logger.info(
    { port, transport: gameServer.transport, bootMs: Math.round(performance.now() - bootStart) },
    "server ready",
  );

  let shutdownPromise: Promise<void> | undefined;
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
    beginDrain() {
      draining = true;
    },
    shutdown() {
      shutdownPromise ??= (async () => {
        draining = true;
        stats.stop();
        if (purgeTimer !== undefined) clearInterval(purgeTimer);
        try {
          await gameServer.gracefullyShutdown();
        } finally {
          probe.dispose();
          await db.close();
        }
      })();
      return shutdownPromise;
    },
  };
}
