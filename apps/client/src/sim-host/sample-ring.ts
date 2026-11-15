// Fixed-size ring of timing samples with on-demand percentiles (latency instrumentation for E13/E14). `push` is the
// hot path (no allocation); `percentile` sorts into a preallocated scratch copy and is meant for 1 Hz stats or
// end-of-run reports.

export class SampleRing {
  private readonly data: Float64Array;
  private readonly scratch: Float64Array;
  private next = 0;
  private filled = 0;
  /** Samples pushed in total. */
  count = 0;
  /** Largest sample ever pushed. */
  max = 0;
  /** Sum of every sample ever pushed (mean = sum / count). */
  sum = 0;

  constructor(capacity = 512) {
    this.data = new Float64Array(capacity);
    this.scratch = new Float64Array(capacity);
  }

  push(v: number): void {
    this.data[this.next] = v;
    this.next = (this.next + 1) % this.data.length;
    if (this.filled < this.data.length) this.filled++;
    this.count++;
    this.sum += v;
    if (v > this.max) this.max = v;
  }

  /** Nearest-rank percentile (0 .. 100) over the retained window; 0 when empty. */
  percentile(p: number): number {
    const n = this.filled;
    if (n === 0) return 0;
    const s = this.scratch.subarray(0, n);
    s.set(this.data.subarray(0, n));
    s.sort();
    const rank = Math.min(n - 1, Math.max(0, Math.ceil((p / 100) * n) - 1));
    return s[rank] ?? 0;
  }

  reset(): void {
    this.next = 0;
    this.filled = 0;
    this.count = 0;
    this.max = 0;
    this.sum = 0;
  }
}
