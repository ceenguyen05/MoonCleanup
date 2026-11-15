// Process-wide bytes-out counter with a month-to-date running total (performance-budgets section 6.2, OPEN_QUESTIONS Q4:
// the owner accepted visibility only, no cap logic). `add` is allocation-free and safe on the send path.
//
// Month attribution: bytes are accumulated in `pending` and folded into the month total by `flush(nowMs)`, so a few
// minutes of traffic around a UTC month boundary can land in the neighbouring month (Render bills on its own cycle
// anyway). The running total survives restarts only if the caller seeds it (from `ops_usage_daily`, M1).

/** `YYYY-MM` in UTC for an epoch-ms timestamp. */
export function monthKeyUtc(epochMs: number): string {
  const d = new Date(epochMs);
  const month = d.getUTCMonth() + 1;
  return `${d.getUTCFullYear()}-${month < 10 ? "0" : ""}${month}`;
}

export interface BandwidthReport {
  /** `YYYY-MM` (UTC) the month-to-date total belongs to. */
  readonly month: string;
  /** Bytes sent since the previous report. */
  readonly bytesSincePreviousReport: number;
  readonly monthToDateBytes: number;
  /** Month-to-date against the 5 GB Render Free allowance (5,000 MB), as a percentage. For visibility only. */
  readonly percentOfAllowance: number;
}

export const EGRESS_ALLOWANCE_BYTES = 5_000_000_000;

export class BandwidthCounter {
  private pending = 0;
  private sinceReport = 0;
  private monthBytes = 0;
  private month: string;
  /** Bytes folded in since the last `takeUnpersisted` (the delta `ops_usage_daily` still has to receive). */
  private unpersisted = 0;

  constructor(startMs: number = Date.now()) {
    this.month = monthKeyUtc(startMs);
  }

  /**
   * Flushes and hands out the bytes not yet written to `ops_usage_daily` (zeroing them). A failed write calls
   * `returnUnpersisted` so the bytes are retried, never lost.
   */
  takeUnpersisted(nowMs: number): number {
    this.flush(nowMs);
    const bytes = this.unpersisted;
    this.unpersisted = 0;
    return bytes;
  }

  returnUnpersisted(bytes: number): void {
    this.unpersisted += bytes;
  }

  /** Hot path: count bytes handed to the transport. */
  add(bytes: number): void {
    this.pending += bytes;
  }

  /** Restores a persisted month-to-date total (ignored if it belongs to a different month than now). */
  seed(month: string, monthToDateBytes: number): void {
    if (month === this.month) this.monthBytes = Math.max(this.monthBytes, monthToDateBytes);
  }

  /** Folds pending bytes into the month total, rolling the month over first when the UTC month changed. */
  flush(nowMs: number): void {
    const month = monthKeyUtc(nowMs);
    if (month !== this.month) {
      this.month = month;
      this.monthBytes = 0;
    }
    this.monthBytes += this.pending;
    this.sinceReport += this.pending;
    this.unpersisted += this.pending;
    this.pending = 0;
  }

  /** Flushes and returns the figures for the hourly log line. */
  report(nowMs: number): BandwidthReport {
    this.flush(nowMs);
    const since = this.sinceReport;
    this.sinceReport = 0;
    return {
      month: this.month,
      bytesSincePreviousReport: since,
      monthToDateBytes: this.monthBytes,
      percentOfAllowance: Math.round((this.monthBytes / EGRESS_ALLOWANCE_BYTES) * 10_000) / 100,
    };
  }
}
