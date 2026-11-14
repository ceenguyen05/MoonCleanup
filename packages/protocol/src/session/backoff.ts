// Deterministic retry schedule for the session (netcode.md sections 9.2 and 10). Pure: jitter, if wanted, comes from an
// injected `random` (0 .. 1) so tests stay deterministic.

export interface BackoffOptions {
  /** First delay, ms. */
  baseMs: number;
  /** Delay cap, ms. */
  maxMs: number;
  /** Growth factor per attempt (default 2). */
  factor?: number;
  /** Symmetric jitter ratio 0 .. 1 applied to the delay (default 0). */
  jitter?: number;
}

/** Seat-hold reconnect: 0.5, 1, 2, 4, 8, 8, ... s (netcode.md section 9.2). */
export const RECONNECT_BACKOFF: BackoffOptions = { baseMs: 500, maxMs: 8000 };
/** First join after the wake probe succeeded: 1, 2, 4, 8, 8 ... s. */
export const CONNECT_BACKOFF: BackoffOptions = { baseMs: 1000, maxMs: 8000 };

/** Delay before attempt number `attempt` (0 = the first retry). */
export function backoffDelayMs(options: BackoffOptions, attempt: number, random: () => number = () => 0.5): number {
  const factor = options.factor ?? 2;
  const raw = Math.min(options.maxMs, options.baseMs * Math.pow(factor, Math.max(0, attempt)));
  const jitter = options.jitter ?? 0;
  if (jitter <= 0) return raw;
  const spread = raw * jitter;
  return Math.max(0, raw - spread + 2 * spread * random());
}
