// Harness adapter of P3 (client-painted tiles, per-texel min merge). One in-process server and N in-process clients;
// "the wire" is the server's per-slot byte buffer, read in place by the client (no copies, no allocation per tick).
//
// How the harness calls map onto P3:
//  - submitStroke(id, stroke): the CLIENT paints the stroke into its own tiles (client CPU). The verdict is the
//    client-side sanity check only (segment length); the server's bounds act later, on the uploaded texels.
//    The stroke end point is also handed to the server as the slot's server-side pose and its tool as the server-known
//    equipped tool: in the game both come from the authoritative sim (inputs), here they are proxies.
//  - advance(1): on a flush tick every client uploads its changed texels, the server merges and relays, clients apply.
//    P3_FLUSH_TICKS sets the cadence (default 2 = 10 Hz, the frame interval of WDS 4.4; 1 = every 20 Hz tick).
//  - clientHash(id): the client holds only the tiles of its dust radius, so the value returned is
//    clientView ^ serverExpected(slot) ^ serverWorld. It equals serverHash() exactly when every tile the client holds is
//    byte-identical to the server's. When the client holds every touched plot this is simply its own hash
//    (counted in `hashChecksFullCoverage`).
// Event-loop lag is only probed under --realtime (a flat-out run never yields to the loop).
import { monitorEventLoopDelay, performance } from "node:perf_hooks";
import { deflateSync } from "node:zlib";
import type { PlotId, RobotPlotIntent, StrokeRecord } from "../../../packages/shared/src/index";
import type { AdapterStartContext, DustPrototypeAdapter, FrameSample, LateJoinResult } from "../harness/src/types";
import { ByteWriter } from "./src/core/bytes";
import { P3Client, PAINT_OK } from "./src/core/client";
import { GeomCache, Vec3, localToDir, type P3Grid } from "./src/core/geom";
import { P3Server } from "./src/core/server";

const LAG_RESOLUTION_MS = 10;
const OK = { ok: true } as const;
const TOO_LONG = { ok: false, reason: "segment_too_long" } as const;
const NOT_JOINED = { ok: false, reason: "tool_not_equipped" } as const;

interface ClientRec {
  readonly id: number;
  slot: number;
  client: P3Client;
  bytes: number;
  uploadBytes: number;
  strokesThisTick: number;
  readonly pose: Vec3;
  hasPose: boolean;
}

