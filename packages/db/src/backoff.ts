// Retry with exponential backoff for the first database connection after Neon Free scales the compute to zero when idle
// (environments.md section 6). The default policy waits 1 s, 2 s, 4 s ... capped at 30 s.

export interface BackoffPolicy {
  readonly initialMs: number;
  readonly maxMs: number;
  readonly factor: number;
}

export const DEFAULT_BACKOFF: BackoffPolicy = { initialMs: 1000, maxMs: 30_000, factor: 2 };

/** Delay before retry number `attempt` (1 = first retry). */
export function backoffDelayMs(attempt: number, policy: BackoffPolicy = DEFAULT_BACKOFF): number {
  const exponent = Math.max(0, attempt - 1);
  return Math.min(policy.maxMs, Math.round(policy.initialMs * policy.factor ** exponent));
}

export interface RetryOptions {
  readonly policy?: BackoffPolicy;
  /** Give up after this many attempts in total (first try included). */
  readonly maxAttempts: number;
  readonly isRetryable: (error: unknown) => boolean;
  readonly sleep?: (ms: number) => Promise<void>;
  /** Called before each wait; must never receive secrets (the error is passed so callers can classify it). */
  readonly onRetry?: (info: { attempt: number; delayMs: number; error: unknown }) => void;
}

const defaultSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Runs `operation`, retrying retryable failures with backoff; rethrows the last error when attempts run out. */
export async function retryWithBackoff<T>(operation: () => Promise<T>, options: RetryOptions): Promise<T> {
  const sleep = options.sleep ?? defaultSleep;
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (attempt >= options.maxAttempts || !options.isRetryable(error)) throw error;
      const delayMs = backoffDelayMs(attempt, options.policy);
      options.onRetry?.({ attempt, delayMs, error });
      await sleep(delayMs);
    }
  }
}
