// Month-to-date egress survives restarts (M1-W5-T01, performance-budgets 6.2): the process-wide BandwidthCounter is
// seeded from `ops_usage_daily` at boot and its new bytes are added to today's row every 10 minutes and on shutdown.
// A failed write hands the bytes back to the counter, so an outage delays the row but never loses bytes (a hard crash
// loses at most the last 10 minutes of counting, acceptable for a visibility-only figure, OPEN_QUESTIONS Q4).

import { BandwidthCounter, monthKeyUtc } from "../ops/bandwidth";
import type { UsageRepository } from "./ports";

/** Write period of the usage row. */
export const USAGE_FLUSH_INTERVAL_MS = 10 * 60 * 1000;

/** `YYYY-MM-DD` in UTC. */
export function dayKeyUtc(epochMs: number): string {
  return new Date(epochMs).toISOString().slice(0, 10);
}

export interface UsagePersisterOptions {
  readonly repo: UsageRepository;
  readonly bandwidth: BandwidthCounter;
  readonly now?: () => number;
  readonly logger?: { warn(obj: object, msg: string): void };
  readonly intervalMs?: number;
}

export class UsagePersister {
  private readonly repo: UsageRepository;
  private readonly bandwidth: BandwidthCounter;
  private readonly now: () => number;
  private readonly logger: UsagePersisterOptions["logger"];
  private readonly intervalMs: number;
  private timer: ReturnType<typeof setInterval> | undefined;
  private flushing: Promise<void> | null = null;
  private seeded = false;
  readonly counters = { writes: 0, failures: 0, bytesWritten: 0 };

  constructor(options: UsagePersisterOptions) {
    this.repo = options.repo;
    this.bandwidth = options.bandwidth;
    this.now = options.now ?? Date.now;
    this.logger = options.logger;
    this.intervalMs = options.intervalMs ?? USAGE_FLUSH_INTERVAL_MS;
  }

  /** Seeds the counter from the stored month total. Never throws; a failure leaves the counter at zero (retried by flush). */
  async seed(): Promise<void> {
    const month = monthKeyUtc(this.now());
    try {
      this.bandwidth.seed(month, await this.repo.monthEgress(month));
      this.seeded = true;
    } catch {
      this.logger?.warn({ month }, "egress seed failed; month-to-date restarts from this boot");
    }
  }

  start(): void {
    if (this.timer !== undefined) return;
    this.timer = setInterval(() => void this.flush(), this.intervalMs);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer !== undefined) clearInterval(this.timer);
    this.timer = undefined;
  }

  /** Adds the not-yet-written bytes to today's row. Overlapping calls share one write. Never throws. */
  flush(): Promise<void> {
    this.flushing ??= this.flushNow().finally(() => {
      this.flushing = null;
    });
    return this.flushing;
  }

  private async flushNow(): Promise<void> {
    if (!this.seeded) await this.seed();
    const nowMs = this.now();
    const bytes = this.bandwidth.takeUnpersisted(nowMs);
    if (bytes === 0) return;
    try {
      await this.repo.addEgress(dayKeyUtc(nowMs), bytes);
      this.counters.writes++;
      this.counters.bytesWritten += bytes;
    } catch {
      this.counters.failures++;
      this.bandwidth.returnUnpersisted(bytes);
      this.logger?.warn({ bytes }, "egress write failed; bytes kept for the next flush");
    }
  }
}
