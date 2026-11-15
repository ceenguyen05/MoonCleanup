// Health of the server's link to the database (netcode.md section 16, "DB powered off / unreachable"): running rooms
// continue, checkpoints retry with backoff 1 -> 30 s, dirty state stays in memory, NEW rooms are refused. Neon Free
// scales to zero when idle, so the first call after a quiet period may fail or take seconds: every call is bounded by a
// timeout and a failed or timed-out call counts as an outage until one call succeeds again.
//
// The link never sleeps or retries by itself: callers ask `canAttempt(now)` (cheap, no I/O) and decide. That keeps the
// 20 Hz room loop free of timers and makes the whole policy testable with a fake clock.

import { backoffDelayMs, errorCodeForLog } from "@moon-cleanup/db";
import { ContractUnavailableError } from "./ports";

export interface StorageLinkOptions {
  /** Epoch ms clock. Default `Date.now`. */
  readonly now?: () => number;
  /** Default per-call bound. Saves use the default; load and lease calls pass a longer one (cold start). */
  readonly timeoutMs?: number;
  readonly onStateChange?: (state: StorageLinkState, info: { failures: number; code: string }) => void;
}

export type StorageLinkState = "ok" | "down";

export class StorageTimeoutError extends Error {
  readonly code = "STORAGE_TIMEOUT";
  constructor(ms: number) {
    super(`storage call exceeded ${ms} ms`);
    this.name = "StorageTimeoutError";
  }
}

/** Default bound of a save call (netcode.md 9.3: "<= 3 s each" at SIGTERM; a little slack for a cold compute). */
export const STORAGE_SAVE_TIMEOUT_MS = 5_000;
/** Bound of load / lease calls, which may be the first call to wake a powered-off database. */
export const STORAGE_WAKE_TIMEOUT_MS = 15_000;

export class StorageLink {
  private readonly now: () => number;
  private readonly timeoutMs: number;
  private readonly onStateChange: StorageLinkOptions["onStateChange"];
  private _state: StorageLinkState = "ok";
  private _failures = 0;
  private _nextAttemptAtMs = 0;
  private _lastCode = "";
  /** Failed calls since boot (ops). */
  totalFailures = 0;

  constructor(options: StorageLinkOptions = {}) {
    this.now = options.now ?? Date.now;
    this.timeoutMs = options.timeoutMs ?? STORAGE_SAVE_TIMEOUT_MS;
    this.onStateChange = options.onStateChange;
  }

  get state(): StorageLinkState {
    return this._state;
  }

  get isDown(): boolean {
    return this._state === "down";
  }

  /** Consecutive failed calls (0 when healthy). */
  get failures(): number {
    return this._failures;
  }

  get lastErrorCode(): string {
    return this._lastCode;
  }

  /** Backoff the next call must wait out after the latest failure (0 when healthy): 1, 2, 4 ... 30 s. */
  get retryDelayMs(): number {
    return this._failures === 0 ? 0 : backoffDelayMs(this._failures);
  }

  /** True when a call may be issued now: healthy, or down and the backoff has elapsed. No I/O. */
  canAttempt(nowMs: number = this.now()): boolean {
    return this._state === "ok" || nowMs >= this._nextAttemptAtMs;
  }

  /**
   * Runs one storage call bounded by `timeoutMs`. A rejection or timeout marks the link down and schedules the next
   * attempt; a `ContractUnavailableError` is a verdict about one Contract, not an outage, and passes through.
   */
  async run<T>(op: () => Promise<T>, timeoutMs: number = this.timeoutMs): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const result = await Promise.race([
        op(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new StorageTimeoutError(timeoutMs)), timeoutMs);
          timer.unref?.();
        }),
      ]);
      this.succeeded();
      return result;
    } catch (error) {
      if (error instanceof ContractUnavailableError) {
        // The database answered; it just refused this Contract.
        this.succeeded();
        throw error;
      }
      this.failed(error);
      throw error;
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }

  private succeeded(): void {
    if (this._state === "down") {
      const failures = this._failures;
      this._state = "ok";
      this._failures = 0;
      this._nextAttemptAtMs = 0;
      this.onStateChange?.("ok", { failures, code: this._lastCode });
    }
  }

  private failed(error: unknown): void {
    this.totalFailures++;
    this._failures++;
    this._lastCode = errorCodeForLog(error);
    this._nextAttemptAtMs = this.now() + backoffDelayMs(this._failures);
    if (this._state === "ok") {
      this._state = "down";
      this.onStateChange?.("down", { failures: this._failures, code: this._lastCode });
    }
  }
}
