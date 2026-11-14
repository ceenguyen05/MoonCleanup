// P1 (scalar + procedural) behind the contest harness adapter. Node entry: the simulation core in ./src has no Node or
// DOM dependency; this file adds the harness plumbing, wall-clock probes and the in-process "network" (every message is
// really encoded by the server and decoded by each client, so byte counts are measured, not estimated).
import { monitorEventLoopDelay } from "node:perf_hooks";
import { deflateSync } from "node:zlib";
import type { PlotId, RobotPlotIntent, StrokeRecord, StrokeRejectReason } from "@moon-cleanup/shared";
import type {
  AdapterStartContext,
  CameraPose,
  ContestGrid,
  DustPrototypeAdapter,
  FrameSample,
  LateJoinResult,
} from "../harness/src/types";
import { P1Client } from "./src/client";
import { ACTOR_SLOTS, writeU32 } from "./src/l0";
import { P1Server, STROKE_OK, type AckSink, type MessageSink } from "./src/server";
import { DetailRing, RING_PRESETS } from "./src/ring";

type Verdict = { readonly ok: true } | { readonly ok: false; readonly reason: string };

// Copy of STROKE_REJECT_REASONS (shared/world/stroke.ts); the type check keeps the copy inside the contract.
const REASONS = [
  "tool_not_equipped",
  "dust_cell_full",
  "out_of_reach",
  "head_too_fast",
  "head_off_ground",
  "segment_too_long",
  "empty_plot",
  "rate_exceeded",
] as const satisfies readonly StrokeRejectReason[];
const ACCEPTED: Verdict = Object.freeze({ ok: true });
const REJECTED: readonly Verdict[] = REASONS.map((reason) => Object.freeze({ ok: false, reason }));

/** Dust radius per preset (residency radius + 20 m, WDS 5.2), metres: who receives robot intents. */
const DUST_RADIUS_M = { low: 100, medium: 140, high: 180 } as const;
/** Highland u0 (16 x level 5): a stroke's visual strength is min(1, depth16 / u0), WDS 7.3. */
const VISUAL_U0 = 80;
/** The ring only matters near the ground; orbit cameras leave it alone. */
const RING_MAX_HEIGHT_M = 200;

class Peer {
  px = 0;
  py = 0;
  pz = 0;
  hasPosition = false;
  lastAnchor = -1;
  ring: DetailRing | null = null;
  constructor(
    readonly id: number,
    readonly client: P1Client,
  ) {}
}

export interface P1AdapterOptions {
  /** Ticks between `dust.plots` flushes. 1 keeps the harness rule (hashes comparable after every advance). */
  readonly plotsFlushTicks?: number;
  /** Ticks between `dust.ack` flushes (frame interval: SIM_TICK_HZ / SNAPSHOT_HZ = 2). */
  readonly ackFlushTicks?: number;
  /** Measure event-loop lag (only meaningful when the harness runs with --realtime). */
  readonly measureLag?: boolean;
}

