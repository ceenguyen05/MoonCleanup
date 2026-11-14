import { createReconnection } from "@colyseus/sdk/Reconnection";
import { describe, expect, it } from "vitest";
import { createRng } from "../rng";
import {
  SESSION_RECONNECT,
  backoffDelayMs,
  capSessionReconnection,
  sessionReconnectBudgetMs,
  withJoinRetry,
  type RetryOptions,
} from "./retry";

const opts: RetryOptions = { baseMs: 100, capMs: 800, maxTotalMs: 5000, label: "bot 0" };

function harness() {
  const sleeps: number[] = [];
  const logs: string[] = [];
  return {
    sleeps,
    logs,
    deps: {
      sleep: async (ms: number) => void sleeps.push(ms),
      rng: createRng(4),
      log: (l: string) => void logs.push(l),
    },
  };
}

// Fake transport: ECONNREFUSED for the first `failures` attempts, then success.
function transport(failures: number) {
  let calls = 0;
  return {
    get calls() {
      return calls;
    },
    join: async (): Promise<string> => {
      calls++;
      if (calls <= failures) throw new Error("connect ECONNREFUSED 127.0.0.1:2571");
      return "room";
    },
  };
}

describe("backoffDelayMs", () => {
  it("doubles, caps and stays within the jitter band", () => {
    const rng = createRng(1);
    for (let a = 1; a <= 12; a++) {
      const raw = Math.min(800, 100 * 2 ** (a - 1));
      const d = backoffDelayMs(a, opts, rng);
      expect(d).toBeGreaterThanOrEqual(Math.floor(raw / 2));
      expect(d).toBeLessThanOrEqual(raw);
    }
  });
});

describe("withJoinRetry", () => {
  it("retries ECONNREFUSED with growing delays, then succeeds and logs", async () => {
    const h = harness();
    const t = transport(4);
    await expect(withJoinRetry(t.join, opts, h.deps)).resolves.toBe("room");
    expect(t.calls).toBe(5);
    expect(h.sleeps).toHaveLength(4);
    expect(h.sleeps[3] as number).toBeGreaterThan(h.sleeps[0] as number);
    expect(h.logs.filter((l) => l.includes("ECONNREFUSED") && l.includes("retrying in"))).toHaveLength(4);
    expect(h.logs.at(-1)).toContain("connected on attempt 5");
  });
  it("does not log or sleep when the first attempt succeeds", async () => {
    const h = harness();
    await withJoinRetry(transport(0).join, opts, h.deps);
    expect(h.sleeps).toEqual([]);
    expect(h.logs).toEqual([]);
  });
  it("gives up once the total wait budget is spent, never sleeping past it", async () => {
    const h = harness();
    const t = transport(1000);
    await expect(withJoinRetry(t.join, { ...opts, maxTotalMs: 1000 }, h.deps)).rejects.toThrow(/ECONNREFUSED/);
    expect(h.sleeps.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(1000);
    expect(h.logs.at(-1)).toContain("giving up");
  });
  it("maxTotalMs 0 means a single attempt", async () => {
    const h = harness();
    const t = transport(1000);
    await expect(withJoinRetry(t.join, { ...opts, maxTotalMs: 0 }, h.deps)).rejects.toThrow(/1 attempt/);
    expect(t.calls).toBe(1);
  });
  it("is deterministic for a seed", async () => {
    const run = async () => {
      const h = harness();
      await withJoinRetry(transport(5).join, opts, h.deps);
      return h.sleeps;
    };
    expect(await run()).toEqual(await run());
  });
});

describe("session reconnect cap (SDK auto-reconnect against a dead server)", () => {
  it("caps the SDK schedule to about 10 s where the default waits about a minute", () => {
    const sdkDefault = createReconnection();
    expect(sessionReconnectBudgetMs(sdkDefault)).toBeGreaterThan(50_000);

    const capped = capSessionReconnection(createReconnection());
    expect(capped.maxRetries).toBe(SESSION_RECONNECT.maxRetries);
    expect(capped.maxDelay).toBe(SESSION_RECONNECT.maxDelayMs);
    expect(sessionReconnectBudgetMs(capped)).toBe(9000);
    expect(sessionReconnectBudgetMs(capped)).toBeLessThanOrEqual(10_000);
    // Other SDK settings (enabled, backoff function, message buffer) are untouched.
    expect(capped.enabled).toBe(true);
    expect(capped.backoff).toBe(sdkDefault.backoff);
  });
  it("is idempotent", () => {
    const once = sessionReconnectBudgetMs(capSessionReconnection(createReconnection()));
    const twice = sessionReconnectBudgetMs(capSessionReconnection(capSessionReconnection(createReconnection())));
    expect(twice).toBe(once);
  });
});
