import { createMemoryRepository } from "@moon-cleanup/db";
import { describe, expect, it, vi } from "vitest";
import { createLazyPurge, LAZY_PURGE_RETRY_MS } from "./service";
import { createHarness } from "./test-harness";

const flush = async (): Promise<void> => {
  await new Promise<void>((resolve) => setImmediate(resolve));
};

function spyRepo() {
  const repo = createMemoryRepository();
  const purge = vi.spyOn(repo, "purgeRefreshTokens");
  return { repo, purge };
}

describe("lazy refresh-token purge", () => {
  it("runs on the first request, then at most once per interval", async () => {
    const { repo, purge } = spyRepo();
    const h = createHarness({ repo });
    let n = 1;
    const call = () => h.call("POST", "/v1/auth/guest", { body: {}, ip: `198.51.100.${n++}` });
    expect((await call()).status).toBe(201);
    await flush();
    expect(purge).toHaveBeenCalledTimes(1);

    h.advance(60 * 60 * 1000);
    await call();
    await flush();
    expect(purge).toHaveBeenCalledTimes(1);

    h.advance(24 * 60 * 60 * 1000);
    await call();
    await flush();
    expect(purge).toHaveBeenCalledTimes(2);
  });

  it("can be disabled with a zero interval", async () => {
    const { repo, purge } = spyRepo();
    const off = createHarness({ repo, purgeIntervalMs: 0 });
    await off.call("POST", "/v1/auth/guest", { body: {} });
    await flush();
    expect(purge).not.toHaveBeenCalled();
  });

  it("a failing purge is logged by code only, never throws into the request, and retries after the retry gap", async () => {
    let clock = 1_000;
    const calls: string[] = [];
    const errors: string[] = [];
    const fn = createLazyPurge({
      repo: {
        purgeRefreshTokens: () => {
          calls.push("p");
          return Promise.reject(new Error("connect ECONNREFUSED db.secret-host.example:5432"));
        },
      },
      logger: { warn: () => undefined, error: (obj) => errors.push(JSON.stringify(obj)) },
      now: () => clock,
      intervalMs: 24 * 60 * 60 * 1000,
    });
    fn();
    await flush();
    expect(calls).toHaveLength(1);
    expect(errors.join("")).not.toContain("secret-host");

    clock += LAZY_PURGE_RETRY_MS - 1;
    fn();
    await flush();
    expect(calls).toHaveLength(1);

    clock += 2;
    fn();
    await flush();
    expect(calls).toHaveLength(2);
  });

  it("never overlaps two purges", async () => {
    let release: (n: number) => void = () => undefined;
    let count = 0;
    let clock = 0;
    const fn = createLazyPurge({
      repo: {
        purgeRefreshTokens: () => {
          count += 1;
          return new Promise<number>((resolve) => {
            release = resolve;
          });
        },
      },
      logger: { warn: () => undefined, error: () => undefined },
      now: () => clock,
      intervalMs: 10,
    });
    fn();
    clock = 100;
    fn();
    expect(count).toBe(1);
    release(0);
    await flush();
    fn();
    expect(count).toBe(2);
  });
});
