// P2 (strokes + tile atlas + coarse ledger) harness adapter. Node lane: authoritative server, in-process clients that
// decode the real wire bytes, in-memory checkpoint store, CPU reference of the client tile atlas.
// The environment-agnostic core is under src/core; only this file touches Node (zlib, perf_hooks, process).
//
// Environment switches (all optional):
//   P2_STROKE_CADENCE=frame|tick   frame (default): one stroke per actor per frame interval (WDS 4.4, 10 Hz);
//                                  tick: every submitted stroke is applied and sent as is (harness cadence, 20 Hz).
//   P2_DUST_CELL_G=<grams>         Dust Cell capacity; 0 (default) = unlimited.
//   P2_TILES=0                     disable the CPU reference tile atlas in view() / lateJoin().
import { monitorEventLoopDelay, performance } from "node:perf_hooks";
import { deflateSync, inflateSync } from "node:zlib";
import type { RobotPlotIntent, StrokeRecord } from "@moon-cleanup/shared";
import type {
  AdapterStartContext,
  CameraPose,
  DustPrototypeAdapter,
  FrameSample,
  LateJoinResult,
} from "../harness/src/types";
import { DurableStore, loadWorld, saveWorld } from "./src/core/persistence";
import { P2Server, type P2Options } from "./src/core/server";
import { buildTables, type GridLike, type PlotTables } from "./src/core/tables";
import { TILE_PRESETS, TileAtlasRef } from "./src/core/tiles";
import type { Codec } from "./src/core/util";

const ZLIB: Codec = {
  deflate: (b) => deflateSync(b, { level: 6 }),
  inflate: (b) => inflateSync(b),
};

const NOW = (): number => performance.now();

const OK = { ok: true } as const;
const REJECT = [
  OK,
  { ok: false, reason: "segment_too_long" },
  { ok: false, reason: "empty_plot" },
  { ok: false, reason: "dust_cell_full" },
  { ok: false, reason: "tool_not_equipped" },
] as const;

