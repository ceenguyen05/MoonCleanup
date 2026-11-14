// Node process probe and the reporter that turns RoomStats and the bandwidth counter into log lines:
// one line per room per minute (every 10 s when NET_SPIKE=1) and one bandwidth line per hour.

import { monitorEventLoopDelay } from "node:perf_hooks";
import type { Logger } from "pino";
import { BandwidthCounter } from "./bandwidth";
import { LateInputLog } from "./late-input-log";
import { RoomStats, type ProcessProbe } from "./room-stats";

/** Real probe: `process.cpuUsage` and a `monitorEventLoopDelay` histogram (20 ms resolution). */
export function createNodeProcessProbe(): ProcessProbe & { dispose(): void } {
  const histogram = monitorEventLoopDelay({ resolution: 20 });
  histogram.enable();
  return {
    cpuMicros() {
      const usage = process.cpuUsage();
      return usage.user + usage.system;
    },
    eventLoopDelayP99Ms() {
      return histogram.count === 0 ? 0 : histogram.percentile(99) / 1e6;
    },
    resetWindow() {
      histogram.reset();
    },
    memoryBytes() {
      const usage = process.memoryUsage();
      return { rss: usage.rss, heapUsed: usage.heapUsed, heapTotal: usage.heapTotal };
    },
    dispose() {
      histogram.disable();
    },
  };
}

export interface TimerApi {
  setInterval(fn: () => void, ms: number): unknown;
  clearInterval(handle: unknown): void;
}

const realTimers: TimerApi = {
  setInterval(fn, ms) {
    const handle = setInterval(fn, ms);
    handle.unref();
    return handle;
  },
  clearInterval(handle) {
    clearInterval(handle as NodeJS.Timeout);
  },
};

export interface StatsReporterOptions {
  readonly logger: Logger;
  readonly probe: ProcessProbe;
  /** NET_SPIKE=1: room lines every 10 s instead of every 60 s. */
  readonly netSpike: boolean;
  readonly now?: () => number;
  readonly timers?: TimerApi;
}

export const ROOM_LINE_INTERVAL_MS = 60_000;
export const SPIKE_ROOM_LINE_INTERVAL_MS = 10_000;
export const BANDWIDTH_LINE_INTERVAL_MS = 3_600_000;

/** Owns the process-wide bandwidth counter and the registry of live rooms' stats. */
export class StatsReporter {
  readonly bandwidth: BandwidthCounter;
  private readonly rooms = new Map<string, RoomStats>();
  private readonly logger: Logger;
  private readonly probe: ProcessProbe;
  private readonly now: () => number;
  private readonly timers: TimerApi;
  private readonly roomIntervalMs: number;
  private handles: unknown[] = [];

  constructor(options: StatsReporterOptions) {
    this.logger = options.logger;
    this.probe = options.probe;
    this.now = options.now ?? Date.now;
    this.timers = options.timers ?? realTimers;
    this.roomIntervalMs = options.netSpike ? SPIKE_ROOM_LINE_INTERVAL_MS : ROOM_LINE_INTERVAL_MS;
    this.bandwidth = new BandwidthCounter(this.now());
  }

  /** Registers a room and returns its stats handle (the room calls `recordTick`/`recordBytesOut` on it). */
  addRoom(roomId: string): RoomStats {
    const lateLog = new LateInputLog(this.logger, roomId, this.now);
    const stats = new RoomStats(roomId, this.probe, this.bandwidth, this.now(), {
      onLateInputs: (count) => lateLog.record(count),
    });
    this.rooms.set(roomId, stats);
    return stats;
  }

  /** Emits a final line for the room and forgets it. */
  removeRoom(roomId: string): void {
    const stats = this.rooms.get(roomId);
    if (stats === undefined) return;
    this.emitRoom(stats);
    this.rooms.delete(roomId);
  }

  roomCount(): number {
    return this.rooms.size;
  }

  /** Σ of live rooms' current-window tick p95, for admission control (netcode.md section 15). */
  sumTickP95Ms(): number {
    let sum = 0;
    for (const stats of this.rooms.values()) sum += stats.currentTickP95Ms();
    return sum;
  }

  start(): void {
    if (this.handles.length > 0) return;
    this.handles = [
      this.timers.setInterval(() => this.emitRooms(), this.roomIntervalMs),
      this.timers.setInterval(() => this.emitBandwidth(), BANDWIDTH_LINE_INTERVAL_MS),
    ];
  }

  stop(): void {
    for (const handle of this.handles) this.timers.clearInterval(handle);
    this.handles = [];
  }

  /** One line per live room, then a new event-loop-delay window. */
  emitRooms(): void {
    for (const stats of this.rooms.values()) this.emitRoom(stats);
    this.probe.resetWindow();
  }

  emitBandwidth(): void {
    const report = this.bandwidth.report(this.now());
    this.logger.info({ kind: "bandwidth", ...report }, "bandwidth month-to-date");
  }

  private emitRoom(stats: RoomStats): void {
    const snapshot = stats.snapshotAndReset(this.now());
    // RSS and heap ride on every room line (the 512 MB free instance is the other budget besides CPU).
    this.logger.info({ kind: "room-stats", ...snapshot, ...this.memoryFields() }, "room stats");
  }

  private memoryFields(): { rssMb?: number; heapUsedMb?: number; heapTotalMb?: number } {
    const memory = this.probe.memoryBytes?.();
    if (memory === undefined) return {};
    const mb = (bytes: number): number => Math.round((bytes / 1_048_576) * 10) / 10;
    return { rssMb: mb(memory.rss), heapUsedMb: mb(memory.heapUsed), heapTotalMb: mb(memory.heapTotal) };
  }
}
