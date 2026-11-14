// Per-room operational statistics (netcode.md section 14/16, performance-budgets section 6). The tick path calls
// `recordTick` and `recordBytesOut`; both are allocation-free after warm-up (typed-array ring, Map of counters).
// Percentiles are computed only when a snapshot is taken (once a minute), never per tick.

import type { BandwidthCounter } from "./bandwidth";

/** Samples kept per window: 2,048 covers 60 s at 30 Hz (1,800) with headroom; older samples are overwritten. */
const RING_CAPACITY = 2048;

/** Render Free instance CPU quota (0.1 CPU); CPU % is reported against it so 100 % means "at the quota". */
export const CPU_QUOTA_FRACTION = 0.1;

/** Process-wide readings supplied to snapshots (injectable so the math is testable). */
export interface ProcessProbe {
  /** Cumulative user+system CPU time of the process, microseconds. */
  cpuMicros(): number;
  /** 99th percentile event-loop delay since the last `resetWindow`, milliseconds. */
  eventLoopDelayP99Ms(): number;
  /** Starts a new event-loop-delay measurement window. */
  resetWindow(): void;
  /** Process memory in bytes (`process.memoryUsage()`); optional so test fakes stay small. */
  memoryBytes?(): ProcessMemory;
}

export interface ProcessMemory {
  readonly rss: number;
  readonly heapUsed: number;
  readonly heapTotal: number;
}

/** Receives late-input counts as they happen (ops builds a rate-limited logger on top). */
export interface RoomStatsHooks {
  onLateInputs?(count: number): void;
}

export interface TickTimings {
  readonly count: number;
  readonly p50Ms: number;
  readonly p95Ms: number;
  readonly maxMs: number;
}

export interface RoomStatsSnapshot {
  readonly roomId: string;
  readonly clients: number;
  readonly windowS: number;
  readonly tick: TickTimings;
  readonly bytesOut: number;
  /** Bytes out per message type in the window. */
  readonly bytesOutByType: Readonly<Record<string, number>>;
  /** Process CPU over the window as a percentage of the 0.1-CPU quota. */
  readonly cpuPercentOfQuota: number;
  readonly eventLoopDelayP99Ms: number;
  /** Inputs dropped as late/duplicate in the window (not a violation; see LateInputLog). */
  readonly lateInputs: number;
}

/** Nearest-rank percentile of an ascending-sorted view; `p` in (0, 1]. */
export function percentileSorted(sorted: Float64Array, p: number): number {
  const n = sorted.length;
  if (n === 0) return 0;
  const rank = Math.min(n, Math.max(1, Math.ceil(p * n)));
  return sorted[rank - 1] ?? 0;
}

/**
 * Shortest wall-time window with a meaningful CPU reading. A near-empty final window (room disposed right after a
 * snapshot) divided a few ms of CPU by a few ms of wall time and reported thousands of percent.
 */
export const MIN_CPU_WINDOW_MS = 1000;

/** CPU % of the quota for `cpuDeltaMicros` of CPU used over `elapsedMs` of wall time; 0 below the minimum window. */
export function cpuPercentOfQuota(cpuDeltaMicros: number, elapsedMs: number): number {
  if (!(elapsedMs >= MIN_CPU_WINDOW_MS) || cpuDeltaMicros <= 0) return 0;
  return (cpuDeltaMicros / 1000 / elapsedMs / CPU_QUOTA_FRACTION) * 100;
}

const round = (value: number, places: number): number => {
  const f = 10 ** places;
  return Math.round(value * f) / f;
};

export class RoomStats {
  readonly roomId: string;
  private clients = 0;
  private readonly samples = new Float64Array(RING_CAPACITY);
  private readonly scratch = new Float64Array(RING_CAPACITY);
  private writeIndex = 0;
  private sampleCount = 0;
  private tickCount = 0;
  private maxTickMs = 0;
  private bytesOutTotal = 0;
  private readonly bytesByType = new Map<string, number>();
  private lateInputsTotal = 0;
  private windowStartMs: number;
  private cpuAtWindowStart: number;

  constructor(
    roomId: string,
    private readonly probe: ProcessProbe,
    private readonly bandwidth: BandwidthCounter | undefined,
    startMs: number,
    private readonly hooks: RoomStatsHooks | undefined = undefined,
  ) {
    this.roomId = roomId;
    this.windowStartMs = startMs;
    this.cpuAtWindowStart = probe.cpuMicros();
  }

  setClients(count: number): void {
    this.clients = count;
  }

  /** Hot path: duration of one simulation tick in milliseconds. */
  recordTick(durationMs: number): void {
    this.samples[this.writeIndex] = durationMs;
    this.writeIndex = (this.writeIndex + 1) % RING_CAPACITY;
    if (this.sampleCount < RING_CAPACITY) this.sampleCount += 1;
    this.tickCount += 1;
    if (durationMs > this.maxTickMs) this.maxTickMs = durationMs;
  }

  /** Hot path: bytes written to the transport for one message of `type` (also feeds the process-wide counter). */
  recordBytesOut(type: string, bytes: number): void {
    this.bytesOutTotal += bytes;
    this.bytesByType.set(type, (this.bytesByType.get(type) ?? 0) + bytes);
    this.bandwidth?.add(bytes);
  }

  /** Inputs dropped as late/duplicate (call only when `count > 0`; the hook rate-limits its own log line). */
  recordLateInputs(count: number): void {
    if (!(count > 0)) return;
    this.lateInputsTotal += count;
    this.hooks?.onLateInputs?.(count);
  }

  /** p95 of the current window without resetting it (used by admission control). */
  currentTickP95Ms(): number {
    if (this.sampleCount === 0) return 0;
    return percentileSorted(this.sortedWindow(), 0.95);
  }

  /** Builds the window snapshot and starts a new window. */
  snapshotAndReset(nowMs: number): RoomStatsSnapshot {
    const sorted = this.sortedWindow();
    const cpuNow = this.probe.cpuMicros();
    const elapsedMs = nowMs - this.windowStartMs;
    const byType: Record<string, number> = {};
    for (const [type, bytes] of this.bytesByType) byType[type] = bytes;

    const snapshot: RoomStatsSnapshot = {
      roomId: this.roomId,
      clients: this.clients,
      windowS: round(elapsedMs / 1000, 1),
      tick: {
        count: this.tickCount,
        p50Ms: round(percentileSorted(sorted, 0.5), 3),
        p95Ms: round(percentileSorted(sorted, 0.95), 3),
        maxMs: round(this.maxTickMs, 3),
      },
      bytesOut: this.bytesOutTotal,
      bytesOutByType: byType,
      cpuPercentOfQuota: round(cpuPercentOfQuota(cpuNow - this.cpuAtWindowStart, elapsedMs), 1),
      eventLoopDelayP99Ms: round(this.probe.eventLoopDelayP99Ms(), 2),
      lateInputs: this.lateInputsTotal,
    };

    this.lateInputsTotal = 0;
    this.writeIndex = 0;
    this.sampleCount = 0;
    this.tickCount = 0;
    this.maxTickMs = 0;
    this.bytesOutTotal = 0;
    this.bytesByType.clear();
    this.windowStartMs = nowMs;
    this.cpuAtWindowStart = cpuNow;
    return snapshot;
  }

  private sortedWindow(): Float64Array {
    const view = this.scratch.subarray(0, this.sampleCount);
    view.set(this.samples.subarray(0, this.sampleCount));
    return view.sort();
  }
}
