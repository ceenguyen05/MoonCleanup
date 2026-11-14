// Rate-limited log of late-input drops. An input is "late" when its sequence number was already consumed or received
// (a duplicate, or a reordered packet that arrives after a substitution). Dropping it is correct (netcode.md section
// 5.1) but a burst means the client's uplink is jittering, so ops wants to see it without a log line per packet: at most
// one `warn` per interval per room, carrying the number dropped since the previous line. The running total is also in
// the room-stats line (`lateInputs`), so nothing is lost when the log is throttled.

import type { Logger } from "pino";

/** Minimum spacing between late-input log lines of one room. */
export const LATE_INPUT_LOG_INTERVAL_MS = 10_000;

export class LateInputLog {
  private pending = 0;
  private lastLogAt = Number.NEGATIVE_INFINITY;

  constructor(
    private readonly logger: Pick<Logger, "warn">,
    private readonly roomId: string,
    private readonly now: () => number = Date.now,
    private readonly intervalMs: number = LATE_INPUT_LOG_INTERVAL_MS,
  ) {}

  /** Counts `count` dropped inputs; emits one warn line when the interval has elapsed. Allocation-free when throttled. */
  record(count: number): void {
    if (!(count > 0)) return;
    this.pending += count;
    const now = this.now();
    if (now - this.lastLogAt < this.intervalMs) return;
    const sinceMs = Number.isFinite(this.lastLogAt) ? now - this.lastLogAt : 0;
    this.logger.warn(
      { kind: "late-inputs", roomId: this.roomId, dropped: this.pending, sinceLastLogS: Math.round(sinceMs / 1000) },
      "late inputs dropped",
    );
    this.pending = 0;
    this.lastLogAt = now;
  }
}
