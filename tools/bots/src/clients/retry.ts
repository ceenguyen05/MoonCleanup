// Join retry with exponential backoff + jitter, so bots survive a server that is still starting or being restarted.

export interface RetryOptions {
  /** First delay between attempts. */
  readonly baseMs: number;
  /** Per-attempt delay ceiling (before jitter). */
  readonly capMs: number;
  /** Give up once this much wall time (per the injected clock) has been spent waiting; 0 = a single attempt. */
  readonly maxTotalMs: number;
  /** Label used in log lines, e.g. "bot 3". */
  readonly label: string;
}

export interface RetryDeps {
  readonly sleep: (ms: number) => Promise<void>;
  readonly rng: () => number;
  readonly log: (line: string) => void;
}

/** Node's fetch reports "fetch failed" with the real cause (ECONNREFUSED, ...) nested; surface both. */
function describeError(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const cause = (error as { cause?: unknown }).cause;
  if (cause instanceof Error) {
    const code = (cause as { code?: string }).code;
    return `${error.message}: ${code ?? cause.message}`;
  }
  return error.message;
}

/**
 * Colyseus SDK session-reconnect policy for a bot (the SDK's own automatic reconnect after a dropped socket). The SDK
 * default is 15 retries with delays doubling from 200 ms up to 5 s (about a minute in total), which keeps a bot
 * hanging for a minute against a dead server. Bots cap it at roughly 10 s: 7 retries, 100 ms base, 2 s ceiling =
 * 0.2 + 0.4 + 0.8 + 1.6 + 2 + 2 + 2 = 9 s of waiting. The room then finishes (`onLeave`), the bot reports `dropped`
 * and the scenario's join backoff (DEFAULT_RETRY) takes over or abandons it.
 */
export const SESSION_RECONNECT = { maxRetries: 7, delayMs: 100, minDelayMs: 100, maxDelayMs: 2000 } as const;

/** The slice of the SDK's `room.reconnection` that the cap touches. */
export interface ReconnectionLike {
  maxRetries: number;
  delay: number;
  minDelay: number;
  maxDelay: number;
  backoff: (attempt: number, delay: number) => number;
}

/** Applies SESSION_RECONNECT to a room's reconnection settings (keeps the SDK's exponential backoff function). */
export function capSessionReconnection<T extends ReconnectionLike>(reconnection: T): T {
  reconnection.maxRetries = SESSION_RECONNECT.maxRetries;
  reconnection.delay = SESSION_RECONNECT.delayMs;
  reconnection.minDelay = SESSION_RECONNECT.minDelayMs;
  reconnection.maxDelay = SESSION_RECONNECT.maxDelayMs;
  return reconnection;
}

/** Total waiting time of the SDK retry schedule for `reconnection` (delay formula copied from the SDK's retryReconnection). */
export function sessionReconnectBudgetMs(reconnection: ReconnectionLike): number {
  let total = 0;
  for (let attempt = 1; attempt <= reconnection.maxRetries; attempt++) {
    total += Math.min(
      reconnection.maxDelay,
      Math.max(reconnection.minDelay, reconnection.backoff(attempt, reconnection.delay)),
    );
  }
  return total;
}

export const DEFAULT_RETRY = { baseMs: 250, capMs: 5000, maxTotalMs: 60_000 } as const;

/** Delay before retry number `attempt` (1-based): min(cap, base * 2^(attempt-1)) scaled by jitter in [0.5, 1.0]. */
export function backoffDelayMs(attempt: number, o: Pick<RetryOptions, "baseMs" | "capMs">, rng: () => number): number {
  const raw = Math.min(o.capMs, o.baseMs * 2 ** Math.min(30, attempt - 1));
  return Math.round(raw * (0.5 + 0.5 * rng()));
}

/**
 * Runs `attempt` until it resolves. Failed attempts log a line, wait with backoff (never past the total budget) and
 * retry; when the budget is exhausted the last error is thrown wrapped with the attempt count.
 */
export async function withJoinRetry<T>(attempt: () => Promise<T>, o: RetryOptions, deps: RetryDeps): Promise<T> {
  let waited = 0;
  for (let n = 1; ; n++) {
    try {
      const result = await attempt();
      if (n > 1) deps.log(`[join] ${o.label}: connected on attempt ${n} after ${waited} ms of backoff`);
      return result;
    } catch (error) {
      const reason = describeError(error);
      const delay = Math.min(backoffDelayMs(n, o, deps.rng), o.maxTotalMs - waited);
      if (delay <= 0) {
        deps.log(`[join] ${o.label}: attempt ${n} failed (${reason}); giving up after ${waited} ms`);
        throw new Error(`join failed after ${n} attempt(s) and ${waited} ms: ${reason}`, { cause: error });
      }
      deps.log(`[join] ${o.label}: attempt ${n} failed (${reason}); retrying in ${delay} ms`);
      await deps.sleep(delay);
      waited += delay;
    }
  }
}