export function createAdapter(): DustPrototypeAdapter {
  const flushTicks = Math.max(1, Number(process.env["P3_FLUSH_TICKS"] ?? 2));
  const measureLag = process.argv.includes("--realtime");
  let hz = 20;
  let geom: GeomCache | null = null;
  let server: P3Server | null = null;
  let lag: ReturnType<typeof monitorEventLoopDelay> | null = null;
  const list: ClientRec[] = [];
  const byId = new Map<number, ClientRec>();
  const poses = new Map<number, Vec3>();
  const lastPose = new Vec3();
  let anyPose = false;
  const up = new ByteWriter(4096);
  const ck = new ByteWriter(1 << 16);
  const staging = new Uint8Array(64 * 64 * 64);
  const scratch = new Vec3();
  const poseBuf = new Float64Array(3);
  let durable: Uint8Array = new Uint8Array(0);

  // Probes.
  let serverMs = 0;
  let persistMs = 0;
  let ticks = 0;
  let paintMs0 = 0;
  let recvMs0 = 0;
  let rebuildMs0 = 0;
  let clientPaintMs = 0;
  let clientRecvMs = 0;
  let fullChecks = 0;
  let partialChecks = 0;
  let checkpointBytes = 0;
  let checkpointDeflated = 0;
  let checkpointTiles = 0;
  let persists = 0;
  let restoreMsLast = 0;
  let uploadBytesTotal = 0;
  let uploadBytesMax = 0;
  let joinBlocking = 0;
  let joinBlockingDeflated = 0;
  let joinStreamed = 0;
  let driftCarried = 0;

  const makeServer = (): P3Server =>
    new P3Server({
      geom: geom as GeomCache,
      simTickHz: hz,
      flushTicks,
      l0Ticks: Math.max(flushTicks, Number(process.env["P3_L0_TICKS"] ?? 10)),
      streamBytesPerFlush: Math.round((8000 * flushTicks) / hz),
    });

  const deliver = (c: ClientRec): number => {
    const w = (server as P3Server).outOf(c.slot);
    const n = w.pos;
    if (n === 0) return 0;
    const fullsBefore = c.client.fullTilesDecoded;
    const t0 = performance.now();
    c.client.receive(w.buf, 0, n);
    const dt = performance.now() - t0;
    clientRecvMs += dt;
    if (c.id === 0) {
      recvMs0 += dt;
      if (c.client.fullTilesDecoded !== fullsBefore) rebuildMs0 += dt;
    }
    c.bytes += n;
    w.reset();
    return n;
  };

  const join = (id: number): ClientRec => {
    const s = server as P3Server;
    const old = byId.get(id);
    if (old) {
      if (old.slot >= 0) s.leave(old.slot);
      driftCarried += old.client.drift;
      list.splice(list.indexOf(old), 1);
      byId.delete(id);
    }
    const own = poses.get(id);
    const rec: ClientRec = {
      id,
      slot: -1,
      client: new P3Client(geom as GeomCache),
      bytes: 0,
      uploadBytes: 0,
      strokesThisTick: 0,
      pose: new Vec3(),
      hasPose: false,
    };
    const from = own ?? (anyPose ? lastPose : null);
    if (from) {
      rec.pose.x = from.x;
      rec.pose.y = from.y;
      rec.pose.z = from.z;
    } else {
      const c = (geom as GeomCache).grid.centerDirection(0 as PlotId);
      rec.pose.x = c.x;
      rec.pose.y = c.y;
      rec.pose.z = c.z;
    }
    const t0 = performance.now();
    rec.slot = s.join(id < 16 ? id : 15, rec.pose.x, rec.pose.y, rec.pose.z);
    serverMs += performance.now() - t0;
    if (rec.slot < 0) throw new Error("P3 prototype server is full (32 slots)");
    list.push(rec);
    byId.set(id, rec);
    return rec;
  };

  const adapter: DustPrototypeAdapter = {
    approach: "p3-client-paint-minmerge",
    isStub: false,
    get simTickHz() {
      return hz;
    },
    start(ctx: AdapterStartContext) {
      hz = ctx.simTickHz;
      geom = new GeomCache(ctx.grid as P3Grid);
      server = makeServer();
      list.length = 0;
      byId.clear();
      poses.clear();
      anyPose = false;
      durable = new Uint8Array(0);
      serverMs = persistMs = paintMs0 = recvMs0 = rebuildMs0 = clientPaintMs = clientRecvMs = 0;
      ticks = fullChecks = partialChecks = persists = 0;
      checkpointBytes = checkpointDeflated = checkpointTiles = restoreMsLast = 0;
      uploadBytesTotal = uploadBytesMax = joinBlocking = joinBlockingDeflated = joinStreamed = driftCarried = 0;
      if (measureLag) {
        lag = monitorEventLoopDelay({ resolution: LAG_RESOLUTION_MS });
        lag.enable();
      }
      return Promise.resolve();
    },
    stop() {
      lag?.disable();
      lag = null;
      return Promise.resolve();
    },
    joinClient(id) {
      deliver(join(id));
    },
    leaveClient(id) {
      const c = byId.get(id);
      if (!c) return;
      if (c.slot >= 0) (server as P3Server).leave(c.slot);
      driftCarried += c.client.drift;
      list.splice(list.indexOf(c), 1);
      byId.delete(id);
    },
    submitStroke(id, stroke: StrokeRecord) {
      const c = byId.get(id);
      if (!c || c.slot < 0) return NOT_JOINED;
      const s = server as P3Server;
      const g = geom as GeomCache;
      // Server-side proxies (see the header): pose of the tool head and the equipped tool.
      localToDir(g.get(stroke.anchor), stroke.endUMm, stroke.endVMm, g.radiusM, scratch);
      let p = poses.get(id);
      if (!p) {
        p = new Vec3();
        poses.set(id, p);
      }
      p.x = lastPose.x = scratch.x;
      p.y = lastPose.y = scratch.y;
      p.z = lastPose.z = scratch.z;
      anyPose = true;
      const t0 = performance.now();
      s.setTool(c.slot, stroke.widthCm, stroke.depth16, stroke.toolCode);
      poseBuf[0] = scratch.x;
      poseBuf[1] = scratch.y;
      poseBuf[2] = scratch.z;
      s.setPoseFrom(c.slot, poseBuf, 0);
      const t1 = performance.now();
      serverMs += t1 - t0;
      const verdict = c.client.paint(stroke);
      const dt = performance.now() - t1;
      clientPaintMs += dt;
      if (id === 0) paintMs0 += dt;
      // More than one stroke of one client inside one tick is the harness scene setup (80 m of sweeping at once):
      // a real server would refuse it, so the bounds are waived for that upload only.
      if (c.strokesThisTick++ > 0) s.trustNextUpload(c.slot);
      return verdict === PAINT_OK ? OK : TOO_LONG;
    },
    submitRobotIntent(intent: RobotPlotIntent) {
      const t0 = performance.now();
      const bytes = (server as P3Server).robotIntent(intent);
      serverMs += performance.now() - t0;
      return bytes;
    },
    advance(n) {
      const s = server as P3Server;
      for (let k = 0; k < n; k++) {
        if ((s.tick + 1) % flushTicks === 0) {
          for (let i = 0; i < list.length; i++) {
            const c = list[i] as ClientRec;
            if (c.slot < 0) continue;
            up.reset();
            const len = c.client.encodeUpload(up);
            if (len === 0) continue;
            c.uploadBytes += len;
            uploadBytesTotal += len;
            const t0 = performance.now();
            s.receive(c.slot, up.buf, 0, len);
            serverMs += performance.now() - t0;
          }
        }
        const t0 = performance.now();
        s.step();
        serverMs += performance.now() - t0;
        for (let i = 0; i < list.length; i++) {
          const c = list[i] as ClientRec;
          c.strokesThisTick = 0;
          if (c.slot >= 0) deliver(c);
        }
        ticks++;
      }
    },
    serverHash: () => (server as P3Server).worldHash(),
    clientHash(id) {
      const c = byId.get(id);
      const s = server as P3Server;
      if (!c || c.slot < 0) return 0;
      const expected = s.expectedHash(c.slot);
      const world = s.worldHash();
      if (expected === world) fullChecks++;
      else partialChecks++;
      return (c.client.viewHash() ^ expected ^ world) >>> 0;
    },
    clientBytesSent: (id) => byId.get(id)?.bytes ?? 0,
    persist() {
      const s = server as P3Server;
      const t0 = performance.now();
      ck.reset();
      const len = s.serialize(ck);
      const dt = performance.now() - t0;
      persistMs += dt;
      serverMs += dt;
      durable = ck.buf.slice(0, len);
      persists++;
      checkpointBytes = len;
      checkpointTiles = s.tileCount;
      checkpointDeflated = deflateSync(durable, { level: 6 }).length;
      return { tick: s.tick, hash: s.worldHash() };
    },
    crash() {
      // Process state is gone: a blank server, every client disconnected.
      server = makeServer();
      for (const c of list) c.slot = -1;
    },
    restore() {
      const t0 = performance.now();
      const s = makeServer();
      const ok = durable.length > 0 && s.restore(durable, 0, durable.length);
      server = ok ? s : makeServer();
      restoreMsLast = performance.now() - t0;
      return { tick: server.tick, hash: server.worldHash(), restoreMs: restoreMsLast };
    },
    serverCpuMs: () => serverMs,
    rssMb: () => process.memoryUsage().rss / (1024 * 1024),
    view(): FrameSample {
      const c = byId.get(0);
      if (!c) return { cpuMs: 0 };
      const t0 = performance.now();
      const regions = c.client.takeGpuUploads(staging);
      const upMs = performance.now() - t0;
      const sample: FrameSample = {
        cpuMs: paintMs0 + recvMs0 + upMs,
        replayMs: paintMs0,
        tileUploads: regions,
        tileRebuildMs: rebuildMs0,
      };
      paintMs0 = recvMs0 = rebuildMs0 = 0;
      return sample;
    },
    // No GPU capture exists in P3: the edge width is NOT RUN (a CPU model is in bench/edge-model.ts).
    measureEdgeWidthPx: () => null,
    lateJoin(id): LateJoinResult {
      const s = server as P3Server;
      const t0 = performance.now();
      const c = join(id);
      const w = s.outOf(c.slot);
      joinBlocking = w.pos;
      joinBlockingDeflated = deflateSync(w.buf.subarray(0, w.pos), { level: 6 }).length;
      const r0 = performance.now();
      deliver(c);
      const t1 = performance.now();
      let rebuild = t1 - r0;
      const playableMs = t1 - t0;
      // Streamed part: tiles between the blocking radius and the dust radius, sent here without the 8 KB/s pacing.
      let guard = 0;
      while (s.hasStream(c.slot) && guard++ < 64) {
        s.flush(Number.POSITIVE_INFINITY);
        for (let i = 0; i < list.length; i++) {
          const o = list[i] as ClientRec;
          if (o === c) {
            const r1 = performance.now();
            deliver(o);
            rebuild += performance.now() - r1;
          } else if (o.slot >= 0) deliver(o);
        }
      }
      joinStreamed = c.bytes - joinBlocking;
      return { blockingBytes: joinBlocking, streamedBytes: joinStreamed, playableMs, tileRebuildMs: rebuild };
    },
    exportMetrics() {
      const s = server as P3Server;
      const seconds = Math.max(1 / hz, ticks / hz);
      let drift = driftCarried;
      let clientTiles = 0;
      uploadBytesMax = 0;
      for (const c of list) {
        drift += c.client.drift;
        clientTiles = Math.max(clientTiles, c.client.tileCount);
        uploadBytesMax = Math.max(uploadBytesMax, c.uploadBytes);
      }
      return {
        flushTicks,
        flushHz: hz / flushTicks,
        serverCpuMs: serverMs,
        serverTiles: s.tileCount,
        serverTileStateBytes: s.tileStateBytes(),
        plotsOpened: s.openedCount,
        plotsPolished: s.polishedCount,
        texelsMerged: s.texelsMerged,
        texelsStale: s.texelsStale,
        levelsMerged: s.levelsMerged,
        rejectedOutOfReach: s.rejects[0] ?? 0,
        rejectedRate: s.rejects[1] ?? 0,
        rejectedMalformed: s.rejects[2] ?? 0,
        uploads: s.uploads,
        uploadBytesTotal,
        uploadBytesPerSecPerClientMax: uploadBytesMax / seconds,
        tileDeltaBytesTotal: s.deltaBytes,
        l0BytesTotal: s.l0Bytes,
        fullTilesSent: s.fullTilesSent,
        fullTileBytesTotal: s.fullTileBytes,
        robotChunks: s.robotChunks,
        robotChunkTicksDeferred: s.robotChunksDeferred,
        clientDriftChecksFailed: drift,
        clientTilesMax: clientTiles,
        clientPaintMsTotal: clientPaintMs,
        clientReceiveMsTotal: clientRecvMs,
        hashChecksFullCoverage: fullChecks,
        hashChecksPartialCoverage: partialChecks,
        geomBuilds: (geom as GeomCache).builds,
        persists,
        persistMsTotal: persistMs,
        checkpointBytes,
        checkpointDeflatedBytes: checkpointDeflated,
        checkpointTiles,
        checkpointBytesPerTile: checkpointTiles > 0 ? checkpointBytes / checkpointTiles : 0,
        restoreMs: restoreMsLast,
        joinBlockingBytes: joinBlocking,
        joinBlockingDeflatedBytes: joinBlockingDeflated,
        joinStreamedBytes: joinStreamed,
        rssMb: process.memoryUsage().rss / (1024 * 1024),
      };
    },
  };
  if (measureLag) {
    // The histogram records the gap between 10 ms timer callbacks; the lag is the excess over the interval.
    adapter.eventLoopLagP99Ms = () => Math.max(0, (lag?.percentile(99) ?? 0) / 1e6 - LAG_RESOLUTION_MS);
  }
  return adapter;
}
