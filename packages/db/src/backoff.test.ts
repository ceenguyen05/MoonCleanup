import { describe, expect, it } from "vitest";
import { DEFAULT_BACKOFF, backoffDelayMs, retryWithBackoff } from "./backoff.ts";
import { DbNotConfiguredError, errorCodeForLog, isUnreachableError } from "./errors.ts";

describe("backoffDelayMs", () => {
  it("doubles from 1 s and caps at 30 s", () => {
    expect([1, 2, 3, 4, 5, 6, 7, 20].map((n) => backoffDelayMs(n))).toEqual([
      1000, 2000, 4000, 8000, 16_000, 30_000, 30_000, 30_000,
    ]);
    expect(DEFAULT_BACKOFF).toEqual({ initialMs: 1000, maxMs: 30_000, factor: 2 });
  });
});

describe("retryWithBackoff", () => {
  it("retries retryable failures with growing waits and then succeeds", async () => {
    const waits: number[] = [];
    let calls = 0;
    const result = await retryWithBackoff(
      () => {
        calls += 1;
        return calls < 4
          ? Promise.reject(Object.assign(new Error("x"), { code: "ECONNREFUSED" }))
          : Promise.resolve("ok");
      },
      { maxAttempts: 10, isRetryable: isUnreachableError, sleep: (ms) => Promise.resolve(void waits.push(ms)) },
    );
    expect(result).toBe("ok");
    expect(waits).toEqual([1000, 2000, 4000]);
  });

  it("rethrows non-retryable errors immediately", async () => {
    let calls = 0;
    await expect(
      retryWithBackoff(
        () => {
          calls += 1;
          return Promise.reject(Object.assign(new Error("auth"), { code: "28P01" }));
        },
        { maxAttempts: 5, isRetryable: isUnreachableError, sleep: () => Promise.resolve() },
      ),
    ).rejects.toThrow("auth");
    expect(calls).toBe(1);
  });

  it("gives up after maxAttempts", async () => {
    let calls = 0;
    await expect(
      retryWithBackoff(
        () => {
          calls += 1;
          return Promise.reject(Object.assign(new Error("down"), { code: "ETIMEDOUT" }));
        },
        { maxAttempts: 3, isRetryable: isUnreachableError, sleep: () => Promise.resolve() },
      ),
    ).rejects.toThrow("down");
    expect(calls).toBe(3);
  });
});

describe("isUnreachableError", () => {
  it("recognises sleep/wake and network failures, including nested ones", () => {
    expect(isUnreachableError({ code: "ECONNREFUSED" })).toBe(true);
    expect(isUnreachableError({ code: "CONNECT_TIMEOUT" })).toBe(true);
    expect(isUnreachableError({ code: "57P03" })).toBe(true);
    expect(isUnreachableError({ code: "08006" })).toBe(true);
    expect(isUnreachableError({ errors: [{ code: "ECONNREFUSED" }] })).toBe(true);
    expect(isUnreachableError({ cause: { code: "ENOTFOUND" } })).toBe(true);
  });

  it("does not treat auth or syntax errors as unreachable", () => {
    expect(isUnreachableError({ code: "28P01" })).toBe(false);
    expect(isUnreachableError({ code: "42601" })).toBe(false);
    expect(isUnreachableError(new Error("boom"))).toBe(false);
    expect(isUnreachableError(null)).toBe(false);
  });

  it("logs only codes", () => {
    expect(errorCodeForLog({ code: "ECONNREFUSED", message: "postgres://u:p@h" })).toBe("ECONNREFUSED");
    expect(errorCodeForLog(new TypeError("x"))).toBe("TypeError");
    expect(new DbNotConfiguredError().message).toBe("database is not configured");
  });
});