export function createAdapter(options: P1AdapterOptions = {}): DustPrototypeAdapter {
  const plotsFlushTicks = options.plotsFlushTicks ?? Number(process.env.P1_PLOTS_FLUSH_TICKS ?? 1);
  const ackFlushTicks = options.ackFlushTicks ?? 2;
  const measureLag = options.measureLag ?? process.argv.includes("--realtime");

  let grid: ContestGrid;
  let server: P1Server;
  let hz = 20;
  let ringPreset: { readonly size: number; readonly texelMm: number } = RING_PRESETS.medium;
  let cosDustRadius = 1;
  const peers: Peer[] = [];
  const slotOwner = new Int32Array(ACTOR_SLOTS).fill(-1);
  let durable: Uint8Array | null = null;
  let durableTick = 0;
  let durableHash = 0;
  let lag: ReturnType<typeof monitorEventLoopDelay> | null = null;
  // Probes (wall ms on this machine).
  let serverMs = 0;
  let clientMs = 0;
  let replayMs = 0;
  let persistMs = 0;
  let persists = 0;
  let lastSnapshotBytes = 0;
  let lastSnapshotDeflated = 0;
  let robotPlot = 0;

  const peerOf = (id: number): Peer | null => {
    for (let i = 0; i < peers.length; i++) {
      const p = peers[i];
      if (p && p.id === id) return p;
    }
    return null;
  };

  // The sinks are created once; a flush calls them with the server's reusable buffer.
  const broadcast: MessageSink = (bytes, length) => {
    const t0 = performance.now();
    for (let i = 0; i < peers.length; i++) peers[i]?.client.receive(bytes, length);
    clientMs += performance.now() - t0;
  };
  const toOwner: AckSink = (actorSlot, bytes, length) => {
    const owner = slotOwner[actorSlot] ?? -1;
    if (owner < 0) return;
    const t0 = performance.now();
    peerOf(owner)?.client.receive(bytes, length);
    clientMs += performance.now() - t0;
  };
  const toInterested: MessageSink = (bytes, length) => {
    const c = grid.centerDirection(robotPlot as PlotId);
    const t0 = performance.now();
    for (let i = 0; i < peers.length; i++) {
      const p = peers[i];
      if (!p || !p.hasPosition) continue;
      if (p.px * c.x + p.py * c.y + p.pz * c.z >= cosDustRadius) p.client.receive(bytes, length);
    }
    clientMs += performance.now() - t0;
  };

  const join = (id: number): Peer => {
    const existing = peerOf(id);
    if (existing) peers.splice(peers.indexOf(existing), 1);
    const peer = new Peer(id, new P1Client(server.plotCount));
    const snapshot = server.encodeSnapshot();
    peer.client.receive(snapshot, snapshot.length);
    lastSnapshotBytes = snapshot.length;
    // The viewer (client 0) owns the only detail ring: the bots of S4 to S6 are headless.
    if (id === 0) peer.ring = new DetailRing(ringPreset.size, ringPreset.texelMm, grid.params.radiusM);
    peers.push(peer);
    return peer;
  };

  const adapter: DustPrototypeAdapter = {
    approach: "p1-scalar-procedural",
    isStub: false,
    get simTickHz() {
      return hz;
    },
    start(ctx: AdapterStartContext) {
      grid = ctx.grid;
      hz = ctx.simTickHz;
      ringPreset = RING_PRESETS[ctx.quality];
      cosDustRadius = Math.cos(DUST_RADIUS_M[ctx.quality] / grid.params.radiusM);
      server = new P1Server({ plotCount: grid.params.plotCount, radiusM: grid.params.radiusM, simTickHz: hz });
      peers.length = 0;
      slotOwner.fill(-1);
      durable = null;
      serverMs = clientMs = replayMs = persistMs = 0;
      persists = 0;
      if (measureLag) {
        lag = monitorEventLoopDelay({ resolution: 10 });
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
      join(id);
    },
    leaveClient(id) {
      const p = peerOf(id);
      if (p) peers.splice(peers.indexOf(p), 1);
      for (let a = 0; a < ACTOR_SLOTS; a++) if (slotOwner[a] === id) slotOwner[a] = -1;
    },
    submitStroke(clientId, stroke: StrokeRecord): Verdict {
      const t0 = performance.now();
      const code = server.submitStroke(stroke, broadcast);
      const t1 = performance.now();
      serverMs += t1 - t0;
      if (code !== STROKE_OK) return REJECTED[code - 1] ?? ACCEPTED;
      slotOwner[stroke.actorSlot] = clientId;
      const peer = peerOf(clientId);
      if (peer) {
        if (peer.lastAnchor !== stroke.anchor) {
          // Server-side position proxy for interest: the centre of the plot the actor last cleaned.
          const c = grid.centerDirection(stroke.anchor);
          peer.px = c.x;
          peer.py = c.y;
          peer.pz = c.z;
          peer.hasPosition = true;
          peer.lastAnchor = stroke.anchor;
        }
        const ring = peer.ring;
        if (ring) {
          // Local prediction: the stroke is drawn into the ring at once; nothing about it is ever sent.
          if (!ring.isAnchored) ring.centerOn(peer.px, peer.py, peer.pz);
          ring.drawStroke(grid.frame(stroke.anchor), stroke, stroke.depth16 / VISUAL_U0);
          replayMs += performance.now() - t1;
        }
      }
      return ACCEPTED;
    },
    submitRobotIntent(intent: RobotPlotIntent) {
      robotPlot = intent.plotId;
      const t0 = performance.now();
      const before = clientMs;
      const bytes = server.submitRobotIntent(intent, toInterested);
      serverMs += performance.now() - t0 - (clientMs - before);
      return bytes;
    },
    advance(n) {
      const t0 = performance.now();
      const before = clientMs;
      for (let k = 0; k < n; k++) {
        server.step(broadcast);
        if (server.tick % plotsFlushTicks === 0) server.flushPlots(broadcast);
        if (server.tick % ackFlushTicks === 0) server.flushAcks(toOwner);
      }
      serverMs += performance.now() - t0 - (clientMs - before);
    },
    serverHash: () => server.hash[0] ?? 0,
    clientHash: (id) => {
      const p = peerOf(id);
      return p ? (p.client.hash[0] ?? 0) : ~(server.hash[0] ?? 0) >>> 0;
    },
    clientBytesSent: (id) => peerOf(id)?.client.bytesReceived ?? 0,
    persist() {
      const t0 = performance.now();
      if (durable === null || server.checkpointDirty) {
        // Flush first so the durable hash is the hash every client has.
        server.flushPlots(broadcast);
        durable = server.encodeCheckpoint();
        durableHash = server.hash[0] ?? 0;
      } else {
        writeU32(durable, 5, server.tick >>> 0);
      }
      durableTick = server.tick;
      persistMs += performance.now() - t0;
      persists++;
      return { tick: durableTick, hash: durableHash };
    },
    crash() {
      server.reset();
      peers.length = 0;
      slotOwner.fill(-1);
    },
    restore() {
      const t0 = performance.now();
      const ok = durable !== null && server.restore(durable);
      const restoreMs = performance.now() - t0;
      return { tick: ok ? server.tick : 0, hash: server.hash[0] ?? 0, restoreMs };
    },
    serverCpuMs: () => serverMs,
    rssMb: () => process.memoryUsage().rss / (1024 * 1024),
    view(pose: CameraPose): FrameSample {
      const viewer = peerOf(0);
      if (!viewer) return { cpuMs: 0 };
      const t0 = performance.now();
      const ring = viewer.ring;
      if (ring && pose.heightM <= RING_MAX_HEIGHT_M) {
        const p = pose.position;
        const l = Math.hypot(p[0], p[1], p[2]) || 1;
        ring.centerOn(p[0] / l, p[1] / l, p[2] / l);
        ring.takeDirtyTexels();
      }
      const rows = viewer.client.takeDirtyRows();
      const replay = replayMs;
      replayMs = 0;
      // P1 has no tiles: `tileUploads` counts plot-table rows (512 texels each) that changed and need a GPU upload.
      return { cpuMs: performance.now() - t0 + replay, replayMs: replay, tileUploads: rows, tileRebuildMs: 0 };
    },
    lateJoin(id): LateJoinResult {
      const t0 = performance.now();
      const peer = join(id);
      const playableMs = performance.now() - t0;
      lastSnapshotDeflated = deflateSync(server.encodeSnapshot(), { level: 6 }).length;
      // The whole P1 world state is the L0 snapshot: nothing is streamed later and there are no tiles to rebuild.
      return { blockingBytes: peer.client.bytesReceived, streamedBytes: 0, playableMs, tileRebuildMs: 0 };
    },
    exportMetrics: () => ({
      serverPlotsNonDefault: server.nonDefaultCount,
      serverStrokesAccepted: server.strokesAccepted,
      serverRobotChunks: server.robotChunks,
      serverMsTotal: serverMs,
      clientDecodeMsTotal: clientMs,
      serverStateBytes: server.removed.byteLength + server.l0.byteLength,
      checkpointBytes: durable?.length ?? 0,
      checkpointMsMean: persists ? persistMs / persists : 0,
      snapshotBytes: lastSnapshotBytes,
      snapshotDeflatedBytes: lastSnapshotDeflated,
      shiftGrams: server.gramsOf(ACTOR_SLOTS - 1),
      actor0Grams: server.gramsOf(0),
      plotsFlushTicks,
    }),
  };
  if (measureLag) {
    // The histogram records the gap between 10 ms timer callbacks; the lag is the excess over the interval.
    adapter.eventLoopLagP99Ms = () => Math.max(0, (lag?.percentile(99) ?? 0) / 1e6 - 10);
  }
  return adapter;
}
