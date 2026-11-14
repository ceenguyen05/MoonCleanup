import { describe, expect, it } from "vitest";
import { percentiles } from "../stats";
import { isLocalUrl } from "../scenarios/spike16";
import { parseServerLog } from "./report";

describe("percentiles", () => {
  it("uses nearest rank", () => {
    expect(percentiles([5, 1, 3, 2, 4])).toMatchObject({ n: 5, p50: 3, max: 5 });
    expect(percentiles([])).toMatchObject({ n: 0, max: 0 });
  });
});

describe("parseServerLog", () => {
  const line = (o: object) => JSON.stringify(o);
  it("summarizes room-stats and spike-loop lines, skipping warm-up and junk", () => {
    const text = [
      "not json",
      line({
        kind: "room-stats",
        clients: 6,
        windowS: 10,
        tick: { p50Ms: 9, p95Ms: 9, maxMs: 99 },
        bytesOutByType: { FRAME: 1 },
        cpuPercentOfQuota: 90,
        eventLoopDelayP99Ms: 99,
      }),
      line({
        kind: "room-stats",
        clients: 6,
        windowS: 10,
        tick: { p50Ms: 0.2, p95Ms: 0.5, maxMs: 2 },
        bytesOutByType: { FRAME: 6000 },
        cpuPercentOfQuota: 20,
        eventLoopDelayP99Ms: 12,
      }),
      line({
        kind: "room-stats",
        clients: 0,
        windowS: 1,
        tick: { p50Ms: 0, p95Ms: 0, maxMs: 0 },
        bytesOutByType: {},
        cpuPercentOfQuota: 5000,
        eventLoopDelayP99Ms: 0,
      }),
      line({ kind: "spike-loop", rssMB: 90, heapUsedMB: 20, counters: { inputsLate: 1 } }),
      line({ kind: "spike-loop", rssMB: 95, heapUsedMB: 25, counters: { inputsLate: 3 } }),
    ].join("\n");
    const s = parseServerLog(text);
    expect(s.tickMs).toEqual({ p50Median: 0.2, p95Max: 0.5, maxMs: 2 });
    expect(s.bytesOutPerClientPerS).toEqual({ FRAME: 100 });
    expect(s.cpuPercentOfQuota).toEqual({ median: 20, max: 20 });
    expect(s.rssMB).toEqual({ first: 90, last: 95, growth: 5 });
    expect(s.counters).toEqual({ inputsLate: 3 });
  });
});

describe("isLocalUrl", () => {
  it("only accepts loopback", () => {
    expect(isLocalUrl("http://localhost:2571")).toBe(true);
    expect(isLocalUrl("http://127.0.0.1:2571")).toBe(true);
    expect(isLocalUrl("https://example.onrender.com")).toBe(false);
  });
});
