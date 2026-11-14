// Allocation-free rolling statistics for the perf HUD and the stats export (M0-W2-T01).
// `RollingWindow.push` is the per-frame path and allocates nothing; `summarize` sorts a preallocated scratch copy
// and is meant for the HUD refresh (4 Hz) or the export, never for every frame.

export interface WindowSummary {
  samples: number;
  avg: number;
  min: number;
  max: number;
  p50: number;
  p95: number;
  p99: number;
}

/** Nearest-rank percentile of an ascending `sorted[0..count)`. `q` in [0, 1]. Returns 0 for an empty range. */
export function percentileSorted(sorted: ArrayLike<number>, count: number, q: number): number {
  if (count <= 0) return 0;
  const clamped = Math.min(1, Math.max(0, q));
  const rank = Math.max(1, Math.ceil(clamped * count));
  return sorted[Math.min(count, rank) - 1] ?? 0;
}

export function emptySummary(): WindowSummary {
  return { samples: 0, avg: 0, min: 0, max: 0, p50: 0, p95: 0, p99: 0 };
}

/** Fixed-capacity ring of the latest `capacity` samples. */
export class RollingWindow {
  private readonly values: Float64Array;
  private readonly scratch: Float64Array;
  private head = 0;
  private count = 0;

  constructor(readonly capacity: number) {
    if (!Number.isInteger(capacity) || capacity < 1) {
      throw new RangeError("RollingWindow: capacity must be an integer >= 1");
    }
    this.values = new Float64Array(capacity);
    this.scratch = new Float64Array(capacity);
  }

  get size(): number {
    return this.count;
  }

  push(value: number): void {
    this.values[this.head] = value;
    this.head = (this.head + 1) % this.capacity;
    if (this.count < this.capacity) this.count += 1;
  }

  clear(): void {
    this.head = 0;
    this.count = 0;
  }

  /** Fills `out` (reused) with the statistics of the current window. */
  summarize(out: WindowSummary): WindowSummary {
    const n = this.count;
    out.samples = n;
    if (n === 0) {
      out.avg = out.min = out.max = out.p50 = out.p95 = out.p99 = 0;
      return out;
    }
    // While filling, the live samples are values[0..n); once full, the whole ring. Order does not matter.
    const sorted = this.scratch.subarray(0, n);
    sorted.set(this.values.subarray(0, n));
    sorted.sort();
    let sum = 0;
    for (let i = 0; i < n; i++) sum += sorted[i] ?? 0;
    out.avg = sum / n;
    out.min = sorted[0] ?? 0;
    out.max = sorted[n - 1] ?? 0;
    out.p50 = percentileSorted(sorted, n, 0.5);
    out.p95 = percentileSorted(sorted, n, 0.95);
    out.p99 = percentileSorted(sorted, n, 0.99);
    return out;
  }
}
