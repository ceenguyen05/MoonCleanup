/* eslint-disable @typescript-eslint/no-explicit-any -- harness: apps/server is loaded dynamically, so its types are not available here */
// Local ShiftRoom server for the `shift-room` bot scenario. Test harness only: stub tokens (`tok-<playerId>`), memory
// dust store, no database, local sockets. It is NOT part of tools/bots' typed source (excluded from tsconfig): it loads
// apps/server read-only through its package context, the same way tools/perf/scripts/shift-state-bandwidth.mts does,
// so tools/bots/src itself keeps importing only protocol/shared/sim.
//
//   node --import tsx harness/shift-server.mts --port 2571 [--tick 20] [--snap 10] [--duration 120]   (write "stop" to stdin to end early)
//
// stdout is newline-delimited JSON (parseServerLog compatible): `shift-ready`, `room-stats` (StatsReporter, tick ms and
// bytes out per client by type), `shift-loop` (tick p50/p95/max over the room ring, overruns, counters, heap) and
// `shift-final`. Stops on SIGINT/SIGTERM or after --duration seconds.
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

const here = new URL(".", import.meta.url);
const serverPkg = new URL("../../../apps/server/package.json", here);
const req = createRequire(serverPkg);
const src = (p: string): string =>
  new URL(`../../../apps/server/src/${p}`, here).pathname.replace(/^\/([A-Za-z]:)/, "$1");

// ESM imports for everything that touches @colyseus/core: a require() copy next to the ws transport's ESM copy gives two
// matchMakers (rooms unknown to the transport -> "seat reservation expired" 524).
const esm = (p: string): Promise<any> => import(pathToFileURL(p).href);
const corePath = createRequire(serverPkg)
  .resolve("@colyseus/core/package.json")
  .replace(/package.json$/, "build/index.mjs");
const { matchMaker } = await esm(corePath);
const pkg = (n: string): Promise<any> => esm(req.resolve(n));
const shared = await pkg("@moon-cleanup/shared");
const { loadGameData } = await pkg("@moon-cleanup/game-data");
const { createPlotGrid } = await pkg("@moon-cleanup/world");
const { createGameServer } = await esm(src("net/game-server.ts"));
const { JoinTickets } = await esm(src("net/shift/join-ticket.ts"));
const { MemoryShiftDustStore } = await esm(src("net/shift/shift-persistence.ts"));
const { StatsReporter, createLogger, createNodeProcessProbe } = req(src("ops/index.ts"));

const { values } = parseArgs({
  options: {
    port: { type: "string", default: "2571" },
    tick: { type: "string", default: "20" },
    snap: { type: "string", default: "10" },
    duration: { type: "string", default: "120" },
    origin: { type: "string", default: "http://localhost:5173" },
  },
});
const port = Number(values.port);
const tickHz = Number(values.tick);
const snapHz = Number(values.snap);

const logger = createLogger({ level: "info", nodeEnv: "production", envName: "local", buildVersion: "bots-shift" });
const probe = createNodeProcessProbe();
const stats = new StatsReporter({ logger, probe, netSpike: true });
const roomIds = new Set<string>();
const sink = {
  addRoom(roomId: string) {
    roomIds.add(roomId);
    return process.env.NOSTATS === "1"
      ? { setClients() {}, recordTick() {}, recordBytesOut() {} }
      : stats.addRoom(roomId);
  },
  removeRoom(roomId: string) {
    roomIds.delete(roomId);
    stats.removeRoom(roomId);
  },
};
const emit = (o: Record<string, unknown>): void => void process.stdout.write(`${JSON.stringify(o)}\n`);

const grid = createPlotGrid(shared.STANDARD_GRID_PARAMS);
const server = await createGameServer({
  port,
  admission: { maxRooms: 4, maxClients: 24, maxSeatsPerIp: 24, maxSocketsPerIp: 24, roomCreatesPerIpPerMin: 1000 },
  routes: [{ method: "GET", path: "/healthz", handle: () => ({ status: 200, body: { ok: true } }) }],
  allowedOrigins: [values.origin],
  logger,
  rates: { simTickHz: tickHz, snapshotHz: snapHz },
  serverBuild: "bots-shift",
  transport: "ws",
  helloRoom: false,
  clientIpHeader: null, // socket-address IP (local only); the default header leaves all bots in the shared "unknown" bucket (8 sockets)
  shift: {
    data: loadGameData(),
    world: { grid, ground: { heightAtXYZ: () => 0 } },
    verifyToken: (t: string) => Promise.resolve(t.startsWith("tok-") ? { playerId: t.slice(4) } : null),
    membership: (playerId: string) =>
      Promise.resolve({
        role: playerId.endsWith("00") ? "holder" : "staff",
        displayName: `B${playerId.slice(-2)}`,
        shiftType: "private",
      }),
    stats: sink,
    tickets: new JoinTickets(),
    seatHoldS: 30,
    dustStore: new MemoryShiftDustStore(),
  },
});
await server.listen();
stats.start();
emit({ kind: "shift-ready", port, tickHz, snapHz });

const loopLine = (kind: string): void => {
  for (const id of roomIds) {
    const room = matchMaker.getLocalRoomById(id);
    if (room === undefined || room.roomName !== "shift") continue;
    emit({
      kind,
      roomId: id,
      clients: room.core.activeSeats,
      tick: room.tickStats(),
      overruns: room.overruns,
      counters: { ...room.core.counters },
      heapUsedMB: Math.round(process.memoryUsage().heapUsed / 1e5) / 10,
      rssMB: Math.round(process.memoryUsage().rss / 1e5) / 10,
    });
  }
};
const loop = setInterval(() => loopLine("spike-loop"), 5000);
let stopping = false;
const stop = (): void => {
  if (stopping) return;
  stopping = true;
  clearInterval(loop);
  loopLine("spike-loop");
  stats.emitRooms();
  stats.stop();
  void server.gracefullyShutdown().then(() => {
    probe.dispose();
    process.exit(0);
  });
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
setTimeout(stop, Number(values.duration) * 1000);
// Windows cannot deliver SIGINT to a child gracefully; the scenario writes "stop" to stdin instead.
process.stdin.on("data", (d: Buffer) => {
  if (d.toString().includes("stop")) stop();
});
process.stdin.on("end", stop);