export function createAdapter(): DustPrototypeAdapter {
  let tables: PlotTables | null = null;
  let tablesKey: unknown = null;
  let server: P2Server | null = null;
  let options: P2Options | null = null;
  let store = new DurableStore();
  let hz = 20;
  let quality: keyof typeof TILE_PRESETS = "medium";
  let lag: ReturnType<typeof monitorEventLoopDelay> | null = null;
  let serverMsCarried = 0;
  let viewer = 0;
  let tiles: TileAtlasRef | null = null;
  let tilesFor = -1;
  let persistMsTotal = 0;
  let persists = 0;
  let restoreMsLast = 0;
  let join = { blocking: 0, streamed: 0, ledgers: 0, snapshotMs: 0, rebuildMs: 0, tiles: 0 };
  const lastPos = new Map<number, Float64Array>();
  const camDir = new Float64Array(3);
  const useTiles = process.env["P2_TILES"] !== "0";

  const srv = (): P2Server => {
    if (server === null) throw new Error("p2 adapter: start() has not been called");
    return server;
  };

  const rememberPositions = (): void => {
    if (server === null) return;
    for (const link of server.links) {
      if (link && link.hasPos) lastPos.set(link.clientId, link.pos.slice());
    }
  };

  /** The CPU reference atlas of the viewing client (created on first use, rebuilt when the viewer changes). */
  const viewerTiles = (): TileAtlasRef | null => {
    if (!useTiles) return null;
    const link = srv().linkOf(viewer);
    if (link === undefined) return null;
    if (tiles === null || tilesFor !== viewer || link.client.tiles !== tiles) {
      const c = link.client;
      tiles = new TileAtlasRef(srv().t, c.view, c.log, c.set, { ...TILE_PRESETS[quality], now: NOW });
      c.tiles = tiles;
      tilesFor = viewer;
    }
    return tiles;
  };

  const adapter: DustPrototypeAdapter = {
    approach: "p2-stroke-atlas-ledger",
    isStub: false,
    get simTickHz() {
      return hz;
    },

    start(ctx: AdapterStartContext) {
      hz = ctx.simTickHz;
      quality = ctx.quality;
      if (tables === null || tablesKey !== ctx.grid) {
        tables = buildTables(ctx.grid as unknown as GridLike, ctx.seed);
        tablesKey = ctx.grid;
      }
      options = {
        simTickHz: hz,
        cadence: process.env["P2_STROKE_CADENCE"] === "tick" ? "tick" : "frame",
        residencyM: TILE_PRESETS[quality].residencyM,
        dustCellCapacityG: Number(process.env["P2_DUST_CELL_G"] ?? 0) || 0,
        codec: ZLIB,
        now: NOW,
      };
      server = new P2Server(tables, options);
      store = new DurableStore();
      lastPos.clear();
      serverMsCarried = 0;
      viewer = 0;
      tiles = null;
      tilesFor = -1;
      persistMsTotal = 0;
      persists = 0;
      restoreMsLast = 0;
      join = { blocking: 0, streamed: 0, ledgers: 0, snapshotMs: 0, rebuildMs: 0, tiles: 0 };
      lag = monitorEventLoopDelay({ resolution: 1 });
      lag.enable();
      return Promise.resolve();
    },

    stop() {
      lag?.disable();
      lag = null;
      server = null;
      tiles = null;
      return Promise.resolve();
    },

    joinClient(id) {
      srv().join(id, lastPos.get(id) ?? null);
    },

    leaveClient(id) {
      const link = server?.linkOf(id);
      if (link?.hasPos) lastPos.set(id, link.pos.slice());
      server?.leave(id);
    },

    submitStroke(id, stroke: StrokeRecord) {
      const s = srv();
      const code = s.submit(id, stroke);
      if (code === 0) {
        const link = s.linkOf(id);
        if (link !== undefined) {
          link.client.ownActor = stroke.actorSlot;
          link.client.predict(stroke.inputSeq, s.tick);
        }
      }
      return REJECT[code] ?? REJECT[4];
    },

    submitRobotIntent(i: RobotPlotIntent) {
      return srv().submitRobotIntent(
        i.robotId,
        i.plotId,
        i.startTick,
        i.widthCm,
        i.depth16,
        i.speedCmPerS,
        i.laneMask[0],
        i.laneMask[1],
      );
    },

    advance(n) {
      srv().advance(n);
    },

    serverHash: () => srv().serverHash(),
    clientHash: (id) => srv().clientHash(id),
    clientBytesSent: (id) => srv().linkOf(id)?.bytes ?? 0,

    persist() {
      const s = srv();
      const t0 = performance.now();
      saveWorld(s, store);
      persistMsTotal += performance.now() - t0;
      persists++;
      return { tick: s.tick, hash: s.serverHash() };
    },

    crash() {
      rememberPositions();
      serverMsCarried += server?.serverMs ?? 0;
      server = null;
      tiles = null;
    },

    restore() {
      if (tables === null || options === null) throw new Error("p2 adapter: restore() before start()");
      const t0 = performance.now();
      const fresh = new P2Server(tables, options);
      loadWorld(fresh, store);
      server = fresh;
      restoreMsLast = performance.now() - t0;
      return { tick: fresh.tick, hash: fresh.serverHash(), restoreMs: restoreMsLast };
    },

    /**
     * Event-loop lag p99. With a live event loop (--realtime) this is the perf_hooks delay histogram. A flat-out
     * simulated-time run never yields to the loop, so the fallback is the p99 of the server-side blocking time per
     * tick (the delay a timer would see). Neither is a 0.1-CPU cgroup measurement (see exportMetrics.lagSource).
     */
    eventLoopLagP99Ms() {
      if (lag !== null && lag.count >= 50) return lag.percentile(99) / 1e6;
      return srv().tickQuantile(0.99);
    },
    serverCpuMs: () => serverMsCarried + (server?.serverMs ?? 0),
    rssMb: () => process.memoryUsage().rss / (1024 * 1024),

    view(pose: CameraPose): FrameSample {
      const s = srv();
      const p = pose.position;
      const l = Math.hypot(p[0], p[1], p[2]) || 1;
      camDir[0] = p[0] / l;
      camDir[1] = p[1] / l;
      camDir[2] = p[2] / l;
      s.setPosition(viewer, camDir);
      const tl = viewerTiles();
      if (tl === null) return { cpuMs: 0 };
      tl.frame(camDir);
      return { cpuMs: tl.fCpuMs, replayMs: tl.fReplayMs, tileUploads: tl.fUploads, tileRebuildMs: tl.fRebuildMs };
    },

    // Edge width is a property of the GPU shading (WDS 7.7 presence mask). The Node lane cannot measure it.
    measureEdgeWidthPx: () => null,

    lateJoin(id): LateJoinResult {
      const s = srv();
      const pos = lastPos.get(id) ?? (s.hasActivity ? s.activity.slice() : null);
      const t0 = performance.now();
      const r = s.join(id, pos);
      const t1 = performance.now();
      viewer = id;
      const tl = viewerTiles();
      let nTiles = 0;
      if (tl !== null && pos !== null) {
        // Drain every rebuild (the budget only spreads them over frames; the total is what "playable" waits for).
        do tl.frame(pos);
        while (tl.rebuildBacklog > 0);
        nTiles = tl.tilesResident;
      }
      const t2 = performance.now();
      join = {
        blocking: r.blockingBytes,
        streamed: r.streamedBytes,
        ledgers: r.ledgersBlocking + r.ledgersStreamed,
        snapshotMs: t1 - t0,
        rebuildMs: t2 - t1,
        tiles: nTiles,
      };
      return {
        blockingBytes: r.blockingBytes,
        streamedBytes: r.streamedBytes,
        playableMs: t2 - t0,
        tileRebuildMs: t2 - t1,
      };
    },

    exportMetrics() {
      const s = server;
      if (s === null) return {};
      const loopAlive = lag !== null && lag.count >= 50;
      let clients = 0;
      let clientLedgers = 0;
      let l0Mismatch = 0;
      let drift = 0;
      let stray = 0;
      let mispredicts = 0;
      let unacked = 0;
      let badCont = 0;
      for (const link of s.links) {
        if (!link) continue;
        clients++;
        clientLedgers += link.client.view.ledgerCount;
        l0Mismatch += link.client.l0Mismatch;
        drift += link.client.driftChunks;
        stray += link.client.strayLedgers;
        mispredicts += link.client.mispredicts;
        unacked += link.client.predN;
        badCont += link.client.badContinuations;
      }
      const out: Record<string, number> = {
        cadenceFrame: s.opt.cadence === "frame" ? 1 : 0,
        frameTicks: s.frameTicks,
        lagSourceEventLoop: loopAlive ? 1 : 0,
        serverTickMsP50: s.tickQuantile(0.5),
        serverTickMsP99: s.tickQuantile(0.99),
        serverTickMsMax: s.tickQuantile(1),
        serverCpuMs: serverMsCarried + s.serverMs,
        strokesSubmitted: s.strokesSubmitted,
        strokesMerged: s.strokesMerged,
        strokesApplied: s.strokesApplied,
        strokesCellFull: s.strokesCellFull,
        unitsRemoved: s.unitsRemoved,
        latticePoints: s.view.latticePoints,
        headersSent: s.headersSent,
        continuationsSent: s.contsSent,
        bytesStrokes: s.bytesStrokes,
        bytesRobot: s.bytesRobot,
        bytesAck: s.bytesAck,
        bytesPlots: s.bytesPlots,
        bytesLedger: s.bytesLedger,
        bytesLog: s.bytesLog,
        bytesCheck: s.bytesCheck,
        bytesSnapshot: s.bytesSnapshot,
        ledgersSent: s.ledgersSent,
        serverLedgers: s.view.ledgerCount,
        serverPolished: s.view.polishedAllN,
        serverLogBytes: s.log.bytes(),
        serverLogEvictions: s.log.evictions,
        robotsActive: s.plans.activeCount,
        robotChunks: s.plans.chunksApplied,
        clients,
        clientLedgersTotal: clientLedgers,
        clientL0Mismatch: l0Mismatch,
        clientDriftChunks: drift,
        clientStrayLedgers: stray,
        clientMispredicts: mispredicts,
        clientUnackedPredictions: unacked,
        clientBadContinuations: badCont,
        resyncs: s.resyncs,
        scanMismatch: s.scanMismatch,
        saves: persists,
        saveMsMean: persists ? persistMsTotal / persists : 0,
        saveBytesLast: store.lastSaveBytes,
        saveChunksLast: store.lastSaveChunks,
        storeBytes: store.bytes(),
        restoreMs: restoreMsLast,
        snapshotStatesRawBytes: s.snapRawBytes,
        joinBlockingBytes: join.blocking,
        joinStreamedBytes: join.streamed,
        joinLedgers: join.ledgers,
        joinSnapshotMs: join.snapshotMs,
        joinTileRebuildMs: join.rebuildMs,
        joinTiles: join.tiles,
        rssMb: process.memoryUsage().rss / (1024 * 1024),
      };
      if (tiles !== null) {
        out["tilesResident"] = tiles.tilesResident;
        out["tileEvictions"] = tiles.evictions;
        out["tileRebuilds"] = tiles.rebuilds;
        out["tileRebuildMsMean"] = tiles.rebuilds ? tiles.rebuildMsTotal / tiles.rebuilds : 0;
        out["tileRebuildMsMax"] = tiles.rebuildMsMax;
        out["tileStrokesReplayed"] = tiles.strokesReplayed;
        out["tileStrokeDraws"] = tiles.tileStrokeDraws;
      }
      return out;
    },
  };
  return adapter;
}
