// Process-wide decompression budget of the checkpoint service (security review H1 residual R1). One instance serves every
// upload verification and every download, so the whole process (one Render Free instance, 0.1 CPU, 512 MB) is bounded no
// matter how many accounts push at once. It sits on top of the per-upload cap (CHECKPOINT_RAW_BUDGET_BYTES, 32 MiB declared
// inflated bytes) and the per-player limits:
//
//   1. CONCURRENCY: at most `maxConcurrent` jobs inflate at once (default 1), at most `maxQueued` wait; more is shed (503).
//      Ownership is handed straight to the next waiter (`running` is never lowered in between), so no late arrival can slip
//      into the gap (security review L1).
//   2. RATE: a token bucket of `bytesPerMinute` inflated bytes. A job is charged its worst-case inflated size before it
//      runs. When the bucket cannot cover it the job is shed at once (never queued) with a `retryAfterS`, so a stream of
//      accepted-but-expensive uploads from many guest accounts cannot keep the instance's CPU saturated: rooms and REST
//      keep their share. The refill is continuous (rate = bytesPerMinute / 60 s).
//
// Memory is NOT the limit this guards: a verification inflates one chunk at a time (<= 421,959 B each) and holds the <= 1 MiB
// request body, so even `maxConcurrent` = 4 stays far below the 384 MB heap cap. CPU time is the scarce resource.

export interface InflateBudgetOptions {
  /** Jobs that may inflate at once (>= 1). */
  readonly maxConcurrent: number;
  /** Jobs that may wait for a free slot (>= 0); beyond it a job is shed. */
  readonly maxQueued: number;
  /** Token bucket size and per-minute refill, in inflated bytes (>= 1). */
  readonly bytesPerMinute: number;
  /** Test seam: epoch/monotonic ms. */
  readonly now?: () => number;
}

export type BudgetResult<T> =
  | { readonly ok: true; readonly value: T }
  /** Shed: nothing ran, the caller answers 503 RETRY_LATER with `retryAfterS`. */
  | { readonly ok: false; readonly retryAfterS: number };

export interface InflateBudget {
  /** Runs `job` once the budget admits it. `cost` = worst-case inflated bytes of the job (clamped to 1..bytesPerMinute). */
  run<T>(cost: number, job: () => Promise<T>): Promise<BudgetResult<T>>;
  /** Snapshot for tests and diagnostics. */
  stats(): { readonly running: number; readonly queued: number; readonly tokens: number };
}

/** Retry hint when the queue is full (the jobs ahead take seconds, not a bucket refill). */
const QUEUE_FULL_RETRY_AFTER_S = 5;
/** Upper bound of the hinted wait, so a client never sleeps for minutes on a refill estimate. */
const MAX_RETRY_AFTER_S = 60;

export function createInflateBudget(options: InflateBudgetOptions): InflateBudget {
  const maxConcurrent = Math.max(1, Math.floor(options.maxConcurrent));
  const maxQueued = Math.max(0, Math.floor(options.maxQueued));
  const capacity = Math.max(1, options.bytesPerMinute);
  const refillPerMs = capacity / 60_000;
  const clock = options.now ?? (() => performance.now());

  let tokens = capacity;
  let lastRefill = clock();
  let running = 0;
  const waiting: (() => void)[] = [];

  const refill = (): void => {
    const at = clock();
    if (at > lastRefill) tokens = Math.min(capacity, tokens + (at - lastRefill) * refillPerMs);
    lastRefill = at;
  };

  return {
    async run<T>(cost: number, job: () => Promise<T>): Promise<BudgetResult<T>> {
      const charge = Math.min(capacity, Math.max(1, Math.ceil(cost)));
      refill();
      if (tokens < charge) {
        const waitS = Math.ceil((charge - tokens) / refillPerMs / 1000);
        return { ok: false, retryAfterS: Math.min(MAX_RETRY_AFTER_S, Math.max(1, waitS)) };
      }
      const mustWait = running >= maxConcurrent;
      if (mustWait && waiting.length >= maxQueued) return { ok: false, retryAfterS: QUEUE_FULL_RETRY_AFTER_S };
      tokens -= charge;
      if (mustWait) await new Promise<void>((resolve) => waiting.push(resolve));
      else running += 1;
      try {
        return { ok: true, value: await job() };
      } finally {
        const next = waiting.shift();
        if (next === undefined) running -= 1;
        else next(); // the slot passes to the waiter: `running` stays as it is
      }
    },
    stats: () => {
      refill();
      return { running, queued: waiting.length, tokens: Math.floor(tokens) };
    },
  };
}
